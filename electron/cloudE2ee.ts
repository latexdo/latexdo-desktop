/*
 * End-to-end encryption between this app and LatexDo's always-on server.
 *
 * Every request and live connection to that server passes through here. The
 * rest of the app keeps speaking the plain collaboration API (text in, text
 * out; the y-websocket protocol for live editing); this layer seals what goes
 * out and opens what comes back, so the server only ever holds ciphertext:
 *
 * - text files: a log of encrypted Yjs updates, merged here;
 * - binary files: one encrypted blob each;
 * - live edits and cursors: encrypted before they leave this computer;
 * - the project's name and people's names.
 *
 * File paths stay readable to the server (it manages the tree) and so do the
 * roles, timestamps and sizes it needs to enforce access and limits.
 */

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import {
  decryptBytes,
  decryptString,
  encryptBytes,
  encryptString,
  isEncryptedString,
  newProjectKey,
} from "./collabCrypto.js";
import type { ProjectKeyStore } from "./collabKeys.js";

export interface E2eeResponse {
  status: number;
  statusText: string;
  text: string;
}

export interface E2eeSocketHandlers {
  onOpen: () => void;
  onMessage: (data: Uint8Array) => void;
  onClose: (code: number, reason: string) => void;
  onError: () => void;
}

export interface E2eeSocket {
  send: (data: Uint8Array) => void;
  close: (code?: number, reason?: string) => void;
}

/** The plain connection to the server, provided by the collaboration bridge. */
export interface RawTransport {
  request(
    path: string,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
    timeoutMs: number,
  ): Promise<E2eeResponse>;
  openSocket(pathAndQuery: string, handlers: E2eeSocketHandlers): Promise<E2eeSocket>;
}

const messageSync = 0;
const messageAwareness = 1;
const messageProjectPresence = 4;
const messageProjectChanged = 5;
const messageUpdate = 10;
const messageLog = 11;
const messageCursor = 12;

/** Live edits are sealed and sent in small batches (fewer messages, same result). */
const sendBatchMs = 250;
/** A file whose log is longer than this is compacted into one snapshot. */
const compactAfterEntries = 40;

const shareTokenPattern = /^p([0-9a-f]{32})_[A-Za-z0-9_-]{43}$/;
const projectIdPattern = /^project_[0-9a-f]{32}$/;

export function projectIdFromShareToken(token: string): string | null {
  const match = shareTokenPattern.exec(token);
  return match ? `project_${match[1]}` : null;
}

function projectIdForPath(path: string): string | null {
  const project = /^\/api\/projects\/([^/?]+)/.exec(path)?.[1];
  if (project) {
    const id = decodeURIComponent(project);
    return projectIdPattern.test(id) ? id : null;
  }
  const token = /^\/api\/shares\/([^/?]+)/.exec(path)?.[1];
  return token ? projectIdFromShareToken(decodeURIComponent(token)) : null;
}

function reply(status: number, body?: unknown): E2eeResponse {
  return {
    status,
    statusText: "",
    text: body === undefined ? "" : JSON.stringify(body),
  };
}

function bytesFromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

class KeyMissingError extends Error {
  constructor() {
    super(
      "This shared project's encryption key is not on this computer. Open it again from its invite.",
    );
  }
}

/** One open document: the editor on one side, the server on the other. */
interface LiveSession {
  projectId: string;
  path: string;
  doc: Y.Doc;
  /** Applies a change made here (e.g. a save) and sends it everywhere. */
  applyLocal: (update: (doc: Y.Doc) => void) => void;
}

export class CloudE2ee {
  /** One ciphertext per name and project, reused so the server sees no churn. */
  private readonly sealedNames = new Map<string, string>();
  private readonly sessions = new Set<LiveSession>();

  constructor(
    private readonly keys: ProjectKeyStore,
    private readonly transport: RawTransport,
  ) {}

  private async key(projectId: string): Promise<string> {
    const key = await this.keys.get(projectId);
    if (!key) throw new KeyMissingError();
    return key;
  }

  /** Remembers the key an invite carried (the server never sees it). */
  async rememberInviteKey(token: string, key: string | undefined): Promise<void> {
    const projectId = projectIdFromShareToken(token);
    if (projectId && key) await this.keys.set(projectId, key);
  }

  async inviteKey(token: string): Promise<string | null> {
    const projectId = projectIdFromShareToken(token);
    return projectId ? this.keys.get(projectId) : null;
  }

  private async sealName(key: string, name: string): Promise<string> {
    const cacheKey = `${key}\n${name}`;
    let sealed = this.sealedNames.get(cacheKey);
    if (!sealed) {
      sealed = await encryptString(key, "", "name", name);
      this.sealedNames.set(cacheKey, sealed);
    }
    return sealed;
  }

  private async openName(key: string | null, value: unknown): Promise<unknown> {
    if (!key || !isEncryptedString(value)) return value;
    try {
      return await decryptString(key, "", "name", value);
    } catch {
      return "Unknown";
    }
  }

  /** Decrypts every name in a response (projects, people, presence). */
  private async openNames(value: unknown, key: string | null): Promise<unknown> {
    if (Array.isArray(value)) {
      return Promise.all(value.map((item) => this.openNames(item, key)));
    }
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    // An owned-project listing carries each project's own name.
    const ownKey =
      typeof record.id === "string" && projectIdPattern.test(record.id)
        ? ((await this.keys.get(record.id)) ?? key)
        : key;
    const out: Record<string, unknown> = {};
    for (const [field, item] of Object.entries(record)) {
      out[field] =
        field === "name" || field === "projectName"
          ? await this.openName(ownKey, item)
          : await this.openNames(item, ownKey);
    }
    return out;
  }

  private async withSealedName(
    headers: Record<string, string>,
    key: string,
  ): Promise<Record<string, string>> {
    const name = headers["x-latexdo-client-name"];
    return name && !isEncryptedString(name)
      ? { ...headers, "x-latexdo-client-name": await this.sealName(key, name) }
      : headers;
  }

  private async docFromEntries(
    key: string,
    projectId: string,
    entries: string[],
  ): Promise<Y.Doc> {
    const doc = new Y.Doc();
    for (const entry of entries) {
      try {
        Y.applyUpdate(
          doc,
          await decryptBytes(key, projectId, "text", bytesFromBase64(entry)),
          "server",
        );
      } catch {
        // Data this key did not seal (or damaged) is ignored, never trusted.
      }
    }
    return doc;
  }

  private liveSession(projectId: string, path: string): LiveSession | undefined {
    for (const session of this.sessions) {
      if (session.projectId === projectId && session.path === path) return session;
    }
    return undefined;
  }

  // --- HTTP ------------------------------------------------------------------

  async request(
    path: string,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
    timeoutMs: number,
  ): Promise<E2eeResponse> {
    try {
      return await this.handle(path, method, headers, body, timeoutMs);
    } catch (error) {
      if (error instanceof KeyMissingError) return reply(403, { error: error.message });
      throw error;
    }
  }

  private async handle(
    path: string,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
    timeoutMs: number,
  ): Promise<E2eeResponse> {
    const send = (
      nextPath: string,
      nextMethod: string,
      nextHeaders: Record<string, string>,
      nextBody?: string,
    ) => this.transport.request(nextPath, nextMethod, nextHeaders, nextBody, timeoutMs);
    const [pathname, query = ""] = path.split("?");
    const params = new URLSearchParams(query);

    // A new project: its key is made here and never leaves this computer.
    if (pathname === "/api/projects" && method === "POST") {
      const key = newProjectKey();
      const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      const name =
        typeof parsed.folderName === "string"
          ? parsed.folderName
          : String(parsed.name ?? "");
      const sealedBody = JSON.stringify({
        folderName: await this.sealName(key, name || "Shared project"),
      });
      const response = await send(
        path,
        method,
        await this.withSealedName(headers, key),
        sealedBody,
      );
      if (response.status !== 200) return response;
      const project = JSON.parse(response.text) as Record<string, unknown>;
      if (typeof project.id !== "string" || !projectIdPattern.test(project.id)) {
        return reply(502, { error: "The collaboration server answered unexpectedly." });
      }
      await this.keys.set(project.id, key);
      return reply(200, await this.openNames(project, key));
    }

    if (pathname === "/api/projects" && method === "GET") {
      const response = await send(path, method, headers, body);
      if (response.status !== 200) return response;
      return reply(200, await this.openNames(JSON.parse(response.text), null));
    }

    const projectId = projectIdForPath(pathname ?? "");
    if (!projectId) return send(path, method, headers, body);
    const key = await this.key(projectId);
    const sealedHeaders = await this.withSealedName(headers, key);
    const filePath = params.get("path") ?? "";
    const projectBase = `/api/projects/${encodeURIComponent(projectId)}`;

    if (pathname?.endsWith("/files/content")) {
      const live = this.liveSession(projectId, filePath);
      if (method === "GET") {
        if (live)
          return reply(200, { content: live.doc.getText("content").toString() });
        const log = await send(
          `${projectBase}/files/log?${params}`,
          "GET",
          sealedHeaders,
        );
        if (log.status === 404) return log;
        if (log.status !== 200) return log;
        const doc = await this.docFromEntries(
          key,
          projectId,
          (JSON.parse(log.text) as { entries: string[] }).entries,
        );
        return reply(200, { content: doc.getText("content").toString() });
      }
      if (method === "PUT") {
        const content = (JSON.parse(body ?? "{}") as { content?: unknown }).content;
        if (typeof content !== "string") {
          return reply(400, { error: "File content must be a string." });
        }
        const replace = (doc: Y.Doc) => {
          const text = doc.getText("content");
          if (text.toString() === content) return;
          doc.transact(() => {
            text.delete(0, text.length);
            text.insert(0, content);
          }, "http");
        };
        if (live) {
          live.applyLocal(replace);
          return reply(204);
        }
        const log = await send(
          `${projectBase}/files/log?${params}`,
          "GET",
          sealedHeaders,
        );
        const doc =
          log.status === 200
            ? await this.docFromEntries(
                key,
                projectId,
                (JSON.parse(log.text) as { entries: string[] }).entries,
              )
            : new Y.Doc();
        const before = Y.encodeStateVector(doc);
        replace(doc);
        const update = Y.encodeStateAsUpdate(doc, before);
        const response = await send(
          `${projectBase}/files/log?${params}`,
          "POST",
          sealedHeaders,
          JSON.stringify({
            data: base64(await encryptBytes(key, projectId, "text", update)),
          }),
        );
        return response.status === 200 ? reply(204) : response;
      }
    }

    if (pathname?.endsWith("/files/binary")) {
      if (method === "GET") {
        const response = await send(path, method, sealedHeaders);
        if (response.status !== 200) {
          // A text file asked for as bytes (e.g. an SVG figure).
          if (response.status === 400) {
            const text = await this.handle(
              `${projectBase}/files/content?${params}`,
              "GET",
              headers,
              undefined,
              timeoutMs,
            );
            if (text.status !== 200) return text;
            const content = (JSON.parse(text.text) as { content: string }).content;
            return reply(200, {
              base64: Buffer.from(content, "utf8").toString("base64"),
            });
          }
          return response;
        }
        const sealed = (JSON.parse(response.text) as { base64: string }).base64;
        try {
          const plain = await decryptBytes(
            key,
            projectId,
            "file",
            bytesFromBase64(sealed),
          );
          return reply(200, { base64: base64(plain) });
        } catch {
          return reply(422, { error: "This file could not be decrypted." });
        }
      }
      if (method === "PUT") {
        const plain = (JSON.parse(body ?? "{}") as { base64?: unknown }).base64;
        if (typeof plain !== "string")
          return reply(400, { error: "Missing file data." });
        const sealed = await encryptBytes(
          key,
          projectId,
          "file",
          bytesFromBase64(plain),
        );
        return send(
          path,
          method,
          sealedHeaders,
          JSON.stringify({ base64: base64(sealed) }),
        );
      }
    }

    if (pathname?.endsWith("/files/bundle") && method === "GET") {
      const response = await send(path, method, sealedHeaders);
      if (response.status !== 200) return response;
      const bundle = JSON.parse(response.text) as {
        revision?: number;
        files: Array<{ relativePath: string; entries?: string[]; base64?: string }>;
      };
      const files = [];
      for (const file of bundle.files) {
        if (file.entries) {
          const live = this.liveSession(projectId, file.relativePath);
          const doc =
            live?.doc ?? (await this.docFromEntries(key, projectId, file.entries));
          files.push({
            relativePath: file.relativePath,
            content: doc.getText("content").toString(),
          });
        } else if (typeof file.base64 === "string") {
          try {
            const plain = await decryptBytes(
              key,
              projectId,
              "file",
              bytesFromBase64(file.base64),
            );
            files.push({ relativePath: file.relativePath, base64: base64(plain) });
          } catch {
            // Skip a file that cannot be decrypted rather than compile garbage.
          }
        }
      }
      return reply(200, { revision: bundle.revision, files });
    }

    const response = await send(path, method, sealedHeaders, body);
    if (!response.text || response.status === 204) return response;
    try {
      return {
        ...response,
        text: JSON.stringify(await this.openNames(JSON.parse(response.text), key)),
      };
    } catch {
      return response;
    }
  }

  // --- Live editing ------------------------------------------------------------

  async openSocket(
    pathAndQuery: string,
    handlers: E2eeSocketHandlers,
  ): Promise<E2eeSocket> {
    const [pathname, query = ""] = pathAndQuery.split("?");
    const params = new URLSearchParams(query);
    const projectId = projectIdForPath(pathname ?? "");
    const filePath = params.get("path") ?? "";
    if (!projectId || !filePath)
      throw new Error("Invalid collaboration socket request.");
    const key = await this.key(projectId);
    const name = params.get("name");
    if (name && !isEncryptedString(name))
      params.set("name", await this.sealName(key, name));

    const doc = new Y.Doc();
    let server: E2eeSocket | null = null;
    let ready = false;
    let closed = false;
    let canEdit = false;
    let outbox: Uint8Array[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const toEditor: Uint8Array[] = [];

    const sendToEditor = (message: Uint8Array) => {
      if (closed) return;
      if (ready) handlers.onMessage(message);
      else toEditor.push(message);
    };

    const flush = async () => {
      flushTimer = null;
      if (!outbox.length || !server || !canEdit) {
        outbox = [];
        return;
      }
      const update = Y.mergeUpdates(outbox);
      outbox = [];
      const sealed = await encryptBytes(key, projectId, "text", update);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageUpdate);
      encoding.writeVarUint8Array(encoder, sealed);
      server.send(encoding.toUint8Array(encoder));
    };

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      // Edits from the server go to the editor; edits from the editor go to the
      // server; a save made here (http) goes to both.
      if (origin !== "renderer") {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.writeUpdate(encoder, update);
        sendToEditor(encoding.toUint8Array(encoder));
      }
      if (origin !== "server") {
        outbox.push(update);
        flushTimer ??= setTimeout(() => void flush(), sendBatchMs);
      }
    });

    const session: LiveSession = {
      projectId,
      path: filePath,
      doc,
      applyLocal: (change) => change(doc),
    };

    const compact = async (seq: number) => {
      const snapshot = await encryptBytes(
        key,
        projectId,
        "text",
        Y.encodeStateAsUpdate(doc),
      );
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-latexdo-session": params.get("session") ?? "",
        "x-latexdo-client": params.get("clientId") ?? "",
        ...(params.get("share")
          ? { "x-latexdo-share-token": params.get("share")! }
          : {}),
      };
      await this.transport
        .request(
          `/api/projects/${encodeURIComponent(projectId)}/files/log?path=${encodeURIComponent(filePath)}`,
          "POST",
          headers,
          JSON.stringify({ data: base64(snapshot), replaceUpTo: seq }),
          60_000,
        )
        .catch(() => undefined);
    };

    const fromServer = async (data: Uint8Array) => {
      let decoder: decoding.Decoder;
      let type: number;
      try {
        decoder = decoding.createDecoder(data);
        type = decoding.readVarUint(decoder);
      } catch {
        return;
      }
      if (type === messageLog) {
        const seq = decoding.readVarUint(decoder);
        const count = decoding.readVarUint(decoder);
        const sealedUpdates: Uint8Array[] = [];
        for (let index = 0; index < count; index += 1) {
          sealedUpdates.push(decoding.readVarUint8Array(decoder));
        }
        const role = decoding.hasContent(decoder)
          ? decoding.readVarString(decoder)
          : "editor";
        canEdit = role === "editor" || role === "admin";
        for (const sealed of sealedUpdates) {
          try {
            Y.applyUpdate(
              doc,
              await decryptBytes(key, projectId, "text", sealed),
              "server",
            );
          } catch {
            // Ignore anything this key did not seal.
          }
        }
        // The editor connects now, seeing the whole document at once.
        ready = true;
        this.sessions.add(session);
        handlers.onOpen();
        for (const message of toEditor.splice(0)) handlers.onMessage(message);
        if (canEdit) {
          // Ask the editor for anything the server is missing (offline edits).
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.writeSyncStep1(encoder, doc);
          handlers.onMessage(encoding.toUint8Array(encoder));
          if (count > compactAfterEntries) void compact(seq);
        }
        return;
      }
      if (type === messageUpdate) {
        decoding.readVarUint(decoder);
        try {
          const update = await decryptBytes(
            key,
            projectId,
            "text",
            decoding.readVarUint8Array(decoder),
          );
          Y.applyUpdate(doc, update, "server");
        } catch {
          // Ignore anything this key did not seal.
        }
        return;
      }
      if (type === messageCursor) {
        try {
          const plain = await decryptBytes(
            key,
            projectId,
            "cursor",
            decoding.readVarUint8Array(decoder),
          );
          if (plain[0] === messageAwareness) sendToEditor(plain);
        } catch {
          // Ignore anything this key did not seal.
        }
        return;
      }
      if (type === messageProjectPresence) {
        try {
          const raw = JSON.parse(decoding.readVarString(decoder)) as unknown;
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageProjectPresence);
          encoding.writeVarString(
            encoder,
            JSON.stringify(await this.openNames(raw, key)),
          );
          sendToEditor(encoding.toUint8Array(encoder));
        } catch {
          // A malformed presence frame is dropped.
        }
        return;
      }
      if (type === messageProjectChanged) sendToEditor(data);
    };

    const shutdown = (code: number, reason: string) => {
      if (closed) return;
      if (flushTimer) {
        clearTimeout(flushTimer);
        void flush();
      }
      closed = true;
      this.sessions.delete(session);
      doc.destroy();
      handlers.onClose(code, reason);
    };

    server = await this.transport.openSocket(`${pathname}?${params}`, {
      onOpen: () => undefined,
      onMessage: (data) => void fromServer(data),
      onClose: (code, reason) => shutdown(code, reason),
      onError: () => handlers.onError(),
    });

    return {
      send: (data) => {
        if (closed || !ready) return;
        let decoder: decoding.Decoder;
        let type: number;
        try {
          decoder = decoding.createDecoder(data);
          type = decoding.readVarUint(decoder);
        } catch {
          return;
        }
        if (type === messageSync) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageSync);
          try {
            if (!canEdit) {
              // Viewers only read: answer their questions, never take edits.
              const inner = syncProtocol.readSyncMessage(
                decoder,
                encoder,
                new Y.Doc(),
                "renderer",
              );
              if (inner === syncProtocol.messageYjsSyncStep1) {
                const reply = encoding.createEncoder();
                encoding.writeVarUint(reply, messageSync);
                syncProtocol.writeSyncStep2(reply, doc);
                handlers.onMessage(encoding.toUint8Array(reply));
              }
              return;
            }
            syncProtocol.readSyncMessage(decoder, encoder, doc, "renderer");
          } catch {
            return;
          }
          if (encoding.length(encoder) > 1)
            handlers.onMessage(encoding.toUint8Array(encoder));
          return;
        }
        if (type === messageAwareness && server) {
          void encryptBytes(key, projectId, "cursor", data).then((sealed) => {
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, messageCursor);
            encoding.writeVarUint8Array(encoder, sealed);
            server?.send(encoding.toUint8Array(encoder));
          });
        }
      },
      close: (code, reason) => {
        server?.close(code, reason);
        shutdown(code ?? 1000, reason ?? "");
      },
    };
  }
}
