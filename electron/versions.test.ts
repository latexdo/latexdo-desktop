import { describe, expect, it } from "vitest";
import {
  compareLatexDoVersions,
  isBuildReleaseSlugForVersion,
  isNewerRelease,
  isReleaseSlugForVersion,
  normalizeLatexDoVersion,
  versionsEquivalent,
  type ReleaseIdentity,
} from "./versions.js";

describe("normalizeLatexDoVersion", () => {
  it("normalizes plain marketing versions", () => {
    expect(normalizeLatexDoVersion("0.3.0")).toEqual({
      core: ["0", "3", "0"],
      prerelease: [],
    });
  });

  it("strips the v prefix", () => {
    expect(normalizeLatexDoVersion("v0.3.0")).toEqual({
      core: ["0", "3", "0"],
      prerelease: [],
    });
    expect(normalizeLatexDoVersion("V1.2.3")).toEqual({
      core: ["1", "2", "3"],
      prerelease: [],
    });
  });

  it("parses prerelease and build segments from build release slugs", () => {
    expect(normalizeLatexDoVersion("0.3.0-build.180.1.38c0f1f5e28d")).toEqual({
      core: ["0", "3", "0"],
      prerelease: ["build", "180", "1", "38c0f1f5e28d"],
    });
    expect(normalizeLatexDoVersion("v0.3.0-build.180.1.38c0f1f5e28d")).toEqual({
      core: ["0", "3", "0"],
      prerelease: ["build", "180", "1", "38c0f1f5e28d"],
    });
  });
});

describe("compareLatexDoVersions", () => {
  it("ranks higher core versions above lower ones", () => {
    expect(compareLatexDoVersions("0.4.0", "0.3.0")).toBeGreaterThan(0);
    expect(compareLatexDoVersions("0.3.0", "0.4.0")).toBeLessThan(0);
    expect(compareLatexDoVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
  });

  it("distinguishes build metadata when both sides carry it", () => {
    expect(
      compareLatexDoVersions("0.3.0-build.181", "0.3.0-build.180"),
    ).toBeGreaterThan(0);
    expect(compareLatexDoVersions("0.3.0-build.180", "0.3.0-build.181")).toBeLessThan(
      0,
    );
    expect(compareLatexDoVersions("0.3.0-build.180", "0.3.0-build.180")).toBe(0);
  });

  it("ranks the plain release above a prerelease of the same core", () => {
    expect(compareLatexDoVersions("0.3.0", "0.3.0-build.180")).toBeGreaterThan(0);
  });

  it("compares prerelease segments numerically where possible", () => {
    expect(compareLatexDoVersions("0.3.0-rc.2", "0.3.0-rc.10")).toBeLessThan(0);
  });

  it("treats leading v prefixes as insignificant", () => {
    expect(compareLatexDoVersions("v0.3.0", "0.3.0")).toBe(0);
  });
});

describe("versionsEquivalent", () => {
  it("accepts identical versions", () => {
    expect(versionsEquivalent("0.3.0", "0.3.0")).toBe(true);
    expect(versionsEquivalent("0.3.0", "v0.3.0")).toBe(true);
  });

  it("rejects versions with different cores", () => {
    expect(versionsEquivalent("0.2.0", "0.3.0")).toBe(false);
  });

  it("rejects build differences", () => {
    expect(versionsEquivalent("0.3.0-build.180", "0.3.0-build.181")).toBe(false);
    expect(versionsEquivalent("0.3.0", "0.3.0-build.180")).toBe(false);
  });
});

describe("release slug helpers", () => {
  it("accepts plain and build slugs for a version", () => {
    expect(isReleaseSlugForVersion("v0.3.0", "0.3.0")).toBe(true);
    expect(isReleaseSlugForVersion("v0.3.0-build.180.1.38c0f1f5e28d", "0.3.0")).toBe(
      true,
    );
    expect(
      isBuildReleaseSlugForVersion("v0.3.0-build.180.1.38c0f1f5e28d", "0.3.0"),
    ).toBe(true);
  });

  it("rejects slugs for the wrong version", () => {
    expect(isReleaseSlugForVersion("v0.4.0", "0.3.0")).toBe(false);
    expect(isReleaseSlugForVersion("v0.3.0-build.180.1.38c0f1f5e28d", "0.4.0")).toBe(
      false,
    );
    expect(isBuildReleaseSlugForVersion("v0.3.0", "0.3.0")).toBe(false);
  });
});

describe("isNewerRelease", () => {
  const installed = {
    version: "0.3.0",
    commit: "a".repeat(40),
    timestamp: "2026-10-05T12:00:00.000Z",
  };
  const published = (overrides: Partial<ReleaseIdentity>): ReleaseIdentity => ({
    version: "0.3.0",
    commit: "b".repeat(40),
    timestamp: "2026-10-06T12:00:00.000Z",
    ...overrides,
  });

  it("treats a later build of the same version as an update", () => {
    expect(isNewerRelease(published({}), installed)).toBe(true);
  });

  it("does not offer the build that is already installed", () => {
    expect(isNewerRelease(published({ commit: installed.commit }), installed)).toBe(
      false,
    );
  });

  it("does not downgrade to a build published before this one was built", () => {
    expect(
      isNewerRelease(published({ timestamp: "2026-10-04T12:00:00.000Z" }), installed),
    ).toBe(false);
  });

  it("lets the version decide when versions differ", () => {
    expect(
      isNewerRelease(published({ version: "0.3.1", commit: null }), installed),
    ).toBe(true);
    expect(isNewerRelease(published({ version: "0.2.9" }), installed)).toBe(false);
  });

  it("falls back to the version alone when a build identity is unknown", () => {
    expect(isNewerRelease(published({}), { version: "0.3.0" })).toBe(false);
    expect(isNewerRelease(published({ commit: null }), installed)).toBe(false);
    expect(isNewerRelease(published({ timestamp: "not a date" }), installed)).toBe(
      false,
    );
  });
});

describe("compareLatexDoVersions edge cases", () => {
  it("pads missing core parts with zero", () => {
    expect(compareLatexDoVersions("1.2", "1.2.0")).toBe(0);
    expect(compareLatexDoVersions("1.2.0", "1.2")).toBe(0);
    expect(compareLatexDoVersions("1.2", "1.2.1")).toBe(-1);
  });

  it("compares non-numeric parts lexically", () => {
    expect(compareLatexDoVersions("1.x", "1.x")).toBe(0);
    expect(compareLatexDoVersions("1.b", "1.a")).toBe(1);
    expect(compareLatexDoVersions("1.a", "1.b")).toBe(-1);
  });

  it("ranks a longer pre-release above its prefix", () => {
    expect(compareLatexDoVersions("1.0.0-beta", "1.0.0-beta.1")).toBe(-1);
    expect(compareLatexDoVersions("1.0.0-beta.1", "1.0.0-beta")).toBe(1);
    expect(compareLatexDoVersions("1.0.0-beta.2", "1.0.0-beta.2")).toBe(0);
    expect(compareLatexDoVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
  });
});

describe("isNewerRelease without timestamps", () => {
  it("is false when either timestamp is missing", () => {
    expect(
      isNewerRelease(
        { version: "1.0.0", commit: "b" },
        { version: "1.0.0", commit: "a", timestamp: "2026-01-01T00:00:00Z" },
      ),
    ).toBe(false);
    expect(
      isNewerRelease(
        { version: "1.0.0", commit: "b", timestamp: "2026-01-02T00:00:00Z" },
        { version: "1.0.0", commit: "a" },
      ),
    ).toBe(false);
  });
});
