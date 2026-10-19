// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const repo = process.cwd();
const script = path.join(repo, "scripts", "build-downloads-page.mjs");
const filenames = [
  "LatexDo-macos-arm64.dmg",
  "LatexDo-macos-x64.dmg",
  "LatexDo-windows-x64.exe",
  "LatexDo-linux-x64.AppImage",
];
const envNames = [
  "LATEXDO_DOWNLOAD_BASE_URL",
  "LATEXDO_RELEASE_DATE",
  "LATEXDO_UPDATE_SIGNING_KEY",
  "LATEXDO_UPDATE_FEED_ENABLED",
  "LATEXDO_RELEASE_COMMIT",
  "GITHUB_SHA",
  "GITHUB_REPOSITORY",
  "LATEXDO_RELEASE_VERSION",
  "LATEXDO_RELEASE_SLUG",
  "LATEXDO_RELEASE_ASSET_BASE_URL",
  "LATEXDO_UPDATE_EXPIRES_AT",
];
const originalArgv = process.argv;
let root;

async function run(...args) {
  vi.resetModules();
  process.argv = [process.execPath, script, ...args];
  await import(/* @vite-ignore */ script);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "latexdo-downloads-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.spyOn(console, "log").mockImplementation(() => {});
  for (const name of envNames) vi.stubEnv(name, undefined);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "v1.2.3" }));
  await mkdir(path.join(root, "artifacts"));
  for (const name of filenames) await writeFile(path.join(root, "artifacts", name), "x");
});

afterEach(async () => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("build-downloads-page defaults", () => {
  it("uses the default folders, package version and site URL without any settings", async () => {
    await run();
    const manifest = JSON.parse(
      await readFile(path.join(root, "public-downloads/downloads/manifest.json"), "utf8"),
    );
    expect(manifest.version).toBe("1.2.3");
    expect(manifest.commit).toBe("");
    expect(manifest.repository).toBe("latexdo/latexdo-desktop");
    expect(manifest.downloadsPage).toBe("https://latexdo.org/downloads/v1.2.3/");
    expect(manifest.files[0].url).toBe(
      "https://latexdo.org/downloads/v1.2.3/LatexDo-macos-arm64.dmg",
    );
    const html = await readFile(
      path.join(root, "public-downloads/downloads/index.html"),
      "utf8",
    );
    expect(html).toContain("<dd>local</dd>");
    // Without a signing key the update feed is skipped.
    await expect(
      readFile(path.join(root, "public-downloads/updates/latest.json")),
    ).rejects.toThrow();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("without signed update feed"),
    );
  });

  it("takes the commit from GITHUB_SHA and a custom asset host", async () => {
    vi.stubEnv("GITHUB_SHA", "b".repeat(40));
    vi.stubEnv("LATEXDO_RELEASE_ASSET_BASE_URL", "https://cdn.example/assets/");
    vi.stubEnv("LATEXDO_UPDATE_FEED_ENABLED", "");
    await run();
    const manifest = JSON.parse(
      await readFile(path.join(root, "public-downloads/downloads/manifest.json"), "utf8"),
    );
    expect(manifest.commit).toBe("b".repeat(40));
    expect(manifest.files[2].url).toBe("https://cdn.example/assets/LatexDo-windows-x64.exe");
  });

  it("refuses a signing key that is not Ed25519", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    vi.stubEnv(
      "LATEXDO_UPDATE_SIGNING_KEY",
      Buffer.from(privateKey.export({ format: "pem", type: "pkcs8" })).toString("base64"),
    );
    await expect(run()).rejects.toThrow("must contain an Ed25519 private key");
  });
});
