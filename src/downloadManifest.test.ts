import { describe, expect, it } from "vitest";
import {
  updateCheckFromDownloadManifest,
  validateDownloadManifest,
  type DownloadManifest,
} from "./downloadManifest";

const sha256 = "b".repeat(64);
const file = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  label: id,
  platform: id.split("-")[0],
  arch: id.split("-")[1],
  filename: `${id}.bin`,
  url: `https://example.test/${id}.bin`,
  sha256,
  size: 10,
  ...overrides,
});
const raw = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  product: "LatexDo",
  version: "1.2.3",
  publishedAt: "2026-01-01",
  commit: "abc",
  repository: "latexdo/latexdo-desktop",
  downloadsPage: "https://latexdo.org/downloads/v1.2.3/",
  files: ["macos-arm64", "macos-x64", "windows-x64", "linux-x64"].map((id) => file(id)),
  ...overrides,
});

describe("validateDownloadManifest", () => {
  it("rejects non-objects and malformed headers", () => {
    expect(validateDownloadManifest(null)).toBeNull();
    expect(validateDownloadManifest("x")).toBeNull();
    expect(validateDownloadManifest(raw({ version: 5 }))).toBeNull();
    expect(validateDownloadManifest(raw({ files: {} }))).toBeNull();
  });

  it("drops invalid file entries and requires every platform", () => {
    const files = raw().files as unknown[];
    expect(
      validateDownloadManifest(
        raw({ files: [...files.slice(1), file("macos-arm64", { size: 0 })] }),
      ),
    ).toBeNull();
    const valid = validateDownloadManifest(
      raw({ files: [...files, null, file("extra-x", { sha256: "nope" })] }),
    );
    expect(valid?.files).toHaveLength(4);
  });

  it("normalises nullable metadata", () => {
    const result = validateDownloadManifest(
      raw({ version: null, publishedAt: 1, commit: undefined, extra: true }),
    );
    expect(result).toMatchObject({ version: null, publishedAt: null, commit: null });
    expect(result).not.toHaveProperty("extra");
    expect(validateDownloadManifest(raw())).toMatchObject({
      version: "1.2.3",
      publishedAt: "2026-01-01",
      commit: "abc",
    });
  });
});

describe("updateCheckFromDownloadManifest", () => {
  const fallback = "https://latexdo.org/downloads/";
  it("reports an error without a manifest or version", () => {
    expect(updateCheckFromDownloadManifest(null, "1.0.0", fallback)).toEqual({
      currentVersion: "1.0.0",
      latestVersion: null,
      releaseUrl: fallback,
      updateAvailable: false,
      error: "No website download manifest version found.",
    });
    const manifest = validateDownloadManifest(raw({ version: null }))!;
    expect(
      updateCheckFromDownloadManifest(manifest, "1.0.0", fallback).error,
    ).toBeDefined();
  });

  it("strips a v prefix and falls back when the downloads page is empty", () => {
    const manifest = {
      ...validateDownloadManifest(raw({ version: "V2.0.0" }))!,
      downloadsPage: "",
    } as DownloadManifest;
    expect(updateCheckFromDownloadManifest(manifest, "1.0.0", fallback)).toEqual({
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      releaseUrl: fallback,
      updateAvailable: true,
    });
  });
});
