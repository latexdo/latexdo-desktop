// OS-backed secret storage for AI cloud credentials.
//
// The renderer never persists API keys. On the desktop build the key is sent
// over IPC once at configuration time and stored here encrypted via Electron's
// `safeStorage` (Keychain / Credential Manager / libsecret). The renderer only
// keeps a `credentialId`; it fetches the secret back only for the duration of
// an actual provider request.
//
// On platforms where safeStorage encryption is unavailable (e.g. headless
// Linux without a secret service) we refuse to store rather than falling back
// to plaintext-on-disk.

import { app, safeStorage } from "electron";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const credentialsFileName = "ai-credentials.json";
const credentialsSchemaVersion = 1;
/** Safe credential ids: provider presets and custom ids built from them. */
const credentialIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
let credentialMutation: Promise<void> = Promise.resolve();

function mutateCredentials(
  change: (entries: Map<string, CredentialEntry>) => void,
): Promise<void> {
  const operation = credentialMutation.then(async () => {
    const entries = await readCredentialEntries();
    change(entries);
    await writeCredentialEntries(entries);
  });
  credentialMutation = operation.catch(() => {});
  return operation;
}

interface CredentialEntry {
  /** Base64 of safeStorage.encryptString(secret). */
  ciphertext: string;
  createdAt: string;
}

function credentialsFilePath(): string {
  return path.join(app.getPath("userData"), credentialsFileName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readCredentialEntries(): Promise<Map<string, CredentialEntry>> {
  try {
    const raw = await readFile(credentialsFilePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.entries)) {
      return new Map();
    }
    const entries = new Map<string, CredentialEntry>();
    for (const [id, entry] of Object.entries(parsed.entries)) {
      if (
        credentialIdPattern.test(id) &&
        isRecord(entry) &&
        typeof entry.ciphertext === "string" &&
        typeof entry.createdAt === "string"
      ) {
        entries.set(id, entry as unknown as CredentialEntry);
      }
    }
    return entries;
  } catch {
    return new Map();
  }
}

async function writeCredentialEntries(
  entries: Map<string, CredentialEntry>,
): Promise<void> {
  const targetPath = credentialsFilePath();
  const directory = path.dirname(targetPath);
  await mkdir(directory, { recursive: true });
  const payload = `${JSON.stringify(
    { schemaVersion: credentialsSchemaVersion, entries: Object.fromEntries(entries) },
    null,
    2,
  )}\n`;
  // Secret files must be readable/writable only by the current user.
  const tempPath = path.join(directory, `.${credentialsFileName}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, payload, { mode: 0o600, encoding: "utf8" });
    await chmod(tempPath, 0o600);
    await rename(tempPath, targetPath);
    await chmod(targetPath, 0o600);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

function ensureEncryptionAvailable(): void {
  if (!isCredentialStorageAvailable()) {
    throw new Error(
      "Secure credential storage is not available on this system. Configure an OS keyring and try again; credentials are never written to disk in plaintext.",
    );
  }
}

export function isCredentialStorageAvailable(): boolean {
  try {
    return (
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" ||
        !["basic_text", "unknown"].includes(safeStorage.getSelectedStorageBackend()))
    );
  } catch {
    return false;
  }
}

export async function setCredential(
  credentialId: string,
  secret: string,
): Promise<void> {
  if (!credentialIdPattern.test(credentialId)) {
    throw new Error("Invalid credential identifier.");
  }
  if (typeof secret !== "string" || secret.trim() === "") {
    throw new Error("The API key cannot be empty.");
  }
  ensureEncryptionAvailable();
  await mutateCredentials((entries) => {
    entries.set(credentialId, {
      ciphertext: safeStorage.encryptString(secret).toString("base64"),
      createdAt: new Date().toISOString(),
    });
  });
}

export async function getCredential(credentialId: string): Promise<string | null> {
  if (!credentialIdPattern.test(credentialId)) {
    return null;
  }
  if (!isCredentialStorageAvailable()) {
    return null;
  }
  const entries = await readCredentialEntries();
  const entry = entries.get(credentialId);
  if (!entry) return null;
  try {
    return safeStorage.decryptString(Buffer.from(entry.ciphertext, "base64"));
  } catch {
    // Corrupt or undecryptable entry (e.g. moved across machines). Treat as
    // missing so the user is prompted to reconfigure.
    return null;
  }
}

export async function hasCredential(credentialId: string): Promise<boolean> {
  if (!credentialIdPattern.test(credentialId) || !isCredentialStorageAvailable()) {
    return false;
  }
  const entries = await readCredentialEntries();
  return entries.has(credentialId);
}

export async function deleteCredential(credentialId: string): Promise<void> {
  if (!credentialIdPattern.test(credentialId)) {
    return;
  }
  await mutateCredentials((entries) => {
    entries.delete(credentialId);
  });
}

export async function listCredentialIds(): Promise<string[]> {
  if (!isCredentialStorageAvailable()) return [];
  const entries = await readCredentialEntries();
  return [...entries.keys()];
}
