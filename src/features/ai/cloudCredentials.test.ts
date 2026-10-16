import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import {
  cloudCredentialConfigured,
  credentialIdForProvider,
  isSecureCredentialStorageAvailable,
  loadCloudCredential,
  migrateLegacyCloudApiKey,
  removeCloudCredential,
  saveCloudCredential,
} from "./cloudCredentials";
import type { AiBridge } from "./aiClient";

function installBridge(overrides: Partial<AiBridge> = {}): Record<string, Mock> {
  const mocks: Record<string, Mock> = {
    credentialsSupported: vi.fn(),
    setCredential: vi.fn(),
    getCredential: vi.fn(),
    hasCredential: vi.fn(),
    deleteCredential: vi.fn(),
  };
  Object.defineProperty(globalThis, "aiApi", {
    configurable: true,
    value: {
      credentialsSupported: mocks.credentialsSupported,
      setCredential: mocks.setCredential,
      getCredential: mocks.getCredential,
      hasCredential: mocks.hasCredential,
      deleteCredential: mocks.deleteCredential,
      ...overrides,
    },
  });
  return mocks;
}

describe("cloudCredentials", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { aiApi?: unknown }).aiApi;
  });
  afterEach(() => {
    delete (globalThis as { aiApi?: unknown }).aiApi;
  });

  it("saves via the secure vault on desktop and loads it back", async () => {
    const mocks = installBridge();
    mocks.setCredential.mockResolvedValue({ ok: true });
    mocks.getCredential.mockResolvedValue("sk-vault");

    expect(await saveCloudCredential("credential-anthropic-primary", "sk-vault")).toBe(
      true,
    );
    expect(mocks.setCredential).toHaveBeenCalledWith(
      "credential-anthropic-primary",
      "sk-vault",
    );

    // loadCloudCredential prefers the in-memory copy; force a vault hit by not
    // seeding memory.
    const key = await loadCloudCredential("other-id");
    expect(key).toBe("sk-vault");
    expect(mocks.getCredential).toHaveBeenCalledWith("other-id");
  });

  it("falls back to a session-only memory vault in the browser", async () => {
    await saveCloudCredential("credential-groq-primary", "sk-memory");
    expect(await loadCloudCredential("credential-groq-primary")).toBe("sk-memory");
    expect(await cloudCredentialConfigured("credential-groq-primary")).toBe(true);
  });

  it("does not reveal a secret through the configured check", async () => {
    const mocks = installBridge();
    mocks.hasCredential.mockResolvedValue(true);
    expect(await cloudCredentialConfigured("credential-openai-primary")).toBe(true);
    expect(mocks.hasCredential).toHaveBeenCalledWith("credential-openai-primary");
    expect(mocks.getCredential).not.toHaveBeenCalled();
  });

  it("removes a stored credential", async () => {
    const mocks = installBridge();
    mocks.deleteCredential.mockResolvedValue({ ok: true });
    mocks.credentialsSupported.mockResolvedValue(true);
    await saveCloudCredential("credential-anthropic-primary", "sk");
    await removeCloudCredential("credential-anthropic-primary");

    expect(mocks.deleteCredential).toHaveBeenCalledWith("credential-anthropic-primary");
    expect(await isSecureCredentialStorageAvailable()).toBe(true);
    expect(mocks.credentialsSupported).toHaveBeenCalled();
  });

  it("migrates a legacy localStorage apiKey into the vault and strips it", async () => {
    const mocks = installBridge();
    mocks.setCredential.mockResolvedValue({ ok: true });

    const migrated = await migrateLegacyCloudApiKey(
      JSON.stringify({
        provider: "cloud",
        cloud: {
          providerId: "groq",
          apiKey: "sk-legacy",
        },
      }),
    );

    expect(mocks.setCredential).toHaveBeenCalledWith(
      "credential-groq-primary",
      "sk-legacy",
    );
    const parsed = migrated
      ? (JSON.parse(migrated) as { cloud: Record<string, unknown> })
      : null;
    expect(parsed?.cloud).toEqual({
      providerId: "groq",
      credentialId: "credential-groq-primary",
      credentialConfigured: true,
    });
    expect("apiKey" in (parsed?.cloud ?? {})).toBe(false);
  });

  it("leaves configs untouched when no legacy key exists", async () => {
    const mocks = installBridge();
    const migrated = await migrateLegacyCloudApiKey(
      JSON.stringify({
        provider: "cloud",
        cloud: { providerId: "openai", credentialConfigured: true },
      }),
    );
    expect(migrated).toBeNull();
    expect(mocks.setCredential).not.toHaveBeenCalled();
  });

  it("handles corrupt or empty configs gracefully", async () => {
    expect(await migrateLegacyCloudApiKey(null)).toBeNull();
    expect(await migrateLegacyCloudApiKey("not-json")).toBeNull();
    expect(await migrateLegacyCloudApiKey("{}")).toBeNull();
  });

  it("derives stable credential ids from provider ids", () => {
    expect(credentialIdForProvider("groq")).toBe("credential-groq-primary");
  });
});
