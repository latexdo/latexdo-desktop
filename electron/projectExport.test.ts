// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportFolderName, writeExportedProject } from "./projectExport.js";

const file = (relativePath: string, text = relativePath) => ({
  relativePath,
  bytes: Buffer.from(text),
});

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "latexdo-export-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("exportFolderName", () => {
  it("keeps the project's name, made safe on every system", () => {
    expect(exportFolderName("My Thesis")).toBe("My Thesis");
    expect(exportFolderName('Paper: "draft" 2/3?')).toBe("Paper draft 2 3");
    expect(exportFolderName("  ..hidden. ")).toBe("hidden");
    expect(exportFolderName("CON")).toBe("LatexDo project");
    expect(exportFolderName("")).toBe("LatexDo project");
    expect(exportFolderName(undefined)).toBe("LatexDo project");
    expect(exportFolderName("x".repeat(200))).toHaveLength(80);
  });
});

describe("writeExportedProject", () => {
  it("writes every file, folders included, into a new folder", async () => {
    const target = path.join(root, "Thesis");
    const result = await writeExportedProject(target, [
      file("main.tex", "\\documentclass{article}"),
      file("chapters/intro.tex"),
      { relativePath: "figures/plot.png", bytes: Buffer.from([0, 255, 1]) },
    ]);
    expect(result).toEqual({ folder: target, written: 3, skipped: [] });
    expect(await readFile(path.join(target, "main.tex"), "utf8")).toBe(
      "\\documentclass{article}",
    );
    expect(await readFile(path.join(target, "chapters/intro.tex"), "utf8")).toBe(
      "chapters/intro.tex",
    );
    expect([...(await readFile(path.join(target, "figures/plot.png")))]).toEqual([
      0, 255, 1,
    ]);
    // No temporary files are left behind.
    expect((await readdir(target)).sort()).toEqual(["chapters", "figures", "main.tex"]);
  });

  it("leaves out paths that could escape the folder or clash", async () => {
    const target = path.join(root, "Copy");
    const result = await writeExportedProject(target, [
      file("../outside.tex"),
      file("a/../../outside.tex"),
      file(".git/config"),
      file("node_modules/x.js"),
      file("/absolute.tex"),
      file("main.tex", "first"),
      file("MAIN.tex", "second"),
      file("figure"),
      file("figure/inside.png"),
    ]);
    expect(result.written).toBe(2);
    expect(result.skipped).toEqual([
      "../outside.tex",
      "a/../../outside.tex",
      ".git/config",
      "node_modules/x.js",
      "/absolute.tex",
      "MAIN.tex",
      "figure/inside.png",
    ]);
    expect(await readFile(path.join(target, "main.tex"), "utf8")).toBe("first");
    expect(await readdir(root)).toEqual(["Copy"]);
  });

  it("uses an empty folder that already exists", async () => {
    const target = path.join(root, "Empty");
    await mkdir(target);
    expect((await writeExportedProject(target, [file("a.tex")])).written).toBe(1);
  });

  it("never writes into a folder that has files, or over a file", async () => {
    const full = path.join(root, "Full");
    await mkdir(full);
    await writeFile(path.join(full, "keep.tex"), "mine");
    await expect(
      writeExportedProject(full, [file("keep.tex", "theirs")]),
    ).rejects.toThrow("already has files in it");
    expect(await readFile(path.join(full, "keep.tex"), "utf8")).toBe("mine");

    const existingFile = path.join(root, "notes.txt");
    await writeFile(existingFile, "notes");
    await expect(writeExportedProject(existingFile, [file("a.tex")])).rejects.toThrow(
      "already exists",
    );
  });
});
