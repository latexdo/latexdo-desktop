/*
 * End-to-end encryption for projects on LatexDo's always-on server.
 *
 * Every project has its own random 256-bit key, made on the owner's computer.
 * It travels only inside the invite (pasted by people, never sent to the
 * server) and is kept in the OS keychain. The server stores and relays
 * ciphertext only: file contents, live edits, cursors, file names inside the
 * editor and the project's name.
 *
 * AES-256-GCM with a fresh random 96-bit nonce per message. Each ciphertext is
 * bound to its project and to what it is (text, file, name, cursor), so the
 * server cannot replay one project's data in another or pass a cursor off as
 * a document edit.
 */

import { webcrypto } from "node:crypto";

const subtle = webcrypto.subtle;
const version = 1;
const nonceBytes = 12;
const stringPrefix = "enc1:";

export type CipherKind = "text" | "file" | "name" | "cursor";

export function newProjectKey(): string {
  return Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

export function isProjectKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value, "base64url").byteLength === 32
  );
}

const importedKeys = new Map<string, Promise<CryptoKey>>();

function importKey(key: string): Promise<CryptoKey> {
  let imported = importedKeys.get(key);
  if (!imported) {
    if (!isProjectKey(key)) throw new Error("Invalid project key.");
    imported = subtle.importKey("raw", Buffer.from(key, "base64url"), "AES-GCM", false, [
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
  const nonce = webcrypto.getRandomValues(new Uint8Array(nonceBytes));
  const ciphertext = new Uint8Array(
    await subtle.encrypt(
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
    await subtle.decrypt(
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
  const sealed = await encryptBytes(key, projectId, kind, new TextEncoder().encode(value));
  return `${stringPrefix}${Buffer.from(sealed).toString("base64url")}`;
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
    Buffer.from(value.slice(stringPrefix.length), "base64url"),
  );
  return new TextDecoder().decode(plain);
}
