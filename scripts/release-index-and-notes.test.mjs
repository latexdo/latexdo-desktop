// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const repo = process.cwd();
const originalArgv = process.argv;
let root, publicKey, privateKey;

async function json(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
}
async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
async function run(script, ...args) {
  vi.resetModules();
  process.argv = [process.execPath, path.join(repo, "scripts", script), ...args];
  await import(/* @vite-ignore */ path.join(repo, "scripts", script));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "latexdo-release-index-"));
  ({ publicKey, privateKey } = generateKeyPairSync("ed25519"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  for (const key of [
    "LATEXDO_DOWNLOAD_BASE_URL",
    "GITHUB_REPOSITORY",
    "LATEXDO_UPDATE_SIGNING_KEY",
  ])
    delete process.env[key];
});
afterEach(async () => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

const manifest = (overrides = {}) => ({
  schemaVersion: 1,
  product: "LatexDo",
  version: "1.0.0",
  publishedAt: "2026-01-01T00:00:00.000Z",
  commit: "b".repeat(40),
  files: [],
  ...overrides,
});

describe("build-downloads-release-index", () => {
  it("uses the default directory and environment fallbacks", async () => {
    const dir = path.join(root, "public-downloads/downloads");
    await json(path.join(dir, "v1.0.0/manifest.json"), manifest());
    await run("build-downloads-release-index.mjs");
    const index = await readJson(path.join(dir, "releases.json"));
    expect(index.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(index.releases[0]).toMatchObject({
      tag: "v1.0.0",
      repository: "latexdo/latexdo-desktop",
      downloadsPage: "https://latexdo.org/downloads/v1.0.0/",
      githubReleaseUrl:
        "https://github.com/latexdo/latexdo-desktop/releases/tag/v1.0.0",
      files: [],
    });
    // No top-level manifest: the newest release manifest drives the page.
    const html = await readFile(path.join(dir, "index.html"), "utf8");
    expect(html).toContain("Version</dt>\n            <dd>1.0.0</dd>");
    expect(html).toContain(
      '<link rel="canonical" href="https://latexdo.org/downloads/"',
    );
  });

  it("skips invalid entries and orders releases by date, then tag", async () => {
    vi.stubEnv("LATEXDO_DOWNLOAD_BASE_URL", "https://mirror.test/");
    vi.stubEnv("GITHUB_REPOSITORY", "me/fork");
    const dir = path.join(root, "site");
    await json(path.join(dir, "not-a-dir.txt"), "x");
    await json(path.join(dir, "a..b/manifest.json"), manifest());
    await json(path.join(dir, "broken/manifest.json"), "{not json");
    await json(path.join(dir, "other/manifest.json"), manifest({ product: "Other" }));
    await json(
      path.join(dir, "old-schema/manifest.json"),
      manifest({ schemaVersion: 2 }),
    );
    await json(path.join(dir, "v1.0.0/manifest.json"), manifest({ files: "bad" }));
    await json(path.join(dir, "v1.0.1/manifest.json"), manifest());
    await json(
      path.join(dir, "v2.0.0/manifest.json"),
      manifest({ publishedAt: "2026-06-01T00:00:00.000Z", repository: "own/repo" }),
    );
    await json(
      path.join(dir, "v0.0.1/manifest.json"),
      manifest({ publishedAt: undefined, commit: undefined, version: undefined }),
    );
    await json(path.join(dir, "manifest.json"), {
      files: [
        {
          platform: "macos",
          arch: "arm64",
          url: "https://x/a.dmg",
          filename: "a.dmg",
          sizeLabel: "1 MB",
        },
        {
          platform: "macos",
          arch: "x64",
          url: "https://x/b.dmg",
          filename: "b.dmg",
          size: 9,
        },
        { platform: "windows", url: "https://x/c", filename: "setup" },
      ],
    });
    await run("build-downloads-release-index.mjs", dir);

    const index = await readJson(path.join(dir, "releases.json"));
    expect(index.releases.map((r) => r.tag)).toEqual([
      "v2.0.0",
      "v1.0.1",
      "v1.0.0",
      "v0.0.1",
    ]);
    expect(index.releases[0].repository).toBe("own/repo");
    expect(index.releases[1].githubReleaseUrl).toContain("github.com/me/fork/");
    expect(index.releases[1].downloadsPage).toBe(
      "https://mirror.test/downloads/v1.0.1/",
    );
    expect(index.releases[2].files).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping broken"),
    );

    const html = await readFile(path.join(dir, "index.html"), "utf8");
    expect(html).toContain("<strong>Apple Silicon</strong>");
    expect(html).toContain("<strong>Intel</strong>");
    expect(html).toContain("1 MB - SHA-256");
    expect(html).toContain("9 bytes - SHA-256");
    expect(html).toContain("<span>Installer installer</span>");
    expect(html).toContain("Older release has no Linux asset");
    expect(html).toContain("Version unknown - Unknown date UTC - unknown");
    expect(html).toContain("<dd>unknown</dd>");
  });

  it("renders Linux downloads and handles unparsable dates", async () => {
    const dir = path.join(root, "site");
    await json(
      path.join(dir, "v1.0.0/manifest.json"),
      manifest({ publishedAt: "not a date" }),
    );
    await json(
      path.join(dir, "v1.1.0/manifest.json"),
      manifest({ publishedAt: "never" }),
    );
    await json(path.join(dir, "manifest.json"), {
      version: "1.1.0",
      files: [
        {
          platform: "linux",
          url: "https://x/l.AppImage",
          filename: "l.AppImage",
          size: 1,
        },
      ],
    });
    await run("build-downloads-release-index.mjs", dir, "--json-only");
    const index = await readJson(path.join(dir, "releases.json"));
    expect(index.releases.map((r) => r.tag)).toEqual(["v1.1.0", "v1.0.0"]);
    await expect(readFile(path.join(dir, "index.html"))).rejects.toThrow();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("JSON index"));
  });

  it("renders Linux cards when the latest manifest has a Linux asset", async () => {
    const dir = path.join(root, "site");
    await json(path.join(dir, "manifest.json"), {
      files: [
        {
          platform: "linux",
          url: "https://x/l.AppImage",
          filename: "l.AppImage",
          size: 1,
        },
      ],
    });
    await run("build-downloads-release-index.mjs", dir);
    const html = await readFile(path.join(dir, "index.html"), "utf8");
    expect(html).toContain("<h2>Linux desktop</h2>");
    expect(html).toContain("<strong>Linux x64</strong>");
    expect(html).toContain("No releases published yet");
  });
});

describe("build-downloads-release-index fallbacks", () => {
  it("orders a dated release before an undated one and tolerates a manifest without files", async () => {
    const dir = path.join(root, "site");
    await json(path.join(dir, "v9.0.0/manifest.json"), manifest({ publishedAt: undefined }));
    await json(path.join(dir, "v1.0.0/manifest.json"), manifest());
    await json(path.join(dir, "manifest.json"), { version: "1.0.0" });
    await run("build-downloads-release-index.mjs", dir);
    const index = await readJson(path.join(dir, "releases.json"));
    expect(index.releases.map((r) => r.tag)).toEqual(["v9.0.0", "v1.0.0"]);
    const html = await readFile(path.join(dir, "index.html"), "utf8");
    expect(html).toContain("Release pending");
  });
});

const notes = () => ({
  schemaVersion: 1,
  product: "LatexDo",
  version: "1.0.0",
  title: "LatexDo 1.0.0",
  summary: "Summary",
  publishedAt: "2026-01-01T00:00:00.000Z",
  releaseUrl: "https://github.com/latexdo/latexdo-desktop/releases",
  highlights: [{ id: "a-1", category: "new", title: "New", description: "d" }, "skip"],
  fixes: ["fix"],
  breakingChanges: ["break"],
  security: [{ title: "S", description: "d", advisoryUrl: "https://latexdo.org/sec" }],
});
const indexEntry = (overrides = {}) => ({
  version: "v1.0.0",
  publishedAt: "2026-01-01T00:00:00.000Z",
  releaseNotesUrl: "https://www.latexdo.org/updates/release-notes/1.0.0.json",
  ...overrides,
});

async function setupNotes({ index, document } = {}) {
  vi.stubEnv(
    "LATEXDO_UPDATE_SIGNING_KEY",
    Buffer.from(privateKey.export({ format: "pem", type: "pkcs8" })).toString("base64"),
  );
  await json(
    path.join(root, "build/update-public-key.pem"),
    publicKey.export({ format: "pem", type: "spki" }),
  );
  await json(
    path.join(root, "release-notes/index.json"),
    index ?? { schemaVersion: 1, product: "LatexDo", releases: [indexEntry()] },
  );
  await json(path.join(root, "release-notes/1.0.0.json"), document ?? notes());
}

async function buildNotes() {
  // Relative default paths resolve against the real cwd, so pass the key path.
  await run(
    "build-release-notes.mjs",
    path.join(root, "release-notes"),
    path.join(root, "out"),
    path.join(root, "build/update-public-key.pem"),
  );
}

const wrap = (entry) => ({ schemaVersion: 1, product: "LatexDo", releases: [entry] });

describe("build-release-notes", () => {
  it("requires a signing key", async () => {
    await expect(run("build-release-notes.mjs")).rejects.toThrow(
      "LATEXDO_UPDATE_SIGNING_KEY is required",
    );
  });

  it("signs a document with all optional sections and a v-prefixed version", async () => {
    await setupNotes();
    await buildNotes();
    const published = await readJson(path.join(root, "out/1.0.0.json"));
    expect(published.signature.algorithm).toBe("ed25519");
    const index = await readJson(path.join(root, "out/index.json"));
    expect(index.releases[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signs a minimal document without optional sections", async () => {
    const minimal = notes();
    delete minimal.summary;
    delete minimal.fixes;
    delete minimal.breakingChanges;
    delete minimal.security;
    minimal.highlights = [];
    await setupNotes({ document: minimal });
    await buildNotes();
    expect((await readJson(path.join(root, "out/1.0.0.json"))).title).toBe(
      "LatexDo 1.0.0",
    );
  });

  it("rejects a non-Ed25519 signing key and a mismatched public key", async () => {
    await setupNotes();
    const { privateKey: rsa } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    vi.stubEnv(
      "LATEXDO_UPDATE_SIGNING_KEY",
      Buffer.from(rsa.export({ format: "pem", type: "pkcs8" })).toString("base64"),
    );
    await expect(buildNotes()).rejects.toThrow("must contain an Ed25519 private key");
    const other = generateKeyPairSync("ed25519");
    vi.stubEnv(
      "LATEXDO_UPDATE_SIGNING_KEY",
      Buffer.from(other.privateKey.export({ format: "pem", type: "pkcs8" })).toString(
        "base64",
      ),
    );
    await expect(buildNotes()).rejects.toThrow("does not match the public key");
  });

  it.each([
    ["not an object", [], "index.json must be an object"],
    ["bad schema", { schemaVersion: 2 }, "schema is invalid"],
    [
      "bad product",
      { schemaVersion: 1, product: "X", releases: [1] },
      "schema is invalid",
    ],
    [
      "no releases",
      { schemaVersion: 1, product: "LatexDo", releases: [] },
      "schema is invalid",
    ],
    [
      "too many",
      { schemaVersion: 1, product: "LatexDo", releases: Array(201).fill(1) },
      "schema is invalid",
    ],
    [
      "malformed entry",
      { schemaVersion: 1, product: "LatexDo", releases: [null] },
      "malformed entry",
    ],
    [
      "bad version",
      wrap(indexEntry({ version: undefined })),
      "invalid entry for undefined",
    ],
    ["bad date", wrap(indexEntry({ publishedAt: "nope" })), "invalid entry"],
    [
      "bad url",
      wrap(indexEntry({ releaseNotesUrl: "http://latexdo.org/x" })),
      "invalid entry",
    ],
    [
      "bad host",
      wrap(
        indexEntry({
          releaseNotesUrl: "https://evil.test/updates/release-notes/1.0.0.json",
        }),
      ),
      "invalid entry",
    ],
    [
      "bad path",
      wrap(indexEntry({ releaseNotesUrl: "https://latexdo.org/1.0.0.json" })),
      "invalid entry",
    ],
    ["unparsable url", wrap(indexEntry({ releaseNotesUrl: "::" })), "invalid entry"],
    ["non-string url", wrap(indexEntry({ releaseNotesUrl: 5 })), "invalid entry"],
    [
      "file mismatch",
      wrap(
        indexEntry({
          releaseNotesUrl: "https://latexdo.org/updates/release-notes/2.0.0.json",
        }),
      ),
      "invalid entry",
    ],
  ])("rejects an index with %s", async (_label, index, message) => {
    await setupNotes({ index });
    await expect(buildNotes()).rejects.toThrow(message);
  });

  const long = (n) => "x".repeat(n);
  it.each([
    ["not an object", () => [], "must be an object"],
    ["schema", (d) => ({ ...d, schemaVersion: 2 }), "invalid schemaVersion"],
    ["product", (d) => ({ ...d, product: "X" }), "invalid product"],
    ["missing version", (d) => ({ ...d, version: undefined }), "does not match"],
    ["other version", (d) => ({ ...d, version: "2.0.0" }), "does not match"],
    ["title", (d) => ({ ...d, title: "" }), "invalid title"],
    ["summary type", (d) => ({ ...d, summary: 3 }), "invalid summary"],
    ["summary length", (d) => ({ ...d, summary: long(1001) }), "invalid summary"],
    ["date", (d) => ({ ...d, publishedAt: 4 }), "invalid publishedAt"],
    [
      "release url",
      (d) => ({ ...d, releaseUrl: "https://evil.test/" }),
      "disallowed releaseUrl",
    ],
    ["release url parse", (d) => ({ ...d, releaseUrl: "::" }), "disallowed releaseUrl"],
    [
      "release url scheme",
      (d) => ({ ...d, releaseUrl: "http://github.com/" }),
      "disallowed releaseUrl",
    ],
    ["highlights type", (d) => ({ ...d, highlights: {} }), "highlights are invalid"],
    [
      "highlights count",
      (d) => ({ ...d, highlights: Array(31).fill("x") }),
      "highlights are invalid",
    ],
    [
      "highlight id",
      (d) => ({ ...d, highlights: [{ ...d.highlights[0], id: "Bad" }] }),
      'highlight "Bad"',
    ],
    [
      "highlight id missing",
      (d) => ({ ...d, highlights: [{ ...d.highlights[0], id: undefined }] }),
      "highlight null",
    ],
    [
      "highlight title",
      (d) => ({ ...d, highlights: [{ ...d.highlights[0], title: long(121) }] }),
      "Invalid release highlight",
    ],
    [
      "highlight description",
      (d) => ({ ...d, highlights: [{ ...d.highlights[0], description: 1 }] }),
      "Invalid release highlight",
    ],
    [
      "highlight description length",
      (d) => ({ ...d, highlights: [{ ...d.highlights[0], description: long(1001) }] }),
      "Invalid release highlight",
    ],
    [
      "highlight category",
      (d) => ({ ...d, highlights: [{ ...d.highlights[0], category: "fun" }] }),
      "Invalid release highlight",
    ],
    ["fixes type", (d) => ({ ...d, fixes: "x" }), "fixes must be an array"],
    [
      "fixes count",
      (d) => ({ ...d, fixes: Array(101).fill("x") }),
      "fixes must be an array",
    ],
    ["fix entry", (d) => ({ ...d, fixes: [""] }), "fixes contains an invalid string"],
    ["fix type", (d) => ({ ...d, fixes: [1] }), "fixes contains an invalid string"],
    [
      "fix length",
      (d) => ({ ...d, breakingChanges: [long(501)] }),
      "breakingChanges contains",
    ],
    ["security type", (d) => ({ ...d, security: {} }), "security must be an array"],
    [
      "security count",
      (d) => ({ ...d, security: Array(31).fill({}) }),
      "security must be an array",
    ],
    ["security note", (d) => ({ ...d, security: [null] }), "invalid note"],
    [
      "security title",
      (d) => ({ ...d, security: [{ title: "", description: "" }] }),
      "invalid note",
    ],
    [
      "security description",
      (d) => ({ ...d, security: [{ title: "t", description: 1 }] }),
      "invalid note",
    ],
    [
      "security description length",
      (d) => ({ ...d, security: [{ title: "t", description: long(1001) }] }),
      "invalid note",
    ],
    [
      "advisory",
      (d) => ({ ...d, security: [{ title: "t", description: "", advisoryUrl: 3 }] }),
      "disallowed advisory",
    ],
  ])("rejects a document with invalid %s", async (_label, mutate, message) => {
    await setupNotes();
    const document = mutate(notes());
    await json(path.join(root, "release-notes/1.0.0.json"), document);
    await expect(buildNotes()).rejects.toThrow(message);
  });

  it("rejects non-finite numbers in a document", async () => {
    await setupNotes();
    const raw = JSON.stringify(notes()).replace(/}$/, ',"extra":1e400}');
    await json(path.join(root, "release-notes/1.0.0.json"), raw);
    await expect(buildNotes()).rejects.toThrow("non-finite number");
  });

  it("signs numbers and booleans inside documents", async () => {
    await setupNotes({
      document: { ...notes(), meta: { count: 3, flag: true, none: null } },
    });
    await buildNotes();
    expect((await readJson(path.join(root, "out/1.0.0.json"))).meta).toEqual({
      count: 3,
      flag: true,
      none: null,
    });
  });
});
