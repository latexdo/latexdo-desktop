/*
 * Links that open the desktop app from a browser. The co-author web page
 * (https://collab.latexdo.org/join#<code>) offers "Open in LatexDo", which
 * goes to latexdo-app://join/<code>; the OS hands that URL to this app.
 *
 * The scheme is separate from latexdo://, which only serves the app's own
 * window and is never registered with the operating system.
 */

export const deepLinkScheme = "latexdo-app";

const invitePrefix = "latexdo-invite:";
const maxInviteCodeLength = 4096;

/**
 * The invite carried by latexdo-app://join/<code> (also accepted with the
 * code after "#" or "?invite="), as the join field expects it, or null.
 */
export function inviteFromDeepLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > maxInviteCodeLength + 64) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== `${deepLinkScheme}:`) return null;
  // "latexdo-app://join/<code>" parses with host "join"; tolerate the
  // "latexdo-app:join/<code>" spelling some systems produce.
  const route = `${url.host}${url.pathname}`.replace(/^\/+/, "");
  const [action, ...rest] = route.split("/");
  if (action !== "join") return null;
  const code = (
    rest.join("/") ||
    url.hash.replace(/^#/, "") ||
    url.searchParams.get("invite") ||
    ""
  ).replace(/^latexdo-invite:/, "");
  if (!code || code.length > maxInviteCodeLength || !/^[A-Za-z0-9_-]+$/.test(code)) {
    return null;
  }
  return `${invitePrefix}${code}`;
}

/** The first join link among command-line arguments (Windows and Linux). */
export function inviteFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (!arg.startsWith(`${deepLinkScheme}:`)) continue;
    const invite = inviteFromDeepLink(arg);
    if (invite) return invite;
  }
  return null;
}
