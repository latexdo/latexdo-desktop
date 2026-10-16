import { createHash } from "node:crypto";

export function sessionHash(sessionId) {
  return createHash("sha256").update(sessionId).digest("hex");
}

export function projectRole(meta, identity, token) {
  if (meta.ownerSession === identity.sessionId) return "admin";
  const existing = Object.hasOwn(meta.permissions, identity.clientId)
    ? meta.permissions[identity.clientId]
    : undefined;
  // Public client IDs are labels, not credentials. Legacy entries must be
  // re-invited under a new client ID instead of allowing an attacker to claim them.
  if (existing) {
    return existing.sessionHash === sessionHash(identity.sessionId)
      ? existing.role
      : null;
  }
  return token && token === meta.shareToken ? "editor" : null;
}

export function accessLogPath(requestUrl) {
  const pathname = (requestUrl || "/").split("?")[0];
  try {
    const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] === "api" && parts[1] === "shares" && parts[2])
      parts[2] = "[redacted]";
    return `/${parts.join("/")}`;
  } catch {
    return "/[invalid-path]";
  }
}

const pendingOperations = new Map();

export function withLock(key, operation) {
  const previous = pendingOperations.get(key) || Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(
    () => {},
    () => {},
  );
  pendingOperations.set(key, settled);
  void settled.then(() => {
    if (pendingOperations.get(key) === settled) pendingOperations.delete(key);
  });
  return result;
}
