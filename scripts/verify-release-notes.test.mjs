// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const script = path.join(process.cwd(), "scripts", "verify-release-notes.mjs");
const originalArgv = process.argv;
let root, notesDir, keyPath, publicKey, privateKey, keyId;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function signed(payload, overrides = {}) {
  const value = sign(null, Buffer.from(canonical(payload)), privateKey).toString("base64");
  return { ...payload, signature: { algorithm: "ed25519", keyId, value, ...overrides } };
}

async function writeNotes(files, directory = notesDir) {
  await mkdir(directory, { recursive: true });
  for (const [name, payload] of Object.entries(files)) {
    // Raw strings let a test write JSON that JSON.stringify cannot produce.
    await writeFile(
      path.join(directory, name),
      typeof payload === "string" ? payload : JSON.stringify(payload),
    );
  }
}

const index = (releases) =>
  signed({ schemaVersion: 1, product: "LatexDo", releases });
const document = (version, extra = {}) => signed({ version, title: "Notes", ...extra });

async function run(...args) {
  vi.resetModules();
  process.argv = [process.execPath, script, ...args];
  await import(/* @vite-ignore */ script);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "latexdo-notes-"));
  notesDir = path.join(root, "notes");
  keyPath = path.join(root, "key.pem");
  ({ publicKey, privateKey } = generateKeyPairSync("ed25519"));
  await writeFile(keyPath, publicKey.export({ format: "pem", type: "spki" }));
  keyId = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex")
    .slice(0, 16);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("verify-release-notes", () => {
  it("verifies every signed document, including v-prefixed versions and checksums", async () => {
    await writeNotes({
      "index.json": index([
        { version: "v1.2.0", sha256: "a".repeat(64) },
        { version: "1.3.0-beta.1" },
      ]),
      "1.2.0.json": document("1.2.0", { draft: false, rank: 1, notes: null }),
      "1.3.0-beta.1.json": document("1.3.0-beta.1"),
    });
    await run(notesDir, keyPath);
    expect(console.log).toHaveBeenCalledWith(
      `Verified 2 signed release notes documents in ${notesDir} with key ${keyId}.`,
    );
  });

  it("verifies only the requested version, with or without a v prefix", async () => {
    await writeNotes({
      "index.json": index([{ version: "1.2.0" }, { version: "1.3.0" }]),
      "1.3.0.json": document("1.3.0"),
    });
    await run(notesDir, keyPath, "v1.3.0");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Verified 1 signed"));
  });

  it("reads the published notes and shipped key from the default locations", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(root);
    await mkdir(path.join(root, "build"));
    await writeFile(
      path.join(root, "build/update-public-key.pem"),
      publicKey.export({ format: "pem", type: "spki" }),
    );
    await writeNotes(
      { "index.json": index([{ version: "1.0.0" }]), "1.0.0.json": document("1.0.0") },
      path.join(root, "public-downloads/updates/release-notes"),
    );
    await run();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Verified 1 signed"));
  });

  it("rejects a key that is not Ed25519", async () => {
    const { publicKey: ecKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    await writeFile(keyPath, ecKey.export({ format: "pem", type: "spki" }));
    await expect(run(notesDir, keyPath)).rejects.toThrow(
      "Release notes verification key is not Ed25519.",
    );
  });

  it.each([
    ["no signature", (payload) => ({ ...payload, signature: undefined })],
    ["another algorithm", (payload) => ({ ...payload, signature: { ...payload.signature, algorithm: "rsa" } })],
    ["a malformed key ID", (payload) => ({ ...payload, signature: { ...payload.signature, keyId: "XYZ" } })],
    ["a missing key ID", (payload) => ({ ...payload, signature: { ...payload.signature, keyId: undefined } })],
    ["a malformed value", (payload) => ({ ...payload, signature: { ...payload.signature, value: "short" } })],
    ["a missing value", (payload) => ({ ...payload, signature: { ...payload.signature, value: undefined } })],
  ])("rejects an index with %s", async (_label, tamper) => {
    await writeNotes({ "index.json": tamper(index([{ version: "1.0.0" }])) });
    await expect(run(notesDir, keyPath)).rejects.toThrow(
      "Release notes signature metadata is invalid.",
    );
  });

  it("rejects a signature from another key", async () => {
    await writeNotes({
      "index.json": signed(
        { schemaVersion: 1, product: "LatexDo", releases: [] },
        { keyId: "0".repeat(16) },
      ),
    });
    await expect(run(notesDir, keyPath)).rejects.toThrow(
      "Release notes signature key ID does not match.",
    );
  });

  it.each([
    ["schema version", { schemaVersion: 2, product: "LatexDo", releases: [{}] }],
    ["product", { schemaVersion: 1, product: "Other", releases: [{}] }],
    ["release list", { schemaVersion: 1, product: "LatexDo", releases: {} }],
    ["empty release list", { schemaVersion: 1, product: "LatexDo", releases: [] }],
  ])("rejects an index with an invalid %s", async (_label, payload) => {
    await writeNotes({ "index.json": signed(payload) });
    await expect(run(notesDir, keyPath)).rejects.toThrow(
      "Release notes index schema is invalid.",
    );
  });

  it.each([[{ version: "latest" }], [{}]])("rejects an invalid version %j", async (entry) => {
    await writeNotes({ "index.json": index([entry]) });
    await expect(run(notesDir, keyPath)).rejects.toThrow(
      "Release notes index contains an invalid version.",
    );
  });

  it("rejects a document for another version", async () => {
    await writeNotes({
      "index.json": index([{ version: "1.0.0" }]),
      "1.0.0.json": document("0.9.0"),
    });
    await expect(run(notesDir, keyPath)).rejects.toThrow(
      "Release notes document 1.0.0 has a mismatched version.",
    );
  });

  it("rejects an invalid checksum", async () => {
    await writeNotes({
      "index.json": index([{ version: "1.0.0", sha256: "not-a-hash" }]),
      "1.0.0.json": document("1.0.0"),
    });
    await expect(run(notesDir, keyPath)).rejects.toThrow(
      "Release notes index has an invalid sha256 for 1.0.0.",
    );
  });

  it("rejects non-finite numbers before checking the signature", async () => {
    const payload = index([{ version: "1.0.0" }]);
    await writeNotes({
      "index.json": JSON.stringify(payload).replace('"schemaVersion":1', '"schemaVersion":1e999'),
    });
    await expect(run(notesDir, keyPath)).rejects.toThrow(
      "Release notes contain a non-finite number.",
    );
  });
});
