import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  directory: "",
  backend: "gnome_libsecret",
  available: true,
}));
vi.mock("electron", () => ({
  app: { getPath: () => storage.directory },
  safeStorage: {
    isEncryptionAvailable: () => storage.available,
    getSelectedStorageBackend: () => storage.backend,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().slice("encrypted:".length),
  },
}));
import {
  deleteCredential,
  getCredential,
  isCredentialStorageAvailable,
  listCredentialIds,
  setCredential,
} from "./secretStorage.js";

beforeEach(async () => {
  storage.directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-secrets-"));
  storage.backend = "gnome_libsecret";
  storage.available = true;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(storage.directory, { recursive: true, force: true });
});

describe("credential vault", () => {
  it.each(["basic_text", "unknown"])(
    "refuses the Linux %s backend",
    async (backend) => {
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      storage.backend = backend;
      expect(isCredentialStorageAvailable()).toBe(false);
      await expect(setCredential("provider", "secret")).rejects.toThrow(
        /Secure credential storage/,
      );
      await expect(
        readFile(path.join(storage.directory, "ai-credentials.json")),
      ).rejects.toThrow();
    },
  );
  it("preserves concurrent credentials and deletion order", async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => setCredential(`provider-${i}`, `key-${i}`)),
    );
    expect(await listCredentialIds()).toHaveLength(12);
    await Promise.all([
      deleteCredential("provider-0"),
      setCredential("provider-new", "new"),
    ]);
    expect(await getCredential("provider-0")).toBeNull();
    expect(await getCredential("provider-new")).toBe("new");
    expect(await listCredentialIds()).toHaveLength(12);
  });
  it("requires encryption and can continue after a rejected write", async () => {
    storage.available = false;
    await expect(setCredential("provider", "secret")).rejects.toThrow();
    storage.available = true;
    await setCredential("provider", "secret");
    expect(await getCredential("provider")).toBe("secret");
  });
});
