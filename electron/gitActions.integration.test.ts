// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runGitText } from "./git.js";
import {
  assertBranchName,
  parseGitAction,
  readDiffForCommitMessage,
  readGitRepositoryInfo,
  runGitAction,
} from "./gitActions.js";
import { readStructuredGitHistory } from "./git.js";

let base: string;
let work: string;
let remote: string;
const git = (cwd: string, ...args: string[]) => runGitText(cwd, args);

async function configure(cwd: string) {
  await git(cwd, "config", "user.name", "Test Author");
  await git(cwd, "config", "user.email", "tests@example.invalid");
  await git(cwd, "config", "commit.gpgsign", "false");
}

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "latexdo-git-actions-"));
  work = path.join(base, "paper");
  remote = path.join(base, "remote.git");
  await git(base, "init", "--bare", "--initial-branch=main", remote);
  await git(base, "init", "--initial-branch=main", work);
  await configure(work);
  await writeFile(path.join(work, "main.tex"), "first\n");
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("Source Control operations", () => {
  it("commits everything with smart commit, then undoes it back to staged", async () => {
    const committed = await runGitAction(work, {
      kind: "commit",
      message: "First draft",
      all: true,
    });
    expect(committed.message).toBe("Committed.");
    expect((await git(work, "log", "--format=%s")).trim()).toBe("First draft");

    await writeFile(path.join(work, "main.tex"), "second\n");
    await runGitAction(work, { kind: "commit", message: "Second", all: true });
    const undone = await runGitAction(work, { kind: "undo-last-commit" });
    expect(undone.commitMessage).toBe("Second");
    expect((await git(work, "log", "--format=%s")).trim()).toBe("First draft");
    expect(await git(work, "diff", "--cached", "--name-only")).toContain("main.tex");
  });

  it("amends the last commit, keeping its message when the box is empty", async () => {
    await runGitAction(work, { kind: "commit", message: "Draft", all: true });
    await writeFile(path.join(work, "notes.tex"), "notes\n");
    await runGitAction(work, { kind: "commit", message: "", all: true, amend: true });
    expect((await git(work, "log", "--format=%s")).trim()).toBe("Draft");
    expect(await git(work, "show", "--name-only", "--format=")).toContain("notes.tex");
  });

  it("publishes to a new remote, then pushes, pulls and syncs", async () => {
    await runGitAction(work, { kind: "commit", message: "Draft", all: true });
    const published = await runGitAction(work, { kind: "publish", remoteUrl: remote });
    expect(published.message).toBe("Published main to origin.");
    expect((await git(remote, "log", "--format=%s", "main")).trim()).toBe("Draft");

    // A co-author pushes a commit.
    const other = path.join(base, "other");
    await git(base, "clone", remote, other);
    await configure(other);
    await writeFile(path.join(other, "intro.tex"), "intro\n");
    await git(other, "add", "--all");
    await git(other, "commit", "-m", "Intro");
    await git(other, "push");

    // Our own new commit, then Sync: pull theirs, push ours.
    await writeFile(path.join(work, "main.tex"), "edited\n");
    await runGitAction(work, { kind: "commit", message: "Edit", all: true });
    const synced = await runGitAction(work, { kind: "sync" });
    expect(synced.message).toBe("Synced main.");
    expect(await readFile(path.join(work, "intro.tex"), "utf8")).toBe("intro\n");
    const remoteLog = await git(remote, "log", "--format=%s", "main");
    expect(remoteLog).toContain("Edit");
    expect(remoteLog).toContain("Intro");
  });

  it("explains a push the remote rejects", async () => {
    await runGitAction(work, { kind: "commit", message: "Draft", all: true });
    await runGitAction(work, { kind: "publish", remoteUrl: remote });
    const other = path.join(base, "other");
    await git(base, "clone", remote, other);
    await configure(other);
    await writeFile(path.join(other, "x.tex"), "x\n");
    await git(other, "add", "--all");
    await git(other, "commit", "-m", "Theirs");
    await git(other, "push");
    await writeFile(path.join(work, "y.tex"), "y\n");
    await runGitAction(work, { kind: "commit", message: "Ours", all: true });
    await expect(runGitAction(work, { kind: "push" })).rejects.toThrow(/Pull first/);
  });

  it("asks for a remote before pushing a repository without one", async () => {
    await runGitAction(work, { kind: "commit", message: "Draft", all: true });
    await expect(runGitAction(work, { kind: "push" })).rejects.toThrow(/no remote/);
  });

  it("creates, lists, switches and deletes branches", async () => {
    await runGitAction(work, { kind: "commit", message: "Draft", all: true });
    await runGitAction(work, { kind: "create-branch", branch: "revision-1" });
    let info = await readGitRepositoryInfo(work);
    expect(info.branches.find((branch) => branch.current)?.name).toBe("revision-1");
    await runGitAction(work, { kind: "checkout", branch: "main" });
    await runGitAction(work, { kind: "delete-branch", branch: "revision-1" });
    info = await readGitRepositoryInfo(work);
    expect(info.branches.map((branch) => branch.name)).toEqual(["main"]);
    expect(info.hasCommits).toBe(true);
  });

  it("refuses to delete the current or an unmerged branch (#246)", async () => {
    await runGitAction(work, { kind: "commit", message: "Draft", all: true });
    await expect(
      runGitAction(work, { kind: "delete-branch", branch: "main" }),
    ).rejects.toThrow();
    await runGitAction(work, { kind: "create-branch", branch: "unfinished" });
    await writeFile(path.join(work, "main.tex"), "unmerged work\n");
    await runGitAction(work, { kind: "commit", message: "Unfinished", all: true });
    await runGitAction(work, { kind: "checkout", branch: "main" });
    await expect(
      runGitAction(work, { kind: "delete-branch", branch: "unfinished" }),
    ).rejects.toThrow();
    expect(
      (await readGitRepositoryInfo(work)).branches.map((branch) => branch.name),
    ).toContain("unfinished");
  });

  it("tracks a remote branch on checkout", async () => {
    await runGitAction(work, { kind: "commit", message: "Draft", all: true });
    await runGitAction(work, { kind: "create-branch", branch: "camera-ready" });
    await runGitAction(work, { kind: "publish", remoteUrl: remote });
    await runGitAction(work, { kind: "checkout", branch: "main" });
    await git(work, "branch", "-D", "camera-ready");
    await runGitAction(work, { kind: "fetch" });
    const result = await runGitAction(work, {
      kind: "checkout",
      branch: "origin/camera-ready",
    });
    expect(result.message).toContain("tracking origin/camera-ready");
  });

  it("stashes and restores changes, untracked files included", async () => {
    await runGitAction(work, { kind: "commit", message: "Draft", all: true });
    await writeFile(path.join(work, "new.tex"), "new\n");
    await runGitAction(work, { kind: "stash" });
    expect((await readGitRepositoryInfo(work)).stashCount).toBe(1);
    await expect(runGitAction(work, { kind: "stash" })).rejects.toThrow(/no changes/);
    await runGitAction(work, { kind: "stash-pop" });
    expect(await readFile(path.join(work, "new.tex"), "utf8")).toBe("new\n");
  });

  it("initializes a repository", async () => {
    const fresh = path.join(base, "fresh");
    await git(base, "init", "--bare", fresh + "-unused.git");
    await import("node:fs/promises").then((fs) => fs.mkdir(fresh));
    const result = await runGitAction(fresh, { kind: "init" });
    expect(result.message).toContain("Initialized");
    expect((await git(fresh, "rev-parse", "--is-inside-work-tree")).trim()).toBe(
      "true",
    );
  });
});

describe("Graph and commit actions", () => {
  async function threeCommits() {
    for (const name of ["one", "two", "three"]) {
      await writeFile(path.join(work, `${name}.tex`), `${name}\n`);
      await runGitAction(work, { kind: "commit", message: name, all: true });
    }
    return (await git(work, "log", "--format=%H")).trim().split("\n");
  }

  it("pages the graph and follows one branch", async () => {
    const [three, two] = await threeCommits();
    const page = await readStructuredGitHistory(work, undefined, { limit: 2 });
    expect(page.commits.map((commit) => commit.hash)).toEqual([three, two]);
    await runGitAction(work, { kind: "branch-at", branch: "older", commit: two });
    const older = await readStructuredGitHistory(work, undefined, { refs: "older" });
    expect(older.commits[0].hash).toBe(two);
    const auto = await readStructuredGitHistory(work, undefined, { refs: "auto" });
    expect(auto.commits[0].hash).toBe(three);
  });

  it("tags, reverts, cherry-picks and checks out a commit", async () => {
    const [three, two] = await threeCommits();
    await runGitAction(work, { kind: "tag", tag: "v1", commit: two });
    expect((await git(work, "rev-parse", "v1")).trim()).toBe(two);

    await runGitAction(work, { kind: "revert", commit: three });
    await expect(readFile(path.join(work, "three.tex"), "utf8")).rejects.toThrow();

    await runGitAction(work, { kind: "branch-at", branch: "side", commit: two });
    await runGitAction(work, { kind: "checkout", branch: "side" });
    await runGitAction(work, { kind: "cherry-pick", commit: three });
    expect(await readFile(path.join(work, "three.tex"), "utf8")).toBe("three\n");

    const result = await runGitAction(work, { kind: "checkout-commit", commit: two });
    expect(result.message).toContain("detached");
    expect((await git(work, "rev-parse", "HEAD")).trim()).toBe(two);
  });

  it("describes staged changes, or all changes when nothing is staged", async () => {
    await threeCommits();
    await writeFile(path.join(work, "one.tex"), "changed\n");
    await writeFile(path.join(work, "new.tex"), "new\n");
    const all = await readDiffForCommitMessage(work);
    expect(all).toContain("one.tex");
    expect(all).toContain("new file: new.tex");
    await git(work, "add", "new.tex");
    const staged = await readDiffForCommitMessage(work);
    expect(staged).toContain("new.tex");
    expect(staged).not.toContain("one.tex");
  });

  it("rejects commit values that are not hashes", () => {
    expect(() => parseGitAction({ kind: "revert", commit: "--hard" })).toThrow();
    expect(() =>
      parseGitAction({ kind: "tag", tag: "v1", commit: "HEAD~1" }),
    ).toThrow();
  });
});

describe("action validation", () => {
  it("rejects branch names Git would read as options or that are invalid", () => {
    for (const bad of ["-x", "a..b", "with space", "a~1", "", "end.", "x@{y}"]) {
      expect(() => assertBranchName(bad)).toThrow();
    }
    expect(assertBranchName("feature/figures")).toBe("feature/figures");
  });

  it("parses only known actions and fields", () => {
    expect(parseGitAction({ kind: "commit", message: "m", amend: true })).toEqual({
      kind: "commit",
      message: "m",
      amend: true,
      all: false,
      push: false,
    });
    expect(() => parseGitAction({ kind: "rm -rf" })).toThrow();
    expect(() => parseGitAction({ kind: "checkout", branch: "--orphan" })).toThrow();
  });
});
