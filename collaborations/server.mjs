#!/usr/bin/env node
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import { Awareness } from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { accessLogPath, projectRole, sessionHash, withLock } from "./security.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const host = process.env.LATEXDO_COLLAB_HOST || "127.0.0.1";
const port =
  process.env.LATEXDO_COLLAB_PORT === "0" ? 0 : numberEnv("LATEXDO_COLLAB_PORT", 8787);
const dataDir = path.resolve(
  process.env.LATEXDO_COLLAB_DATA_DIR || path.join(repoRoot, "collaborations-data"),
);
const publicOrigin = (process.env.LATEXDO_COLLAB_PUBLIC_ORIGIN || "").replace(
  /\/+$/,
  "",
);
// Where share links point (a web page that opens them); without one, people
// share the invite token itself.
const shareUrlBase = process.env.LATEXDO_COLLAB_SHARE_URL_BASE || "";
const allowedOrigins = parseCsv(process.env.LATEXDO_COLLAB_ALLOWED_ORIGINS || "*");
const maxJsonBytes = numberEnv("LATEXDO_COLLAB_MAX_JSON_BYTES", 1024 * 1024);
const maxFileBytes = numberEnv("LATEXDO_COLLAB_MAX_FILE_BYTES", 2 * 1024 * 1024);
const maxProjectBytes = numberEnv("LATEXDO_COLLAB_MAX_PROJECT_BYTES", 20 * 1024 * 1024);
const maxProjectFiles = numberEnv("LATEXDO_COLLAB_MAX_PROJECT_FILES", 500);
const maxWebSocketFrameBytes = numberEnv(
  "LATEXDO_COLLAB_MAX_WS_FRAME_BYTES",
  512 * 1024,
);
const presenceTtlMs = numberEnv("LATEXDO_COLLAB_PRESENCE_TTL_MS", 45_000);
const roomPersistDelayMs = numberEnv("LATEXDO_COLLAB_ROOM_PERSIST_DELAY_MS", 250);

// --- Abuse / resource limits (safe defaults; override via environment) -------
// Per-IP request rate limiting. `trustProxyHeader` MUST stay true only when the
// server sits behind a reverse proxy you control (nginx), otherwise a client can
// spoof X-Forwarded-For to dodge the limit.
const trustProxyHeader = boolEnv("LATEXDO_COLLAB_TRUST_PROXY", false);
const rateLimitWindowMs = numberEnv("LATEXDO_COLLAB_RATE_WINDOW_MS", 60_000);
const rateLimitMax = numberEnv("LATEXDO_COLLAB_RATE_MAX", 600);
const createRateLimitMax = numberEnv("LATEXDO_COLLAB_CREATE_RATE_MAX", 30);
// Caps that bound disk and memory growth for the whole server.
const maxProjectsGlobal = numberEnv("LATEXDO_COLLAB_MAX_PROJECTS", 250_000);
const maxRoomsInMemory = numberEnv("LATEXDO_COLLAB_MAX_ROOMS", 20_000);
const maxConnectionsTotal = numberEnv("LATEXDO_COLLAB_MAX_CONNECTIONS", 30_000);
const maxConnectionsPerRoom = numberEnv("LATEXDO_COLLAB_MAX_ROOM_CONNECTIONS", 80);
// A live-edited document may not grow past this many characters. This closes the
// quota-bypass where WebSocket edits skipped the HTTP size checks.
const maxCollabDocChars = numberEnv("LATEXDO_COLLAB_MAX_DOC_CHARS", 5_000_000);
// Idle WebSocket connections are pinged and then dropped so they cannot be held
// open cheaply (slowloris-style).
const wsIdleTimeoutMs = numberEnv("LATEXDO_COLLAB_WS_IDLE_MS", 120_000);
const wsHeartbeatMs = numberEnv("LATEXDO_COLLAB_WS_HEARTBEAT_MS", 30_000);
const roomEvictionDelayMs = numberEnv("LATEXDO_COLLAB_ROOM_EVICTION_MS", 30_000);
const accessLogEnabled = boolEnv("LATEXDO_COLLAB_ACCESS_LOG", true);
// When the desktop app hosts this server on a user's own computer, only the app
// itself may create or list projects: it sends this key, guests never see it.
// Leave it unset on a shared server where any client may create projects.
const createKey = (process.env.LATEXDO_COLLAB_CREATE_KEY || "").trim();
// Rotated invite tokens keep resolving for people who already joined, so a
// rotation revokes the invite without logging existing collaborators out.
const maxRetiredShareTokens = 20;
const maxPendingRequests = 50;

const wsGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const messageSync = 0;
const messageAwareness = 1;
const messageProjectPresence = 4;
// The project's files changed (added, moved, deleted or replaced).
const messageProjectChanged = 5;
// Admins only: who is waiting to join, sent the moment it changes.
const messageJoinRequests = 6;

const rooms = new Map();

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boolEnv(name, fallback) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

// --- Per-IP rate limiting ----------------------------------------------------
// A fixed-window counter per client IP. Cheap, in-process, and good enough to
// stop scripted floods; pair it with an nginx/WAF limit for network-level abuse.
const rateBuckets = new Map();
let totalConnections = 0;

function clientIp(request) {
  if (trustProxyHeader) {
    const header = request.headers["x-forwarded-for"];
    const forwarded = Array.isArray(header) ? header[0] : header;
    const first = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "";
    if (first) return first;
  }
  return request.socket?.remoteAddress || "unknown";
}

function checkRateLimit(ip, kind = "general") {
  const timestamp = now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= timestamp) {
    bucket = { count: 0, createCount: 0, resetAt: timestamp + rateLimitWindowMs };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (kind === "create") bucket.createCount += 1;
  if (bucket.count > rateLimitMax) return false;
  if (kind === "create" && bucket.createCount > createRateLimitMax) return false;
  return true;
}

function pruneRateBuckets() {
  const timestamp = now();
  for (const [ip, bucket] of rateBuckets) {
    if (bucket.resetAt <= timestamp) rateBuckets.delete(ip);
  }
}

// The number of projects on disk, counted once at startup and kept in sync so
// creation stays O(1) instead of scanning the data directory on every request.
let knownProjectCount = null;

async function ensureProjectCount() {
  if (knownProjectCount !== null) return knownProjectCount;
  const root = path.join(dataDir, "projects");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  knownProjectCount = entries.filter((entry) => entry.isDirectory()).length;
  return knownProjectCount;
}

function parseCsv(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function now() {
  return Date.now();
}

function randomId(prefix) {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function projectDir(projectId) {
  return path.join(dataDir, "projects", projectId);
}

function projectFilesDir(projectId) {
  return path.join(projectDir(projectId), "files");
}

function projectMetaPath(projectId) {
  return path.join(projectDir(projectId), "project.json");
}

function sharesIndexPath() {
  return path.join(dataDir, "shares.json");
}

async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomToken()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function atomicWriteText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomToken()}.tmp`;
  try {
    await writeFile(temporaryPath, value, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function readSharesIndex() {
  const parsed = safeJsonParse(
    await readFile(sharesIndexPath(), "utf8").catch(() => "{}"),
    {},
  );
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

async function writeSharesIndex(index) {
  await atomicWriteJson(sharesIndexPath(), index);
}

async function readProjectMeta(projectId) {
  if (!/^[a-z0-9_]{10,80}$/i.test(projectId)) {
    throw new HttpError(400, "Invalid project id.");
  }
  const parsed = safeJsonParse(
    await readFile(projectMetaPath(projectId), "utf8").catch(() => ""),
    null,
  );
  if (!parsed || parsed.schemaVersion !== 1 || parsed.id !== projectId) {
    throw new HttpError(404, "Project not found.");
  }
  parsed.permissions =
    parsed.permissions && typeof parsed.permissions === "object"
      ? parsed.permissions
      : {};
  parsed.presence =
    parsed.presence && typeof parsed.presence === "object" ? parsed.presence : {};
  parsed.pending =
    parsed.pending && typeof parsed.pending === "object" ? parsed.pending : {};
  parsed.retiredShareTokens = Array.isArray(parsed.retiredShareTokens)
    ? parsed.retiredShareTokens.filter((token) => typeof token === "string")
    : [];
  return parsed;
}

async function writeProjectMeta(meta) {
  meta.updatedAt = now();
  await atomicWriteJson(projectMetaPath(meta.id), meta);
}

async function createProject(identity, folderName) {
  await ensureProjectCount();
  if (knownProjectCount >= maxProjectsGlobal) {
    throw new HttpError(507, "The collaboration server has reached its project limit.");
  }
  const timestamp = now();
  const projectId = randomId("project");
  const name = cleanProjectName(folderName) || "LatexDo Shared Project";
  const meta = {
    schemaVersion: 1,
    id: projectId,
    name,
    ownerSession: identity.sessionId,
    createdAt: timestamp,
    updatedAt: timestamp,
    shareToken: null,
    permissions: {
      [identity.clientId]: {
        clientId: identity.clientId,
        name: identity.clientName,
        role: "admin",
        sessionHash: sessionHash(identity.sessionId),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
    presence: {},
  };
  knownProjectCount += 1;
  try {
    await mkdir(projectFilesDir(projectId), { recursive: true });
    await writeProjectMeta(meta);
  } catch (error) {
    knownProjectCount -= 1;
    throw error;
  }
  return openProject(meta);
}

function cleanProjectName(value) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function openProject(meta) {
  return { id: meta.id, rootPath: "", name: meta.name };
}

function isAllowedOrigin(origin) {
  if (!origin || allowedOrigins.includes("*")) return true;
  return allowedOrigins.includes(origin);
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  const allowOrigin = isAllowedOrigin(origin) ? origin || "*" : "null";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers":
      "content-type,x-latexdo-session,x-latexdo-client,x-latexdo-client-name,x-latexdo-share-token,x-latexdo-project-id,x-latexdo-host-key",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function sendJson(response, request, status, body) {
  const payload = body === undefined ? "" : `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    ...corsHeaders(request),
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendEmpty(response, request, status = 204) {
  response.writeHead(status, {
    ...corsHeaders(request),
    "cache-control": "no-store",
  });
  response.end();
}

async function readJsonBody(request) {
  if (Object.hasOwn(request, "parsedJsonBody")) return request.parsedJsonBody;
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.byteLength;
    if (total > maxJsonBytes) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Invalid body");
    request.parsedJsonBody = body;
    return body;
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
}

function requestIdentity(request, url) {
  const sessionId = cleanHeader(
    request.headers["x-latexdo-session"] || url.searchParams.get("session"),
    160,
  );
  const clientId = cleanHeader(
    request.headers["x-latexdo-client"] || url.searchParams.get("clientId"),
    160,
  );
  if (!sessionId || !clientId) {
    throw new HttpError(400, "Missing LatexDo collaboration identity headers.");
  }
  return {
    sessionId,
    clientId,
    clientName:
      cleanHeader(
        request.headers["x-latexdo-client-name"] || url.searchParams.get("name"),
        80,
      ) || "Anonymous",
  };
}

function cleanHeader(value, maxLength) {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" ? text.trim().slice(0, maxLength) : "";
}

function requestShareToken(request, url) {
  return cleanHeader(
    request.headers["x-latexdo-share-token"] || url.searchParams.get("share"),
    256,
  );
}

function roleRank(role) {
  return role === "admin" ? 3 : role === "editor" ? 2 : role === "viewer" ? 1 : 0;
}

function roleForProject(meta, identity, token) {
  return projectRole(meta, identity, token);
}

function assertCreateAllowed(request) {
  if (!createKey) return;
  const provided = cleanHeader(request.headers["x-latexdo-host-key"], 256);
  const expected = createHash("sha256").update(createKey).digest();
  const actual = createHash("sha256").update(provided).digest();
  if (!provided || !timingSafeEqual(expected, actual)) {
    throw new HttpError(403, "Only the host can create projects on this computer.");
  }
}

// Returns true when the request is new and the project metadata must be saved.
function recordPendingRequest(meta, identity) {
  const hash = sessionHash(identity.sessionId);
  const existing = Object.hasOwn(meta.pending, identity.clientId)
    ? meta.pending[identity.clientId]
    : undefined;
  if (
    existing &&
    existing.sessionHash === hash &&
    existing.name === identity.clientName
  ) {
    return false;
  }
  if (!existing && Object.keys(meta.pending).length >= maxPendingRequests) {
    throw new HttpError(429, "Too many people are waiting to join this project.");
  }
  Object.defineProperty(meta.pending, identity.clientId, {
    value: {
      clientId: identity.clientId,
      name: identity.clientName,
      sessionHash: hash,
      requestedAt: existing?.requestedAt ?? now(),
    },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return true;
}

function pendingList(meta) {
  return Object.values(meta.pending)
    .filter((request) => request && typeof request.clientId === "string")
    .sort((left, right) => left.requestedAt - right.requestedAt)
    .map((request) => ({
      clientId: request.clientId,
      name: request.name || "Anonymous",
      requestedAt: request.requestedAt,
    }));
}

function ensureProjectPermission(meta, identity, role) {
  const existing = Object.hasOwn(meta.permissions, identity.clientId)
    ? meta.permissions[identity.clientId]
    : undefined;
  const nextRole = meta.ownerSession === identity.sessionId ? "admin" : role;
  if (
    existing &&
    existing.name === identity.clientName &&
    existing.role === nextRole &&
    existing.sessionHash === sessionHash(identity.sessionId)
  ) {
    return false;
  }
  Object.defineProperty(meta.permissions, identity.clientId, {
    value: {
      clientId: identity.clientId,
      name: identity.clientName,
      role: nextRole,
      sessionHash: sessionHash(identity.sessionId),
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return true;
}

async function authorizeProject(request, url, projectId, minimumRole = "viewer") {
  const identity = requestIdentity(request, url);
  const token = requestShareToken(request, url);
  const meta = await readProjectMeta(projectId);
  const isOwner = meta.ownerSession === identity.sessionId;
  if (meta.sharingStopped && !isOwner) {
    throw new HttpError(
      403,
      "The owner has stopped sharing this project.",
      "sharing-stopped",
    );
  }
  const role = roleForProject(meta, identity, token);
  const existing = Object.hasOwn(meta.permissions, identity.clientId)
    ? meta.permissions[identity.clientId]
    : undefined;
  if (!role) {
    if (
      existing &&
      existing.role === null &&
      existing.sessionHash === sessionHash(identity.sessionId)
    ) {
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
    if (recordPendingRequest(meta, identity)) {
      await writeProjectMeta(meta);
      broadcastJoinRequests(meta);
    }
    throw new HttpError(
      403,
      "Waiting for the project owner to let you in.",
      "approval-pending",
    );
  }
  if (roleRank(role) < roleRank(minimumRole)) {
    throw new HttpError(403, "You do not have access to this project.");
  }
  const changed = ensureProjectPermission(meta, identity, role);
  if (changed) await writeProjectMeta(meta);
  return { meta, identity, token, role };
}

async function authorizeShare(request, url, token, minimumRole = "viewer") {
  const index = await readSharesIndex();
  const projectId = index[token];
  if (!projectId) {
    throw new HttpError(404, "Share token not found.");
  }
  url.searchParams.set("share", token);
  return authorizeProject(request, url, projectId, minimumRole);
}

async function ensureShare(meta) {
  if (meta.shareToken) return meta.shareToken;
  const token = randomToken();
  meta.shareToken = token;
  meta.sharingStopped = false;
  await withLock("shares", async () => {
    const index = await readSharesIndex();
    index[token] = meta.id;
    await writeSharesIndex(index);
  });
  await writeProjectMeta(meta);
  return token;
}

async function rotateShare(meta) {
  const token = randomToken();
  const retired = [
    ...(meta.shareToken ? [meta.shareToken] : []),
    ...meta.retiredShareTokens,
  ];
  const dropped = retired.slice(maxRetiredShareTokens);
  meta.retiredShareTokens = retired.slice(0, maxRetiredShareTokens);
  meta.shareToken = token;
  meta.sharingStopped = false;
  // Nobody new can join through a retired token, so requests still waiting on
  // the old invite are dropped with it.
  meta.pending = {};
  await withLock("shares", async () => {
    const index = await readSharesIndex();
    for (const droppedToken of dropped) delete index[droppedToken];
    index[token] = meta.id;
    await writeSharesIndex(index);
  });
  await writeProjectMeta(meta);
  broadcastJoinRequests(meta);
  return token;
}

// Ends sharing: every invite stops resolving and everyone but the owner is
// disconnected. Collaborator roles are kept so sharing again restores them.
async function stopShare(meta) {
  const tokens = [
    ...(meta.shareToken ? [meta.shareToken] : []),
    ...meta.retiredShareTokens,
  ];
  meta.shareToken = null;
  meta.retiredShareTokens = [];
  meta.pending = {};
  meta.presence = {};
  meta.sharingStopped = true;
  await withLock("shares", async () => {
    const index = await readSharesIndex();
    for (const token of tokens) delete index[token];
    await writeSharesIndex(index);
  });
  await writeProjectMeta(meta);
  for (const room of rooms.values()) {
    if (room.projectId !== meta.id) continue;
    for (const conn of Array.from(room.conns)) {
      if (conn.identity.sessionId !== meta.ownerSession) {
        conn.close(1008, "Sharing stopped");
      }
    }
  }
}

function shareUrl(token) {
  try {
    const url = new URL(shareUrlBase);
    url.hash = new URLSearchParams({ share: token }).toString();
    return url.toString();
  } catch {
    return undefined;
  }
}

function permissionList(meta, currentClientId) {
  return Object.values(meta.permissions)
    .filter(
      (permission) =>
        permission &&
        isRole(permission.role) &&
        typeof permission.clientId === "string",
    )
    .sort((left, right) => {
      const rankDelta = roleRank(right.role) - roleRank(left.role);
      if (rankDelta) return rankDelta;
      return String(left.name).localeCompare(String(right.name));
    })
    .map((permission) => ({
      clientId: permission.clientId,
      name: permission.name || "Anonymous",
      role: isRole(permission.role) ? permission.role : "viewer",
      isCurrent: permission.clientId === currentClientId || undefined,
    }));
}

function activePresence(meta) {
  const cutoff = now() - presenceTtlMs;
  return Object.values(meta.presence)
    .filter((user) => user && user.lastSeen >= cutoff)
    .slice(0, 50)
    .map((user) => ({
      clientId: user.clientId,
      name: user.name || "Anonymous",
      currentFile:
        typeof user.currentFile === "string" && user.currentFile
          ? user.currentFile
          : null,
      lastSeen: user.lastSeen,
      role: meta.permissions[user.clientId]?.role || "viewer",
    }));
}

function collaborationState(meta, identity, role) {
  const token = meta.shareToken || undefined;
  return {
    enabled: Boolean(token),
    ...(token ? { token, shareUrl: shareUrl(token) } : {}),
    projectId: meta.id,
    projectName: meta.name,
    users: activePresence(meta),
    currentUserRole: role,
    isAdmin: role === "admin",
    requireApproval: Boolean(meta.requireApproval),
    revision: Number(meta.revision) || 0,
    ...(role === "admin" ? { pending: pendingList(meta) } : {}),
  };
}

// Tells everyone with the project open that its files changed.
async function bumpRevision(projectId) {
  const meta = await readProjectMeta(projectId);
  meta.revision = (Number(meta.revision) || 0) + 1;
  await writeProjectMeta(meta);
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageProjectChanged);
  encoding.writeVarString(encoder, JSON.stringify({ revision: meta.revision }));
  const frame = encoding.toUint8Array(encoder);
  for (const room of rooms.values()) {
    if (room.projectId === projectId) broadcastRoom(room, frame, null);
  }
}

function closeRoomsUnder(projectId, relativePath, reason) {
  for (const [key, room] of rooms) {
    if (
      room.projectId === projectId &&
      (room.relativePath === relativePath ||
        room.relativePath.startsWith(`${relativePath}/`))
    ) {
      rooms.delete(key);
      room.closeAll(1012, reason);
    }
  }
}

async function flushRoomsUnder(projectId, relativePath) {
  for (const room of rooms.values()) {
    if (
      room.projectId === projectId &&
      (room.relativePath === relativePath ||
        room.relativePath.startsWith(`${relativePath}/`))
    ) {
      await atomicWriteText(
        filePathFor(projectId, room.relativePath),
        room.text.toString(),
      );
    }
  }
}

function decodeText(buffer) {
  if (buffer.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

async function readProjectBinary(projectId, relativePath) {
  const fullPath = filePathFor(projectId, relativePath);
  const fileStat = await stat(fullPath).catch(() => null);
  if (!fileStat) throw new HttpError(404, "File not found.");
  if (!fileStat.isFile()) throw new HttpError(400, "Path is not a file.");
  if (fileStat.size > maxFileBytes) throw new HttpError(413, "File is too large.");
  const room = rooms.get(roomKey(projectId, relativePath));
  return room ? Buffer.from(room.text.toString(), "utf8") : readFile(fullPath);
}

async function writeProjectBinary(projectId, relativePath, bytes) {
  if (bytes.byteLength > maxFileBytes) throw new HttpError(413, "File is too large.");
  await assertProjectQuota(projectId, relativePath, bytes.byteLength);
  const fullPath = filePathFor(projectId, relativePath);
  const created = !(await exists(fullPath));
  await mkdir(path.dirname(fullPath), { recursive: true });
  closeRoomsUnder(projectId, relativePath, "Replaced by a binary file");
  const temporaryPath = `${fullPath}.${randomToken()}.tmp`;
  try {
    await writeFile(temporaryPath, bytes, { mode: 0o600, flag: "wx" });
    await rename(temporaryPath, fullPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
  void created;
  await bumpRevision(projectId);
}

// Every file at once: for compiling and for saving to the owner's folder.
async function projectBundle(projectId) {
  const root = projectFilesDir(projectId);
  const files = [];
  async function walk(relativeDirectory) {
    const directory = relativeDirectory ? path.join(root, relativeDirectory) : root;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (entry.isDirectory()) {
        await walk(relativePath);
      } else if (entry.isFile()) {
        const room = rooms.get(roomKey(projectId, relativePath));
        if (room) {
          files.push({ relativePath, content: room.text.toString() });
          continue;
        }
        const buffer = await readFile(path.join(root, relativePath));
        const text = decodeText(buffer);
        files.push(
          text === null
            ? { relativePath, base64: buffer.toString("base64") }
            : { relativePath, content: text },
        );
      }
    }
  }
  await walk("");
  return { revision: Number((await readProjectMeta(projectId)).revision) || 0, files };
}

async function deleteEntry(projectId, relativePath) {
  const fullPath = filePathFor(projectId, relativePath);
  if (!(await exists(fullPath))) throw new HttpError(404, "File not found.");
  closeRoomsUnder(projectId, relativePath, "File deleted");
  await rm(fullPath, { recursive: true, force: true });
  await bumpRevision(projectId);
}

async function copyEntry(projectId, fromRelativePath, toRelativePath) {
  const fromPath = filePathFor(projectId, fromRelativePath);
  const toPath = filePathFor(projectId, toRelativePath);
  if (!(await exists(fromPath))) throw new HttpError(404, "Source path not found.");
  if (await exists(toPath)) throw new HttpError(409, "Destination already exists.");
  if (
    toRelativePath === fromRelativePath ||
    toRelativePath.startsWith(`${fromRelativePath}/`)
  ) {
    throw new HttpError(400, "Cannot copy a folder into itself.");
  }
  await flushRoomsUnder(projectId, fromRelativePath);
  const source = await stat(fromPath);
  if (source.isFile()) {
    await assertProjectQuota(projectId, toRelativePath, source.size);
  }
  await mkdir(path.dirname(toPath), { recursive: true });
  await cp(fromPath, toPath, { recursive: true, errorOnExist: true, force: false });
  await bumpRevision(projectId);
  return toRelativePath;
}

function isRole(value) {
  return value === "admin" || value === "editor" || value === "viewer";
}

function updatePresence(meta, identity, currentFile) {
  Object.defineProperty(meta.presence, identity.clientId, {
    value: {
      clientId: identity.clientId,
      name: identity.clientName,
      currentFile: currentFile || null,
      lastSeen: now(),
    },
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function normalizeRelativePath(value, { allowEmpty = false } = {}) {
  const raw = typeof value === "string" ? value.trim().replaceAll("\\", "/") : "";
  if (!raw && !allowEmpty) throw new HttpError(400, "Missing file path.");
  if (raw.length > 512) throw new HttpError(400, "File path is too long.");
  if (
    raw.startsWith("/") ||
    /^[A-Za-z]:/.test(raw) ||
    /[\u0000-\u001f\u007f]/.test(raw) ||
    raw.split("/").some((segment) => ["..", ".git", "node_modules"].includes(segment))
  ) {
    throw new HttpError(400, "Invalid file path.");
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === ".") return allowEmpty ? "" : failPath();
  if (normalized.startsWith("../") || normalized === "..") failPath();
  return normalized;
}

function failPath() {
  throw new HttpError(400, "Invalid file path.");
}

function filePathFor(projectId, relativePath) {
  const root = projectFilesDir(projectId);
  const fullPath = path.resolve(root, relativePath);
  const resolvedRoot = path.resolve(root);
  if (fullPath !== resolvedRoot && !fullPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new HttpError(400, "Invalid file path.");
  }
  return fullPath;
}

async function readProjectFile(projectId, relativePath) {
  const fullPath = filePathFor(projectId, relativePath);
  let fileStat;
  try {
    fileStat = await stat(fullPath);
  } catch {
    throw new HttpError(404, "File not found.");
  }
  if (!fileStat.isFile()) throw new HttpError(400, "Path is not a file.");
  if (fileStat.size > maxFileBytes) throw new HttpError(413, "File is too large.");
  return readFile(fullPath, "utf8");
}

async function writeProjectFile(projectId, relativePath, content) {
  if (typeof content !== "string") {
    throw new HttpError(400, "File content must be a string.");
  }
  if (Buffer.byteLength(content, "utf8") > maxFileBytes) {
    throw new HttpError(413, "File is too large.");
  }
  await assertProjectQuota(projectId, relativePath, Buffer.byteLength(content, "utf8"));
  await atomicWriteText(filePathFor(projectId, relativePath), content);
  const room = rooms.get(roomKey(projectId, relativePath));
  if (room) {
    setRoomText(room, content, "http-write");
  }
}

async function assertProjectQuota(projectId, incomingPath, incomingBytes) {
  let fileCount = 0;
  let totalBytes = incomingBytes;
  const seen = new Set([incomingPath]);
  const root = projectFilesDir(projectId);
  const incomingFullPath = filePathFor(projectId, incomingPath);
  const incomingExists = await exists(incomingFullPath);
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        fileCount += 1;
        if (entryPath !== incomingFullPath) {
          const relativePath = path.relative(root, entryPath).split(path.sep).join("/");
          seen.add(relativePath);
          const room = rooms.get(roomKey(projectId, relativePath));
          totalBytes += room
            ? Buffer.byteLength(room.text.toString(), "utf8")
            : (await stat(entryPath)).size;
        }
      }
    }
  }
  await walk(root);
  for (const room of rooms.values()) {
    if (room.projectId === projectId && !seen.has(room.relativePath)) {
      fileCount += 1;
      totalBytes += Buffer.byteLength(room.text.toString(), "utf8");
    }
  }
  if (fileCount + (incomingExists ? 0 : 1) > maxProjectFiles) {
    throw new HttpError(413, "Project has too many files.");
  }
  if (totalBytes > maxProjectBytes) {
    throw new HttpError(413, "Project is too large.");
  }
}

async function listProjectFiles(projectId) {
  const root = projectFilesDir(projectId);
  await mkdir(root, { recursive: true });
  return listDirectory(root, "");
}

async function listDirectory(root, relativePath) {
  const directory = relativePath ? path.join(root, relativePath) : root;
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const result = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const childRelativePath = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: childRelativePath,
        relativePath: childRelativePath,
        type: "directory",
        children: await listDirectory(root, childRelativePath),
      });
    } else if (entry.isFile()) {
      result.push({
        name: entry.name,
        path: childRelativePath,
        relativePath: childRelativePath,
        type: "file",
      });
    }
  }
  return result;
}

async function countProjectEntries(projectId) {
  const root = projectFilesDir(projectId);
  let count = 0;
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      count += 1;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name));
    }
  }
  await walk(root);
  return count;
}

async function createEntry(projectId, relativePath, type) {
  const fullPath = filePathFor(projectId, relativePath);
  if (await exists(fullPath)) {
    throw new HttpError(409, `"${relativePath}" already exists.`);
  }
  if (type === "directory") {
    if ((await countProjectEntries(projectId)) >= maxProjectFiles) {
      throw new HttpError(413, "Project has too many entries.");
    }
    await mkdir(fullPath, { recursive: true });
    return relativePath;
  }
  if (type === "file") {
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeProjectFile(projectId, relativePath, "");
    return relativePath;
  }
  throw new HttpError(400, "Entry type must be file or directory.");
}

async function moveEntry(projectId, fromRelativePath, toRelativePath) {
  const fromPath = filePathFor(projectId, fromRelativePath);
  const toPath = filePathFor(projectId, toRelativePath);
  if (!(await exists(fromPath))) throw new HttpError(404, "Source path not found.");
  if (await exists(toPath)) throw new HttpError(409, "Destination already exists.");
  if (toRelativePath.startsWith(`${fromRelativePath}/`)) {
    throw new HttpError(400, "Cannot move a folder into itself.");
  }
  await mkdir(path.dirname(toPath), { recursive: true });
  for (const room of rooms.values()) {
    if (
      room.projectId === projectId &&
      (room.relativePath === fromRelativePath ||
        room.relativePath.startsWith(`${fromRelativePath}/`))
    ) {
      await atomicWriteText(
        filePathFor(projectId, room.relativePath),
        room.text.toString(),
      );
    }
  }
  await rename(fromPath, toPath);
  for (const [key, room] of rooms) {
    if (
      room.projectId === projectId &&
      (room.relativePath === fromRelativePath ||
        room.relativePath.startsWith(`${fromRelativePath}/`))
    ) {
      rooms.delete(key);
      room.closeAll(1012, "File moved");
    }
  }
  return toRelativePath;
}

async function exists(filePath) {
  return stat(filePath)
    .then(() => true)
    .catch(() => false);
}

async function handleHttp(request, response) {
  const url = new URL(
    request.url || "/",
    publicOrigin || `http://${request.headers.host}`,
  );
  if (request.method === "OPTIONS") {
    sendEmpty(response, request);
    return;
  }
  if (!isAllowedOrigin(request.headers.origin)) {
    throw new HttpError(403, "Origin is not allowed.");
  }
  if (!checkRateLimit(clientIp(request))) {
    throw new HttpError(429, "Too many requests. Please slow down and try again.");
  }

  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, request, 200, {
      ok: true,
      product: "LatexDo collaborations",
      version: 1,
      compilation: "client-local",
      websocket: true,
    });
    return;
  }

  if (parts[0] === "api" && parts[1] === "projects" && parts.length === 2) {
    if (request.method === "GET") {
      assertCreateAllowed(request);
      const identity = requestIdentity(request, url);
      const projects = await listOwnedProjects(identity.sessionId);
      sendJson(response, request, 200, { projects });
      return;
    }
    if (request.method === "POST") {
      assertCreateAllowed(request);
      if (!checkRateLimit(clientIp(request), "create")) {
        throw new HttpError(429, "Too many new projects. Please try again shortly.");
      }
      const identity = requestIdentity(request, url);
      const body = await readJsonBody(request);
      const project = await createProject(identity, body.folderName || body.name);
      sendJson(response, request, 200, project);
      return;
    }
  }

  if (
    parts[0] === "api" &&
    parts[1] === "projects" &&
    parts[2] === "open" &&
    parts.length === 3 &&
    request.method === "POST"
  ) {
    assertCreateAllowed(request);
    const identity = requestIdentity(request, url);
    const projects = await listOwnedProjects(identity.sessionId);
    if (projects[0]) {
      sendJson(
        response,
        request,
        200,
        openProject(await readProjectMeta(projects[0].id)),
      );
      return;
    }
    if (!checkRateLimit(clientIp(request), "create")) {
      throw new HttpError(429, "Too many new projects. Please try again shortly.");
    }
    sendJson(response, request, 200, await createProject(identity));
    return;
  }

  if (parts[0] === "api" && parts[1] === "projects" && parts.length >= 3) {
    if (["POST", "PUT"].includes(request.method)) await readJsonBody(request);
    await withLock(`project:${parts[2]}`, () =>
      handleProjectRoute(request, response, url, parts),
    );
    return;
  }

  if (parts[0] === "api" && parts[1] === "shares" && parts.length >= 3) {
    if (["POST", "PUT"].includes(request.method)) await readJsonBody(request);
    const index = await readSharesIndex();
    const projectId = Object.hasOwn(index, parts[2]) ? index[parts[2]] : null;
    if (!projectId) throw new HttpError(404, "Share token not found.");
    await withLock(`project:${projectId}`, () =>
      handleShareRoute(request, response, url, parts),
    );
    return;
  }

  if (
    parts[0] === "api" &&
    parts[1] === "import" &&
    (parts[2] === "docx" || parts[2] === "markdown")
  ) {
    throw new HttpError(
      501,
      "Hosted import conversion is not configured on this collaboration server.",
    );
  }

  throw new HttpError(404, "Route not found.");
}

async function listOwnedProjects(sessionId) {
  const root = path.join(dataDir, "projects");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const meta = await readProjectMeta(entry.name);
      if (meta.ownerSession === sessionId) {
        projects.push({ id: meta.id, name: meta.name, updatedAt: meta.updatedAt });
      }
    } catch {
      // Ignore malformed project directories.
    }
  }
  return projects.sort((left, right) => right.updatedAt - left.updatedAt);
}

async function handleProjectRoute(request, response, url, parts) {
  const projectId = parts[2];
  const route = parts.slice(3).join("/");

  // Stopping sharing deletes the copy: only its owner may.
  if (route === "" && request.method === "DELETE") {
    const { meta, identity } = await authorizeProject(request, url, projectId, "admin");
    if (meta.ownerSession !== identity.sessionId) {
      throw new HttpError(403, "Only the owner can delete this project.");
    }
    await stopShare(meta);
    for (const [key, room] of rooms) {
      if (room.projectId === projectId) {
        rooms.delete(key);
        room.closeAll(1012, "Project deleted");
      }
    }
    await rm(projectDir(projectId), { recursive: true, force: true });
    if (knownProjectCount !== null) {
      knownProjectCount = Math.max(0, knownProjectCount - 1);
    }
    sendJson(response, request, 200, { deleted: true });
    return;
  }

  if (route === "files" && request.method === "GET") {
    await authorizeProject(request, url, projectId, "viewer");
    sendJson(response, request, 200, await listProjectFiles(projectId));
    return;
  }

  if (route === "files" && request.method === "POST") {
    await authorizeProject(request, url, projectId, "editor");
    const body = await readJsonBody(request);
    const relativePath = normalizeRelativePath(body.relativePath);
    const created = await createEntry(projectId, relativePath, body.type);
    await bumpRevision(projectId);
    sendJson(response, request, 200, { relativePath: created });
    return;
  }

  if (route === "files/content") {
    const relativePath = normalizeRelativePath(url.searchParams.get("path"));
    if (request.method === "GET") {
      await authorizeProject(request, url, projectId, "viewer");
      sendJson(response, request, 200, {
        content: await readProjectFile(projectId, relativePath),
      });
      return;
    }
    if (request.method === "PUT") {
      await authorizeProject(request, url, projectId, "editor");
      const body = await readJsonBody(request);
      const created = !(await exists(filePathFor(projectId, relativePath)));
      await writeProjectFile(projectId, relativePath, body.content);
      if (created) await bumpRevision(projectId);
      sendEmpty(response, request);
      return;
    }
  }

  if (route === "files" && request.method === "DELETE") {
    await authorizeProject(request, url, projectId, "editor");
    await deleteEntry(projectId, normalizeRelativePath(url.searchParams.get("path")));
    sendEmpty(response, request);
    return;
  }

  if (route === "files/binary") {
    const relativePath = normalizeRelativePath(url.searchParams.get("path"));
    if (request.method === "GET") {
      await authorizeProject(request, url, projectId, "viewer");
      const bytes = await readProjectBinary(projectId, relativePath);
      sendJson(response, request, 200, { base64: bytes.toString("base64") });
      return;
    }
    if (request.method === "PUT") {
      await authorizeProject(request, url, projectId, "editor");
      const body = await readJsonBody(request);
      if (typeof body.base64 !== "string")
        throw new HttpError(400, "Missing file data.");
      await writeProjectBinary(
        projectId,
        relativePath,
        Buffer.from(body.base64, "base64"),
      );
      sendEmpty(response, request);
      return;
    }
  }

  if (route === "files/bundle" && request.method === "GET") {
    await authorizeProject(request, url, projectId, "viewer");
    sendJson(response, request, 200, await projectBundle(projectId));
    return;
  }

  if (route === "files/copy" && request.method === "POST") {
    await authorizeProject(request, url, projectId, "editor");
    const body = await readJsonBody(request);
    const copied = await copyEntry(
      projectId,
      normalizeRelativePath(body.fromRelativePath),
      normalizeRelativePath(body.toRelativePath),
    );
    sendJson(response, request, 200, { relativePath: copied });
    return;
  }

  if (route === "files/exists" && request.method === "GET") {
    await authorizeProject(request, url, projectId, "viewer");
    const relativePath = normalizeRelativePath(url.searchParams.get("path"));
    sendJson(response, request, 200, {
      exists: await exists(filePathFor(projectId, relativePath)),
    });
    return;
  }

  if (route === "files/move" && request.method === "POST") {
    await authorizeProject(request, url, projectId, "editor");
    const body = await readJsonBody(request);
    const moved = await moveEntry(
      projectId,
      normalizeRelativePath(body.fromRelativePath),
      normalizeRelativePath(body.toRelativePath),
    );
    await bumpRevision(projectId);
    sendJson(response, request, 200, { relativePath: moved });
    return;
  }

  if (route === "share" && (request.method === "GET" || request.method === "POST")) {
    const { meta, identity, role } = await authorizeProject(
      request,
      url,
      projectId,
      request.method === "POST" ? "admin" : "viewer",
    );
    if (request.method === "POST") await ensureShare(meta);
    sendJson(response, request, 200, collaborationState(meta, identity, role));
    return;
  }

  if (route === "share" && request.method === "DELETE") {
    const { meta, identity, role } = await authorizeProject(
      request,
      url,
      projectId,
      "admin",
    );
    await stopShare(meta);
    sendJson(response, request, 200, collaborationState(meta, identity, role));
    return;
  }

  if (route === "share/rotate" && request.method === "POST") {
    const { meta, identity, role } = await authorizeProject(
      request,
      url,
      projectId,
      "admin",
    );
    await rotateShare(meta);
    sendJson(response, request, 200, collaborationState(meta, identity, role));
    return;
  }

  if (route === "files/collaborate") {
    throw new HttpError(426, "Use WebSocket upgrade for collaboration.");
  }

  throw new HttpError(404, "Project route not found.");
}

async function handleShareRoute(request, response, url, parts) {
  const token = parts[2];
  const route = parts.slice(3).join("/");

  if (route === "open" && request.method === "POST") {
    const { meta, identity, role } = await authorizeShare(
      request,
      url,
      token,
      "viewer",
    );
    updatePresence(meta, identity, null);
    await writeProjectMeta(meta);
    broadcastProjectPresence(meta.id, activePresence(meta));
    sendJson(response, request, 200, {
      project: openProject(meta),
      collaboration: collaborationState(meta, identity, role),
    });
    return;
  }

  if (route === "presence" && request.method === "POST") {
    const { meta, identity, role } = await authorizeShare(
      request,
      url,
      token,
      "viewer",
    );
    const body = await readJsonBody(request);
    const currentFile =
      body.currentFile === null || body.currentFile === undefined
        ? null
        : normalizeRelativePath(body.currentFile);
    updatePresence(meta, identity, currentFile);
    await writeProjectMeta(meta);
    const users = activePresence(meta);
    broadcastProjectPresence(meta.id, users);
    sendJson(response, request, 200, {
      ...collaborationState(meta, identity, role),
      users,
    });
    return;
  }

  if (route === "permissions" && request.method === "GET") {
    const { meta, identity, role } = await authorizeShare(
      request,
      url,
      token,
      "viewer",
    );
    sendJson(response, request, 200, {
      permissions: permissionList(meta, identity.clientId),
      isAdmin: role === "admin",
      currentUserRole: role,
      requireApproval: Boolean(meta.requireApproval),
      ...(role === "admin" ? { pending: pendingList(meta) } : {}),
    });
    return;
  }

  if (route === "approval" && request.method === "PUT") {
    const { meta, identity, role } = await authorizeShare(request, url, token, "admin");
    const body = await readJsonBody(request);
    if (typeof body.requireApproval !== "boolean") {
      throw new HttpError(400, "Invalid approval setting.");
    }
    meta.requireApproval = body.requireApproval;
    // Turning approval off must not silently admit people who were waiting.
    if (!body.requireApproval) meta.pending = {};
    await writeProjectMeta(meta);
    broadcastJoinRequests(meta);
    sendJson(response, request, 200, collaborationState(meta, identity, role));
    return;
  }

  if (route.startsWith("pending/") && request.method === "POST") {
    const { meta, identity, role } = await authorizeShare(request, url, token, "admin");
    const body = await readJsonBody(request);
    const pendingClientId = parts[4];
    const pending =
      pendingClientId && Object.hasOwn(meta.pending, pendingClientId)
        ? meta.pending[pendingClientId]
        : undefined;
    if (!pending) throw new HttpError(404, "Join request not found.");
    if (body.action !== "approve" && body.action !== "deny") {
      throw new HttpError(400, "Invalid join request decision.");
    }
    const grantedRole = body.role === undefined ? "editor" : body.role;
    if (body.action === "approve" && !isRole(grantedRole)) {
      throw new HttpError(400, "Invalid role.");
    }
    delete meta.pending[pendingClientId];
    // A denied request keeps its session binding with no role, exactly like a
    // removed collaborator, so the same device cannot simply ask again.
    Object.defineProperty(meta.permissions, pendingClientId, {
      value: {
        clientId: pendingClientId,
        name: pending.name,
        role: body.action === "approve" ? grantedRole : null,
        sessionHash: pending.sessionHash,
        createdAt: now(),
        updatedAt: now(),
      },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    await writeProjectMeta(meta);
    broadcastJoinRequests(meta);
    sendJson(response, request, 200, collaborationState(meta, identity, role));
    return;
  }

  if (route === "permissions" && request.method === "PUT") {
    const { meta, identity } = await authorizeShare(request, url, token, "admin");
    const body = await readJsonBody(request);
    if (!isRole(body.role) || typeof body.clientId !== "string") {
      throw new HttpError(400, "Invalid permission update.");
    }
    if (body.clientId === identity.clientId) {
      throw new HttpError(400, "You cannot change your own role.");
    }
    const existing = Object.hasOwn(meta.permissions, body.clientId)
      ? meta.permissions[body.clientId]
      : undefined;
    if (!existing) throw new HttpError(404, "Collaborator not found.");
    existing.role = body.role;
    existing.updatedAt = now();
    await writeProjectMeta(meta);
    closeClientConnections(meta.id, body.clientId, 1008, "Permissions changed");
    const updated = {
      clientId: existing.clientId,
      name: existing.name,
      role: existing.role,
    };
    sendJson(response, request, 200, updated);
    return;
  }

  if (route.startsWith("collaborators/") && request.method === "DELETE") {
    const { meta, identity } = await authorizeShare(request, url, token, "admin");
    const clientIdToRemove = parts[4];
    if (!clientIdToRemove || clientIdToRemove === identity.clientId) {
      throw new HttpError(400, "Invalid collaborator removal.");
    }
    if (!Object.hasOwn(meta.permissions, clientIdToRemove)) {
      throw new HttpError(404, "Collaborator not found.");
    }
    const remainingAdmins = Object.values(meta.permissions).filter(
      (permission) =>
        permission.clientId !== clientIdToRemove && permission.role === "admin",
    );
    if (!remainingAdmins.length) {
      throw new HttpError(400, "A project must keep at least one admin.");
    }
    // Keep the session binding so possession of an old share link cannot
    // silently re-enroll a removed collaborator.
    meta.permissions[clientIdToRemove].role = null;
    delete meta.presence[clientIdToRemove];
    // The removed person still holds the invite. Retire it so they cannot come
    // back under a fresh identity; everyone else stays signed in.
    await rotateShare(meta);
    closeClientConnections(meta.id, clientIdToRemove, 1008, "Removed from project");
    broadcastProjectPresence(meta.id, activePresence(meta));
    sendEmpty(response, request);
    return;
  }

  throw new HttpError(404, "Share route not found.");
}

function roomKey(projectId, relativePath) {
  return `${projectId}:${relativePath}`;
}

async function getRoom(projectId, relativePath) {
  const key = roomKey(projectId, relativePath);
  const existing = rooms.get(key);
  if (existing) return existing;

  const doc = new Y.Doc();
  const text = doc.getText("content");
  const initialContent = await readProjectFile(projectId, relativePath).catch(
    (error) => {
      if (error instanceof HttpError && error.status === 404) return "";
      throw error;
    },
  );
  doc.transact(() => text.insert(0, initialContent), "initial-load");
  const awareness = new Awareness(doc);
  const conns = new Set();
  const room = {
    projectId,
    relativePath,
    doc,
    text,
    awareness,
    conns,
    persistTimer: null,
    evictTimer: null,
    lastActivityAt: now(),
    closeAll(code, reason) {
      for (const conn of Array.from(conns)) {
        conn.close(code, reason);
      }
      if (room.persistTimer) clearTimeout(room.persistTimer);
      if (room.evictTimer) clearTimeout(room.evictTimer);
      room.persistTimer = null;
      room.evictTimer = null;
      awareness.destroy();
      doc.destroy();
    },
  };

  // Bound how many documents live in memory. When over the cap, drop rooms that
  // currently have no connections (oldest first) before adding a new one.
  if (rooms.size >= maxRoomsInMemory) {
    const idle = [...rooms.values()]
      .filter((candidate) => candidate.conns.size === 0)
      .sort((left, right) => left.lastActivityAt - right.lastActivityAt);
    for (const candidate of idle) {
      if (rooms.size < maxRoomsInMemory) break;
      evictRoom(candidate);
    }
    if (rooms.size >= maxRoomsInMemory) {
      awareness.destroy();
      doc.destroy();
      throw new HttpError(503, "The collaboration server is at document capacity.");
    }
  }

  doc.on("update", (update, origin) => {
    scheduleRoomPersist(room);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    broadcastRoom(room, encoding.toUint8Array(encoder), origin);
  });

  awareness.on("update", ({ added, updated, removed }, origin) => {
    if (origin?.controlledAwarenessIds) {
      for (const id of added.concat(updated)) origin.controlledAwarenessIds.add(id);
      for (const id of removed) origin.controlledAwarenessIds.delete(id);
    }
    const changed = added.concat(updated, removed);
    if (!changed.length) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
    );
    broadcastRoom(room, encoding.toUint8Array(encoder), origin);
  });

  rooms.set(key, room);
  return room;
}

function setRoomText(room, content, origin) {
  if (room.text.toString() === content) return;
  room.doc.transact(() => {
    room.text.delete(0, room.text.length);
    room.text.insert(0, content);
  }, origin);
}

function scheduleRoomPersist(room) {
  if (room.persistTimer) clearTimeout(room.persistTimer);
  room.persistTimer = setTimeout(() => {
    room.persistTimer = null;
    // Never write past the document cap. Live edits share this limit with the
    // HTTP write path so a WebSocket session cannot grow a file without bound.
    if (room.text.length > maxCollabDocChars) {
      console.warn("Skipping oversize collaboration persist", {
        projectId: room.projectId,
        relativePath: room.relativePath,
        length: room.text.length,
      });
      return;
    }
    void withLock(`project:${room.projectId}`, async () => {
      if (rooms.get(roomKey(room.projectId, room.relativePath)) !== room) return;
      await atomicWriteText(
        filePathFor(room.projectId, room.relativePath),
        room.text.toString(),
      );
    }).catch((error) => {
      console.error("Could not persist collaboration room", {
        projectId: room.projectId,
        relativePath: room.relativePath,
        error,
      });
    });
  }, roomPersistDelayMs);
}

function evictRoom(room) {
  const key = roomKey(room.projectId, room.relativePath);
  if (rooms.get(key) !== room) return;
  if (room.evictTimer) {
    clearTimeout(room.evictTimer);
    room.evictTimer = null;
  }
  if (room.persistTimer) {
    clearTimeout(room.persistTimer);
    room.persistTimer = null;
    if (room.text.length <= maxCollabDocChars) {
      void atomicWriteText(
        filePathFor(room.projectId, room.relativePath),
        room.text.toString(),
      ).catch(() => {});
    }
  }
  rooms.delete(key);
  room.doc.destroy();
}

// When the last collaborator leaves, keep the document briefly (a quick
// reconnect reuses it) then release it so idle rooms cannot accumulate.
function scheduleRoomEviction(room) {
  if (room.evictTimer) clearTimeout(room.evictTimer);
  room.evictTimer = setTimeout(() => {
    room.evictTimer = null;
    if (room.conns.size === 0) evictRoom(room);
  }, roomEvictionDelayMs);
}

function broadcastRoom(room, message, origin) {
  for (const conn of room.conns) {
    if (conn !== origin) conn.sendBinary(message);
  }
}

function encodeProjectPresence(users) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageProjectPresence);
  encoding.writeVarString(encoder, JSON.stringify({ version: 1, users }));
  return encoding.toUint8Array(encoder);
}

function broadcastProjectPresence(projectId, users) {
  const frame = encodeProjectPresence(users);
  for (const room of rooms.values()) {
    if (room.projectId === projectId) {
      broadcastRoom(room, frame, null);
    }
  }
}

function encodeJoinRequests(meta) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageJoinRequests);
  encoding.writeVarString(
    encoder,
    JSON.stringify({ version: 1, pending: pendingList(meta) }),
  );
  return encoding.toUint8Array(encoder);
}

// Lets the owner in an open document answer a join request without having
// to reopen the Share window.
function broadcastJoinRequests(meta) {
  const frame = encodeJoinRequests(meta);
  for (const room of rooms.values()) {
    if (room.projectId !== meta.id) continue;
    for (const conn of room.conns) {
      if (conn.role === "admin") conn.sendBinary(frame);
    }
  }
}

function closeClientConnections(projectId, clientId, code, reason) {
  for (const room of rooms.values()) {
    if (room.projectId !== projectId) continue;
    for (const conn of Array.from(room.conns)) {
      if (conn.identity.clientId === clientId) conn.close(code, reason);
    }
  }
}

async function handleUpgrade(request, socket, head) {
  try {
    const url = new URL(
      request.url || "/",
      publicOrigin || `http://${request.headers.host}`,
    );
    if (!isAllowedOrigin(request.headers.origin)) {
      throw new HttpError(403, "Origin is not allowed.");
    }
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (
      parts[0] !== "api" ||
      parts[1] !== "projects" ||
      parts[3] !== "files" ||
      parts[4] !== "collaborate"
    ) {
      throw new HttpError(404, "WebSocket route not found.");
    }
    if (!checkRateLimit(clientIp(request))) {
      throw new HttpError(429, "Too many requests. Please slow down and try again.");
    }
    if (totalConnections >= maxConnectionsTotal) {
      throw new HttpError(503, "The collaboration server is at capacity.");
    }
    const projectId = parts[2];
    const relativePath = normalizeRelativePath(url.searchParams.get("path"));
    await withLock(`project:${projectId}`, async () => {
      const auth = await authorizeProject(request, url, projectId, "viewer");
      const key = request.headers["sec-websocket-key"];
      if (typeof key !== "string") throw new HttpError(400, "Missing WebSocket key.");
      const accept = createHash("sha1").update(`${key}${wsGuid}`).digest("base64");
      const room = await getRoom(projectId, relativePath);
      if (
        room.conns.size >= maxConnectionsPerRoom ||
        totalConnections >= maxConnectionsTotal
      ) {
        throw new HttpError(503, "This document has too many active collaborators.");
      }
      socket.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${accept}`,
          "\r\n",
        ].join("\r\n"),
      );

      if (room.evictTimer) {
        clearTimeout(room.evictTimer);
        room.evictTimer = null;
      }
      const conn = new CollaborationConnection(socket, room, auth.identity, auth.role);
      room.conns.add(conn);
      totalConnections += 1;
      room.lastActivityAt = now();
      updatePresence(auth.meta, auth.identity, relativePath);
      await writeProjectMeta(auth.meta);
      broadcastProjectPresence(projectId, activePresence(auth.meta));
      if (auth.role !== "viewer") conn.sendSyncStep1();
      conn.sendAwarenessStates();
      if (auth.role === "admin" && Object.keys(auth.meta.pending).length) {
        conn.sendBinary(encodeJoinRequests(auth.meta));
      }
      if (head?.byteLength) conn.receive(head);
    });
  } catch (error) {
    socket.write(
      `HTTP/1.1 ${error.status || 500} ${http.STATUS_CODES[error.status || 500] || "Error"}\r\nConnection: close\r\n\r\n`,
    );
    socket.destroy();
  }
}

class CollaborationConnection {
  constructor(socket, room, identity, role) {
    this.socket = socket;
    this.room = room;
    this.identity = identity;
    this.role = role;
    this.buffer = Buffer.alloc(0);
    this.controlledAwarenessIds = new Set();
    this.closed = false;
    this.pendingBytes = 0;
    this.pendingFrames = 0;
    this.lastActivityAt = now();

    socket.on("data", (chunk) => this.receive(chunk));
    socket.on("close", () => void this.destroy());
    socket.on("error", () => void this.destroy());
  }

  receive(chunk) {
    if (this.closed) return;
    this.lastActivityAt = now();
    this.room.lastActivityAt = this.lastActivityAt;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length) {
      let frame;
      try {
        frame = parseWebSocketFrame(this.buffer);
      } catch (error) {
        this.close(error.status === 1009 ? 1009 : 1003, error.message);
        return;
      }
      if (!frame) return;
      this.buffer = this.buffer.subarray(frame.bytesRead);
      this.pendingBytes += frame.payload.length;
      this.pendingFrames += 1;
      if (this.pendingBytes > maxWebSocketFrameBytes * 4 || this.pendingFrames > 256) {
        this.close(1009, "Too many pending messages");
        return;
      }
      void withLock(`project:${this.room.projectId}`, () => this.handleFrame(frame))
        .catch(() => this.close(1008, "Collaboration message rejected"))
        .finally(() => {
          this.pendingBytes -= frame.payload.length;
          this.pendingFrames -= 1;
        });
    }
  }

  async handleFrame(frame) {
    if (this.closed) return;
    if (frame.opcode === 8) {
      this.close(1000, "closed");
      return;
    }
    if (frame.opcode === 9) {
      this.sendFrame(10, frame.payload);
      return;
    }
    if (frame.opcode !== 2) return;
    if (frame.payload.byteLength > maxWebSocketFrameBytes) {
      this.close(1009, "Collaboration frame is too large");
      return;
    }
    await this.handleBinary(new Uint8Array(frame.payload));
  }

  async handleBinary(payload) {
    let decoder;
    let messageType;
    try {
      decoder = decoding.createDecoder(payload);
      messageType = decoding.readVarUint(decoder);
    } catch {
      return;
    }

    if (messageType === messageSync) {
      if (
        this.role === "viewer" &&
        syncInnerMessageType(payload) !== syncProtocol.messageYjsSyncStep1
      ) {
        this.close(1008, "Viewer access is read-only");
        return;
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      try {
        const innerType = syncInnerMessageType(payload);
        if (
          innerType === syncProtocol.messageYjsSyncStep2 ||
          innerType === syncProtocol.messageYjsUpdate
        ) {
          decoding.readVarUint(decoder);
          const update = decoding.readVarUint8Array(decoder);
          // Validate in an isolated document before any broadcast or mutation.
          const candidate = new Y.Doc();
          try {
            Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.room.doc));
            Y.applyUpdate(candidate, update);
            const text = candidate.getText("content");
            const bytes = Buffer.byteLength(text.toString(), "utf8");
            if (
              text.length > maxCollabDocChars ||
              bytes > maxFileBytes ||
              Y.encodeStateAsUpdate(candidate).byteLength > maxFileBytes * 4
            ) {
              this.close(1009, "Document is too large for collaboration.");
              return;
            }
            await assertProjectQuota(
              this.room.projectId,
              this.room.relativePath,
              bytes,
            );
            if (!this.closed) Y.applyUpdate(this.room.doc, update, this);
          } finally {
            candidate.destroy();
          }
        } else {
          syncProtocol.readSyncMessage(decoder, encoder, this.room.doc, this);
        }
      } catch {
        this.close(1008, "Collaboration update rejected");
        return;
      }
      // Enforce the shared document-size cap for live edits so a WebSocket
      // session cannot grow a file past the HTTP write limit.
      if (this.room.text.length > maxCollabDocChars) {
        this.close(1009, "Document is too large for collaboration.");
        return;
      }
      if (encoding.length(encoder) > 1) {
        this.sendBinary(encoding.toUint8Array(encoder));
      }
      return;
    }

    if (messageType === messageAwareness) {
      try {
        if (!decoding.hasContent(decoder)) return;
        const update = decoding.readVarUint8Array(decoder);
        if (!update.byteLength) return;
        if (update.byteLength > 16 * 1024)
          throw new Error("Awareness update too large");
        const awarenessDecoder = decoding.createDecoder(update);
        const count = decoding.readVarUint(awarenessDecoder);
        if (count > 16) throw new Error("Too many awareness states");
        const ids = new Set(this.controlledAwarenessIds);
        for (let index = 0; index < count; index += 1) {
          const id = decoding.readVarUint(awarenessDecoder);
          decoding.readVarUint(awarenessDecoder);
          const state = JSON.parse(decoding.readVarString(awarenessDecoder));
          if (
            this.room.awareness.getStates().has(id) &&
            !this.controlledAwarenessIds.has(id)
          ) {
            throw new Error("Awareness identity belongs to another connection");
          }
          if (state === null) ids.delete(id);
          else ids.add(id);
        }
        if (ids.size > 16) throw new Error("Too many awareness identities");
        awarenessProtocol.applyAwarenessUpdate(this.room.awareness, update, this);
      } catch {
        this.close(1008, "Awareness update rejected");
        return;
      }
    }
  }

  sendSyncStep1() {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, this.room.doc);
    this.sendBinary(encoding.toUint8Array(encoder));
  }

  sendAwarenessStates() {
    const states = Array.from(this.room.awareness.getStates().keys());
    if (!states.length) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.room.awareness, states),
    );
    this.sendBinary(encoding.toUint8Array(encoder));
  }

  sendBinary(payload) {
    this.sendFrame(2, Buffer.from(payload));
  }

  sendFrame(opcode, payload = Buffer.alloc(0)) {
    if (this.closed || !this.socket.writable) return;
    if (this.socket.writableLength > maxWebSocketFrameBytes * 4) {
      this.socket.destroy();
      void this.destroy();
      return;
    }
    this.socket.write(encodeWebSocketFrame(opcode, payload));
  }

  close(code = 1000, reason = "") {
    if (this.closed) return;
    const reasonBuffer = Buffer.from(reason.slice(0, 120));
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    this.sendFrame(8, payload);
    this.socket.end();
    void this.destroy();
  }

  async destroy() {
    if (this.closed) return;
    this.closed = true;
    this.room.conns.delete(this);
    totalConnections = Math.max(0, totalConnections - 1);
    if (this.room.conns.size === 0) {
      scheduleRoomEviction(this.room);
    }
    if (this.controlledAwarenessIds.size) {
      awarenessProtocol.removeAwarenessStates(
        this.room.awareness,
        Array.from(this.controlledAwarenessIds),
        this,
      );
    }
  }
}

function syncInnerMessageType(payload) {
  try {
    const decoder = decoding.createDecoder(payload);
    decoding.readVarUint(decoder);
    return decoding.readVarUint(decoder);
  } catch {
    return null;
  }
}

function parseWebSocketFrame(buffer) {
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (!fin) throw new HttpError(1003, "Fragmented frames are not supported.");
  if (!masked || (first & 0x70) !== 0 || ![2, 8, 9, 10].includes(opcode)) {
    throw new HttpError(1002, "Invalid WebSocket frame.");
  }
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    if (high !== 0) throw new HttpError(1009, "Frame is too large.");
    length = low;
    offset += 8;
  }
  if (length > maxWebSocketFrameBytes) {
    throw new HttpError(1009, "Frame is too large.");
  }
  if (opcode >= 8 && length > 125) throw new HttpError(1002, "Invalid control frame.");
  let mask;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }
  return { opcode, payload, bytesRead: offset + length };
}

function encodeWebSocketFrame(opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
  }
  return Buffer.concat([header, payload]);
}

// Structured, single-line JSON logs so journald / log shippers can parse them.
// The request path is logged without its query string so session and share
// tokens (which some clients pass as query params) never land in the logs.
function logAccess(request, status, startedAt) {
  if (!accessLogEnabled) return;
  const pathOnly = accessLogPath(request.url);
  console.log(
    JSON.stringify({
      level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      msg: "request",
      method: request.method,
      path: pathOnly,
      status,
      ip: clientIp(request),
      durationMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    }),
  );
}

const server = http.createServer((request, response) => {
  const startedAt = Date.now();
  response.on("finish", () => logAccess(request, response.statusCode, startedAt));
  handleHttp(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof HttpError ? error.message : "Internal collaboration error.";
    if (status >= 500) console.error(error);
    sendJson(response, request, status, {
      error: message,
      ...(error instanceof HttpError && error.code ? { code: error.code } : {}),
    });
  });
});

server.on("upgrade", (request, socket, head) => {
  void handleUpgrade(request, socket, head);
});

// Heartbeat: ping live connections and drop ones that have gone idle, so a
// client cannot hold a socket open indefinitely without sending anything.
const heartbeatTimer = setInterval(() => {
  const cutoff = now() - wsIdleTimeoutMs;
  for (const room of rooms.values()) {
    for (const conn of Array.from(room.conns)) {
      if (conn.lastActivityAt < cutoff) {
        conn.close(1001, "Idle timeout");
      } else {
        conn.sendFrame(9);
      }
    }
  }
}, wsHeartbeatMs);
heartbeatTimer.unref?.();

// Drop expired rate-limit buckets so the map cannot grow without bound.
const rateBucketTimer = setInterval(pruneRateBuckets, rateLimitWindowMs);
rateBucketTimer.unref?.();

await mkdir(dataDir, { recursive: true });
await ensureProjectCount();

server.listen(port, host, () => {
  console.log(
    JSON.stringify({
      level: "info",
      msg: "listening",
      host,
      port: server.address().port,
      dataDir,
      projects: knownProjectCount,
      time: new Date().toISOString(),
    }),
  );
});

function shutdown(signal) {
  console.log(
    JSON.stringify({
      level: "info",
      msg: "shutdown",
      signal,
      time: new Date().toISOString(),
    }),
  );
  clearInterval(heartbeatTimer);
  clearInterval(rateBucketTimer);
  for (const room of rooms.values()) {
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
      if (room.text.length <= maxCollabDocChars) {
        void atomicWriteText(
          filePathFor(room.projectId, room.relativePath),
          room.text.toString(),
        ).catch(() => {});
      }
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref?.();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
