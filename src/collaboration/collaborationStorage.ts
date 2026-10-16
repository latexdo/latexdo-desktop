import type { CollaborationIdentity } from "./collaborationTypes";

// Share tokens are kept per server; projects shared from this computer use this key.
const defaultApiOrigin = "local";
const cloudSessionKey = "latexdo.cloud.session";
const cloudClientKey = "latexdo.cloud.client";
const cloudClientNameKey = "latexdo.cloud.clientName";
const cloudClientColorKey = "latexdo.cloud.clientColor";
const legacyShareTokensKey = "latexdo.cloud.shareTokens";

const collaboratorColors = [
  "#2f6fdb",
  "#1d7a56",
  "#a65f1b",
  "#8b4aa6",
  "#b42318",
  "#0f766e",
  "#6d5dfc",
  "#b45309",
];

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
  const clientName = storedClientName();
  const color = readOrCreate(cloudClientColorKey, () => {
    const random = new Uint8Array(1);
    crypto.getRandomValues(random);
    return collaboratorColors[random[0] % collaboratorColors.length];
  });
  return { clientName, color };
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
