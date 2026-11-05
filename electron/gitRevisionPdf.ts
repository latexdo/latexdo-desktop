import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  GitCommandError,
  GitOutputLimitError,
  getGitRepositoryContext,
  repoPathForProjectPath,
  runGitBuffer,
  type GitRepositoryContext,
} from "./git.js";
import type { CloudCompileFile } from "./compiler.js";
import type { CompileRequest, CompileResult, GitRevisionRef } from "./types.js";

type CompileEngine = CompileRequest["engine"];

/** The largest PDF read from a Git revision for comparison. */
export const maxRevisionPdfBytes = 128 * 1024 * 1024;
/** Limits for a project snapshot written out to compile an old revision. */
export const maxRevisionTreeFiles = 2000;
export const maxRevisionTreeFileBytes = 25 * 1024 * 1024;
export const maxRevisionTreeTotalBytes = 200 * 1024 * 1024;

export type RevisionSnapshotRef = Extract<GitRevisionRef, { kind: "commit" | "index" }>;

export interface RevisionTreeEntry {
  /** Path relative to the open project folder, with forward slashes. */
  relativePath: string;
  objectId: string;
  size: number;
}

export interface RevisionTreeListing {
  entries: RevisionTreeEntry[];
  /** Files left out of the snapshot: links, submodules, or too large. */
  skipped: string[];
}

function stripProjectPrefix(
  context: Pick<GitRepositoryContext, "projectPrefix">,
  repoPath: string,
): string | null {
  if (!context.projectPrefix) return repoPath;
  const prefix = `${context.projectPrefix}/`;
  return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : null;
}

function prefixPathspec(context: GitRepositoryContext): string[] {
  return context.projectPrefix ? ["--", context.projectPrefix] : [];
}

/**
 * Parses `git ls-tree -r -z -l --full-tree` output into project files.
 * Only regular files are kept: symbolic links could point outside the
 * snapshot and submodules have no content in this repository.
 */
export function parseLsTreeOutput(
  context: Pick<GitRepositoryContext, "projectPrefix">,
  output: string,
): RevisionTreeListing {
  const entries: RevisionTreeEntry[] = [];
  const skipped: string[] = [];
  for (const record of output.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    const [mode, type, objectId, rawSize] = record.slice(0, tab).trim().split(/\s+/);
    const repoPath = record.slice(tab + 1);
    const relativePath = stripProjectPrefix(context, repoPath);
    if (relativePath === null || !relativePath) continue;
    if (type !== "blob" || (mode !== "100644" && mode !== "100755")) {
      skipped.push(relativePath);
      continue;
    }
    const size = Number(rawSize);
    if (!Number.isFinite(size) || size > maxRevisionTreeFileBytes) {
      skipped.push(relativePath);
      continue;
    }
    entries.push({ relativePath, objectId, size });
  }
  return { entries, skipped };
}

/** Parses `git ls-files -s -z` (stage 0 only) into project files. */
export function parseLsFilesStageOutput(
  context: Pick<GitRepositoryContext, "projectPrefix">,
  output: string,
): Array<Omit<RevisionTreeEntry, "size"> & { mode: string }> {
  const entries: Array<Omit<RevisionTreeEntry, "size"> & { mode: string }> = [];
  for (const record of output.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    const [mode, objectId, stage] = record.slice(0, tab).trim().split(/\s+/);
    if (stage !== "0") continue;
    const relativePath = stripProjectPrefix(context, record.slice(tab + 1));
    if (!relativePath) continue;
    entries.push({ relativePath, objectId, mode });
  }
  return entries;
}

/**
 * Splits the output of `git cat-file --batch` into object contents, in the
 * order the object ids were requested.
 */
export function parseCatFileBatch(output: Buffer): Map<string, Buffer> {
  const objects = new Map<string, Buffer>();
  let offset = 0;
  while (offset < output.length) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd === -1) break;
    const header = output.subarray(offset, headerEnd).toString("utf8");
    const [objectId, type, rawSize] = header.split(" ");
    if (type === "missing" || rawSize === undefined) {
      offset = headerEnd + 1;
      continue;
    }
    const size = Number(rawSize);
    const start = headerEnd + 1;
    objects.set(objectId, output.subarray(start, start + size));
    // Each object is followed by a newline.
    offset = start + size + 1;
  }
  return objects;
}

async function listRevisionTree(
  context: GitRepositoryContext,
  ref: RevisionSnapshotRef,
): Promise<RevisionTreeListing> {
  if (ref.kind === "commit") {
    const output = await runGitBuffer(context.repositoryRoot, [
      "ls-tree",
      "-r",
      "-z",
      "-l",
      "--full-tree",
      ref.hash,
      ...prefixPathspec(context),
    ]);
    return parseLsTreeOutput(context, output.toString("utf8"));
  }

  const staged = parseLsFilesStageOutput(
    context,
    (
      await runGitBuffer(
        context.repositoryRoot,
        ["ls-files", "-s", "-z", "--full-name", ...prefixPathspec(context)],
        { optionalLocks: false },
      )
    ).toString("utf8"),
  );
  const entries: RevisionTreeEntry[] = [];
  const skipped: string[] = [];
  const regular = staged.filter((entry) => {
    if (entry.mode === "100644" || entry.mode === "100755") return true;
    skipped.push(entry.relativePath);
    return false;
  });
  if (regular.length) {
    const sizes = (
      await runGitBuffer(context.repositoryRoot, ["cat-file", "--batch-check"], {
        input: `${regular.map((entry) => entry.objectId).join("\n")}\n`,
      })
    )
      .toString("utf8")
      .split("\n");
    regular.forEach((entry, index) => {
      const size = Number(sizes[index]?.split(" ")[2]);
      if (!Number.isFinite(size) || size > maxRevisionTreeFileBytes) {
        skipped.push(entry.relativePath);
      } else {
        entries.push({
          relativePath: entry.relativePath,
          objectId: entry.objectId,
          size,
        });
      }
    });
  }
  return { entries, skipped };
}

/**
 * The project's files as they were at a commit or are in the index, ready to
 * be written to a scratch folder and compiled.
 */
export async function readRevisionProjectFiles(
  projectRoot: string,
  ref: RevisionSnapshotRef,
): Promise<{ files: CloudCompileFile[]; skipped: string[] }> {
  const context = await getGitRepositoryContext(projectRoot);
  const listing = await listRevisionTree(context, ref);
  // Build output that was committed by mistake is not needed to compile.
  const entries = listing.entries.filter(
    (entry) => !entry.relativePath.split("/").includes(".latexdo"),
  );
  if (entries.length > maxRevisionTreeFiles) {
    throw new Error(
      `This revision has too many files to compile (limit ${maxRevisionTreeFiles}).`,
    );
  }
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (totalBytes > maxRevisionTreeTotalBytes) {
    throw new Error("This revision is too large to compile.");
  }
  if (!entries.length) {
    return { files: [], skipped: listing.skipped };
  }

  const uniqueIds = [...new Set(entries.map((entry) => entry.objectId))];
  const objects = parseCatFileBatch(
    await runGitBuffer(context.repositoryRoot, ["cat-file", "--batch"], {
      input: `${uniqueIds.join("\n")}\n`,
      // Headers and separators add a little to the content itself.
      maxBytes: totalBytes + uniqueIds.length * 128 + 1024,
    }),
  );
  const files: CloudCompileFile[] = [];
  for (const entry of entries) {
    const bytes = objects.get(entry.objectId);
    if (!bytes) {
      listing.skipped.push(entry.relativePath);
      continue;
    }
    files.push({ relativePath: entry.relativePath, bytes: new Uint8Array(bytes) });
  }
  return { files, skipped: listing.skipped };
}

/**
 * One file's bytes at a revision, or null when the file does not exist there.
 * Used to compare PDFs that are themselves tracked in Git.
 */
export async function readRevisionFileBytes(
  projectRoot: string,
  relativePath: string,
  ref: GitRevisionRef,
  maxBytes = maxRevisionPdfBytes,
): Promise<Uint8Array | null> {
  if (ref.kind === "empty") return null;
  if (ref.kind === "working-tree") {
    const filePath = path.resolve(projectRoot, relativePath);
    const fileStats = await stat(filePath).catch(() => null);
    if (!fileStats?.isFile()) return null;
    if (fileStats.size > maxBytes) {
      throw new Error("This PDF is too large to compare.");
    }
    return new Uint8Array(await readFile(filePath));
  }

  const context = await getGitRepositoryContext(projectRoot);
  const repoPath = repoPathForProjectPath(context, relativePath);
  const spec = ref.kind === "index" ? `:${repoPath}` : `${ref.hash}:${repoPath}`;
  try {
    return new Uint8Array(
      await runGitBuffer(context.repositoryRoot, ["show", spec], { maxBytes }),
    );
  } catch (error) {
    if (error instanceof GitOutputLimitError) {
      throw new Error("This PDF is too large to compare.");
    }
    if (error instanceof GitCommandError) return null;
    throw error;
  }
}

export interface RevisionPdfCompileOptions {
  projectRoot: string;
  rootFile: string;
  ref: RevisionSnapshotRef;
  engine: CompileEngine;
  /** Scratch folder owned by the app (for example inside the temp folder). */
  cacheRoot: string;
  signal?: AbortSignal;
  materialize: (folder: string, files: CloudCompileFile[]) => Promise<void>;
  compile: (
    request: { projectPath: string; rootFile: string; engine: CompileEngine },
    signal?: AbortSignal,
  ) => Promise<CompileResult>;
}

export interface RevisionPdfResult {
  ok: boolean;
  pdf?: Uint8Array;
  output: string;
  error?: string;
  cached: boolean;
  skipped: string[];
}

export function revisionCacheKey(
  projectRoot: string,
  rootFile: string,
  ref: RevisionSnapshotRef,
  engine: CompileEngine,
): { projectKey: string; revisionKey: string } {
  const projectKey = createHash("sha256")
    .update(projectRoot)
    .digest("hex")
    .slice(0, 16);
  const revisionKey = createHash("sha256")
    .update(
      JSON.stringify([ref.kind === "commit" ? ref.hash : "index", rootFile, engine]),
    )
    .digest("hex")
    .slice(0, 24);
  return { projectKey, revisionKey };
}

/**
 * Compiles the project as it was at `ref` in a scratch folder and returns the
 * PDF. Commits never change, so their PDFs are cached; the index is rebuilt
 * every time.
 */
export async function compileRevisionPdf(
  options: RevisionPdfCompileOptions,
): Promise<RevisionPdfResult> {
  const { projectKey, revisionKey } = revisionCacheKey(
    options.projectRoot,
    options.rootFile,
    options.ref,
    options.engine,
  );
  const projectCache = path.join(options.cacheRoot, projectKey);
  const cachedPdf = path.join(projectCache, "pdf", `${revisionKey}.pdf`);
  if (options.ref.kind === "commit") {
    const cached = await readFile(cachedPdf).catch(() => null);
    if (cached) {
      return {
        ok: true,
        pdf: new Uint8Array(cached),
        output: "",
        cached: true,
        skipped: [],
      };
    }
  }

  const { files, skipped } = await readRevisionProjectFiles(
    options.projectRoot,
    options.ref,
  );
  const rootFile = options.rootFile.replaceAll("\\", "/");
  if (!files.some((file) => file.relativePath === rootFile)) {
    return {
      ok: false,
      output: "",
      error: `${rootFile} does not exist in this revision.`,
      cached: false,
      skipped,
    };
  }

  const workFolder = path.join(projectCache, "work", revisionKey);
  try {
    await options.materialize(workFolder, files);
    const result = await options.compile(
      { projectPath: workFolder, rootFile, engine: options.engine },
      options.signal,
    );
    if (!result.ok || !result.pdfPath) {
      return {
        ok: false,
        output: result.output,
        error: result.error ?? "This revision did not compile.",
        cached: false,
        skipped,
      };
    }
    const pdf = await readFile(result.pdfPath);
    if (options.ref.kind === "commit") {
      await mkdir(path.dirname(cachedPdf), { recursive: true });
      await copyFile(result.pdfPath, cachedPdf).catch(() => undefined);
    }
    return {
      ok: true,
      pdf: new Uint8Array(pdf),
      output: result.output,
      cached: false,
      skipped,
    };
  } finally {
    await rm(workFolder, { recursive: true, force: true }).catch(() => undefined);
  }
}
