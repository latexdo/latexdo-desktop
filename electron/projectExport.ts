/*
 * Export a shared (cloud) project: write every file of its shared copy into a
 * new folder the person chose, so they keep a local copy they own (with Git,
 * the desktop TeX engine, and no server needed). Owners and guests alike.
 */
import { lstat, mkdir, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeRelativeSegments, type FolderFile } from "./peerCollab.js";

/** Characters no folder name may contain on any of the three systems. */
const unsafeNameCharacters = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const reservedWindowsNames = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** A folder name for the project: its name, made safe everywhere. */
export function exportFolderName(projectName: string | null | undefined): string {
  const cleaned = (projectName ?? "")
    .replace(unsafeNameCharacters, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .slice(0, 80)
    .trim();
  if (!cleaned || reservedWindowsNames.test(cleaned)) return "LatexDo project";
  return cleaned;
}

export interface ExportedProject {
  folder: string;
  written: number;
  /** Paths left out because they could not be written safely. */
  skipped: string[];
}

/**
 * Writes the files into `targetRoot`, which must be new or an empty folder:
 * an export never mixes with, or replaces, files that are already there.
 * Paths are checked like the shared copy's own write-back (no "..", no .git,
 * no links followed).
 */
export async function writeExportedProject(
  targetRoot: string,
  files: FolderFile[],
): Promise<ExportedProject> {
  const existing = await lstat(targetRoot).catch(() => null);
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error(
        `${path.basename(targetRoot)} already exists. Choose a new folder name.`,
      );
    }
    if ((await readdir(targetRoot)).length > 0) {
      throw new Error(
        `${path.basename(targetRoot)} already has files in it. Choose a new folder name.`,
      );
    }
  } else {
    await mkdir(targetRoot, { recursive: true });
  }

  let written = 0;
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const key = file.relativePath.toLowerCase();
    if (!safeRelativeSegments(file.relativePath) || seen.has(key)) {
      skipped.push(file.relativePath);
      continue;
    }
    seen.add(key);
    const segments = file.relativePath.split("/");
    const targetPath = path.join(targetRoot, ...segments);
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      // A path the export itself already made a folder of (or the reverse).
      if (await lstat(targetPath).catch(() => null)) {
        skipped.push(file.relativePath);
        continue;
      }
      const temporaryPath = `${targetPath}.${process.pid}.latexdo-tmp`;
      await writeFile(temporaryPath, file.bytes, { flag: "wx" });
      await rename(temporaryPath, targetPath);
      written += 1;
    } catch {
      skipped.push(file.relativePath);
    }
  }
  return { folder: targetRoot, written, skipped };
}
