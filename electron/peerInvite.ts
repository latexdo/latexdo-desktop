// Invite codes for projects hosted on a user's own computer. A code is a single
// pasteable string that carries the share token plus every address the host can
// currently be reached at, so the guest never has to type an address.

export const peerInvitePrefix = "latexdo-invite:";
/** Stable pseudo-origin for the collaboration server hosted by this computer. */
export const localHostOrigin = "latexdo-host://local";

const inviteVersion = 1;
const maxInviteLength = 4096;
const maxInviteAddresses = 8;
const tokenPattern = /^[A-Za-z0-9_-]{16,256}$/;

export interface PeerInvite {
  token: string;
  addresses: string[];
}

/** Returns the bare http(s) origin for a guest-reachable address, or null. */
export function normalizePeerOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 512) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || !url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function encodePeerInvite(invite: PeerInvite): string {
  const addresses = invite.addresses
    .map(normalizePeerOrigin)
    .filter((address): address is string => address !== null)
    .slice(0, maxInviteAddresses);
  if (!tokenPattern.test(invite.token) || !addresses.length) {
    throw new Error("An invite needs a share token and at least one address.");
  }
  const payload = JSON.stringify({ v: inviteVersion, t: invite.token, a: addresses });
  return `${peerInvitePrefix}${Buffer.from(payload, "utf8").toString("base64url")}`;
}

/** Decodes a pasted invite. Returns null for anything that is not an invite. */
export function decodePeerInvite(input: unknown): PeerInvite | null {
  if (typeof input !== "string") return null;
  // Chat apps wrap long strings; whitespace is never part of a code.
  const compact = input.replace(/\s+/g, "");
  if (compact.length > maxInviteLength || !compact.startsWith(peerInvitePrefix)) {
    return null;
  }
  const encoded = compact.slice(peerInvitePrefix.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const { v, t, a } = parsed as { v?: unknown; t?: unknown; a?: unknown };
    if (v !== inviteVersion || typeof t !== "string" || !tokenPattern.test(t)) {
      return null;
    }
    if (!Array.isArray(a) || a.length > maxInviteAddresses) return null;
    const addresses = [
      ...new Set(
        a
          .map(normalizePeerOrigin)
          .filter((address): address is string => address !== null),
      ),
    ];
    return addresses.length ? { token: t, addresses } : null;
  } catch {
    return null;
  }
}

export function looksLikePeerInvite(input: unknown): boolean {
  return (
    typeof input === "string" && input.replace(/\s+/g, "").startsWith(peerInvitePrefix)
  );
}
