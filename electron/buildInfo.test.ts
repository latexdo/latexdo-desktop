import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBuildInfo } from "./buildInfo.js";
import {
  recentChanges,
  resolveBuildCommit,
  writeBuildInfo,
  // @ts-expect-error The build script is plain JavaScript without type declarations.
} from "../scripts/write-build-info.mjs";

let directory: string | null = null;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = null;
});

describe("build info", () => {
  it("round-trips what the build script writes", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-build-info-"));
    const written = await writeBuildInfo(directory, {});
    expect(written.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(readBuildInfo(directory)).toEqual(written);
  });

  it("prefers the checked-out commit and falls back to CI variables", () => {
    const head = "a".repeat(40);
    const ci = "b".repeat(40);
    expect(resolveBuildCommit({ GITHUB_SHA: ci }, () => head)).toBe(head);
    expect(resolveBuildCommit({ GITHUB_SHA: ci }, () => null)).toBe(ci);
    expect(resolveBuildCommit({ GITHUB_SHA: "main" }, () => null)).toBeNull();
  });

  it("ignores missing or malformed build info", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-build-info-"));
    expect(readBuildInfo(directory)).toBeNull();
    await writeFile(
      path.join(directory, "build-info.json"),
      JSON.stringify({ commit: "main", builtAt: "yesterday" }),
    );
    expect(readBuildInfo(directory)).toBeNull();
  });
});

describe("recentChanges", () => {
  it("parses first-parent history into commit and subject pairs", () => {
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    expect(
      recentChanges(
        () => `${a}\tfeat: one\n${b}\tfix(x): two\twith tab\nnot-a-commit\tthree`,
      ),
    ).toEqual([
      { commit: a, subject: "feat: one" },
      { commit: b, subject: "fix(x): two\twith tab" },
    ]);
    expect(recentChanges(() => "")).toEqual([]);
  });
});
