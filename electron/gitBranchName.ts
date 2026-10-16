// Branch name rules Git enforces (git check-ref-format), checked before a name
// reaches Git so it can never be read as an option. Shared with the renderer.

const branchNamePattern =
  /^(?!-)(?!.*\.\.)(?!.*[\s~^:?*[\\])(?!.*@\{)(?!.*\.lock$)[^\0]+(?<![./])$/;

/** Why `name` is not a usable branch name, or null when it is. */
export function branchNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Please provide a branch name.";
  if (trimmed.length > 250 || !branchNamePattern.test(trimmed)) {
    return `"${trimmed}" is not a valid branch name. Use letters, digits, "-", "_", "." and "/".`;
  }
  return null;
}

/** Throws unless `name` is a branch name Git accepts. */
export function assertBranchName(name: string): string {
  const problem = branchNameProblem(name);
  if (problem) throw new Error(problem);
  return name.trim();
}
