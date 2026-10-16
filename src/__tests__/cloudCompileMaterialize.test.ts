import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  materializeCloudCompileFiles,
  maxCloudCompileFiles,
} from "../../electron/compiler";

let scratchRoot: string;

beforeEach(async () => {
  scratchRoot = await mkdtemp(path.join(tmpdir(), "latexdo-cloud-test-"));
});

afterEach(async () => {
  await rm(scratchRoot, { recursive: true, force: true });
});

describe("materializeCloudCompileFiles", () => {
  it("writes files and creates parent directories", async () => {
    await materializeCloudCompileFiles(scratchRoot, [
      { relativePath: "main.tex", content: "\\documentclass{article}" },
      { relativePath: "chapters/intro.tex", content: "Intro" },
    ]);

    expect(await readFile(path.join(scratchRoot, "main.tex"), "utf8")).toBe(
      "\\documentclass{article}",
    );
    expect(await readFile(path.join(scratchRoot, "chapters/intro.tex"), "utf8")).toBe(
      "Intro",
    );
  });

  it("removes stale files from previous runs but keeps .latexdo caches", async () => {
    await writeFile(path.join(scratchRoot, "stale.tex"), "old");
    await mkdir(path.join(scratchRoot, ".latexdo", "build"), { recursive: true });
    await writeFile(path.join(scratchRoot, ".latexdo", "build", "cache.aux"), "aux");

    await materializeCloudCompileFiles(scratchRoot, [
      { relativePath: "main.tex", content: "fresh" },
    ]);

    const entries = await readdir(scratchRoot);
    expect(entries.sort()).toEqual([".latexdo", "main.tex"]);
    expect(
      await readFile(path.join(scratchRoot, ".latexdo", "build", "cache.aux"), "utf8"),
    ).toBe("aux");
  });

  it.each([
    "../escape.tex",
    "/absolute.tex",
    "a/../../escape.tex",
    "C:/windows.tex",
    "nested/./dot.tex",
    "",
  ])("rejects unsafe path %j", async (relativePath) => {
    await expect(
      materializeCloudCompileFiles(scratchRoot, [{ relativePath, content: "x" }]),
    ).rejects.toThrow(/Unsafe project path|too many|too large/);
  });

  it("rejects projects with too many files", async () => {
    const files = Array.from({ length: maxCloudCompileFiles + 1 }, (_, index) => ({
      relativePath: `file-${index}.tex`,
      content: "",
    }));
    await expect(materializeCloudCompileFiles(scratchRoot, files)).rejects.toThrow(
      /too many files/,
    );
  });

  it("rejects oversized individual files", async () => {
    await expect(
      materializeCloudCompileFiles(scratchRoot, [
        { relativePath: "big.tex", content: "x".repeat(9 * 1024 * 1024) },
      ]),
    ).rejects.toThrow(/too large/);
  });

  it("normalizes backslash separators", async () => {
    await materializeCloudCompileFiles(scratchRoot, [
      { relativePath: "sections\\one.tex", content: "one" },
    ]);
    expect(await readFile(path.join(scratchRoot, "sections/one.tex"), "utf8")).toBe(
      "one",
    );
  });
});
