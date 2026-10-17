/*
 * A guest's connection to a shared project on LatexDo's always-on server, from
 * a web browser. It speaks exactly what the desktop app's encryption layer
 * (electron/cloudE2ee.ts) speaks, so guests and desktop users edit together:
 *
 * - HTTP for joining, the file tree and figures;
 * - one WebSocket per open file carrying encrypted Yjs updates (10), the
 *   file's encrypted log on connect (11) and encrypted cursors (12).
 *
 * Nothing here touches the page, so the same code runs in tests under Node.
 */

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import {
  base64ToBytes,
  bytesToBase64,
  decryptBytes,
  decryptString,
  encryptBytes,
  encryptString,
  isEncryptedString,
} from "./crypto";
import type { WebInvite } from "./invite";

const messageAwareness = 1;
const messageProjectPresence = 4;
const messageProjectChanged = 5;
const messageUpdate = 10;
const messageLog = 11;
const messageCursor = 12;

/** Live edits are sealed and sent in small batches, as the desktop app does. */
const sendBatchMs = 250;
/** A file whose log is longer than this is compacted into one snapshot. */
const compactAfterEntries = 40;

export interface GuestIdentity {
  sessionId: string;
  clientId: string;
  name: string;
  color: string;
  emoji: string;
}

export interface TreeEntry {
  name: string;
  relativePath: string;
  type: "file" | "directory";
  binary?: boolean;
  children?: TreeEntry[];
}

export interface Person {
  clientId: string;
  name: string;
  currentFile: string | null;
}

export type JoinResult =
  | { status: "ready"; projectName: string; role: string; users: Person[] }
  | { status: "pending" }
  | { status: "error"; message: string; code?: string };

export interface GuestEnvironment {
  fetch: typeof fetch;
  WebSocket: typeof WebSocket;
}

export class GuestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export class GuestSession {
  private sealedName: Promise<string> | null = null;
  readonly projectBase: string;

  constructor(
    readonly origin: string,
    readonly invite: WebInvite,
    readonly identity: GuestIdentity,
    private readonly env: GuestEnvironment = {
      fetch: globalThis.fetch.bind(globalThis),
      WebSocket: globalThis.WebSocket,
    },
  ) {
    this.projectBase = `/api/projects/${encodeURIComponent(invite.projectId)}`;
  }

  /** The guest's name, sealed once so the server sees the same ciphertext. */
  name(): Promise<string> {
    this.sealedName ??= encryptString(this.invite.key, "", "name", this.identity.name);
    return this.sealedName;
  }

  private async headers(): Promise<Record<string, string>> {
    return {
      "content-type": "application/json",
      "x-latexdo-session": this.identity.sessionId,
      "x-latexdo-client": this.identity.clientId,
      "x-latexdo-client-name": await this.name(),
      "x-latexdo-share-token": this.invite.token,
    };
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.env.fetch(`${this.origin}${path}`, {
      method,
      headers: await this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      // Not JSON: reported below by status.
    }
    if (!response.ok) {
      throw new GuestError(
        response.status,
        typeof parsed.error === "string"
          ? parsed.error
          : `The server answered ${response.status}.`,
        typeof parsed.code === "string" ? parsed.code : undefined,
      );
    }
    return parsed as T;
  }

  async openName(value: unknown): Promise<string> {
    if (!isEncryptedString(value)) return typeof value === "string" ? value : "";
    try {
      return await decryptString(this.invite.key, "", "name", value);
    } catch {
      return "Unknown";
    }
  }

  async openPeople(value: unknown): Promise<Person[]> {
    if (!Array.isArray(value)) return [];
    const people: Person[] = [];
    for (const item of value as Array<Record<string, unknown>>) {
      if (!item || typeof item.clientId !== "string") continue;
      people.push({
        clientId: item.clientId,
        name: (await this.openName(item.name)) || "Guest",
        currentFile: typeof item.currentFile === "string" ? item.currentFile : null,
      });
    }
    return people;
  }

  /** Asks to join. With approval on, the owner has to let the guest in first. */
  async join(): Promise<JoinResult> {
    try {
      const opened = await this.request<{
        project?: { name?: unknown };
        collaboration?: { currentUserRole?: unknown; users?: unknown };
      }>("POST", `/api/shares/${encodeURIComponent(this.invite.token)}/open`, {});
      return {
        status: "ready",
        projectName: (await this.openName(opened.project?.name)) || "Shared project",
        role:
          typeof opened.collaboration?.currentUserRole === "string"
            ? opened.collaboration.currentUserRole
            : "viewer",
        users: await this.openPeople(opened.collaboration?.users),
      };
    } catch (error) {
      if (error instanceof GuestError && error.code === "approval-pending") {
        return { status: "pending" };
      }
      return {
        status: "error",
        message: error instanceof Error ? error.message : "Could not open the project.",
        code: error instanceof GuestError ? error.code : undefined,
      };
    }
  }

  async tree(): Promise<TreeEntry[]> {
    const tree = await this.request<unknown>("GET", `${this.projectBase}/files`);
    return Array.isArray(tree) ? (tree as TreeEntry[]) : [];
  }

  async presence(currentFile: string | null): Promise<Person[]> {
    const state = await this.request<{ users?: unknown }>(
      "POST",
      `/api/shares/${encodeURIComponent(this.invite.token)}/presence`,
      { currentFile },
    );
    return this.openPeople(state.users);
  }

  /** A figure, PDF or other file, decrypted. */
  async readBinary(path: string): Promise<Uint8Array> {
    const { base64 } = await this.request<{ base64: string }>(
      "GET",
      `${this.projectBase}/files/binary?path=${encodeURIComponent(path)}`,
    );
    return decryptBytes(
      this.invite.key,
      this.invite.projectId,
      "file",
      base64ToBytes(base64),
    );
  }

  async socketUrl(path: string): Promise<string> {
    const url = new URL(`${this.projectBase}/files/collaborate`, this.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("path", path);
    url.searchParams.set("session", this.identity.sessionId);
    url.searchParams.set("clientId", this.identity.clientId);
    url.searchParams.set("name", await this.name());
    url.searchParams.set("share", this.invite.token);
    return url.toString();
  }

  openFile(path: string, events: LiveFileEvents = {}): LiveFile {
    return new LiveFile(this, path, events, this.env.WebSocket);
  }
}

export type LiveStatus = "connecting" | "live" | "offline" | "closed";

export interface LiveFileEvents {
  onStatus?: (status: LiveStatus, detail?: string) => void;
  onReady?: (canEdit: boolean) => void;
  onPresence?: (people: Person[]) => void;
  onProjectChanged?: () => void;
}

/** One open text file, kept in sync with everyone through the server. */
export class LiveFile {
  readonly doc = new Y.Doc();
  readonly text = this.doc.getText("content");
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  canEdit = false;
  ready = false;
  private socket: WebSocket | null = null;
  private closed = false;
  private retryMs = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private outbox: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Messages are decrypted in order, one after another. */
  private inbox: Promise<void> = Promise.resolve();

  constructor(
    private readonly session: GuestSession,
    readonly path: string,
    private readonly events: LiveFileEvents,
    private readonly SocketClass: typeof WebSocket,
  ) {
    const { identity } = session;
    this.awareness.setLocalState({
      user: { name: identity.name, color: identity.color, emoji: identity.emoji },
      file: path,
    });
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "server" || !this.ready || !this.canEdit) return;
      this.outbox.push(update);
      this.flushTimer ??= setTimeout(() => void this.flush(), sendBatchMs);
    });
    this.awareness.on(
      "update",
      (
        changes: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        if (origin !== "local") return;
        const clients = [...changes.added, ...changes.updated, ...changes.removed];
        void this.sendCursor(
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients),
        );
      },
    );
    // After the caller has stored this file, so status events find it.
    queueMicrotask(() => void this.connect());
  }

  private get key(): string {
    return this.session.invite.key;
  }

  private get projectId(): string {
    return this.session.invite.projectId;
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    this.events.onStatus?.("connecting");
    let socket: WebSocket;
    try {
      socket = new this.SocketClass(await this.session.socketUrl(this.path));
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.closed) {
      socket.close();
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const data = new Uint8Array(event.data);
      this.inbox = this.inbox.then(() => this.receive(data)).catch(() => undefined);
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.ready = false;
      this.dropRemoteCursors();
      if (this.closed) return;
      // Policy closes (removed, sharing stopped) are final; a new role is not.
      if (event.code === 1008 && event.reason !== "Permissions changed") {
        this.closed = true;
        this.events.onStatus?.("closed", event.reason || "The connection was closed.");
        return;
      }
      this.events.onStatus?.("offline");
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 15_000);
  }

  private send(message: Uint8Array): void {
    if (this.socket && this.socket.readyState === 1) this.socket.send(message);
  }

  private async receive(data: Uint8Array): Promise<void> {
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
      const sealed: Uint8Array[] = [];
      for (let index = 0; index < count; index++) {
        sealed.push(decoding.readVarUint8Array(decoder));
      }
      const role = decoding.hasContent(decoder)
        ? decoding.readVarString(decoder)
        : "viewer";
      this.canEdit = role === "editor" || role === "admin";
      // What the server holds, to find what only this browser has (offline edits).
      const server = new Y.Doc();
      for (const item of sealed) {
        try {
          const update = await decryptBytes(this.key, this.projectId, "text", item);
          Y.applyUpdate(server, update);
          Y.applyUpdate(this.doc, update, "server");
        } catch {
          // Data this key did not seal (or damaged) is ignored, never trusted.
        }
      }
      this.ready = true;
      this.retryMs = 1000;
      this.events.onStatus?.("live");
      this.events.onReady?.(this.canEdit);
      if (this.canEdit) {
        const missing = Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(server));
        if (hasContent(missing)) {
          this.outbox.push(missing);
          await this.flush();
        }
        if (count > compactAfterEntries) void this.compact(seq);
      }
      server.destroy();
      // Show this person's cursor to everyone already here.
      void this.sendCursor(
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
      );
      return;
    }
    if (type === messageUpdate) {
      decoding.readVarUint(decoder);
      try {
        Y.applyUpdate(
          this.doc,
          await decryptBytes(
            this.key,
            this.projectId,
            "text",
            decoding.readVarUint8Array(decoder),
          ),
          "server",
        );
      } catch {
        // Ignore anything this key did not seal.
      }
      return;
    }
    if (type === messageCursor) {
      try {
        const plain = await decryptBytes(
          this.key,
          this.projectId,
          "cursor",
          decoding.readVarUint8Array(decoder),
        );
        const inner = decoding.createDecoder(plain);
        if (decoding.readVarUint(inner) !== messageAwareness) return;
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(inner),
          "remote",
        );
      } catch {
        // Ignore anything this key did not seal.
      }
      return;
    }
    if (type === messageProjectPresence) {
      try {
        const raw = JSON.parse(decoding.readVarString(decoder)) as { users?: unknown };
        this.events.onPresence?.(await this.session.openPeople(raw.users));
      } catch {
        // A malformed presence frame is dropped.
      }
      return;
    }
    if (type === messageProjectChanged) this.events.onProjectChanged?.();
  }

  private async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.outbox.length) return;
    if (!this.ready || !this.canEdit) {
      // Kept in the document; sent as the difference after reconnecting.
      this.outbox = [];
      return;
    }
    const update = Y.mergeUpdates(this.outbox);
    this.outbox = [];
    const sealed = await encryptBytes(this.key, this.projectId, "text", update);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageUpdate);
    encoding.writeVarUint8Array(encoder, sealed);
    this.send(encoding.toUint8Array(encoder));
  }

  private async sendCursor(update: Uint8Array): Promise<void> {
    if (!this.ready) return;
    const inner = encoding.createEncoder();
    encoding.writeVarUint(inner, messageAwareness);
    encoding.writeVarUint8Array(inner, update);
    const sealed = await encryptBytes(
      this.key,
      this.projectId,
      "cursor",
      encoding.toUint8Array(inner),
    );
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageCursor);
    encoding.writeVarUint8Array(encoder, sealed);
    this.send(encoding.toUint8Array(encoder));
  }

  private async compact(seq: number): Promise<void> {
    const snapshot = await encryptBytes(
      this.key,
      this.projectId,
      "text",
      Y.encodeStateAsUpdate(this.doc),
    );
    await this.session
      .request(
        "POST",
        `${this.session.projectBase}/files/log?path=${encodeURIComponent(this.path)}`,
        { data: bytesToBase64(snapshot), replaceUpTo: seq },
      )
      .catch(() => undefined);
  }

  private dropRemoteCursors(): void {
    const others = [...this.awareness.getStates().keys()].filter(
      (client) => client !== this.doc.clientID,
    );
    if (others.length) {
      awarenessProtocol.removeAwarenessStates(this.awareness, others, "remote");
    }
  }

  /** Sends what is still pending, then leaves. */
  async close(): Promise<void> {
    if (this.closed) return;
    await this.flush();
    this.awareness.setLocalState(null);
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.socket?.close(1000, "Closed");
    this.socket = null;
    this.awareness.destroy();
    this.doc.destroy();
    this.events.onStatus?.("closed");
  }
}

/** An encoded Yjs update that actually changes something. */
function hasContent(update: Uint8Array): boolean {
  const decoded = Y.decodeUpdate(update);
  return decoded.structs.length > 0 || decoded.ds.clients.size > 0;
}
