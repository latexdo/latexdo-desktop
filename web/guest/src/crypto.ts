/*
 * The browser side of LatexDo's end-to-end encryption. Byte for byte the same
 * format as the desktop app (electron/collabCrypto.ts): AES-256-GCM, a fresh
 * 96-bit nonce per message, and each ciphertext bound to its project and kind.
 */

export type CipherKind = "text" | "file" | "name" | "cursor";

const version = 1;
const nonceBytes = 12;
const stringPrefix = "enc1:";

export function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function base64ToBytes(value: string): Uint8Array {
  return base64UrlToBytes(value);
}

export function isProjectKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(value) &&
    base64UrlToBytes(value).byteLength === 32
  );
}

const importedKeys = new Map<string, Promise<CryptoKey>>();

function importKey(key: string): Promise<CryptoKey> {
  let imported = importedKeys.get(key);
  if (!imported) {
    if (!isProjectKey(key)) throw new Error("Invalid project key.");
    imported = crypto.subtle.importKey("raw", base64UrlToBytes(key), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
    importedKeys.set(key, imported);
  }
  return imported;
}

function associatedData(projectId: string, kind: CipherKind): Uint8Array {
  return new TextEncoder().encode(`latexdo/${version}/${kind}/${projectId}`);
}

/** version (1) | nonce (12) | AES-GCM ciphertext and tag */
export async function encryptBytes(
  key: string,
  projectId: string,
  kind: CipherKind,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(nonceBytes));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: associatedData(projectId, kind) },
      await importKey(key),
      plaintext,
    ),
  );
  const out = new Uint8Array(1 + nonceBytes + ciphertext.byteLength);
  out[0] = version;
  out.set(nonce, 1);
  out.set(ciphertext, 1 + nonceBytes);
  return out;
}

/** Throws when the data was not made with this key, project and kind. */
export async function decryptBytes(
  key: string,
  projectId: string,
  kind: CipherKind,
  sealed: Uint8Array,
): Promise<Uint8Array> {
  if (sealed.byteLength < 1 + nonceBytes + 16 || sealed[0] !== version) {
    throw new Error("Not an encrypted LatexDo payload.");
  }
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: sealed.subarray(1, 1 + nonceBytes),
        additionalData: associatedData(projectId, kind),
      },
      await importKey(key),
      sealed.subarray(1 + nonceBytes),
    ),
  );
}

export async function encryptString(
  key: string,
  projectId: string,
  kind: CipherKind,
  value: string,
): Promise<string> {
  const sealed = await encryptBytes(
    key,
    projectId,
    kind,
    new TextEncoder().encode(value),
  );
  return `${stringPrefix}${bytesToBase64Url(sealed)}`;
}

export function isEncryptedString(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(stringPrefix);
}

export async function decryptString(
  key: string,
  projectId: string,
  kind: CipherKind,
  value: string,
): Promise<string> {
  if (!isEncryptedString(value)) throw new Error("Not an encrypted LatexDo string.");
  const plain = await decryptBytes(
    key,
    projectId,
    kind,
    base64UrlToBytes(value.slice(stringPrefix.length)),
  );
  return new TextDecoder().decode(plain);
}
