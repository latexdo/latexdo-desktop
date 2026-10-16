import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listProject } from "../electron/projectTree.js";
import type { ProjectEntry } from "./types";

async function withTempDirectory(
  callback: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "latexdo-project-tree-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function flattenEntries(entries: ProjectEntry[]): ProjectEntry[] {
  return entries.flatMap((entry) => [
    entry,
    ...(entry.children ? flattenEntries(entry.children) : []),
  ]);
}

describe("project tree listing limits", () => {
  it("ignores bulky folders by default", async () => {
    await withTempDirectory(async (root) => {
      await mkdir(path.join(root, "release"), { recursive: true });
      await mkdir(path.join(root, "coverage"), { recursive: true });
      await mkdir(path.join(root, "dist-electron"), { recursive: true });
      await writeFile(path.join(root, "release", "bundle.zip"), "large");
      await writeFile(path.join(root, "coverage", "index.html"), "coverage");
      await writeFile(path.join(root, "dist-electron", "main.js"), "built");
      await writeFile(path.join(root, "main.tex"), "\\section{Intro}");

      const entries = await listProject(root);
      expect(entries.map((entry) => entry.name)).toEqual(["main.tex"]);
    });
  });

  it("accepts user-provided ignored names", async () => {
    await withTempDirectory(async (root) => {
      await mkdir(path.join(root, "vendor"), { recursive: true });
      await writeFile(path.join(root, "vendor", "copy.tex"), "ignored");
      await writeFile(path.join(root, "paper.tex"), "shown");

      const entries = await listProject(root, { ignoredNames: ["vendor"] });
      expect(entries.map((entry) => entry.name)).toEqual(["paper.tex"]);
    });
  });

  it("adds a marker when folder depth is capped", async () => {
    await withTempDirectory(async (root) => {
      await mkdir(path.join(root, "chapters", "deep"), { recursive: true });
      await writeFile(path.join(root, "chapters", "deep", "intro.tex"), "text");

      const entries = await listProject(root, { maxDepth: 1 });
      const flattened = flattenEntries(entries);
      expect(flattened.some((entry) => entry.limited)).toBe(true);
      expect(
        flattened.some((entry) => entry.name.includes("Folder depth limited")),
      ).toBe(true);
    });
  });

  it("stops walking when the max entry count is reached", async () => {
    await withTempDirectory(async (root) => {
      for (let index = 0; index < 6; index += 1) {
        await writeFile(path.join(root, `file-${index}.tex`), "text");
      }

      const entries = await listProject(root, { maxEntries: 3 });
      const flattened = flattenEntries(entries);
      expect(flattened.filter((entry) => !entry.limited)).toHaveLength(3);
      expect(
        flattened.some((entry) => entry.name.includes("Project tree limited")),
      ).toBe(true);
    });
  });
});
