// Renderer credential client.
//
// Cloud API keys never live in localStorage. On the desktop build they are
// stored in the main process OS credential vault (via safeStorage) after a
// single IPC round trip at configuration time. The renderer keeps only the
// credential id; it retrieves the secret for the short window of an actual
// provider request.
//
// In browser-only builds there is no secure vault, so the secret is held in
// memory for the current session only and is re-entered on reload.

import type { AiBridge } from "./aiClient";

/** In-memory fallback used by browser-only builds. */
const memoryVault = new Map<string, string>();

function bridge(): AiBridge | null {
  return (globalThis as { aiApi?: AiBridge }).aiApi ?? null;
}

export function credentialIdForProvider(providerId: string): string {
  return `credential-${providerId || "custom"}-primary`;
}

export async function isSecureCredentialStorageAvailable(): Promise<boolean> {
  const bridged = bridge();
  if (!bridged?.credentialsSupported) return false;
  try {
    return await bridged.credentialsSupported();
  } catch {
    return false;
  }
}

/** Persist a secret; resolves false when no secure store is reachable. */
export async function saveCloudCredential(
  credentialId: string,
  secret: string,
): Promise<boolean> {
  const bridged = bridge();
  memoryVault.set(credentialId, secret);
  if (bridged?.setCredential) {
    try {
      const result = await bridged.setCredential(credentialId, secret);
      return result.ok;
    } catch {
      return false;
    }
  }
  // Browser-only build: keep it in memory for this session.
  return true;
}

/** Fetch the secret back only for an in-flight request. Never persisted. */
export async function loadCloudCredential(
  credentialId: string,
): Promise<string | null> {
  const fromMemory = memoryVault.get(credentialId);
  if (fromMemory !== undefined) return fromMemory;
  const bridged = bridge();
  if (bridged?.getCredential) {
    try {
      const stored = await bridged.getCredential(credentialId);
      if (stored) {
        memoryVault.set(credentialId, stored);
        return stored;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** Whether a usable secret exists without revealing it. */
export async function cloudCredentialConfigured(
  credentialId: string,
): Promise<boolean> {
  if (memoryVault.has(credentialId)) return true;
  const bridged = bridge();
  if (bridged?.hasCredential) {
    try {
      return await bridged.hasCredential(credentialId);
    } catch {
      return false;
    }
  }
  return false;
}

export async function removeCloudCredential(credentialId: string): Promise<void> {
  memoryVault.delete(credentialId);
  const bridged = bridge();
  if (bridged?.deleteCredential) {
    try {
      await bridged.deleteCredential(credentialId);
    } catch {
      // Best effort.
    }
  }
}

/**
 * One-time migration for configs saved before credentials moved to the secure
 * vault. If the raw AiConfig JSON still holds a plaintext cloud.apiKey it is
 * moved into the vault and stripped from storage. Returns the migrated config
 * JSON so callers can persist the sanitized version.
 */
export async function migrateLegacyCloudApiKey(
  rawJson: string | null,
): Promise<string | null> {
  if (!rawJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as { cloud?: unknown }).cloud !== "object" ||
    (parsed as { cloud?: { apiKey?: unknown } }).cloud === null
  ) {
    return null;
  }
  const cloud = (
    parsed as {
      cloud?: { apiKey?: unknown; credentialId?: unknown; providerId?: unknown };
    }
  ).cloud as { apiKey?: unknown; credentialId?: unknown; providerId?: unknown };
  const legacyKey = typeof cloud.apiKey === "string" ? cloud.apiKey : "";
  if (!legacyKey.trim() || cloud.credentialId) {
    return null;
  }
  // Derive the same id the config normalizer assigns so the vault entry is
  // found on the next load (it uses the provider id as the id suffix).
  const credentialId =
    typeof cloud.credentialId === "string" && cloud.credentialId.trim()
      ? (cloud.credentialId as string)
      : credentialIdForProvider(
          typeof cloud.providerId === "string" && cloud.providerId.trim()
            ? (cloud.providerId as string)
            : "custom",
        );
  await saveCloudCredential(credentialId, legacyKey);
  const next: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  next.cloud = {
    ...cloud,
    credentialId,
    credentialConfigured: true,
  };
  delete (next.cloud as { apiKey?: unknown }).apiKey;
  return JSON.stringify(next);
}
