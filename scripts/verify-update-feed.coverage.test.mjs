// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
let root;
const originalArgv = process.argv;
const keys = generateKeyPairSync("ed25519");
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
function signed(extra = {}) {
  const payload = {
    schemaVersion: 2,
    product: "LatexDo",
    channel: "stable",
    version: "1.0.0",
    release: "v1.0.0",
    commit: "a".repeat(40),
    publishedAt: new Date(Date.now() - 60000).toISOString(),
    expiresAt: new Date(Date.now() + 86400000 * 10).toISOString(),
    files: [],
    extra: { enabled: true, value: null },
    ...extra,
  };
  return {
    ...payload,
    signature: {
      algorithm: "ed25519",
      keyId: createHash("sha256")
        .update(keys.publicKey.export({ type: "spki", format: "der" }))
        .digest("hex")
        .slice(0, 16),
      value: sign(null, Buffer.from(canonical(payload)), keys.privateKey).toString(
        "base64",
      ),
    },
  };
}
async function run(payload = signed()) {
  await writeFile(path.join(root, "feed.json"), JSON.stringify(payload));
  vi.resetModules();
  return import("./verify-update-feed.mjs");
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "feed-verify-"));
  await writeFile(
    path.join(root, "key.pem"),
    keys.publicKey.export({ type: "spki", format: "pem" }),
  );
  process.argv = [
    process.execPath,
    "script",
    path.join(root, "feed.json"),
    path.join(root, "key.pem"),
  ];
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
describe("update feed verifier", () => {
  it.each(["v1.0.0", "v1.0.0-build.123.4.aaaaaaaaaaaa"])(
    "verifies signed release %s",
    async (release) => {
      await run(signed({ release }));
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Verified update feed"),
      );
    },
  );
  it.each(["-1", "366", "1.5", "invalid"])(
    "rejects invalid validity setting %s",
    async (value) => {
      vi.stubEnv("LATEXDO_UPDATE_MIN_VALIDITY_DAYS", value);
      await expect(run()).rejects.toThrow("integer from 0 to 365");
    },
  );
  it.each([
    { channel: "beta" },
    { release: "invalid" },
    { version: 12 },
    { commit: "invalid" },
  ])("rejects invalid metadata %j", async (extra) => {
    await expect(run(signed(extra))).rejects.toThrow("metadata is invalid");
  });
  it.each([
    { expiresAt: "2000-01-01" },
    { publishedAt: "2099-01-01" },
    { expiresAt: "not a date" },
  ])("rejects expired or invalid dates %j", async (extra) => {
    await expect(run(signed(extra))).rejects.toThrow("freshness");
  });
  it("requires sufficient remaining validity", async () => {
    vi.stubEnv("LATEXDO_UPDATE_MIN_VALIDITY_DAYS", "20");
    await expect(run()).rejects.toThrow("less than 20 days");
  });
  it("rejects an unexpected key and a tampered payload", async () => {
    const payload = signed();
    payload.signature.keyId = "0".repeat(16);
    await expect(run(payload)).rejects.toThrow("key ID");
    const tampered = signed();
    tampered.files = [{ url: "untrusted" }];
    await expect(run(tampered)).rejects.toThrow("signature is invalid");
  });
  it("rejects non-Ed25519 verification keys", async () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    await writeFile(
      path.join(root, "key.pem"),
      other.publicKey.export({ type: "spki", format: "pem" }),
    );
    await expect(run()).rejects.toThrow("not Ed25519");
  });
});
