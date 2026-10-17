import {
  collaborationClientId,
  collaborationIdentity,
  collaborationSessionId,
  shareTokenForProject,
} from "./collaborationStorage";
import type { CollaborationRoomOptions } from "./collaborationTypes";
import { usesPeerBridge } from "./peerSocket";

export class CollaborationApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CollaborationApiError";
  }
}

/**
 * The self-hosted collaboration server's origin, or "" when none is set.
 * Without one, projects are shared from this computer (see peerSocket.ts).
 */
function normalizedCollaborationApiBaseUrl(value: unknown): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : "";
  } catch {
    return "";
  }
}

/** LatexDo's always-on collaboration server (projects shared over the internet). */
export const alwaysOnCollaborationOrigin = normalizedCollaborationApiBaseUrl(
  import.meta.env.VITE_LATEXDO_COLLAB_URL || "https://collab.latexdo.org",
);

export function isAlwaysOnCollaborationServer(origin: string | undefined): boolean {
  return Boolean(origin) && origin === alwaysOnCollaborationOrigin;
}

export function collaborationApiBaseUrl(): string {
  return normalizedCollaborationApiBaseUrl(import.meta.env.VITE_LATEXDO_API_BASE_URL);
}

export function collaborationHeaders(shareToken?: string): Record<string, string> {
  const clientName = collaborationIdentity().clientName;
  return {
    "x-latexdo-session": collaborationSessionId(),
    "x-latexdo-client": collaborationClientId(),
    ...(clientName ? { "x-latexdo-client-name": clientName } : {}),
    ...(shareToken ? { "x-latexdo-share-token": shareToken } : {}),
  };
}

export function collaborationShareUrl(token: string): string {
  return `${window.location.origin}${window.location.pathname}#share=${encodeURIComponent(token)}`;
}

export function projectShareToken(
  projectId: string,
  explicitToken?: string,
  apiBaseUrl = collaborationApiBaseUrl(),
): string | undefined {
  return explicitToken || shareTokenForProject(projectId, apiBaseUrl);
}

export async function collaborationWebSocketUrl(
  options: CollaborationRoomOptions,
): Promise<string> {
  // A project hosted on someone's computer is reached through the desktop
  // bridge, which only needs the path and query; the origin here is a stand-in.
  const base = usesPeerBridge(options.apiBaseUrl)
    ? "http://peer.invalid"
    : normalizedCollaborationApiBaseUrl(options.apiBaseUrl);
  if (!base) throw new Error("No collaboration server is configured.");
  const token = projectShareToken(options.projectId, options.shareToken, base);

  const url = new URL(
    `/api/projects/${encodeURIComponent(options.projectId)}/files/collaborate`,
    base,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("path", options.relativePath);
  url.searchParams.set("session", collaborationSessionId());
  url.searchParams.set("clientId", collaborationClientId());
  if (options.clientName) {
    url.searchParams.set("name", options.clientName);
  }
  if (token) {
    url.searchParams.set("share", token);
  }
  return url.toString();
}
