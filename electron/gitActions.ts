/*
 * Repository operations behind the Source Control view: init, branches,
 * fetch / pull / push / sync, publish, commit options, undo, stash.
 *
 * The set of operations and how they compose follow the Git extension of
 * Visual Studio Code (extensions/git/src/repository.ts, git.ts, commands.ts):
 *
 *   Copyright (c) Microsoft Corporation. All rights reserved.
 *   Licensed under the MIT License.
 *   https://github.com/microsoft/vscode/blob/main/LICENSE.txt
 */

import { getGitRepositoryContext, runGitText } from "./git.js";
import { assertBranchName } from "./gitBranchName.js";

export { assertBranchName };

/** Long enough for a slow push, short enough that a stuck prompt ends. */
const networkTimeoutMs = 120_000;

export interface GitBranchInfo {
  name: string;
  kind: "local" | "remote";
  current: boolean;
  upstream?: string;
  shortHash: string;
  subject: string;
}

export interface GitRepositoryInfo {
  remotes: string[];
  branches: GitBranchInfo[];
  stashCount: number;
  /** Message of HEAD, so Undo Last Commit can put it back in the box. */
  headSubject?: string;
  hasCommits: boolean;
}

export type GitAction =
  | { kind: "init" }
  | { kind: "fetch" }
  | { kind: "pull" }
  | { kind: "push" }
  | { kind: "sync" }
  | { kind: "publish"; remoteUrl?: string }
  | { kind: "checkout"; branch: string }
  | { kind: "create-branch"; branch: string }
  | { kind: "delete-branch"; branch: string }
  | { kind: "commit"; message: string; amend?: boolean; all?: boolean; push?: boolean }
  | { kind: "undo-last-commit" }
  | { kind: "stash"; message?: string }
  | { kind: "stash-pop" }
  | { kind: "branch-at"; branch: string; commit: string }
  | { kind: "tag"; tag: string; commit: string }
  | { kind: "cherry-pick"; commit: string }
  | { kind: "revert"; commit: string }
  | { kind: "checkout-commit"; commit: string };

export interface GitActionResult {
  /** Short line for the status bar. */
  message: string;
  /** For Undo Last Commit: the message to restore into the commit box. */
  commitMessage?: string;
}

async function repo(projectPath: string): Promise<string> {
  return (await getGitRepositoryContext(projectPath)).repositoryRoot;
}

async function currentBranch(root: string): Promise<string> {
  const branch = (
    await runGitText(root, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")
  ).trim();
  if (!branch || branch === "HEAD") {
    throw new Error(
      "You are not on a branch (detached HEAD). Switch to a branch first.",
    );
  }
  return branch;
}

async function remotes(root: string): Promise<string[]> {
  return (await runGitText(root, ["remote"]))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function upstreamOf(root: string): Promise<string | null> {
  const upstream = await runGitText(root, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]).catch(() => "");
  return upstream.trim() || null;
}

/** `git pull`, merging unless the user configured rebase (like VS Code). */
async function pull(root: string): Promise<void> {
  const rebase = (
    await runGitText(root, ["config", "--get", "pull.rebase"]).catch(() => "")
  ).trim();
  await runGitText(root, ["pull", ...(rebase ? [] : ["--no-rebase"]), "--no-edit"], {
    timeoutMs: networkTimeoutMs,
  });
}

/** Pushes the branch, publishing it to the first remote when it has no upstream. */
async function push(root: string): Promise<string> {
  const branch = await currentBranch(root);
  if (await upstreamOf(root)) {
    await runGitText(root, ["push"], { timeoutMs: networkTimeoutMs });
    return `Pushed ${branch}.`;
  }
  const list = await remotes(root);
  const remote = list.includes("origin") ? "origin" : list[0];
  if (!remote) {
    throw new Error(
      "This repository has no remote. Use Publish Branch and enter the repository address.",
    );
  }
  await runGitText(root, ["push", "--set-upstream", remote, branch], {
    timeoutMs: networkTimeoutMs,
  });
  return `Published ${branch} to ${remote}.`;
}

export async function readGitRepositoryInfo(
  projectPath: string,
): Promise<GitRepositoryInfo> {
  const root = await repo(projectPath);
  const separator = "\u001f";
  const refs = await runGitText(root, [
    "for-each-ref",
    `--format=%(refname)${separator}%(refname:short)${separator}%(HEAD)${separator}%(upstream:short)${separator}%(objectname:short)${separator}%(contents:subject)`,
    "--sort=-committerdate",
    "refs/heads",
    "refs/remotes",
  ]);
  const branches: GitBranchInfo[] = [];
  for (const line of refs.split("\n")) {
    if (!line.trim()) continue;
    const [ref, name, head, upstream, shortHash, subject] = line.split(separator);
    if (ref.startsWith("refs/remotes/") && ref.endsWith("/HEAD")) continue;
    branches.push({
      name,
      kind: ref.startsWith("refs/heads/") ? "local" : "remote",
      current: head === "*",
      upstream: upstream || undefined,
      shortHash,
      subject,
    });
  }
  const stashes = await runGitText(root, ["stash", "list"]).catch(() => "");
  const headSubject = (
    await runGitText(root, ["log", "-1", "--format=%B"]).catch(() => "")
  ).trim();
  return {
    remotes: await remotes(root),
    branches,
    stashCount: stashes.split("\n").filter(Boolean).length,
    headSubject: headSubject || undefined,
    hasCommits: Boolean(headSubject),
  };
}

export async function runGitAction(
  projectPath: string,
  action: GitAction,
): Promise<GitActionResult> {
  if (action.kind === "init") {
    await runGitText(projectPath, ["init"]);
    return { message: "Initialized a Git repository." };
  }
  const root = await repo(projectPath);
  switch (action.kind) {
    case "fetch":
      await runGitText(root, ["fetch", "--all", "--prune"], {
        timeoutMs: networkTimeoutMs,
      });
      return { message: "Fetched from all remotes." };
    case "pull":
      await pull(root);
      return { message: "Pulled." };
    case "push":
      return { message: await push(root) };
    case "sync": {
      // VS Code's Sync Changes: pull what is new, then push what is ours.
      if (await upstreamOf(root)) await pull(root);
      return { message: (await push(root)).replace(/^Pushed/, "Synced") };
    }
    case "publish": {
      if (action.remoteUrl) {
        const url = action.remoteUrl.trim();
        if (!/^(?:https?:\/\/|ssh:\/\/|git@|file:\/\/|\/)\S+$/.test(url)) {
          throw new Error(
            "Enter a repository address such as https://github.com/you/paper.git",
          );
        }
        const list = await remotes(root);
        if (list.includes("origin")) {
          await runGitText(root, ["remote", "set-url", "origin", url]);
        } else {
          await runGitText(root, ["remote", "add", "origin", url]);
        }
      }
      return { message: await push(root) };
    }
    case "checkout": {
      const branch = assertBranchName(action.branch);
      const locals = (await runGitText(root, ["branch", "--format=%(refname:short)"]))
        .split("\n")
        .map((line) => line.trim());
      if (locals.includes(branch)) {
        await runGitText(root, ["checkout", branch]);
        return { message: `Switched to ${branch}.` };
      }
      // A remote branch such as origin/draft: track it in a local branch.
      const local = branch.replace(/^[^/]+\//, "");
      if (locals.includes(local)) {
        await runGitText(root, ["checkout", local]);
        return { message: `Switched to ${local}.` };
      }
      await runGitText(root, ["checkout", "--track", branch]);
      return { message: `Switched to ${local}, tracking ${branch}.` };
    }
    case "create-branch": {
      const branch = assertBranchName(action.branch);
      await runGitText(root, ["checkout", "-b", branch]);
      return { message: `Created and switched to ${branch}.` };
    }
    case "delete-branch": {
      const branch = assertBranchName(action.branch);
      await runGitText(root, ["branch", "-d", branch]);
      return { message: `Deleted ${branch}.` };
    }
    case "commit": {
      const message = action.message.trim();
      if (!message && !action.amend) throw new Error("Enter a commit message.");
      if (action.all) {
        const context = await getGitRepositoryContext(projectPath);
        await runGitText(root, ["add", "--all", "--", context.projectPrefix || "."]);
      }
      await runGitText(root, [
        "commit",
        ...(action.amend ? ["--amend"] : []),
        ...(message ? ["-m", message] : ["--no-edit"]),
      ]);
      const done = action.amend ? "Amended the last commit." : "Committed.";
      if (!action.push) return { message: done };
      return { message: `${done} ${await push(root)}` };
    }
    case "undo-last-commit": {
      const body = (await runGitText(root, ["log", "-1", "--format=%B"])).trim();
      const hasParent = await runGitText(root, ["rev-parse", "--verify", "HEAD~1"])
        .then(() => true)
        .catch(() => false);
      if (hasParent) {
        await runGitText(root, ["reset", "--soft", "HEAD~1"]);
      } else {
        // The first commit: remove it but keep its files staged.
        await runGitText(root, ["update-ref", "-d", "HEAD"]);
      }
      return {
        message: "Undid the last commit; its changes are staged.",
        commitMessage: body,
      };
    }
    case "stash":
      if (!(await runGitText(root, ["status", "--porcelain"])).trim()) {
        throw new Error("There are no changes to stash.");
      }
      await runGitText(root, [
        "stash",
        "push",
        "--include-untracked",
        ...(action.message?.trim() ? ["-m", action.message.trim()] : []),
      ]);
      return { message: "Stashed your changes." };
    case "stash-pop":
      await runGitText(root, ["stash", "pop"]);
      return { message: "Restored the latest stash." };
    case "branch-at": {
      const branch = assertBranchName(action.branch);
      await runGitText(root, ["branch", branch, assertCommit(action.commit)]);
      return { message: `Created ${branch} at ${action.commit.slice(0, 7)}.` };
    }
    case "tag": {
      const tag = assertBranchName(action.tag);
      await runGitText(root, ["tag", tag, assertCommit(action.commit)]);
      return { message: `Tagged ${action.commit.slice(0, 7)} as ${tag}.` };
    }
    case "cherry-pick":
      await runGitText(root, ["cherry-pick", assertCommit(action.commit)]);
      return { message: `Applied ${action.commit.slice(0, 7)} on this branch.` };
    case "revert":
      await runGitText(root, ["revert", "--no-edit", assertCommit(action.commit)]);
      return { message: `Reverted ${action.commit.slice(0, 7)} in a new commit.` };
    case "checkout-commit":
      await runGitText(root, ["checkout", "--detach", assertCommit(action.commit)]);
      return {
        message: `Checked out ${action.commit.slice(0, 7)} (detached HEAD). Switch to a branch to keep working.`,
      };
  }
}

/** A full or abbreviated commit hash; never an option or a range. */
export function assertCommit(value: string): string {
  if (!/^[0-9a-f]{7,64}$/i.test(value)) throw new Error("Invalid commit.");
  return value;
}

/**
 * The diff a commit message is written from: what is staged, or every change
 * when nothing is staged yet (the commit would then stage everything).
 */
export async function readDiffForCommitMessage(projectPath: string): Promise<string> {
  const context = await getGitRepositoryContext(projectPath);
  const scope = context.projectPrefix || ".";
  const staged = await runGitText(context.repositoryRoot, [
    "diff",
    "--cached",
    "--stat",
    "--patch",
    "--",
    scope,
  ]);
  if (staged.trim()) return staged;
  const tracked = await runGitText(context.repositoryRoot, [
    "diff",
    "--stat",
    "--patch",
    "--",
    scope,
  ]);
  const untracked = await runGitText(context.repositoryRoot, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    scope,
  ]);
  const added = untracked
    .split("\n")
    .filter(Boolean)
    .map((file) => `new file: ${file}`)
    .join("\n");
  return [tracked, added].filter((part) => part.trim()).join("\n");
}

/** Validates an action that came over IPC. */
export function parseGitAction(value: unknown): GitAction {
  if (!value || typeof value !== "object") throw new Error("Invalid Git action.");
  const raw = value as Record<string, unknown>;
  const text = (key: string, max = 10_000): string | undefined => {
    const field = raw[key];
    if (field === undefined) return undefined;
    if (typeof field !== "string" || field.length > max) {
      throw new Error(`Invalid Git action field: ${key}`);
    }
    return field;
  };
  const flag = (key: string) => raw[key] === true;
  switch (raw.kind) {
    case "init":
    case "fetch":
    case "pull":
    case "push":
    case "sync":
    case "undo-last-commit":
    case "stash-pop":
      return { kind: raw.kind };
    case "publish":
      return { kind: "publish", remoteUrl: text("remoteUrl", 2048) };
    case "checkout":
    case "create-branch":
    case "delete-branch":
      return { kind: raw.kind, branch: assertBranchName(text("branch", 250) ?? "") };
    case "commit":
      return {
        kind: "commit",
        message: text("message") ?? "",
        amend: flag("amend"),
        all: flag("all"),
        push: flag("push"),
      };
    case "stash":
      return { kind: "stash", message: text("message", 500) };
    case "branch-at":
      return {
        kind: "branch-at",
        branch: assertBranchName(text("branch", 250) ?? ""),
        commit: assertCommit(text("commit", 64) ?? ""),
      };
    case "tag":
      return {
        kind: "tag",
        tag: assertBranchName(text("tag", 250) ?? ""),
        commit: assertCommit(text("commit", 64) ?? ""),
      };
    case "cherry-pick":
    case "revert":
    case "checkout-commit":
      return { kind: raw.kind, commit: assertCommit(text("commit", 64) ?? "") };
    default:
      throw new Error("Unknown Git action.");
  }
}
