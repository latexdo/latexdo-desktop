import type { CollaborationIdentity } from "./collaborationTypes";
import { collaboratorLook } from "./collaboratorLook";

// Share tokens are kept per server; projects shared from this computer use this key.
const defaultApiOrigin = "local";
const cloudSessionKey = "latexdo.cloud.session";
const cloudClientKey = "latexdo.cloud.client";
const cloudClientNameKey = "latexdo.cloud.clientName";
const legacyShareTokensKey = "latexdo.cloud.shareTokens";

function normalizedOrigin(value = defaultApiOrigin): string {
  try {
    return new URL(value).origin;
  } catch {
    return defaultApiOrigin;
  }
}

function shareTokenKey(projectId: string, apiOrigin: string): string {
  return `latexdo.cloud.shareToken.v2:${encodeURIComponent(normalizedOrigin(apiOrigin))}:${encodeURIComponent(projectId)}`;
}

function readOrCreate(key: string, create: () => string): string {
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = create();
  window.localStorage.setItem(key, created);
  return created;
}

function storedClientName(): string {
  return (window.localStorage.getItem(cloudClientNameKey) ?? "").trim().slice(0, 80);
}

export function collaborationSessionId(): string {
  return readOrCreate(cloudSessionKey, () => `session-${crypto.randomUUID()}`);
}

export function collaborationClientId(): string {
  return readOrCreate(cloudClientKey, () => `client-${crypto.randomUUID()}`);
}

export function collaborationIdentity(): CollaborationIdentity {
  // Color and emoji come from the client id, so other people see the same
  // look on this person's cursor and avatar.
  const { color, emoji } = collaboratorLook(collaborationClientId());
  return { clientName: storedClientName(), color, emoji };
}

export function shareTokenForProject(
  projectId: string,
  apiOrigin = defaultApiOrigin,
): string | undefined {
  const key = shareTokenKey(projectId, apiOrigin);
  const stored = window.localStorage.getItem(key)?.trim();
  if (stored) return stored;
  try {
    const legacy = JSON.parse(
      window.localStorage.getItem(legacyShareTokensKey) ?? "{}",
    ) as Record<string, unknown>;
    const token = typeof legacy[projectId] === "string" ? legacy[projectId].trim() : "";
    if (!token) return undefined;
    window.localStorage.setItem(key, token);
    return token;
  } catch {
    return undefined;
  }
}

export function rememberShareToken(
  projectId: string,
  token: string,
  apiOrigin = defaultApiOrigin,
): void {
  window.localStorage.setItem(shareTokenKey(projectId, apiOrigin), token);
}

export function forgetShareToken(
  projectId: string,
  apiOrigin = defaultApiOrigin,
): void {
  window.localStorage.removeItem(shareTokenKey(projectId, apiOrigin));
}
