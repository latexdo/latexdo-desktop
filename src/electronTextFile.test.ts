import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readSafeTextFile } from "../electron/textFile.js";

async function withTempDirectory(
  callback: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "latexdo-text-file-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("safe editable text file reads", () => {
  it("reads UTF-8 text files", async () => {
    await withTempDirectory(async (root) => {
      const filePath = path.join(root, "main.tex");
      await writeFile(filePath, "\\section{Intro}\n", "utf8");

      await expect(readSafeTextFile(root, filePath, "main.tex")).resolves.toBe(
        "\\section{Intro}\n",
      );
    });
  });

  it("reads safe text files with arbitrary extensions", async () => {
    await withTempDirectory(async (root) => {
      const filePath = path.join(root, "analysis.py");
      await writeFile(filePath, "print('ok')\n", "utf8");

      await expect(readSafeTextFile(root, filePath, "analysis.py")).resolves.toBe(
        "print('ok')\n",
      );
    });
  });

  it("rejects oversized text files before decoding", async () => {
    await withTempDirectory(async (root) => {
      const filePath = path.join(root, "main.tex");
      await writeFile(filePath, "abcde", "utf8");

      await expect(
        readSafeTextFile(root, filePath, "main.tex", { maxBytes: 4 }),
      ).rejects.toThrow("File is too large");
    });
  });

  it("rejects files with null bytes", async () => {
    await withTempDirectory(async (root) => {
      const filePath = path.join(root, "main.tex");
      await writeFile(filePath, Buffer.from([65, 0, 66]));

      await expect(readSafeTextFile(root, filePath, "main.tex")).rejects.toThrow(
        "File appears to be binary",
      );
    });
  });

  it("rejects directories", async () => {
    await withTempDirectory(async (root) => {
      const filePath = path.join(root, "chapter.tex");
      await mkdir(filePath);

      await expect(readSafeTextFile(root, filePath, "chapter.tex")).rejects.toThrow(
        "Only regular text files",
      );
    });
  });

  it("rejects symlinks that resolve outside the project", async () => {
    await withTempDirectory(async (root) => {
      const projectPath = path.join(root, "project");
      await mkdir(projectPath);
      const outsidePath = path.join(root, "outside.tex");
      const linkPath = path.join(projectPath, "link.tex");
      await writeFile(outsidePath, "outside", "utf8");
      await symlink(outsidePath, linkPath);

      await expect(readSafeTextFile(projectPath, linkPath, "link.tex")).rejects.toThrow(
        "outside the open project",
      );
    });
  });
});
