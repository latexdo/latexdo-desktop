/*
 * Web links for shared projects: https://collab.latexdo.org/join#<code>, where
 * <code> is the desktop invite without its "latexdo-invite:" prefix. Browsers
 * never send the part after "#" to a server, so the key stays in the link.
 */

import { base64UrlToBytes, isProjectKey } from "./crypto";

export interface WebInvite {
  token: string;
  key: string;
  projectId: string;
}

const invitePrefix = "latexdo-invite:";
const shareTokenPattern = /^p([0-9a-f]{32})_[A-Za-z0-9_-]{43}$/;

export function projectIdFromShareToken(token: string): string | null {
  const match = shareTokenPattern.exec(token);
  return match ? `project_${match[1]}` : null;
}

/** Reads an invite from a link's fragment or a pasted desktop invite. */
export function parseWebInvite(input: string): WebInvite | null {
  let code = input.replace(/\s+/g, "");
  const hash = code.indexOf("#");
  if (hash >= 0) code = code.slice(hash + 1);
  if (code.startsWith(invitePrefix)) code = code.slice(invitePrefix.length);
  if (!code || code.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(code))) as {
      v?: unknown;
      t?: unknown;
      k?: unknown;
    };
    if (parsed.v !== 1 || typeof parsed.t !== "string" || !isProjectKey(parsed.k)) {
      return null;
    }
    const projectId = projectIdFromShareToken(parsed.t);
    return projectId ? { token: parsed.t, key: parsed.k, projectId } : null;
  } catch {
    return null;
  }
}
