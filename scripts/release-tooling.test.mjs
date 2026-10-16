// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, createHash, verify } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const repo = process.cwd();
let root, publicKey, privateKey;
const filenames = [
  "LatexDo-macos-arm64.dmg",
  "LatexDo-macos-x64.dmg",
  "LatexDo-windows-x64.exe",
  "LatexDo-linux-x64.AppImage",
];
async function json(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}
async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function assertSigned(payload) {
  const { signature, ...unsigned } = payload;
  expect(signature.algorithm).toBe("ed25519");
  expect(signature.keyId).toBe(
    createHash("sha256")
      .update(publicKey.export({ format: "der", type: "spki" }))
      .digest("hex")
      .slice(0, 16),
  );
  expect(
    verify(
      null,
      Buffer.from(canonical(unsigned)),
      publicKey,
      Buffer.from(signature.value, "base64"),
    ),
  ).toBe(true);
}
async function run(script, ...args) {
  vi.resetModules();
  process.argv = [process.execPath, path.join(repo, "scripts", script), ...args];
  await import(/* @vite-ignore */ path.join(repo, "scripts", script));
}
const originalArgv = process.argv;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "latexdo-release-"));
  ({ publicKey, privateKey } = generateKeyPairSync("ed25519"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await json(path.join(root, "package.json"), { version: "0.3.0" });
  await mkdir(path.join(root, "build"));
  await writeFile(
    path.join(root, "build/update-public-key.pem"),
    publicKey.export({ format: "pem", type: "spki" }),
  );
  await mkdir(path.join(root, "artifacts"));
  for (const [i, name] of filenames.entries())
    await writeFile(
      path.join(root, "artifacts", name),
      Buffer.alloc(i === 3 ? 1024 * 1024 : 100 + i, i + 1),
    );
  vi.stubEnv(
    "LATEXDO_UPDATE_SIGNING_KEY",
    Buffer.from(privateKey.export({ format: "pem", type: "pkcs8" })).toString("base64"),
  );
  vi.stubEnv("LATEXDO_DOWNLOAD_BASE_URL", "https://latexdo.org");
  vi.stubEnv("LATEXDO_RELEASE_VERSION", "0.3.0");
  vi.stubEnv("LATEXDO_RELEASE_SLUG", "v0.3.0");
  vi.stubEnv("LATEXDO_RELEASE_COMMIT", "a".repeat(40));
  vi.stubEnv("GITHUB_REPOSITORY", "latexdo/latexdo");
  vi.stubEnv("LATEXDO_RELEASE_DATE", new Date(Date.now() - 86400000).toISOString());
  vi.stubEnv("LATEXDO_UPDATE_FEED_ENABLED", "true");
});
afterEach(async () => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
async function buildDownloads() {
  await run(
    "build-downloads-page.mjs",
    path.join(root, "artifacts"),
    path.join(root, "site/downloads"),
  );
  return readJson(path.join(root, "site/updates/latest.json"));
}
async function buildNotes() {
  const notes = await readJson(path.join(repo, "release-notes/0.3.0.json"));
  await json(path.join(root, "notes/0.3.0.json"), notes);
  await json(path.join(root, "notes/index.json"), {
    schemaVersion: 1,
    product: "LatexDo",
    releases: [
      {
        version: "0.3.0",
        publishedAt: notes.publishedAt,
        releaseNotesUrl: "https://latexdo.org/updates/release-notes/0.3.0.json",
      },
    ],
  });
  await run(
    "build-release-notes.mjs",
    path.join(root, "notes"),
    path.join(root, "published-notes"),
    path.join(root, "build/update-public-key.pem"),
  );
}
describe("release artifacts and signed update feeds", () => {
  it("builds download pages, actual checksums, immutable manifests and independently verifiable signatures", async () => {
    const feed = await buildDownloads();
    assertSigned(feed);
    expect(feed).toMatchObject({
      version: "0.3.0",
      release: "v0.3.0",
      commit: "a".repeat(40),
      schemaVersion: 2,
    });
    expect(feed.files).toHaveLength(4);
    const manifest = await readJson(
      path.join(root, "site/downloads/v0.3.0/manifest.json"),
    );
    expect(manifest.files).toEqual(feed.files);
    expect(await readJson(path.join(root, "site/downloads/manifest.json"))).toEqual(
      manifest,
    );
    const sums = await readFile(
      path.join(root, "site/downloads/SHA256SUMS.txt"),
      "utf8",
    );
    for (const file of feed.files) {
      const bytes = await readFile(path.join(root, "artifacts", file.filename));
      expect(file.size).toBe(bytes.length);
      expect(file.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(sums).toContain(`${file.sha256}  ${file.filename}`);
    }
    const html = await readFile(path.join(root, "site/downloads/index.html"), "utf8");
    for (const file of feed.files) expect(html).toContain(file.url);
    expect(html).toContain("Apple Silicon");
    expect(html).toContain("Intel");
    expect(html).toContain("1.0 MB");
    expect(
      await readFile(path.join(root, "site/downloads/v0.3.0/index.html"), "utf8"),
    ).toContain("Exact release");
  });
  it("builds unsigned downloads when updates are explicitly disabled", async () => {
    vi.stubEnv("LATEXDO_UPDATE_FEED_ENABLED", "false");
    vi.stubEnv("LATEXDO_UPDATE_SIGNING_KEY", "");
    await run(
      "build-downloads-page.mjs",
      path.join(root, "artifacts"),
      path.join(root, "site/downloads"),
    );
    expect(
      (await readJson(path.join(root, "site/downloads/manifest.json"))).files,
    ).toHaveLength(4);
    await expect(
      readFile(path.join(root, "site/updates/latest.json")),
    ).rejects.toThrow();
  });
  it.each([
    ["LATEXDO_RELEASE_DATE", "invalid", "valid timestamp"],
    ["LATEXDO_RELEASE_VERSION", "../escape", "Invalid release version"],
    ["LATEXDO_RELEASE_SLUG", "../escape", "Invalid release slug"],
    ["LATEXDO_UPDATE_EXPIRES_AT", "2000-01-01", "expiry"],
    ["LATEXDO_UPDATE_SIGNING_KEY", "", "required"],
  ])("rejects invalid %s before publishing an update", async (name, value, message) => {
    vi.stubEnv(name, value);
    await expect(buildDownloads()).rejects.toThrow(message);
    await expect(
      readFile(path.join(root, "site/updates/latest.json")),
    ).rejects.toThrow();
  });
  it("rejects a signing key that does not match the shipped public key", async () => {
    const other = generateKeyPairSync("ed25519");
    await writeFile(
      path.join(root, "build/update-public-key.pem"),
      other.publicKey.export({ format: "pem", type: "spki" }),
    );
    await expect(buildDownloads()).rejects.toThrow("does not match");
  });
  it("renews only the feed lifetime while preserving release artifacts", async () => {
    const before = await buildDownloads();
    const immutable = await readFile(
      path.join(root, "site/downloads/v0.3.0/manifest.json"),
      "utf8",
    );
    await run(
      "renew-update-feed.mjs",
      path.join(root, "site/updates/latest.json"),
      path.join(root, "site/downloads"),
      path.join(root, "build/update-public-key.pem"),
    );
    const after = await readJson(path.join(root, "site/updates/latest.json"));
    assertSigned(after);
    expect(Date.parse(after.publishedAt)).toBeGreaterThan(
      Date.parse(before.publishedAt),
    );
    expect(Date.parse(after.expiresAt) - Date.parse(after.publishedAt)).toBe(
      30 * 86400000,
    );
    expect(after.files).toEqual(before.files);
    expect(
      await readFile(path.join(root, "site/downloads/v0.3.0/manifest.json"), "utf8"),
    ).toBe(immutable);
  });
  it.each(["signature", "manifest", "checksums"])(
    "refuses renewal after tampering with %s",
    async (target) => {
      await buildDownloads();
      const feedPath = path.join(root, "site/updates/latest.json");
      if (target === "signature") {
        const feed = await readJson(feedPath);
        feed.version = "0.4.0";
        await json(feedPath, feed);
      }
      if (target === "manifest") {
        const file = path.join(root, "site/downloads/v0.3.0/manifest.json");
        const manifest = await readJson(file);
        manifest.commit = "b".repeat(40);
        await json(file, manifest);
      }
      if (target === "checksums")
        await writeFile(
          path.join(root, "site/downloads/v0.3.0/SHA256SUMS.txt"),
          "tampered",
        );
      const before = await readFile(feedPath, "utf8");
      await expect(
        run(
          "renew-update-feed.mjs",
          feedPath,
          path.join(root, "site/downloads"),
          path.join(root, "build/update-public-key.pem"),
        ),
      ).rejects.toThrow();
      expect(await readFile(feedPath, "utf8")).toBe(before);
    },
  );
  it("indexes release histories and supports JSON-only refreshes", async () => {
    await buildDownloads();
    await mkdir(path.join(root, "site/downloads/broken"));
    const old = await readJson(path.join(root, "site/downloads/manifest.json"));
    await json(path.join(root, "site/downloads/v0.2.0/manifest.json"), {
      ...old,
      version: "0.2.0",
      publishedAt: "2025-01-01",
      files: [],
    });
    await run("build-downloads-release-index.mjs", path.join(root, "site/downloads"));
    const index = await readJson(path.join(root, "site/downloads/releases.json"));
    expect(index.releases.map((r) => r.tag)).toEqual(["v0.3.0", "v0.2.0"]);
    expect(
      await readFile(path.join(root, "site/downloads/index.html"), "utf8"),
    ).toContain("All desktop releases");
    await writeFile(path.join(root, "site/downloads/index.html"), "preserve page");
    await run(
      "build-downloads-release-index.mjs",
      path.join(root, "site/downloads"),
      "--json-only",
    );
    expect(await readFile(path.join(root, "site/downloads/index.html"), "utf8")).toBe(
      "preserve page",
    );
  });
  it("renders an empty release index with pending installer choices", async () => {
    await mkdir(path.join(root, "empty"));
    await run("build-downloads-release-index.mjs", path.join(root, "empty"));
    expect((await readJson(path.join(root, "empty/releases.json"))).releases).toEqual(
      [],
    );
    const html = await readFile(path.join(root, "empty/index.html"), "utf8");
    expect(html).toContain("No releases published yet");
    expect(html).toContain("Release pending");
  });
});
describe("release notes signing and verification", () => {
  it("signs both documents and index and verifies the requested version", async () => {
    await buildNotes();
    for (const name of ["index", "0.3.0"])
      assertSigned(await readJson(path.join(root, `published-notes/${name}.json`)));
    await expect(
      run(
        "verify-release-notes.mjs",
        path.join(root, "published-notes"),
        path.join(root, "build/update-public-key.pem"),
        "0.3.0",
      ),
    ).resolves.toBeUndefined();
    await expect(
      run(
        "verify-release-notes.mjs",
        path.join(root, "published-notes"),
        path.join(root, "build/update-public-key.pem"),
        "99.0.0",
      ),
    ).rejects.toThrow("No release notes");
  });
  it("rejects tampered release notes", async () => {
    await buildNotes();
    const file = path.join(root, "published-notes/0.3.0.json");
    const notes = await readJson(file);
    notes.title = "Tampered";
    await json(file, notes);
    await expect(
      run(
        "verify-release-notes.mjs",
        path.join(root, "published-notes"),
        path.join(root, "build/update-public-key.pem"),
      ),
    ).rejects.toThrow("signature is invalid");
  });
  it.each(["title", "version", "highlights", "security", "releaseUrl"])(
    "validates release notes field %s before signing",
    async (field) => {
      await buildNotes();
      const file = path.join(root, "notes/0.3.0.json");
      const notes = await readJson(file);
      notes[field] = field === "releaseUrl" ? "javascript:alert(1)" : null;
      await json(file, notes);
      await expect(
        run(
          "build-release-notes.mjs",
          path.join(root, "notes"),
          path.join(root, "rejected"),
          path.join(root, "build/update-public-key.pem"),
        ),
      ).rejects.toThrow();
    },
  );
});

describe("deployment verification against published artifacts", () => {
  async function serveArtifacts() {
    const feed = await buildDownloads();
    await run("build-downloads-release-index.mjs", path.join(root, "site/downloads"));
    vi.stubEnv("LATEXDO_VERIFY_RETRIES", "1");
    vi.stubEnv("LATEXDO_VERIFY_DELAY_MS", "0");
    const fetchMock = vi.fn(async (input, options) => {
      const url = new URL(input);
      if (options?.method === "HEAD") {
        const file = feed.files.find((f) => f.url === url.href);
        return new Response(null, {
          status: file ? 200 : 404,
          headers: file ? { "content-length": String(file.size) } : {},
        });
      }
      try {
        return new Response(await readFile(path.join(root, "site", url.pathname)), {
          status: 200,
        });
      } catch {
        return new Response("missing", { status: 404 });
      }
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  it("verifies all four installers, signed feeds, manifests and release index", async () => {
    const fetchMock = await serveArtifacts();
    await expect(
      run("verify-deployed-downloads.mjs", "https://latexdo.org/downloads/"),
    ).resolves.toBeUndefined();
    expect(
      fetchMock.mock.calls.filter(([, options]) => options.method === "HEAD"),
    ).toHaveLength(4);
    expect(
      fetchMock.mock.calls
        .filter(([url]) => new URL(url).hostname === "latexdo.org")
        .every(
          ([url, options]) =>
            new URL(url).searchParams.has("deploy_verify") &&
            options.headers["cache-control"] === "no-cache",
        ),
    ).toBe(true);
  });
  it.each(["version", "signature", "checksums", "size", "index", "http"])(
    "rejects a deployment with invalid %s",
    async (target) => {
      const fetchMock = await serveArtifacts();
      if (target === "version") {
        const file = path.join(root, "site/downloads/manifest.json");
        const data = await readJson(file);
        data.version = "0.0.0";
        await json(file, data);
      }
      if (target === "signature") {
        const file = path.join(root, "site/updates/latest.json");
        const data = await readJson(file);
        data.signature.value = "A".repeat(86) + "==";
        await json(file, data);
      }
      if (target === "checksums")
        await writeFile(path.join(root, "site/downloads/SHA256SUMS.txt"), "missing");
      if (target === "index")
        await json(path.join(root, "site/downloads/releases.json"), {
          schemaVersion: 1,
          product: "LatexDo",
          releases: [],
        });
      if (target === "http")
        fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
      if (target === "size") {
        const implementation = fetchMock.getMockImplementation();
        fetchMock.mockImplementation((url, options) =>
          options?.method === "HEAD"
            ? Promise.resolve(
                new Response(null, { headers: { "content-length": "999" } }),
              )
            : implementation(url, options),
        );
      }
      await expect(
        run("verify-deployed-downloads.mjs", "https://latexdo.org/downloads/"),
      ).rejects.toThrow();
    },
  );
  it("retries transient deployment failures with a new cache key", async () => {
    const fetchMock = await serveArtifacts();
    vi.stubEnv("LATEXDO_VERIFY_RETRIES", "2");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await run("verify-deployed-downloads.mjs", "https://latexdo.org/downloads/");
    expect(
      new URL(fetchMock.mock.calls[0][0]).searchParams.get("deploy_verify"),
    ).not.toBe(new URL(fetchMock.mock.calls[1][0]).searchParams.get("deploy_verify"));
  });
});
