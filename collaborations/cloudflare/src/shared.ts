/*
 * Helpers shared by the router and the project rooms: errors, CORS, the
 * caller's identity, safe paths and share tokens. The HTTP API matches the
 * self-hosted server in ../server.mjs, so the desktop app talks to both.
 */

export const limits = {
  /** A JSON request body (a file travels inside one, base64-encoded). */
  maxJsonBytes: 40 * 1024 * 1024,
  /** One encrypted edit or snapshot of a text file. */
  maxUpdateBytes: 24 * 1024 * 1024,
  /** One binary file (figure, PDF, data). */
  maxBinaryBytes: 25 * 1024 * 1024,
  /** Everything in one project. */
  maxProjectBytes: 100 * 1024 * 1024,
  maxProjectEntries: 2000,
  /** Projects one person can own. */
  maxProjectsPerOwner: 20,
  /**
   * All projects together. The free plan has 5 GB; past this, uploads and new
   * projects are refused so nobody can fill it for everyone.
   */
  maxAccountBytes: 4 * 1024 * 1024 * 1024,
  usageReportStepBytes: 1024 * 1024,
  maxConnectionsPerProject: 150,
  maxConnectionsPerClient: 40,
  maxPendingRequests: 50,
  maxRetiredShareTokens: 20,
  /** Encrypted names are longer than the names themselves. */
  maxNameChars: 600,
  maxCursorBytes: 32 * 1024,
  /** Presence counts as "here" this long after the last sign of life. */
  presenceTtlMs: 150_000,
  /** Live edits are saved this soon (well before a room can hibernate). */
  flushDelayMs: 4_000,
  /** A project nobody opens for this long is deleted. */
  inactiveProjectMs: 365 * 24 * 60 * 60 * 1000,
  cleanupCheckMs: 7 * 24 * 60 * 60 * 1000,
  /** Rows hold at most 2 MB; larger data is split into parts. */
  chunkBytes: 1_500_000,
} as const;

export type Role = "admin" | "editor" | "viewer";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

// No CORS: only the LatexDo app (its main process, not a web page) talks to
// this server, so browsers refuse cross-site calls from any website.
const securityHeaders: Record<string, string> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

export function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : `${JSON.stringify(body)}\n`, {
    status: body === undefined && status === 200 ? 204 : status,
    headers: { ...securityHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

export function empty(status = 204): Response {
  return new Response(null, {
    status,
    headers: securityHeaders,
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json(error.status, {
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
  console.error(error);
  return json(500, { error: "Internal collaboration error." });
}

export interface Identity {
  sessionId: string;
  clientId: string;
  clientName: string;
}

function clean(value: string | null, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function requestIdentity(request: Request, url: URL): Identity {
  const sessionId = clean(
    request.headers.get("x-latexdo-session") ?? url.searchParams.get("session"),
    160,
  );
  const clientId = clean(
    request.headers.get("x-latexdo-client") ?? url.searchParams.get("clientId"),
    160,
  );
  if (!sessionId || !clientId) {
    throw new HttpError(400, "Missing LatexDo collaboration identity headers.");
  }
  return {
    sessionId,
    clientId,
    // Encrypted by the app, so longer than the name itself.
    clientName:
      clean(
        request.headers.get("x-latexdo-client-name") ?? url.searchParams.get("name"),
        limits.maxNameChars,
      ) || "Anonymous",
  };
}

export function requestShareToken(request: Request, url: URL): string {
  return clean(
    request.headers.get("x-latexdo-share-token") ?? url.searchParams.get("share"),
    256,
  );
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function roleRank(role: Role | null | undefined): number {
  return role === "admin" ? 3 : role === "editor" ? 2 : role === "viewer" ? 1 : 0;
}

export function isRole(value: unknown): value is Role {
  return value === "admin" || value === "editor" || value === "viewer";
}

/** A project-relative path, normalized; never escapes the project. */
export function normalizeRelativePath(
  value: unknown,
  { allowEmpty = false } = {},
): string {
  const raw = typeof value === "string" ? value.trim().replaceAll("\\", "/") : "";
  if (!raw) {
    if (allowEmpty) return "";
    throw new HttpError(400, "Missing file path.");
  }
  if (raw.length > 512) throw new HttpError(400, "File path is too long.");
  if (
    raw.startsWith("/") ||
    /^[A-Za-z]:/.test(raw) ||
    /[\u0000-\u001f\u007f]/.test(raw)
  ) {
    throw new HttpError(400, "Invalid file path.");
  }
  const segments: string[] = [];
  for (const segment of raw.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === ".." || segment === ".git" || segment === "node_modules") {
      throw new HttpError(400, "Invalid file path.");
    }
    segments.push(segment);
  }
  if (!segments.length) {
    if (allowEmpty) return "";
    throw new HttpError(400, "Invalid file path.");
  }
  return segments.join("/");
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

export function base64Decode(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

const projectIdPattern = /^project_[0-9a-f]{32}$/;
// A share token carries its project's id, so a request reaches the right room
// without any lookup table: p<32 hex>_<43 random base64url characters>.
const shareTokenPattern = /^p([0-9a-f]{32})_[A-Za-z0-9_-]{43}$/;

export function newProjectId(): string {
  return `project_${randomHex(16)}`;
}

export function isProjectId(value: string): boolean {
  return projectIdPattern.test(value);
}

export function newShareToken(projectId: string): string {
  return `p${projectId.slice("project_".length)}_${base64UrlEncode(
    crypto.getRandomValues(new Uint8Array(32)),
  )}`;
}

export function projectIdFromShareToken(token: string): string | null {
  const match = shareTokenPattern.exec(token);
  return match ? `project_${match[1]}` : null;
}

/** Compares secrets without leaking where they differ. */
export function sameSecret(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
