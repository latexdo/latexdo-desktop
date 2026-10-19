import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  directory: "",
  backend: "gnome_libsecret",
  available: true,
  decryptFails: false,
  availabilityThrows: false,
}));
vi.mock("electron", () => ({
  app: { getPath: () => storage.directory },
  safeStorage: {
    isEncryptionAvailable: () => {
      if (storage.availabilityThrows) throw new Error("keyring crashed");
      return storage.available;
    },
    getSelectedStorageBackend: () => storage.backend,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => {
      if (storage.decryptFails) throw new Error("cannot decrypt");
      return value.toString().slice("encrypted:".length);
    },
  },
}));
import {
  deleteCredential,
  getCredential,
  hasCredential,
  isCredentialStorageAvailable,
  listCredentialIds,
  setCredential,
} from "./secretStorage.js";

beforeEach(async () => {
  storage.directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-secrets-"));
  storage.backend = "gnome_libsecret";
  storage.available = true;
  storage.decryptFails = false;
  storage.availabilityThrows = false;
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

describe("credential vault edge cases", () => {
  const vaultPath = () => path.join(storage.directory, "ai-credentials.json");

  it("treats a throwing keyring as unavailable", async () => {
    storage.availabilityThrows = true;
    expect(isCredentialStorageAvailable()).toBe(false);
    expect(await listCredentialIds()).toEqual([]);
    expect(await hasCredential("provider")).toBe(false);
    expect(await getCredential("provider")).toBeNull();
  });

  it("allows a non-plaintext backend on Linux", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    expect(isCredentialStorageAvailable()).toBe(true);
  });

  it("rejects invalid identifiers and empty secrets", async () => {
    await expect(setCredential("../escape", "secret")).rejects.toThrow(
      "Invalid credential identifier.",
    );
    await expect(setCredential("provider", "   ")).rejects.toThrow(
      "The API key cannot be empty.",
    );
    await expect(setCredential("provider", 7 as never)).rejects.toThrow(
      "The API key cannot be empty.",
    );
    expect(await getCredential("bad id")).toBeNull();
    expect(await hasCredential("bad id")).toBe(false);
    await expect(deleteCredential("bad id")).resolves.toBeUndefined();
    await expect(readFile(vaultPath())).rejects.toThrow();
  });

  it("reports stored, missing and undecryptable credentials", async () => {
    await setCredential("provider", "secret");
    expect(await hasCredential("provider")).toBe(true);
    expect(await hasCredential("other")).toBe(false);
    expect(await getCredential("other")).toBeNull();
    storage.decryptFails = true;
    expect(await getCredential("provider")).toBeNull();
    const written = JSON.parse(await readFile(vaultPath(), "utf8"));
    expect(written.schemaVersion).toBe(1);
    expect(written.entries.provider.ciphertext).toBe(
      Buffer.from("encrypted:secret").toString("base64"),
    );
  });

  it("returns null from getCredential when storage becomes unavailable", async () => {
    await setCredential("provider", "secret");
    storage.available = false;
    expect(await getCredential("provider")).toBeNull();
    expect(await listCredentialIds()).toEqual([]);
  });

  it.each([
    ["not json", "{"],
    ["an array", "[]"],
    ["entries that are not an object", JSON.stringify({ entries: [] })],
  ])("ignores a vault file containing %s", async (_label, contents) => {
    await writeFile(vaultPath(), contents);
    expect(await listCredentialIds()).toEqual([]);
  });

  it("keeps only well-formed entries with safe identifiers", async () => {
    await writeFile(
      vaultPath(),
      JSON.stringify({
        entries: {
          good: { ciphertext: "Y2lwaGVy", createdAt: "2026-01-01" },
          "bad id": { ciphertext: "x", createdAt: "y" },
          notRecord: "x",
          noCipher: { ciphertext: 1, createdAt: "y" },
          noDate: { ciphertext: "x", createdAt: null },
        },
      }),
    );
    expect(await listCredentialIds()).toEqual(["good"]);
  });

  it("removes the temporary file when replacing the vault fails", async () => {
    await mkdir(path.join(vaultPath(), "occupied"), { recursive: true });
    await expect(setCredential("provider", "secret")).rejects.toThrow();
    const leftovers = (await readdir(storage.directory)).filter((name) =>
      name.endsWith(".tmp"),
    );
    expect(leftovers).toEqual([]);
    // The queue keeps working after a failed write.
    await rm(vaultPath(), { recursive: true, force: true });
    await setCredential("provider", "secret");
    expect(await getCredential("provider")).toBe("secret");
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "surfaces the error when the temporary file cannot be created",
    async () => {
      await chmod(storage.directory, 0o500);
      try {
        await expect(setCredential("provider", "secret")).rejects.toThrow(/EACCES|EPERM/);
      } finally {
        await chmod(storage.directory, 0o700);
      }
    },
  );
});
