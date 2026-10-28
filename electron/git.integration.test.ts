// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  getGitRepositoryContext,
  GitCommandError,
  GitOutputLimitError,
  readCommitDiffSession,
  readGitBlame,
  readGitDiffPreview,
  readGitPatch,
  readStructuredGitCommitDetails,
  readStructuredGitHistory,
  readStructuredGitStatus,
  readWorkingTreeDiffSession,
  repoPathForProjectPath,
  runGitBuffer,
  runGitText,
} from "./git.js";
let root: string;
const git = (...args: string[]) => runGitText(root, args);
async function commit(message: string) {
  await git("add", "--all");
  await git("commit", "-m", message);
  return (await git("rev-parse", "HEAD")).trim();
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "latexdo-git-integration-"));
  await git("init", "--initial-branch=main");
  await git("config", "user.name", "Test Author");
  await git("config", "user.email", "tests@example.invalid");
  await git("config", "commit.gpgsign", "false");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe("real repository history and revisions", () => {
  it("distinguishes HEAD, index and unsaved working-tree changes", async () => {
    await writeFile(path.join(root, "main.tex"), "first\n");
    const first = await commit("Initial paper");
    await writeFile(path.join(root, "main.tex"), "staged\n");
    await git("add", "main.tex");
    await writeFile(path.join(root, "main.tex"), "working\n");
    expect(await readWorkingTreeDiffSession(root, "main.tex", "staged")).toMatchObject({
      originalContent: "first\n",
      modifiedContent: "staged\n",
      originalRef: { kind: "commit", hash: first },
      modifiedRef: { kind: "index" },
      language: "latex",
      modifiedAuthor: "Test Author",
    });
    expect(await readWorkingTreeDiffSession(root, "main.tex")).toMatchObject({
      originalContent: "staged\n",
      modifiedContent: "working\n",
      modifiedRef: { kind: "working-tree" },
    });
    expect(await readGitDiffPreview(root, "main.tex")).toContain("+working");
    const stagedPatch = await readGitPatch(root, "main.tex", "staged");
    expect(stagedPatch).toContain("+staged");
    expect(stagedPatch).not.toContain("+working");
    const workingPatch = await readGitPatch(root, "main.tex", "changes");
    expect(workingPatch).toContain("-staged");
    expect(workingPatch).toContain("+working");
    await writeFile(path.join(root, "changes.patch"), workingPatch);
    await git("apply", "--check", "--reverse", "changes.patch");
    const details = await readStructuredGitCommitDetails(root, first);
    expect(details).toMatchObject({
      hash: first,
      summary: "Initial paper",
      parents: [],
    });
    expect(details.changedFiles).toEqual([
      expect.objectContaining({ path: "main.tex", status: "added" }),
    ]);
    expect(await readCommitDiffSession(root, "main.tex", first)).toMatchObject({
      originalContent: "",
      modifiedContent: "first\n",
      status: "added",
      originalRef: { kind: "empty" },
    });
    expect(
      await readGitBlame(root, "main.tex", { kind: "commit", hash: first }),
    ).toEqual([
      expect.objectContaining({ hash: first, author: "Test Author", line: 1 }),
    ]);
    expect(await readGitBlame(root, "main.tex", { kind: "working-tree" })).toEqual([
      expect.objectContaining({ hash: "0".repeat(40), line: 1 }),
    ]);
    expect(await readGitBlame(root, "main.tex", { kind: "empty" })).toEqual([]);
  });
  it("preserves rename history and validates parent selection", async () => {
    await writeFile(path.join(root, "old.tex"), "one\ntwo\nthree\n");
    const first = await commit("First");
    await rename(path.join(root, "old.tex"), path.join(root, "new.tex"));
    const second = await commit("Rename paper");
    const diff = await readCommitDiffSession(root, "old.tex", second, first);
    expect(diff).toMatchObject({
      relativePath: "new.tex",
      oldPath: "old.tex",
      status: "renamed",
      originalContent: "one\ntwo\nthree\n",
      modifiedContent: "one\ntwo\nthree\n",
    });
    await expect(
      readCommitDiffSession(root, "new.tex", second, second),
    ).rejects.toThrow("not a parent");
    const history = await readStructuredGitHistory(root, "new.tex");
    expect(history).toMatchObject({ scope: "file", target: "new.tex" });
    expect(history.commits.map((c) => c.subject)).toEqual(["Rename paper", "First"]);
    await rm(path.join(root, "new.tex"));
    const third = await commit("Delete");
    expect(await readCommitDiffSession(root, "new.tex", third)).toMatchObject({
      status: "deleted",
      modifiedContent: "",
      originalContent: "one\ntwo\nthree\n",
    });
  });
  it("keeps nested project paths scoped while showing repository refs and merge graph", async () => {
    const nested = path.join(root, "paper");
    await mkdir(nested);
    await writeFile(path.join(nested, "main.tex"), "paper");
    await writeFile(path.join(root, "outside.txt"), "outside");
    await commit("Base");
    await git("tag", "v1");
    await git("checkout", "-b", "feature");
    await writeFile(path.join(root, "feature.txt"), "feature");
    await commit("Feature");
    await git("checkout", "main");
    await writeFile(path.join(root, "main-only.txt"), "main");
    await commit("Main");
    await git("merge", "--no-ff", "feature", "-m", "Merge feature");
    const context = await getGitRepositoryContext(nested);
    expect(repoPathForProjectPath(context, "main.tex")).toBe("paper/main.tex");
    await writeFile(path.join(nested, "main.tex"), "changed");
    await writeFile(path.join(root, "outside.txt"), "also changed");
    expect((await readStructuredGitStatus(nested)).entries.map((e) => e.path)).toEqual([
      "main.tex",
    ]);
    const history = await readStructuredGitHistory(root);
    expect(history.commits[0].parents).toHaveLength(2);
    expect(history.commits).toHaveLength(4);
    expect(history.commits.some((c) => c.refs.some((r) => r.name === "v1"))).toBe(true);
  });
  it("supports staged additions before the first commit and deleted index entries", async () => {
    await writeFile(path.join(root, "new.md"), "new");
    await git("add", "new.md");
    expect(await readWorkingTreeDiffSession(root, "new.md", "staged")).toMatchObject({
      status: "added",
      originalContent: "",
      modifiedContent: "new",
      originalRef: { kind: "empty" },
    });
    expect(await readGitBlame(root, "new.md", { kind: "index" })).toEqual([]);
    await commit("First");
    await git("rm", "new.md");
    expect(await readWorkingTreeDiffSession(root, "new.md", "staged")).toMatchObject({
      status: "deleted",
      originalContent: "new",
      modifiedContent: "",
    });
  });
  it.each([
    ["bib", "bibtex"],
    ["ts", "typescript"],
    ["js", "javascript"],
    ["json", "json"],
    ["md", "markdown"],
    ["css", "css"],
    ["html", "html"],
    ["xml", "xml"],
    ["yaml", "yaml"],
    ["py", "python"],
    ["sh", "shell"],
    ["txt", "plaintext"],
  ])("opens an untracked .%s file using %s syntax", async (extension, language) => {
    const name = `new.${extension}`;
    await writeFile(path.join(root, name), "new content");
    expect(await readWorkingTreeDiffSession(root, name)).toMatchObject({
      originalRef: { kind: "empty" },
      status: "added",
      originalContent: "",
      modifiedContent: "new content",
      language,
    });
  });
  it("limits binary and oversized revisions without exposing broken editor text", async () => {
    for (const [name, data] of [
      ["binary.bin", Buffer.from([0, 1, 2])],
      ["invalid.txt", Buffer.from([255, 254])],
      ["large.txt", Buffer.alloc(5 * 1024 * 1024 + 1, 65)],
    ] as const) {
      await writeFile(path.join(root, name), data);
      const session = await readWorkingTreeDiffSession(root, name);
      expect(session.modifiedContent).toBe("");
      expect(session.message).toContain(name === "large.txt" ? "too large" : "Binary");
    }
    await expect(
      runGitBuffer(root, ["hash-object", "--stdin"], { input: "hello", maxBytes: 1 }),
    ).rejects.toBeInstanceOf(GitOutputLimitError);
    await expect(git("not-a-real-command")).rejects.toBeInstanceOf(GitCommandError);
  });
  it("waits for a repository lock to clear instead of failing", async () => {
    await writeFile(path.join(root, "main.tex"), "first\n");
    const lock = path.join(root, ".git", "index.lock");
    await writeFile(lock, "");
    setTimeout(() => void rm(lock, { force: true }), 120);
    await git("add", "main.tex");
    expect((await readStructuredGitStatus(root)).entries).toHaveLength(1);
  });
  it("explains a commit with nothing staged in plain words", async () => {
    await writeFile(path.join(root, "main.tex"), "first\n");
    await commit("Initial paper");
    await expect(git("commit", "-m", "Empty")).rejects.toMatchObject({
      gitErrorCode: "NothingToCommit",
      message: "There is nothing staged to commit. Stage your changes first.",
    });
  });
  it("handles folders without repositories and missing revisions", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "latexdo-nongit-"));
    try {
      expect(await readStructuredGitStatus(outside)).toMatchObject({
        isRepo: false,
        entries: [],
      });
      expect((await readStructuredGitHistory(outside)).commits).toEqual([]);
      expect(await readGitBlame(outside, "main.tex", { kind: "working-tree" })).toEqual(
        [],
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
    expect(await readGitBlame(root, "absent.tex", { kind: "working-tree" })).toEqual(
      [],
    );
  });
});
