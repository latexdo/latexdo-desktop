// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  decryptBytes,
  decryptString,
  encryptBytes,
  encryptString,
  isProjectKey,
  newProjectKey,
} from "./collabCrypto.js";
import { ProjectKeyStore } from "./collabKeys.js";
import { decodePeerInvite, encodePeerInvite } from "./peerInvite.js";

const projectId = `project_${"a".repeat(32)}`;
const otherProject = `project_${"b".repeat(32)}`;
const text = new TextEncoder().encode("\\section{Secret results}");

describe("project encryption", () => {
  it("round-trips data and never repeats a ciphertext", async () => {
    const key = newProjectKey();
    expect(isProjectKey(key)).toBe(true);
    const first = await encryptBytes(key, projectId, "text", text);
    const second = await encryptBytes(key, projectId, "text", text);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
    expect(Buffer.from(first).toString("latin1")).not.toContain("Secret");
    expect(await decryptBytes(key, projectId, "text", first)).toEqual(text);
  });

  it("refuses the wrong key, another project, another kind and tampering", async () => {
    const key = newProjectKey();
    const sealed = await encryptBytes(key, projectId, "text", text);
    await expect(
      decryptBytes(newProjectKey(), projectId, "text", sealed),
    ).rejects.toThrow();
    // The server cannot move one project's data into another...
    await expect(decryptBytes(key, otherProject, "text", sealed)).rejects.toThrow();
    // ...or pass a cursor off as a document edit.
    await expect(decryptBytes(key, projectId, "cursor", sealed)).rejects.toThrow();
    const tampered = Uint8Array.from(sealed);
    tampered[tampered.length - 1] ^= 1;
    await expect(decryptBytes(key, projectId, "text", tampered)).rejects.toThrow();
    await expect(
      decryptBytes(key, projectId, "text", new Uint8Array(4)),
    ).rejects.toThrow();
  });

  it("seals names as strings", async () => {
    const key = newProjectKey();
    const sealed = await encryptString(key, "", "name", "Ada Lovelace");
    expect(sealed).toMatch(/^enc1:/);
    expect(sealed).not.toContain("Ada");
    expect(await decryptString(key, "", "name", sealed)).toBe("Ada Lovelace");
  });
});

describe("invites", () => {
  it("carry the project key and reject a malformed one", () => {
    const key = newProjectKey();
    const token = `p${"a".repeat(32)}_${"x".repeat(43)}`;
    const invite = encodePeerInvite({
      token,
      addresses: ["https://collab.latexdo.org"],
      key,
    });
    expect(decodePeerInvite(invite)).toEqual({
      token,
      addresses: ["https://collab.latexdo.org"],
      key,
    });
    expect(() =>
      encodePeerInvite({
        token,
        addresses: ["https://collab.latexdo.org"],
        key: "short",
      }),
    ).toThrow();
    const forged = `latexdo-invite:${Buffer.from(
      JSON.stringify({ v: 1, t: token, a: ["https://collab.latexdo.org"], k: "!!" }),
    ).toString("base64url")}`;
    expect(decodePeerInvite(forged)).toBeNull();
  });
});

describe("key store", () => {
  const roots: string[] = [];
  afterAll(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true });
  });

  it("keeps keys protected by the OS keychain and reloads them", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "latexdo-keys-"));
    roots.push(root);
    const file = path.join(root, "keys.json");
    const protection = {
      available: () => true,
      encrypt: (value: string) => Buffer.from(`sealed:${value}`),
      decrypt: (value: Buffer) => value.toString().replace(/^sealed:/, ""),
    };
    const key = newProjectKey();
    await new ProjectKeyStore(file, protection).set(projectId, key);
    const stored = await readFile(file, "utf8");
    expect(stored).not.toContain(key);
    expect(await new ProjectKeyStore(file, protection).get(projectId)).toBe(key);
    await expect(
      new ProjectKeyStore(file, protection).set("nope", key),
    ).rejects.toThrow();
  });

  it("ignores damaged entries instead of failing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "latexdo-keys-"));
    roots.push(root);
    const file = path.join(root, "keys.json");
    const store = new ProjectKeyStore(file);
    await store.set(projectId, newProjectKey());
    const broken = new ProjectKeyStore(file, {
      available: () => true,
      encrypt: () => Buffer.alloc(0),
      decrypt: () => {
        throw new Error("other machine");
      },
    });
    // Written unprotected, read back unprotected.
    expect(await new ProjectKeyStore(file).get(projectId)).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(await broken.get(otherProject)).toBeNull();
  });
});
