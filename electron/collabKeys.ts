/*
 * The encryption keys of shared projects on this computer, protected by the
 * OS keychain (Electron safeStorage) when it is available. Losing a key only
 * matters if both the invite and the owner's own folder are gone: the folder
 * keeps the plain files.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProjectKey } from "./collabCrypto.js";

export interface KeyProtection {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

interface StoredKeys {
  version: 1;
  protected: boolean;
  keys: Record<string, string>;
}

const projectIdPattern = /^project_[0-9a-f]{32}$/;

export class ProjectKeyStore {
  private cache: Map<string, string> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly protection?: KeyProtection,
  ) {}

  private protectedStorage(): boolean {
    try {
      return Boolean(this.protection?.available());
    } catch {
      return false;
    }
  }

  private async load(): Promise<Map<string, string>> {
    if (this.cache) return this.cache;
    const keys = new Map<string, string>();
    try {
      const stored = JSON.parse(await readFile(this.file, "utf8")) as StoredKeys;
      for (const [projectId, value] of Object.entries(stored.keys ?? {})) {
        if (!projectIdPattern.test(projectId) || typeof value !== "string") continue;
        try {
          const key = stored.protected
            ? this.protection!.decrypt(Buffer.from(value, "base64"))
            : value;
          if (isProjectKey(key)) keys.set(projectId, key);
        } catch {
          // A key protected on another account or machine cannot be read here.
        }
      }
    } catch {
      // No keys yet.
    }
    this.cache = keys;
    return keys;
  }

  async get(projectId: string): Promise<string | null> {
    return (await this.load()).get(projectId) ?? null;
  }

  async set(projectId: string, key: string): Promise<void> {
    if (!projectIdPattern.test(projectId) || !isProjectKey(key)) {
      throw new Error("Invalid project key.");
    }
    const keys = await this.load();
    if (keys.get(projectId) === key) return;
    keys.set(projectId, key);
    await this.save();
  }

  private save(): Promise<void> {
    this.writing = this.writing.then(async () => {
      const keys = await this.load();
      const protectedStorage = this.protectedStorage();
      const stored: StoredKeys = {
        version: 1,
        protected: protectedStorage,
        keys: Object.fromEntries(
          [...keys].map(([projectId, key]) => [
            projectId,
            protectedStorage ? this.protection!.encrypt(key).toString("base64") : key,
          ]),
        ),
      };
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporaryPath = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(stored), { mode: 0o600 });
      await rename(temporaryPath, this.file);
    });
    return this.writing;
  }
}
