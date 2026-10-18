/*
 * Web links for projects on LatexDo's always-on server: a co-author opens
 * https://collab.latexdo.org/join#<invite> in any browser and edits right away.
 * The part after "#" is the desktop invite (share token, address and the
 * project's encryption key); browsers never send it to a server.
 */

const invitePrefix = "latexdo-invite:";

function decodeInvitePayload(encoded: string): { a?: unknown; k?: unknown } | null {
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as { a?: unknown; k?: unknown })
      : null;
  } catch {
    return null;
  }
}

/** The browser link for an invite, or null when the project is not on the server. */
export function webLinkForInvite(inviteCode: string | undefined | null): string | null {
  const compact = (inviteCode ?? "").replace(/\s+/g, "");
  if (!compact.startsWith(invitePrefix)) return null;
  const encoded = compact.slice(invitePrefix.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  const payload = decodeInvitePayload(encoded);
  // Only always-on projects carry a key; a computer-hosted one has no web page.
  if (!payload || typeof payload.k !== "string" || !Array.isArray(payload.a))
    return null;
  const address = payload.a.find((item): item is string => typeof item === "string");
  if (!address) return null;
  try {
    const origin = new URL(address);
    if (origin.protocol !== "https:" && origin.hostname !== "localhost") return null;
    return `${origin.origin}/join#${encoded}`;
  } catch {
    return null;
  }
}
