// Compile-trust guards (P0 #4).
//
// External compilers (latexmk, asymptote) are spawned with a working directory
// of the open project. Lexical containment checks are not enough: a directory
// symlink, file symlink, or Windows junction inside the project can silently
// point outside it, so a hostile project could trick the compiler into
// reading/writing files anywhere on the machine. These routines re-verify
// containment using canonical (realpath) locations before a compiler runs.

import { realpath } from "node:fs/promises";
import { assertProjectPath } from "./projectPaths.js";

/**
 * Verify containment, including existing symlinks and missing output paths.
 * The compiler reports missing input files; dangling links fail closed.
 */
export async function assertCanonicalCompileInside(
  projectPath: string,
  targetPath: string,
): Promise<void> {
  await assertProjectPath(projectPath, targetPath);
}

/** Convenience wrapper: assert containment and return the target path. */
export async function canonicalCompileTarget(
  projectPath: string,
  targetPath: string,
): Promise<string> {
  await assertCanonicalCompileInside(projectPath, targetPath);
  return await realpath(targetPath).catch(() => targetPath);
}
