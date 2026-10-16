import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

// Check each existing component, including dangling links, before allowing
// reads or creation of a missing tail. Never treat permission errors as absence.
export async function assertProjectPath(
  projectPath: string,
  targetPath: string,
): Promise<void> {
  const root = path.resolve(projectPath);
  const target = path.resolve(targetPath);
  const canonicalRoot = await realpath(root);
  const rejected = () =>
    new Error(
      "The requested path escapes the open project via a symbolic link or traversal.",
    );
  if (!isPathInside(root, target)) throw rejected();
  let current = root;
  for (const component of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    // realpath deliberately fails closed for broken links and link loops.
    if (!isPathInside(canonicalRoot, await realpath(current))) throw rejected();
  }
}
