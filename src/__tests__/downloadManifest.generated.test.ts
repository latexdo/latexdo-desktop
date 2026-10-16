import { describe, expect, it } from "vitest";
import {
  compareVersionStrings,
  updateCheckFromDownloadManifest,
  validateDownloadManifest,
  type DownloadManifest,
} from "../downloadManifest";

const fallbackUrl = "https://latexdo.org/downloads/";
const sha256 = "a".repeat(64);

function manifest(version: string | null): DownloadManifest {
  const releaseVersion = version?.replace(/^v/i, "") ?? null;
  const downloadsPage = version ? `${fallbackUrl}v${releaseVersion}/` : fallbackUrl;
  const assetBaseUrl = releaseVersion
    ? `https://github.com/latexdo/latexdo/releases/download/v${releaseVersion}/`
    : downloadsPage;

  return {
    schemaVersion: 1,
    product: "LatexDo",
    version,
    publishedAt: "2026-06-27T00:00:00.000Z",
    commit: "abc123",
    repository: "latexdo/latexdo",
    downloadsPage,
    files: [
      {
        id: "macos-arm64",
        label: "macOS Apple Silicon",
        platform: "macos",
        arch: "arm64",
        filename: "LatexDo-macos-arm64.dmg",
        url: `${assetBaseUrl}LatexDo-macos-arm64.dmg`,
        sha256,
        size: 128,
      },
      {
        id: "macos-x64",
        label: "macOS Intel",
        platform: "macos",
        arch: "x64",
        filename: "LatexDo-macos-x64.dmg",
        url: `${assetBaseUrl}LatexDo-macos-x64.dmg`,
        sha256,
        size: 128,
      },
      {
        id: "windows-x64",
        label: "Windows",
        platform: "windows",
        arch: "x64",
        filename: "LatexDo-windows-x64.exe",
        url: `${assetBaseUrl}LatexDo-windows-x64.exe`,
        sha256,
        size: 128,
      },
      {
        id: "linux-x64",
        label: "Linux",
        platform: "linux",
        arch: "x64",
        filename: "LatexDo-linux-x64.AppImage",
        url: `${assetBaseUrl}LatexDo-linux-x64.AppImage`,
        sha256,
        size: 128,
      },
    ],
  };
}

const updateCases = Array.from({ length: 2100 }, (_, index) => {
  const major = 1 + (index % 24);
  const minor = Math.floor(index / 24) % 30;
  const patch = Math.floor(index / (24 * 30));
  const currentVersion = `${major}.${minor}.${patch}`;
  const latestVersion =
    index % 3 === 0
      ? `${major}.${minor}.${patch + 1}`
      : index % 3 === 1
        ? `${major}.${minor}.${patch}`
        : `${Math.max(0, major - 1)}.${minor}.${patch}`;
  return {
    currentVersion,
    latestVersion,
    shouldUpdate: compareVersionStrings(latestVersion, currentVersion) > 0,
  };
});

describe("download manifest generated update matrix", () => {
  it.each(updateCases)(
    "case %# current=$currentVersion latest=$latestVersion update=$shouldUpdate",
    ({ currentVersion, latestVersion, shouldUpdate }) => {
      const validManifest = validateDownloadManifest(manifest(latestVersion));
      const downloadsPage = manifest(latestVersion).downloadsPage;
      const result = updateCheckFromDownloadManifest(
        validManifest,
        currentVersion,
        fallbackUrl,
      );

      expect(validManifest).not.toBeNull();
      expect(result.latestVersion).toBe(latestVersion);
      expect(result.releaseUrl).toBe(downloadsPage);
      expect(result.updateAvailable).toBe(shouldUpdate);
    },
  );

  it("rejects a manifest without every required installer", () => {
    const incomplete = manifest("2.0.0");
    incomplete.files = incomplete.files.filter((file) => file.id !== "linux-x64");

    expect(validateDownloadManifest(incomplete)).toBeNull();
  });

  it("rejects a manifest with invalid SHA-256 data", () => {
    const invalid = manifest("2.0.0");
    invalid.files[0] = { ...invalid.files[0], sha256: "not-a-checksum" };

    expect(validateDownloadManifest(invalid)).toBeNull();
  });
});

describe("compareVersionStrings explicit ordering", () => {
  it.each([
    { left: "1.0.1", right: "1.0.0", expected: 1 },
    { left: "1.0.0", right: "1.0.1", expected: -1 },
    { left: "1.10.0", right: "1.9.0", expected: 1 },
    { left: "2.0.0", right: "1.99.99", expected: 1 },
    { left: "1.0.0", right: "1.0.0", expected: 0 },
    { left: "v1.2.3", right: "1.2.3", expected: 0 },
    { left: "1.0", right: "1.0.0", expected: 0 },
  ])("core versions: $left vs $right = $expected", ({ left, right, expected }) => {
    expect(Math.sign(compareVersionStrings(left, right))).toBe(expected);
  });

  it.each([
    { left: "1.0.0", right: "1.0.0-beta", expected: 1 },
    { left: "1.0.0-beta", right: "1.0.0", expected: -1 },
    { left: "0.1.0", right: "0.1.0-rc.1", expected: 1 },
    { left: "1.0.0-alpha", right: "1.0.0-beta", expected: -1 },
    { left: "1.0.0-rc.2", right: "1.0.0-rc.1", expected: 1 },
    { left: "1.0.0-rc.1", right: "1.0.0-rc.1", expected: 0 },
    { left: "1.0.1-alpha", right: "1.0.0", expected: 1 },
    { left: "1.0.0-beta.2", right: "1.0.0-beta", expected: 1 },
  ])(
    "pre-releases rank below their release: $left vs $right = $expected",
    ({ left, right, expected }) => {
      expect(Math.sign(compareVersionStrings(left, right))).toBe(expected);
    },
  );

  it("offers the final release to users on a pre-release build", () => {
    const result = updateCheckFromDownloadManifest(
      validateDownloadManifest(manifest("1.0.0")),
      "1.0.0-beta",
      fallbackUrl,
    );

    expect(result.updateAvailable).toBe(true);
  });

  it("does not offer a pre-release to users on the final release", () => {
    const result = updateCheckFromDownloadManifest(
      validateDownloadManifest(manifest("1.0.0-rc.1")),
      "1.0.0",
      fallbackUrl,
    );

    expect(result.updateAvailable).toBe(false);
  });
});
