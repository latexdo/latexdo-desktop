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
  /**
   * The project's end-to-end encryption key (always-on server). It lives only
   * in the invite: the server never receives it.
   */
  key?: string;
}

const keyPattern = /^[A-Za-z0-9_-]{43}$/;

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
  if (invite.key !== undefined && !keyPattern.test(invite.key)) {
    throw new Error("Invalid project key.");
  }
  const payload = JSON.stringify({
    v: inviteVersion,
    t: invite.token,
    a: addresses,
    ...(invite.key ? { k: invite.key } : {}),
  });
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
    const { v, t, a, k } = parsed as {
      v?: unknown;
      t?: unknown;
      a?: unknown;
      k?: unknown;
    };
    if (v !== inviteVersion || typeof t !== "string" || !tokenPattern.test(t)) {
      return null;
    }
    if (!Array.isArray(a) || a.length > maxInviteAddresses) return null;
    if (k !== undefined && (typeof k !== "string" || !keyPattern.test(k))) return null;
    const addresses = [
      ...new Set(
        a
          .map(normalizePeerOrigin)
          .filter((address): address is string => address !== null),
      ),
    ];
    if (!addresses.length) return null;
    return typeof k === "string"
      ? { token: t, addresses, key: k }
      : { token: t, addresses };
  } catch {
    return null;
  }
}

export function looksLikePeerInvite(input: unknown): boolean {
  return (
    typeof input === "string" && input.replace(/\s+/g, "").startsWith(peerInvitePrefix)
  );
}
