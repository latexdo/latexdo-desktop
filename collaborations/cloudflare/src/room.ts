/*
 * One shared project, always on. Everything in it is end-to-end encrypted by
 * the LatexDo app before it arrives: this room stores and relays ciphertext it
 * cannot read. What it still enforces is who may do what (members, roles,
 * invites, approval), how much may be stored, and the file tree (paths are
 * the only plaintext metadata, so moves and copies work).
 *
 * A text file is a log of encrypted Yjs updates; the apps merge them. Live
 * edits are relayed at once and saved in batches by an alarm (well before the
 * room can hibernate); an app that reconnects re-sends anything the log is
 * missing, so no edit is lost. Apps compact a long log into one encrypted
 * snapshot. A binary file is one encrypted blob.
 */

import { DurableObject } from "cloudflare:workers";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import {
  HttpError,
  base64Decode,
  base64Encode,
  empty,
  errorResponse,
  isRole,
  json,
  limits,
  newShareToken,
  normalizeRelativePath,
  requestIdentity,
  requestShareToken,
  roleRank,
  sameSecret,
  sha256Hex,
  type Identity,
  type Role,
} from "./shared";
import type { UsageMeter } from "./usage";

/** Project presence (plaintext JSON: ids, roles and encrypted names). */
const messageProjectPresence = 4;
/** The file tree changed: the client reloads it. */
const messageProjectChanged = 5;
/** Admins only: who is waiting to join (plaintext JSON, encrypted names). */
const messageJoinRequests = 6;
/** client → room: one encrypted update. room → client: (seq, update). */
const messageUpdate = 10;
/** room → client on connect: (seq, count, updates…, role), the whole log. */
const messageLog = 11;
/** An encrypted cursor/selection, relayed as is. */
const messageCursor = 12;

interface Permission {
  clientId: string;
  name: string;
  role: Role | null;
  sessionHash: string;
  createdAt: number;
  updatedAt: number;
}

interface PendingRequest {
  clientId: string;
  name: string;
  sessionHash: string;
  requestedAt: number;
}

interface ProjectMeta {
  schemaVersion: 2;
  id: string;
  /** Encrypted by the owner's app. */
  name: string;
  ownerSessionHash: string;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
  shareToken: string | null;
  retiredShareTokens: string[];
  sharingStopped: boolean;
  requireApproval: boolean;
  permissions: Record<string, Permission>;
  pending: Record<string, PendingRequest>;
  revision: number;
}

interface Presence {
  clientId: string;
  name: string;
  currentFile: string | null;
  lastSeen: number;
}

interface SocketInfo {
  path: string;
  clientId: string;
  sessionHash: string;
  name: string;
  role: Role;
}

interface Auth {
  meta: ProjectMeta;
  identity: Identity;
  sessionHash: string;
  role: Role;
}

type EntryRow = {
  path: string;
  type: string;
  binary: number;
  size: number;
  updated: number;
};

interface TreeEntry {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "directory";
  binary?: boolean;
  children?: TreeEntry[];
}

interface RoomEnv {
  USAGE: DurableObjectNamespace<UsageMeter>;
}

const dayMs = 24 * 60 * 60 * 1000;

function now(): number {
  return Date.now();
}

function fileTag(path: string): string {
  return `f:${path}`;
}

function clientTag(clientId: string): string {
  return `c:${clientId}`;
}

function inside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** A batch of updates stored as one record: count, then each update. */
function encodeRecord(updates: Uint8Array[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, updates.length);
  for (const update of updates) encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

function decodeRecord(bytes: Uint8Array): Uint8Array[] {
  const decoder = decoding.createDecoder(bytes);
  const count = decoding.readVarUint(decoder);
  const updates: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    updates.push(decoding.readVarUint8Array(decoder));
  }
  return updates;
}

export class ProjectRoom extends DurableObject<RoomEnv> {
  private readonly sql: SqlStorage;
  private meta: ProjectMeta | null = null;
  private readonly presence = new Map<string, Presence>();
  /** Updates relayed but not yet saved, per file. */
  private readonly pending = new Map<
    string,
    Array<{ seq: number; data: Uint8Array }>
  >();
  private readonly nextSeq = new Map<string, number>();
  private flushScheduled = false;
  private reportedBytes = -1;

  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entries (
        path TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        binary INTEGER NOT NULL DEFAULT 0,
        size INTEGER NOT NULL DEFAULT 0,
        updated INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS logs (
        path TEXT NOT NULL,
        seq INTEGER NOT NULL,
        part INTEGER NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY (path, seq, part)
      );
      CREATE TABLE IF NOT EXISTS blobs (
        path TEXT NOT NULL,
        part INTEGER NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY (path, part)
      );
    `);
  }

  // --- Requests ------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (parts[0] === "internal" && parts[1] === "create") {
        return await this.create(request, url);
      }
      if (parts[0] === "api" && parts[1] === "projects") {
        return await this.projectRoute(request, url, parts);
      }
      if (parts[0] === "api" && parts[1] === "shares") {
        return await this.shareRoute(request, url, parts);
      }
      throw new HttpError(404, "Route not found.");
    } catch (error) {
      return errorResponse(error);
    } finally {
      // Routes that ignore a payload (or reject before parsing it) still own
      // its stream. Drain it without buffering before returning so the
      // forwarding Worker finishes pumping before the request lifetime ends.
      // Cancelling alone does not wait for workerd's forwarding pump.
      if (request.body && !request.bodyUsed && !request.body.locked) {
        await request.body.pipeTo(new WritableStream());
      }
    }
  }

  private async body(request: Request): Promise<Record<string, unknown>> {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > limits.maxJsonBytes)
      throw new HttpError(413, "Request body is too large.");
    const text = await request.text();
    if (text.length > limits.maxJsonBytes)
      throw new HttpError(413, "Request body is too large.");
    if (!text) return {};
    try {
      const value = JSON.parse(text) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error();
      return value as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "Request body must be JSON.");
    }
  }

  private async create(request: Request, url: URL): Promise<Response> {
    if (this.readMeta()) throw new HttpError(409, "Project already exists.");
    const identity = requestIdentity(request, url);
    const body = await this.body(request);
    const projectId = url.searchParams.get("id") ?? "";
    const sessionHash = await sha256Hex(identity.sessionId);
    const timestamp = now();
    const rawName =
      typeof body.folderName === "string"
        ? body.folderName
        : typeof body.name === "string"
          ? body.name
          : "";
    const name =
      rawName.trim().slice(0, limits.maxNameChars) || "LatexDo Shared Project";
    const meta: ProjectMeta = {
      schemaVersion: 2,
      id: projectId,
      name,
      ownerSessionHash: sessionHash,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActiveAt: timestamp,
      shareToken: null,
      retiredShareTokens: [],
      sharingStopped: false,
      requireApproval: true,
      permissions: {
        [identity.clientId]: {
          clientId: identity.clientId,
          name: identity.clientName,
          role: "admin",
          sessionHash,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
      pending: {},
      revision: 1,
    };
    this.writeMeta(meta);
    await this.scheduleCleanup();
    return json(200, { id: projectId, rootPath: "", name });
  }

  private async projectRoute(
    request: Request,
    url: URL,
    parts: string[],
  ): Promise<Response> {
    const route = parts.slice(3).join("/");
    const method = request.method;

    // Stopping sharing deletes the copy: only its owner may.
    if (route === "" && method === "DELETE") {
      const auth = await this.authorize(request, url, "admin");
      if (auth.meta.ownerSessionHash !== auth.sessionHash) {
        throw new HttpError(403, "Only the owner can delete this project.");
      }
      await this.deleteProject("Project deleted");
      return json(200, { deleted: true });
    }
    if (route === "files/collaborate") return await this.openSocket(request, url);
    if (route === "files" && method === "GET") {
      await this.authorize(request, url, "viewer");
      return json(200, this.tree());
    }
    if (route === "files" && method === "POST") {
      await this.authorize(request, url, "editor");
      const body = await this.body(request);
      const path = normalizeRelativePath(body.relativePath);
      this.createEntry(path, body.type);
      return json(200, { relativePath: path });
    }
    if (route === "files" && method === "DELETE") {
      await this.authorize(request, url, "editor");
      this.deleteEntry(normalizeRelativePath(url.searchParams.get("path")));
      return empty();
    }
    if (route === "files/content") {
      throw new HttpError(
        400,
        "This project is end-to-end encrypted. Update LatexDo to open it.",
        "encrypted",
      );
    }
    if (route === "files/log") {
      const path = normalizeRelativePath(url.searchParams.get("path"));
      if (method === "GET") {
        await this.authorize(request, url, "viewer");
        const { seq, updates } = this.readLog(path);
        return json(200, { seq, entries: updates.map(base64Encode) });
      }
      if (method === "POST") {
        await this.authorize(request, url, "editor");
        const body = await this.body(request);
        const data = this.decodeData(body.data);
        if (body.replaceUpTo !== undefined) {
          if (
            typeof body.replaceUpTo !== "number" ||
            !Number.isSafeInteger(body.replaceUpTo)
          ) {
            throw new HttpError(400, "Invalid compaction point.");
          }
          this.compact(path, body.replaceUpTo, data);
          return json(200, { seq: body.replaceUpTo });
        }
        const seq = this.appendUpdate(path, data, null, true);
        return json(200, { seq });
      }
    }
    if (route === "files/binary") {
      const path = normalizeRelativePath(url.searchParams.get("path"));
      if (method === "GET") {
        await this.authorize(request, url, "viewer");
        return json(200, { base64: base64Encode(this.readBlob(path)) });
      }
      if (method === "PUT") {
        await this.authorize(request, url, "editor");
        const body = await this.body(request);
        await this.writeBlob(path, this.decodeData(body.base64));
        return empty();
      }
    }
    if (route === "files/bundle" && method === "GET") {
      await this.authorize(request, url, "viewer");
      return json(200, this.bundle());
    }
    if (route === "files/exists" && method === "GET") {
      await this.authorize(request, url, "viewer");
      const path = normalizeRelativePath(url.searchParams.get("path"));
      return json(200, { exists: this.entry(path) !== null || this.hasChildren(path) });
    }
    if (route === "files/move" && method === "POST") {
      await this.authorize(request, url, "editor");
      const body = await this.body(request);
      const to = this.moveEntry(
        normalizeRelativePath(body.fromRelativePath),
        normalizeRelativePath(body.toRelativePath),
      );
      return json(200, { relativePath: to });
    }
    if (route === "files/copy" && method === "POST") {
      await this.authorize(request, url, "editor");
      const body = await this.body(request);
      const to = this.copyEntry(
        normalizeRelativePath(body.fromRelativePath),
        normalizeRelativePath(body.toRelativePath),
      );
      return json(200, { relativePath: to });
    }
    if (route === "share" && (method === "GET" || method === "POST")) {
      const auth = await this.authorize(
        request,
        url,
        method === "POST" ? "admin" : "viewer",
      );
      if (method === "POST") this.ensureShare(auth.meta);
      return json(200, this.state(auth));
    }
    if (route === "share" && method === "DELETE") {
      const auth = await this.authorize(request, url, "admin");
      this.stopShare(auth.meta);
      return json(200, this.state(auth));
    }
    if (route === "share/rotate" && method === "POST") {
      const auth = await this.authorize(request, url, "admin");
      this.rotateShare(auth.meta);
      return json(200, this.state(auth));
    }
    throw new HttpError(404, "Project route not found.");
  }

  private async shareRoute(
    request: Request,
    url: URL,
    parts: string[],
  ): Promise<Response> {
    const token = parts[2] ?? "";
    const route = parts.slice(3).join("/");
    url.searchParams.set("share", token);
    const method = request.method;

    if (route === "open" && method === "POST") {
      const auth = await this.authorize(request, url, "viewer");
      this.touchPresence(auth, null);
      return json(200, {
        project: { id: auth.meta.id, rootPath: "", name: auth.meta.name },
        collaboration: this.state(auth),
      });
    }
    if (route === "presence" && method === "POST") {
      const auth = await this.authorize(request, url, "viewer");
      const body = await this.body(request);
      const currentFile =
        body.currentFile === null || body.currentFile === undefined
          ? null
          : normalizeRelativePath(body.currentFile);
      this.touchPresence(auth, currentFile);
      return json(200, this.state(auth));
    }
    if (route === "permissions" && method === "GET") {
      const auth = await this.authorize(request, url, "viewer");
      return json(200, {
        permissions: this.permissionList(auth.meta, auth.identity.clientId),
        isAdmin: auth.role === "admin",
        currentUserRole: auth.role,
        requireApproval: auth.meta.requireApproval,
        ...(auth.role === "admin" ? { pending: this.pendingList(auth.meta) } : {}),
      });
    }
    if (route === "approval" && method === "PUT") {
      const auth = await this.authorize(request, url, "admin");
      const body = await this.body(request);
      if (typeof body.requireApproval !== "boolean") {
        throw new HttpError(400, "Invalid approval setting.");
      }
      auth.meta.requireApproval = body.requireApproval;
      // Turning approval off must not silently admit people who were waiting.
      if (!body.requireApproval) auth.meta.pending = {};
      this.writeMeta(auth.meta);
      this.broadcastJoinRequests(auth.meta);
      return json(200, this.state(auth));
    }
    if (route.startsWith("pending/") && method === "POST") {
      const auth = await this.authorize(request, url, "admin");
      const body = await this.body(request);
      const pendingClientId = parts[4] ?? "";
      const pending = Object.hasOwn(auth.meta.pending, pendingClientId)
        ? auth.meta.pending[pendingClientId]
        : undefined;
      if (!pending) throw new HttpError(404, "Join request not found.");
      if (body.action !== "approve" && body.action !== "deny") {
        throw new HttpError(400, "Invalid join request decision.");
      }
      const grantedRole = body.role === undefined ? "editor" : body.role;
      if (body.action === "approve" && !isRole(grantedRole)) {
        throw new HttpError(400, "Invalid role.");
      }
      delete auth.meta.pending[pendingClientId];
      // A denied request keeps its session binding with no role, like a removed
      // collaborator, so the same device cannot simply ask again.
      auth.meta.permissions[pendingClientId] = {
        clientId: pendingClientId,
        name: pending.name,
        role: body.action === "approve" ? (grantedRole as Role) : null,
        sessionHash: pending.sessionHash,
        createdAt: now(),
        updatedAt: now(),
      };
      this.writeMeta(auth.meta);
      this.broadcastJoinRequests(auth.meta);
      return json(200, this.state(auth));
    }
    if (route === "permissions" && method === "PUT") {
      const auth = await this.authorize(request, url, "admin");
      const body = await this.body(request);
      if (!isRole(body.role) || typeof body.clientId !== "string") {
        throw new HttpError(400, "Invalid permission update.");
      }
      if (body.clientId === auth.identity.clientId) {
        throw new HttpError(400, "You cannot change your own role.");
      }
      const existing = Object.hasOwn(auth.meta.permissions, body.clientId)
        ? auth.meta.permissions[body.clientId]
        : undefined;
      if (!existing) throw new HttpError(404, "Collaborator not found.");
      existing.role = body.role;
      existing.updatedAt = now();
      this.writeMeta(auth.meta);
      this.closeClient(body.clientId, 1008, "Permissions changed");
      return json(200, {
        clientId: existing.clientId,
        name: existing.name,
        role: existing.role,
      });
    }
    if (route.startsWith("collaborators/") && method === "DELETE") {
      const auth = await this.authorize(request, url, "admin");
      const removeId = parts[4] ?? "";
      if (!removeId || removeId === auth.identity.clientId) {
        throw new HttpError(400, "Invalid collaborator removal.");
      }
      const permission = Object.hasOwn(auth.meta.permissions, removeId)
        ? auth.meta.permissions[removeId]
        : undefined;
      if (!permission) throw new HttpError(404, "Collaborator not found.");
      const admins = Object.values(auth.meta.permissions).filter(
        (item) => item.clientId !== removeId && item.role === "admin",
      );
      if (!admins.length)
        throw new HttpError(400, "A project must keep at least one admin.");
      // Keep the session binding so an old invite cannot re-enroll them, and
      // retire the invite so they cannot come back under a new identity.
      permission.role = null;
      this.presence.delete(removeId);
      this.rotateShare(auth.meta);
      this.closeClient(removeId, 1008, "Removed from project");
      this.broadcastPresence();
      return empty();
    }
    throw new HttpError(404, "Share route not found.");
  }

  // --- Access --------------------------------------------------------------

  private readMeta(): ProjectMeta | null {
    if (this.meta) return this.meta;
    const row = this.sql
      .exec<{ value: string }>("SELECT value FROM kv WHERE key = 'meta'")
      .toArray()[0];
    if (!row) return null;
    this.meta = JSON.parse(row.value) as ProjectMeta;
    this.meta.requireApproval = this.meta.requireApproval !== false;
    return this.meta;
  }

  private writeMeta(meta: ProjectMeta): void {
    meta.updatedAt = now();
    this.meta = meta;
    this.sql.exec(
      "INSERT INTO kv (key, value) VALUES ('meta', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(meta),
    );
  }

  private projectRole(
    meta: ProjectMeta,
    identity: Identity,
    sessionHash: string,
    token: string,
  ): Role | null {
    if (meta.ownerSessionHash === sessionHash) return "admin";
    const existing = Object.hasOwn(meta.permissions, identity.clientId)
      ? meta.permissions[identity.clientId]
      : undefined;
    // Client ids are public labels, not credentials: a permission belongs to
    // the session that earned it.
    if (existing) return existing.sessionHash === sessionHash ? existing.role : null;
    return token && meta.shareToken && sameSecret(token, meta.shareToken)
      ? "editor"
      : null;
  }

  private async authorize(request: Request, url: URL, minimum: Role): Promise<Auth> {
    const identity = requestIdentity(request, url);
    const token = requestShareToken(request, url);
    const sessionHash = await sha256Hex(identity.sessionId);
    const meta = this.readMeta();
    if (!meta) throw new HttpError(404, "Project not found.");
    const isOwner = meta.ownerSessionHash === sessionHash;
    if (meta.sharingStopped && !isOwner) {
      throw new HttpError(
        403,
        "The owner has stopped sharing this project.",
        "sharing-stopped",
      );
    }
    const role = this.projectRole(meta, identity, sessionHash, token);
    const existing = Object.hasOwn(meta.permissions, identity.clientId)
      ? meta.permissions[identity.clientId]
      : undefined;
    if (!role) {
      if (existing && existing.role === null && existing.sessionHash === sessionHash) {
        throw new HttpError(
          403,
          "The owner declined or removed your access to this project.",
          "access-removed",
        );
      }
      if (!existing && token && meta.retiredShareTokens.includes(token)) {
        throw new HttpError(
          403,
          "This invite is no longer valid. Ask the owner for a new one.",
          "invite-expired",
        );
      }
      throw new HttpError(403, "You do not have access to this project.");
    }
    if (!existing && !isOwner && meta.requireApproval) {
      this.recordPending(meta, identity, sessionHash);
      throw new HttpError(
        403,
        "Waiting for the project owner to let you in.",
        "approval-pending",
      );
    }
    if (roleRank(role) < roleRank(minimum)) {
      throw new HttpError(403, "You do not have access to this project.");
    }
    const nextRole = isOwner ? "admin" : role;
    let changed = false;
    if (
      !existing ||
      existing.name !== identity.clientName ||
      existing.role !== nextRole ||
      existing.sessionHash !== sessionHash
    ) {
      meta.permissions[identity.clientId] = {
        clientId: identity.clientId,
        name: identity.clientName,
        role: nextRole,
        sessionHash,
        createdAt: existing?.createdAt ?? now(),
        updatedAt: now(),
      };
      changed = true;
    }
    // Activity keeps a project from being cleaned up (saved once a day).
    if (now() - (meta.lastActiveAt ?? 0) > dayMs) {
      meta.lastActiveAt = now();
      changed = true;
    }
    if (changed) this.writeMeta(meta);
    return { meta, identity, sessionHash, role: nextRole };
  }

  private recordPending(
    meta: ProjectMeta,
    identity: Identity,
    sessionHash: string,
  ): void {
    const existing = Object.hasOwn(meta.pending, identity.clientId)
      ? meta.pending[identity.clientId]
      : undefined;
    if (
      existing &&
      existing.sessionHash === sessionHash &&
      existing.name === identity.clientName
    ) {
      return;
    }
    if (!existing && Object.keys(meta.pending).length >= limits.maxPendingRequests) {
      throw new HttpError(429, "Too many people are waiting to join this project.");
    }
    meta.pending[identity.clientId] = {
      clientId: identity.clientId,
      name: identity.clientName,
      sessionHash,
      requestedAt: existing?.requestedAt ?? now(),
    };
    this.writeMeta(meta);
    this.broadcastJoinRequests(meta);
  }

  private ensureShare(meta: ProjectMeta): void {
    if (meta.shareToken && !meta.sharingStopped) return;
    meta.shareToken = meta.shareToken ?? newShareToken(meta.id);
    meta.sharingStopped = false;
    this.writeMeta(meta);
  }

  private rotateShare(meta: ProjectMeta): void {
    const retired = [
      ...(meta.shareToken ? [meta.shareToken] : []),
      ...meta.retiredShareTokens,
    ];
    meta.retiredShareTokens = retired.slice(0, limits.maxRetiredShareTokens);
    meta.shareToken = newShareToken(meta.id);
    meta.sharingStopped = false;
    // Nobody new can join through a retired invite: drop their requests too.
    meta.pending = {};
    this.writeMeta(meta);
    this.broadcastJoinRequests(meta);
  }

  /** Ends sharing: invites stop working and everyone but the owner leaves. */
  private stopShare(meta: ProjectMeta): void {
    meta.shareToken = null;
    meta.retiredShareTokens = [];
    meta.pending = {};
    meta.sharingStopped = true;
    this.writeMeta(meta);
    this.presence.clear();
    for (const socket of this.ctx.getWebSockets()) {
      const info = this.info(socket);
      if (info && info.sessionHash !== meta.ownerSessionHash)
        socket.close(1008, "Sharing stopped");
    }
  }

  private state(auth: Auth): Record<string, unknown> {
    const { meta, role } = auth;
    const token = !meta.sharingStopped && meta.shareToken ? meta.shareToken : undefined;
    return {
      enabled: Boolean(token),
      ...(token ? { token } : {}),
      projectId: meta.id,
      projectName: meta.name,
      users: this.activePresence(),
      currentUserRole: role,
      isAdmin: role === "admin",
      requireApproval: meta.requireApproval,
      revision: meta.revision,
      encrypted: true,
      ...(role === "admin" ? { pending: this.pendingList(meta) } : {}),
    };
  }

  private permissionList(meta: ProjectMeta, currentClientId: string) {
    return Object.values(meta.permissions)
      .filter((item) => isRole(item.role))
      .sort(
        (left, right) =>
          roleRank(right.role) - roleRank(left.role) ||
          left.name.localeCompare(right.name),
      )
      .map((item) => ({
        clientId: item.clientId,
        name: item.name || "Anonymous",
        role: item.role,
        ...(item.clientId === currentClientId ? { isCurrent: true } : {}),
      }));
  }

  private pendingList(meta: ProjectMeta) {
    return Object.values(meta.pending)
      .sort((left, right) => left.requestedAt - right.requestedAt)
      .map((item) => ({
        clientId: item.clientId,
        name: item.name || "Anonymous",
        requestedAt: item.requestedAt,
      }));
  }

  // --- Presence ------------------------------------------------------------

  private touchPresence(auth: Auth, currentFile: string | null): void {
    this.presence.set(auth.identity.clientId, {
      clientId: auth.identity.clientId,
      name: auth.identity.clientName,
      currentFile,
      lastSeen: now(),
    });
    this.broadcastPresence();
  }

  private activePresence() {
    const cutoff = now() - limits.presenceTtlMs;
    const live = new Map<string, Presence>();
    // Anyone with an open document is here, even between presence pings.
    for (const socket of this.ctx.getWebSockets()) {
      const info = this.info(socket);
      if (!info) continue;
      const known = this.presence.get(info.clientId);
      live.set(info.clientId, {
        clientId: info.clientId,
        name: info.name,
        currentFile: known?.currentFile ?? info.path,
        lastSeen: now(),
      });
    }
    for (const entry of this.presence.values()) {
      if (entry.lastSeen >= cutoff && !live.has(entry.clientId))
        live.set(entry.clientId, entry);
    }
    const meta = this.readMeta();
    return [...live.values()].slice(0, 50).map((entry) => ({
      ...entry,
      role: meta?.permissions[entry.clientId]?.role ?? "viewer",
    }));
  }

  private broadcastPresence(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageProjectPresence);
    encoding.writeVarString(
      encoder,
      JSON.stringify({ version: 1, users: this.activePresence() }),
    );
    this.broadcastAll(encoding.toUint8Array(encoder));
  }

  /**
   * Tells the admins with a file open who is waiting, the moment it changes,
   * so a guest is let in without anyone reopening the Share window.
   */
  private broadcastJoinRequests(meta: ProjectMeta): void {
    const message = this.joinRequestsFrame(meta);
    for (const socket of this.ctx.getWebSockets()) {
      if (this.info(socket)?.role === "admin") this.send(socket, message);
    }
  }

  private joinRequestsFrame(meta: ProjectMeta): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageJoinRequests);
    encoding.writeVarString(
      encoder,
      JSON.stringify({ version: 1, pending: this.pendingList(meta) }),
    );
    return encoding.toUint8Array(encoder);
  }

  private bumpRevision(): void {
    const meta = this.readMeta();
    if (!meta) return;
    meta.revision += 1;
    this.writeMeta(meta);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageProjectChanged);
    encoding.writeVarString(encoder, JSON.stringify({ revision: meta.revision }));
    this.broadcastAll(encoding.toUint8Array(encoder));
  }

  // --- Storage limits ------------------------------------------------------

  private decodeData(value: unknown): Uint8Array {
    if (typeof value !== "string") throw new HttpError(400, "Missing file data.");
    try {
      return base64Decode(value);
    } catch {
      throw new HttpError(400, "File data is not valid base64.");
    }
  }

  private projectBytes(except?: string): number {
    return (
      this.sql
        .exec<{
          total: number | null;
        }>("SELECT SUM(size) AS total FROM entries WHERE path != ?", except ?? "")
        .one().total ?? 0
    );
  }

  private assertRoom(path: string, bytes: number, replacing = true): void {
    const existing = this.entry(path);
    if (!existing) {
      const count = this.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM entries")
        .one().n;
      if (count >= limits.maxProjectEntries)
        throw new HttpError(413, "Project has too many files.");
    }
    const base = replacing ? this.projectBytes(path) : this.projectBytes();
    if (base + bytes > limits.maxProjectBytes) {
      throw new HttpError(
        413,
        `Shared projects are limited to ${limits.maxProjectBytes / 1024 / 1024} MB.`,
      );
    }
  }

  private usage() {
    return this.env.USAGE.get(this.env.USAGE.idFromName("global"));
  }

  /** Reports this project's size to the account-wide meter now and then. */
  private reportUsage(): void {
    const bytes = this.projectBytes();
    if (
      this.reportedBytes >= 0 &&
      Math.abs(bytes - this.reportedBytes) < limits.usageReportStepBytes
    ) {
      return;
    }
    this.reportedBytes = bytes;
    const meta = this.readMeta();
    if (!meta) return;
    this.ctx.waitUntil(
      this.usage()
        .report(meta.id, bytes)
        .catch(() => undefined),
    );
  }

  private async assertAccountSpace(incomingBytes: number): Promise<void> {
    if (!(await this.usage().allows(incomingBytes))) {
      throw new HttpError(
        507,
        "LatexDo's shared storage is full right now. Try again later or share on your network.",
      );
    }
  }

  // --- Files ---------------------------------------------------------------

  private entry(path: string): EntryRow | null {
    return (
      this.sql
        .exec<EntryRow>("SELECT * FROM entries WHERE path = ?", path)
        .toArray()[0] ?? null
    );
  }

  private hasChildren(path: string): boolean {
    return (
      this.sql
        .exec<{
          n: number;
        }>(
          "SELECT COUNT(*) AS n FROM entries WHERE path LIKE ? ESCAPE '\\'",
          `${likeEscape(path)}/%`,
        )
        .one().n > 0
    );
  }

  private tree(): TreeEntry[] {
    const rows = this.sql
      .exec<EntryRow>("SELECT * FROM entries ORDER BY path")
      .toArray();
    const root: TreeEntry[] = [];
    const folders = new Map<string, TreeEntry>();
    const folder = (path: string): TreeEntry[] => {
      if (!path) return root;
      const existing = folders.get(path);
      if (existing) return existing.children!;
      const slash = path.lastIndexOf("/");
      const parent = folder(slash < 0 ? "" : path.slice(0, slash));
      const created: TreeEntry = {
        name: path.slice(slash + 1),
        path,
        relativePath: path,
        type: "directory",
        children: [],
      };
      parent.push(created);
      folders.set(path, created);
      return created.children!;
    };
    for (const row of rows) {
      if (row.type === "directory") {
        folder(row.path);
        continue;
      }
      const slash = row.path.lastIndexOf("/");
      folder(slash < 0 ? "" : row.path.slice(0, slash)).push({
        name: row.path.slice(slash + 1),
        path: row.path,
        relativePath: row.path,
        type: "file",
        ...(row.binary ? { binary: true } : {}),
      });
    }
    const sort = (items: TreeEntry[]) => {
      items.sort((left, right) => left.name.localeCompare(right.name));
      for (const item of items) if (item.children) sort(item.children);
    };
    sort(root);
    return root;
  }

  private ensureParents(path: string): void {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index).join("/");
      const row = this.entry(parent);
      if (row?.type === "file") throw new HttpError(409, `"${parent}" is a file.`);
      if (!row) {
        this.sql.exec(
          "INSERT INTO entries (path, type, binary, size, updated) VALUES (?, 'directory', 0, 0, ?)",
          parent,
          now(),
        );
      }
    }
  }

  /** Makes a text file exist; true when it was just created. */
  private createTextEntry(path: string): boolean {
    const existing = this.entry(path);
    if (existing?.type === "directory")
      throw new HttpError(409, `"${path}" is a folder.`);
    if (existing && !existing.binary) return false;
    this.assertRoom(path, 0);
    this.ensureParents(path);
    this.sql.exec("DELETE FROM blobs WHERE path = ?", path);
    this.sql.exec(
      "INSERT INTO entries (path, type, binary, size, updated) VALUES (?, 'file', 0, 0, ?) ON CONFLICT(path) DO UPDATE SET binary = 0, size = 0, updated = excluded.updated",
      path,
      now(),
    );
    return true;
  }

  private createEntry(path: string, type: unknown): void {
    if (this.entry(path)) throw new HttpError(409, `"${path}" already exists.`);
    if (type === "directory") {
      this.assertRoom(path, 0);
      this.ensureParents(path);
      this.sql.exec(
        "INSERT INTO entries (path, type, binary, size, updated) VALUES (?, 'directory', 0, 0, ?)",
        path,
        now(),
      );
      this.bumpRevision();
      return;
    }
    if (type === "file") {
      this.createTextEntry(path);
      this.bumpRevision();
      return;
    }
    throw new HttpError(400, "Entry type must be file or directory.");
  }

  /** Rows hold at most 2 MB, so larger data is split into parts. */
  private writeParts(path: string, seq: number | null, bytes: Uint8Array): void {
    for (
      let part = 0, offset = 0;
      offset < bytes.length || part === 0;
      part += 1, offset += limits.chunkBytes
    ) {
      const slice = bytes.slice(offset, offset + limits.chunkBytes).buffer;
      if (seq === null) {
        this.sql.exec(
          "INSERT INTO blobs (path, part, data) VALUES (?, ?, ?)",
          path,
          part,
          slice,
        );
      } else {
        this.sql.exec(
          "INSERT INTO logs (path, seq, part, data) VALUES (?, ?, ?, ?)",
          path,
          seq,
          part,
          slice,
        );
      }
      if (bytes.length === 0) break;
    }
  }

  private joinParts(rows: Array<{ data: ArrayBuffer }>): Uint8Array {
    const total = rows.reduce((sum, row) => sum + row.data.byteLength, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const row of rows) {
      bytes.set(new Uint8Array(row.data), offset);
      offset += row.data.byteLength;
    }
    return bytes;
  }

  private storedLogBytes(path: string): number {
    return (
      this.sql
        .exec<{
          total: number | null;
        }>("SELECT SUM(LENGTH(data)) AS total FROM logs WHERE path = ?", path)
        .one().total ?? 0
    );
  }

  private latestStoredSeq(path: string): number {
    return (
      this.sql
        .exec<{
          seq: number | null;
        }>("SELECT MAX(seq) AS seq FROM logs WHERE path = ?", path)
        .one().seq ?? 0
    );
  }

  private takeSeq(path: string): number {
    const next =
      this.nextSeq.get(path) ??
      Math.max(this.latestStoredSeq(path), this.pending.get(path)?.at(-1)?.seq ?? 0) +
        1;
    this.nextSeq.set(path, next + 1);
    return next;
  }

  /** The stored log plus updates not saved yet, oldest first. */
  private readLog(path: string): { seq: number; updates: Uint8Array[] } {
    const row = this.entry(path);
    if (!row || row.type !== "file") throw new HttpError(404, "File not found.");
    if (row.binary) throw new HttpError(400, "This is a binary file.");
    const rows = this.sql
      .exec<{
        seq: number;
        data: ArrayBuffer;
      }>("SELECT seq, data FROM logs WHERE path = ? ORDER BY seq, part", path)
      .toArray();
    const updates: Uint8Array[] = [];
    let seq = 0;
    for (let index = 0; index < rows.length; ) {
      const current = rows[index]!.seq;
      const group: Array<{ data: ArrayBuffer }> = [];
      while (index < rows.length && rows[index]!.seq === current)
        group.push(rows[index++]!);
      updates.push(...decodeRecord(this.joinParts(group)));
      seq = current;
    }
    for (const item of this.pending.get(path) ?? []) {
      updates.push(item.data);
      seq = item.seq;
    }
    return { seq, updates };
  }

  /**
   * Adds one encrypted update to a file: relayed to its editors at once and
   * saved with the next batch (or right away for HTTP writes).
   */
  private appendUpdate(
    path: string,
    data: Uint8Array,
    origin: WebSocket | null,
    persistNow: boolean,
  ): number {
    if (data.byteLength > limits.maxUpdateBytes) {
      throw new HttpError(413, "This change is too large.");
    }
    const created = this.createTextEntry(path);
    this.assertRoom(path, (this.entry(path)?.size ?? 0) + data.byteLength);
    const seq = this.takeSeq(path);
    const queue = this.pending.get(path) ?? [];
    queue.push({ seq, data });
    this.pending.set(path, queue);
    this.sql.exec(
      "UPDATE entries SET size = size + ?, updated = ? WHERE path = ?",
      data.byteLength,
      now(),
      path,
    );
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageUpdate);
    encoding.writeVarUint(encoder, seq);
    encoding.writeVarUint8Array(encoder, data);
    const message = encoding.toUint8Array(encoder);
    for (const socket of this.ctx.getWebSockets(fileTag(path))) {
      if (socket !== origin) this.send(socket, message);
    }
    if (persistNow) this.flushPath(path);
    else this.scheduleFlush();
    if (created) this.bumpRevision();
    return seq;
  }

  /** Replaces everything up to `upTo` with one encrypted snapshot. */
  private compact(path: string, upTo: number, snapshot: Uint8Array): void {
    if (snapshot.byteLength > limits.maxUpdateBytes) {
      throw new HttpError(413, "This file is too large.");
    }
    const row = this.entry(path);
    if (!row || row.type !== "file" || row.binary)
      throw new HttpError(404, "File not found.");
    this.flushPath(path);
    if (upTo < 1 || upTo > this.latestStoredSeq(path)) {
      throw new HttpError(409, "The file changed; compact again.");
    }
    this.sql.exec("DELETE FROM logs WHERE path = ? AND seq <= ?", path, upTo);
    this.writeParts(path, upTo, encodeRecord([snapshot]));
    this.sql.exec(
      "UPDATE entries SET size = ?, updated = ? WHERE path = ?",
      this.storedLogBytes(path),
      now(),
      path,
    );
    this.reportUsage();
  }

  private flushPath(path: string): void {
    const queue = this.pending.get(path);
    this.pending.delete(path);
    if (!queue?.length || !this.entry(path)) return;
    this.writeParts(
      path,
      queue.at(-1)!.seq,
      encodeRecord(queue.map((item) => item.data)),
    );
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    void this.ctx.storage.setAlarm(now() + limits.flushDelayMs);
  }

  private readBlob(path: string): Uint8Array {
    const row = this.entry(path);
    if (!row || row.type !== "file") throw new HttpError(404, "File not found.");
    if (!row.binary) throw new HttpError(400, "This is a text file.");
    return this.joinParts(
      this.sql
        .exec<{
          data: ArrayBuffer;
        }>("SELECT data FROM blobs WHERE path = ? ORDER BY part", path)
        .toArray(),
    );
  }

  private async writeBlob(path: string, bytes: Uint8Array): Promise<void> {
    // Encryption adds 29 bytes to the file's own size.
    if (bytes.byteLength > limits.maxBinaryBytes + 64) {
      throw new HttpError(
        413,
        `Files are limited to ${limits.maxBinaryBytes / 1024 / 1024} MB.`,
      );
    }
    this.assertRoom(path, bytes.byteLength);
    await this.assertAccountSpace(bytes.byteLength);
    const existing = this.entry(path);
    if (existing?.type === "directory")
      throw new HttpError(409, `"${path}" is a folder.`);
    this.ensureParents(path);
    if (existing && !existing.binary) this.dropText(path, "Replaced by a binary file");
    this.sql.exec("DELETE FROM blobs WHERE path = ?", path);
    this.writeParts(path, null, bytes);
    this.sql.exec(
      "INSERT INTO entries (path, type, binary, size, updated) VALUES (?, 'file', 1, ?, ?) ON CONFLICT(path) DO UPDATE SET type = 'file', binary = 1, size = excluded.size, updated = excluded.updated",
      path,
      bytes.byteLength,
      now(),
    );
    this.bumpRevision();
    this.reportUsage();
  }

  private pathsUnder(path: string): string[] {
    return this.sql
      .exec<{ path: string }>(
        "SELECT path FROM entries WHERE path = ? OR path LIKE ? ESCAPE '\\'",
        path,
        `${likeEscape(path)}/%`,
      )
      .toArray()
      .map((row) => row.path);
  }

  private dropText(path: string, reason: string): void {
    this.pending.delete(path);
    this.nextSeq.delete(path);
    this.sql.exec("DELETE FROM logs WHERE path = ?", path);
    for (const socket of this.ctx.getWebSockets(fileTag(path)))
      socket.close(1012, reason);
  }

  private deleteEntry(path: string): void {
    const paths = this.pathsUnder(path);
    if (!paths.length) throw new HttpError(404, "File not found.");
    for (const item of paths) {
      this.dropText(item, "File deleted");
      this.sql.exec("DELETE FROM blobs WHERE path = ?", item);
      this.sql.exec("DELETE FROM entries WHERE path = ?", item);
    }
    this.bumpRevision();
    this.reportUsage();
  }

  private moveEntry(from: string, to: string): string {
    const paths = this.pathsUnder(from);
    if (!paths.length) throw new HttpError(404, "Source path not found.");
    if (this.entry(to) || this.hasChildren(to)) {
      throw new HttpError(409, "Destination already exists.");
    }
    if (inside(to, from)) throw new HttpError(400, "Cannot move a folder into itself.");
    for (const item of paths) this.flushPath(item);
    this.ensureParents(to);
    for (const item of paths) {
      const target = to + item.slice(from.length);
      this.nextSeq.delete(item);
      for (const socket of this.ctx.getWebSockets(fileTag(item)))
        socket.close(1012, "File moved");
      this.sql.exec(
        "UPDATE entries SET path = ?, updated = ? WHERE path = ?",
        target,
        now(),
        item,
      );
      this.sql.exec("UPDATE logs SET path = ? WHERE path = ?", target, item);
      this.sql.exec("UPDATE blobs SET path = ? WHERE path = ?", target, item);
    }
    this.bumpRevision();
    return to;
  }

  private copyEntry(from: string, to: string): string {
    const paths = this.pathsUnder(from);
    if (!paths.length) throw new HttpError(404, "Source path not found.");
    if (this.entry(to) || this.hasChildren(to)) {
      throw new HttpError(409, "Destination already exists.");
    }
    if (inside(to, from)) throw new HttpError(400, "Cannot copy a folder into itself.");
    for (const item of paths) this.flushPath(item);
    const bytes = paths.reduce((sum, item) => sum + (this.entry(item)?.size ?? 0), 0);
    this.assertRoom(to, bytes, false);
    this.ensureParents(to);
    for (const item of paths) {
      const target = to + item.slice(from.length);
      this.sql.exec(
        "INSERT INTO entries (path, type, binary, size, updated) SELECT ?, type, binary, size, ? FROM entries WHERE path = ?",
        target,
        now(),
        item,
      );
      this.sql.exec(
        "INSERT INTO logs (path, seq, part, data) SELECT ?, seq, part, data FROM logs WHERE path = ?",
        target,
        item,
      );
      this.sql.exec(
        "INSERT INTO blobs (path, part, data) SELECT ?, part, data FROM blobs WHERE path = ?",
        target,
        item,
      );
    }
    this.bumpRevision();
    this.reportUsage();
    return to;
  }

  /** Every file at once (encrypted): for compiling and saving to a folder. */
  private bundle() {
    const rows = this.sql
      .exec<EntryRow>("SELECT * FROM entries WHERE type = 'file' ORDER BY path")
      .toArray();
    return {
      revision: this.readMeta()?.revision ?? 0,
      files: rows.map((row) =>
        row.binary
          ? { relativePath: row.path, base64: base64Encode(this.readBlob(row.path)) }
          : {
              relativePath: row.path,
              entries: this.readLog(row.path).updates.map(base64Encode),
            },
      ),
    };
  }

  // --- Alarms: saving edits and cleaning up --------------------------------

  async alarm(): Promise<void> {
    this.flushScheduled = false;
    for (const path of [...this.pending.keys()]) this.flushPath(path);
    this.reportUsage();
    await this.scheduleCleanup();
  }

  private async deleteProject(reason: string): Promise<void> {
    const meta = this.readMeta();
    if (!meta) return;
    for (const socket of this.ctx.getWebSockets()) socket.close(1008, reason);
    this.pending.clear();
    await this.usage()
      .report(meta.id, 0)
      .catch(() => undefined);
    await this.ctx.storage.deleteAll();
    this.meta = null;
  }

  /**
   * A project nobody has opened for a long time is deleted, so abandoned or
   * junk projects cannot fill the account's storage.
   */
  private async scheduleCleanup(): Promise<void> {
    const meta = this.readMeta();
    if (!meta) return;
    if (now() - (meta.lastActiveAt ?? meta.createdAt) > limits.inactiveProjectMs) {
      await this.deleteProject("Project expired");
      return;
    }
    if (this.flushScheduled) return;
    const next = (await this.ctx.storage.getAlarm()) ?? 0;
    if (next > now()) return;
    await this.ctx.storage.setAlarm(now() + limits.cleanupCheckMs);
  }

  // --- Live editing over WebSockets ----------------------------------------

  private async openSocket(request: Request, url: URL): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      throw new HttpError(426, "Use a WebSocket for live editing.");
    }
    const auth = await this.authorize(request, url, "viewer");
    const path = normalizeRelativePath(url.searchParams.get("path"));
    const row = this.entry(path);
    if (row?.binary) throw new HttpError(400, "Binary files are not edited live.");
    if (!row) {
      if (auth.role === "viewer") throw new HttpError(404, "File not found.");
      this.createTextEntry(path);
      this.bumpRevision();
    }
    if (this.ctx.getWebSockets().length >= limits.maxConnectionsPerProject) {
      throw new HttpError(503, "This project has too many open documents right now.");
    }
    if (
      this.ctx.getWebSockets(clientTag(auth.identity.clientId)).length >=
      limits.maxConnectionsPerClient
    ) {
      throw new HttpError(429, "Too many open documents from this computer.");
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [
      fileTag(path),
      clientTag(auth.identity.clientId),
    ]);
    const info: SocketInfo = {
      path,
      clientId: auth.identity.clientId,
      sessionHash: auth.sessionHash,
      name: auth.identity.clientName,
      role: auth.role,
    };
    server.serializeAttachment(info);
    // Hand the newcomer the whole (encrypted) file.
    const { seq, updates } = this.readLog(path);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageLog);
    encoding.writeVarUint(encoder, seq);
    encoding.writeVarUint(encoder, updates.length);
    for (const update of updates) encoding.writeVarUint8Array(encoder, update);
    // The app needs the role to know whether it may send edits.
    encoding.writeVarString(encoder, auth.role);
    this.send(server, encoding.toUint8Array(encoder));
    // An admin who (re)connects learns at once who is already waiting.
    if (auth.role === "admin" && Object.keys(auth.meta.pending).length) {
      this.send(server, this.joinRequestsFrame(auth.meta));
    }
    this.presence.set(auth.identity.clientId, {
      clientId: auth.identity.clientId,
      name: auth.identity.clientName,
      currentFile: path,
      lastSeen: now(),
    });
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  private info(socket: WebSocket): SocketInfo | null {
    try {
      return (socket.deserializeAttachment() as SocketInfo | null) ?? null;
    } catch {
      return null;
    }
  }

  private send(socket: WebSocket, message: Uint8Array): void {
    try {
      socket.send(message);
    } catch {
      // A socket that is closing simply misses the message.
    }
  }

  private broadcastAll(message: Uint8Array): void {
    for (const socket of this.ctx.getWebSockets()) this.send(socket, message);
  }

  private closeClient(clientId: string, code: number, reason: string): void {
    for (const socket of this.ctx.getWebSockets(clientTag(clientId)))
      socket.close(code, reason);
  }

  async webSocketMessage(
    socket: WebSocket,
    message: ArrayBuffer | string,
  ): Promise<void> {
    if (typeof message === "string") return;
    const info = this.info(socket);
    if (!info) {
      socket.close(1011, "Lost connection state");
      return;
    }
    const payload = new Uint8Array(message);
    let decoder: decoding.Decoder;
    let type: number;
    try {
      decoder = decoding.createDecoder(payload);
      type = decoding.readVarUint(decoder);
    } catch {
      return;
    }

    if (type === messageUpdate) {
      if (info.role === "viewer") {
        socket.close(1008, "Viewer access is read-only");
        return;
      }
      try {
        const data = decoding.readVarUint8Array(decoder);
        if (!data.byteLength) return;
        this.appendUpdate(info.path, data, socket, false);
      } catch (error) {
        socket.close(
          error instanceof HttpError && error.status === 413 ? 1009 : 1008,
          error instanceof HttpError ? error.message.slice(0, 120) : "Update rejected",
        );
      }
      return;
    }

    if (type === messageCursor) {
      if (payload.byteLength > limits.maxCursorBytes) {
        socket.close(1008, "Cursor update rejected");
        return;
      }
      for (const other of this.ctx.getWebSockets(fileTag(info.path))) {
        if (other !== socket) this.send(other, payload);
      }
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    this.leave(socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    this.leave(socket);
  }

  private leave(socket: WebSocket): void {
    const info = this.info(socket);
    if (!info) return;
    const remaining = this.ctx
      .getWebSockets(fileTag(info.path))
      .filter((other) => other !== socket);
    // The last editor left this file: save it now rather than on the timer.
    if (!remaining.length) this.flushPath(info.path);
    this.broadcastPresence();
  }
}
