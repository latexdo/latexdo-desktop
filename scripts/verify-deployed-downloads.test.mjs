// @vitest-environment node
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const script = path.join(process.cwd(), "scripts", "verify-deployed-downloads.mjs");
const commit = "a".repeat(40);
const downloads = "https://latexdo.org/downloads/";
const release = `${downloads}v0.3.0/`;
const ids = ["macos-arm64", "macos-x64", "windows-x64", "linux-x64"];
const originalArgv = process.argv;

let root;
let privateKey;
let keyId;
let site;
let headSizes;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function signFeed(unsigned) {
  return {
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      keyId,
      value: sign(null, Buffer.from(canonical(unsigned)), privateKey).toString(
        "base64",
      ),
    },
  };
}

function files() {
  return ids.map((id, index) => ({
    id,
    filename: `LatexDo-${id}.bin`,
    url: `${release}LatexDo-${id}.bin`,
    size: 100 + index,
    sha256: String(index).repeat(64),
  }));
}

function manifest() {
  return {
    schemaVersion: 1,
    product: "LatexDo",
    version: "0.3.0",
    commit,
    repository: "latexdo/latexdo-desktop",
    downloadsPage: release,
    files: files(),
  };
}

function unsignedFeed() {
  const now = Date.now();
  return {
    schemaVersion: 2,
    product: "LatexDo",
    channel: "stable",
    release: "v0.3.0",
    version: "0.3.0",
    publishedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 86_400_000).toISOString(),
    commit,
    releaseUrl: release,
    downloadsPage: release,
    manifestUrl: `${release}manifest.json`,
    files: files(),
  };
}

function checksums() {
  return files()
    .map((file) => `${file.sha256}  ${file.filename}`)
    .join("\n");
}

/** A complete, valid deployment keyed by URL path. */
function deployment() {
  return {
    "/downloads/index.html": "<html>",
    "/downloads/manifest.json": manifest(),
    "/downloads/v0.3.0/index.html": "<html>",
    "/downloads/v0.3.0/manifest.json": manifest(),
    "/updates/latest.json": signFeed(unsignedFeed()),
    "/updates/v0.3.0.json": signFeed(unsignedFeed()),
    "/downloads/releases.json": {
      schemaVersion: 1,
      product: "LatexDo",
      releases: [
        null,
        {
          tag: "v0.3.0",
          downloadsPage: release,
          manifestUrl: `${release}manifest.json`,
        },
      ],
    },
    "/downloads/SHA256SUMS.txt": checksums(),
    "/downloads/v0.3.0/SHA256SUMS.txt": checksums(),
  };
}

const fetchMock = vi.fn(async (input, options) => {
  const url = new URL(input);
  if (options?.method === "HEAD") {
    const size = headSizes[url.href];
    return new Response(null, {
      status: size === undefined ? 404 : 200,
      headers: size ? { "content-length": String(size) } : {},
    });
  }
  const body = site[url.pathname];
  if (body === undefined) return new Response("missing", { status: 404 });
  return new Response(typeof body === "string" ? body : JSON.stringify(body));
});

async function run(...args) {
  vi.resetModules();
  process.argv = [process.execPath, script, ...args];
  await import("./verify-deployed-downloads.mjs");
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "latexdo-verify-"));
  const pair = generateKeyPairSync("ed25519");
  privateKey = pair.privateKey;
  keyId = createHash("sha256")
    .update(pair.publicKey.export({ type: "spki", format: "der" }))
    .digest("hex")
    .slice(0, 16);
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ version: "0.3.0" }),
  );
  await mkdir(path.join(root, "build"));
  await writeFile(
    path.join(root, "build/update-public-key.pem"),
    pair.publicKey.export({ type: "spki", format: "pem" }),
  );
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.spyOn(console, "log").mockImplementation(() => {});
  for (const name of [
    "LATEXDO_PUBLIC_DOWNLOADS_URL",
    "LATEXDO_RELEASE_SLUG",
    "LATEXDO_RELEASE_ASSET_BASE_URL",
    "GITHUB_SHA",
    "GITHUB_RUN_ID",
    "LATEXDO_VERIFY_RUN_ID",
  ])
    vi.stubEnv(name, undefined);
  vi.stubEnv("GITHUB_REPOSITORY", "latexdo/latexdo-desktop");
  vi.stubEnv("LATEXDO_RELEASE_COMMIT", commit);
  vi.stubEnv("LATEXDO_VERIFY_RETRIES", "1");
  vi.stubEnv("LATEXDO_VERIFY_DELAY_MS", "0");
  site = deployment();
  headSizes = Object.fromEntries(files().map((file) => [file.url, file.size]));
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("verify-deployed-downloads", () => {
  it("accepts a complete deployment, with or without content lengths", async () => {
    headSizes[files()[0].url] = 0;
    await expect(run(downloads)).resolves.toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(
      `Verified deployed downloads at ${downloads}`,
    );
    const busted = new URL(fetchMock.mock.calls[0][0]).searchParams.get(
      "deploy_verify",
    );
    expect(busted).toMatch(new RegExp(`^${commit}-\\d+-1$`));
    expect(fetchMock.mock.calls[0][1].headers["user-agent"]).toBe(
      "latexdo-deploy-verifier/0.3.0",
    );
  });

  it("uses the default URL, run ids and explicit slugs and asset bases", async () => {
    vi.stubEnv("LATEXDO_RELEASE_COMMIT", undefined);
    vi.stubEnv("GITHUB_RUN_ID", "77");
    vi.stubEnv("LATEXDO_RELEASE_SLUG", "v0.3.0");
    vi.stubEnv("LATEXDO_RELEASE_ASSET_BASE_URL", `${downloads}v0.3.0//`);
    await expect(run()).resolves.toBeUndefined();
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("deploy_verify")).toBe(
      "0.3.0-77-1",
    );
  });

  it("rejects a key that is not Ed25519", async () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    await writeFile(
      path.join(root, "build/update-public-key.pem"),
      publicKey.export({ type: "spki", format: "pem" }),
    );
    await expect(run(downloads)).rejects.toThrow("must be Ed25519");
  });

  it.each(["", "a/b", "a\\b", "..x"])("rejects the release slug %j", async (slug) => {
    vi.stubEnv("LATEXDO_RELEASE_SLUG", slug === "" ? " " : slug);
    await expect(run(downloads)).rejects.toThrow("Invalid release slug");
  });

  it("retries, then reports the last failure", async () => {
    vi.stubEnv("LATEXDO_VERIFY_RETRIES", "2");
    vi.stubEnv("LATEXDO_VERIFY_RUN_ID", "r");
    delete site["/downloads/index.html"];
    await expect(run(downloads)).rejects.toThrow("returned 404");
    const tokens = fetchMock.mock.calls.map(([url]) =>
      new URL(url).searchParams.get("deploy_verify"),
    );
    expect(tokens).toEqual([`${commit}-r-1`, `${commit}-r-2`]);
  });

  it("fails without retrying when retries are zero", async () => {
    vi.stubEnv("LATEXDO_VERIFY_RETRIES", "0");
    await expect(run(downloads)).rejects.toThrow("Deployment verification failed.");
  });

  it("reports non-Error failures", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw "plain";
    });
    await expect(run(downloads)).rejects.toBe("plain");
    expect(console.log).toHaveBeenCalledWith(
      "Deployment verification attempt 1/1 failed: plain",
    );
  });

  const manifestCases = [
    ["not an object", () => null, "Manifest is not an object."],
    ["schema", (m) => ({ ...m, schemaVersion: 2 }), "schemaVersion must be 1"],
    ["product", (m) => ({ ...m, product: "X" }), "product must be LatexDo"],
    ["version", (m) => ({ ...m, version: "9" }), "Manifest version 9 does not match"],
    ["missing version", (m) => ({ ...m, version: undefined }), "<missing>"],
    ["commit format", (m) => ({ ...m, commit: "abc" }), "full Git SHA"],
    ["missing commit", (m) => ({ ...m, commit: undefined }), "full Git SHA"],
    ["repository", (m) => ({ ...m, repository: "x/y" }), "repository does not match"],
    ["commit", (m) => ({ ...m, commit: "b".repeat(40) }), "Manifest commit"],
    ["files", (m) => ({ ...m, files: {} }), "files must be an array"],
    [
      "downloadsPage",
      (m) => ({ ...m, downloadsPage: "x" }),
      "downloadsPage must point",
    ],
    ["missing id", (m) => ({ ...m, files: m.files.slice(1) }), "missing macos-arm64"],
    [
      "url",
      (m) => ({
        ...m,
        files: [{ ...m.files[0], url: "https://evil/x" }, ...m.files.slice(1)],
      }),
      "Invalid URL for macos-arm64",
    ],
    [
      "url type",
      (m) => ({ ...m, files: [{ ...m.files[0], url: 1 }, ...m.files.slice(1)] }),
      "Invalid URL",
    ],
    [
      "size",
      (m) => ({ ...m, files: [{ ...m.files[0], size: 0 }, ...m.files.slice(1)] }),
      "Invalid size",
    ],
    [
      "size type",
      (m) => ({ ...m, files: [{ ...m.files[0], size: "1" }, ...m.files.slice(1)] }),
      "Invalid size",
    ],
    [
      "sha",
      (m) => ({ ...m, files: [{ ...m.files[0], sha256: "zz" }, ...m.files.slice(1)] }),
      "Invalid SHA-256",
    ],
    [
      "sha type",
      (m) => ({ ...m, files: [{ ...m.files[0], sha256: 5 }, ...m.files.slice(1)] }),
      "Invalid SHA-256",
    ],
  ];
  it.each(manifestCases)(
    "rejects a manifest with a bad %s",
    async (_name, mutate, message) => {
      site["/downloads/manifest.json"] = mutate(manifest());
      await expect(run(downloads)).rejects.toThrow(message);
    },
  );

  it("checks the release manifest too", async () => {
    site["/downloads/v0.3.0/manifest.json"] = { ...manifest(), product: "Other" };
    await expect(run(downloads)).rejects.toThrow("product must be LatexDo");
  });

  const feedCases = [
    ["not an object", () => null, "Update feed is not an object."],
    ["schema", (f) => ({ ...f, schemaVersion: 1 }), "schemaVersion must be 2"],
    ["product", (f) => ({ ...f, product: "X" }), "Update feed product"],
    ["channel", (f) => ({ ...f, channel: "beta" }), "channel must be stable"],
    ["release", (f) => ({ ...f, release: "v1" }), "release does not match"],
    ["version", (f) => ({ ...f, version: "1" }), "Update feed version 1"],
    [
      "missing version",
      (f) => ({ ...f, version: undefined }),
      "Update feed version <missing>",
    ],
    ["publishedAt type", (f) => ({ ...f, publishedAt: 1 }), "freshness window"],
    ["expiresAt type", (f) => ({ ...f, expiresAt: 1 }), "freshness window"],
    ["publishedAt", (f) => ({ ...f, publishedAt: "nope" }), "freshness window"],
    ["expiresAt", (f) => ({ ...f, expiresAt: "nope" }), "freshness window"],
    ["window order", (f) => ({ ...f, expiresAt: f.publishedAt }), "freshness window"],
    [
      "future",
      (f) => ({
        ...f,
        publishedAt: new Date(Date.now() + 3_600_000).toISOString(),
        expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
      }),
      "freshness window",
    ],
    [
      "expired",
      (f) => ({
        ...f,
        publishedAt: new Date(Date.now() - 7_200_000).toISOString(),
        expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
      }),
      "freshness window",
    ],
    ["commit", (f) => ({ ...f, commit: "c".repeat(40) }), "Update feed commit"],
    [
      "missing commit",
      (f) => ({ ...f, commit: undefined }),
      "Update feed commit <missing>",
    ],
    ["releaseUrl", (f) => ({ ...f, releaseUrl: "x" }), "releaseUrl does not match"],
    [
      "downloadsPage",
      (f) => ({ ...f, downloadsPage: "x" }),
      "Update feed downloadsPage",
    ],
    ["manifestUrl", (f) => ({ ...f, manifestUrl: "x" }), "manifestUrl does not match"],
    ["files", (f) => ({ ...f, files: null }), "Update feed files must be an array"],
    [
      "missing file",
      (f) => ({ ...f, files: [null, ...f.files.slice(1)] }),
      "Update feed is missing macos-arm64",
    ],
    [
      "file field",
      (f) => ({ ...f, files: [{ ...f.files[0], size: 1 }, ...f.files.slice(1)] }),
      "macos-arm64 size does not match",
    ],
  ];
  it.each(feedCases)(
    "rejects an update feed with a bad %s",
    async (_name, mutate, message) => {
      const mutated = mutate(unsignedFeed());
      site["/updates/latest.json"] = mutated && signFeed(mutated);
      await expect(run(downloads)).rejects.toThrow(message);
    },
  );

  it("checks the versioned feed too", async () => {
    site["/updates/v0.3.0.json"] = signFeed({ ...unsignedFeed(), channel: "beta" });
    await expect(run(downloads)).rejects.toThrow("channel must be stable");
  });

  const signatureCases = [
    ["missing", (f) => ({ ...f, signature: undefined })],
    ["not an object", (f) => ({ ...f, signature: "sig" })],
    ["algorithm", (f) => ({ ...f, signature: { ...f.signature, algorithm: "rsa" } })],
    ["key id", (f) => ({ ...f, signature: { ...f.signature, keyId: "0" } })],
    ["value type", (f) => ({ ...f, signature: { ...f.signature, value: 5 } })],
    ["value format", (f) => ({ ...f, signature: { ...f.signature, value: "abc" } })],
  ];
  it.each(signatureCases)(
    "rejects a signature with a bad %s",
    async (_name, mutate) => {
      site["/updates/latest.json"] = mutate(signFeed(unsignedFeed()));
      await expect(run(downloads)).rejects.toThrow("signature metadata is invalid");
    },
  );

  it("rejects a forged signature", async () => {
    const signed = signFeed(unsignedFeed());
    site["/updates/latest.json"] = { ...signed, channel: "stable", extra: true };
    await expect(run(downloads)).rejects.toThrow("signature verification failed");
  });

  it.each([
    ["non-finite number", { weight: Number.POSITIVE_INFINITY }, "non-finite number"],
    ["unsupported value", { flag: undefined }, "unsupported value"],
  ])("rejects a feed containing a %s", async (_name, extra, message) => {
    const signed = signFeed(unsignedFeed());
    // The JSON body cannot carry these, so the parsed feed is patched.
    const original = Response.prototype.json;
    vi.spyOn(Response.prototype, "json").mockImplementation(async function () {
      const value = await original.call(this);
      return value?.schemaVersion === 2 ? { ...value, ...extra } : value;
    });
    site["/updates/latest.json"] = signed;
    await expect(run(downloads)).rejects.toThrow(message);
  });

  it("accepts booleans and nulls in a signed feed", async () => {
    site["/updates/latest.json"] = signFeed({
      ...unsignedFeed(),
      beta: false,
      notes: null,
    });
    await expect(run(downloads)).resolves.toBeUndefined();
  });

  const indexCases = [
    ["not an object", () => 3, "Release index is not an object."],
    ["schema", (i) => ({ ...i, schemaVersion: 2 }), "Release index schemaVersion"],
    ["product", (i) => ({ ...i, product: "X" }), "Release index product"],
    ["releases", (i) => ({ ...i, releases: {} }), "releases must be an array"],
    ["release", (i) => ({ ...i, releases: [] }), "Release index is missing v0.3.0"],
    [
      "downloadsPage",
      (i) => ({ ...i, releases: [{ ...i.releases[1], downloadsPage: "x" }] }),
      "Release index downloadsPage",
    ],
    [
      "manifestUrl",
      (i) => ({ ...i, releases: [{ ...i.releases[1], manifestUrl: "x" }] }),
      "Release index manifestUrl",
    ],
  ];
  it.each(indexCases)(
    "rejects a release index with a bad %s",
    async (_name, mutate, message) => {
      site["/downloads/releases.json"] = mutate(
        deployment()["/downloads/releases.json"],
      );
      await expect(run(downloads)).rejects.toThrow(message);
    },
  );

  it.each([
    ["/downloads/SHA256SUMS.txt", "Latest checksums file does not include"],
    ["/downloads/v0.3.0/SHA256SUMS.txt", "Release checksums file does not include"],
  ])("rejects %s without every installer", async (file, message) => {
    site[file] = checksums().split("\n").slice(1).join("\n");
    await expect(run(downloads)).rejects.toThrow(message);
    site[file] = `${"f".repeat(64)}  LatexDo-macos-arm64.bin`;
    await expect(run(downloads)).rejects.toThrow(message);
  });

  it("rejects an installer whose served size differs", async () => {
    headSizes[files()[1].url] = 5;
    await expect(run(downloads)).rejects.toThrow(
      "LatexDo-macos-x64.bin content-length 5 does not match manifest size 101.",
    );
  });

  it("waits between attempts", async () => {
    vi.stubEnv("LATEXDO_VERIFY_RETRIES", "2");
    vi.stubEnv("LATEXDO_VERIFY_DELAY_MS", "1");
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 500 }));
    await expect(run(downloads)).resolves.toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("attempt 1/2 failed"),
    );
  });
});
