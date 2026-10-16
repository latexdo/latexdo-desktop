/*
 * Git error recognition and the lock retry policy are adapted from the Git
 * extension of Visual Studio Code (extensions/git/src/git.ts, repository.ts):
 *
 *   Copyright (c) Microsoft Corporation. All rights reserved.
 *   Licensed under the MIT License.
 *   https://github.com/microsoft/vscode/blob/main/LICENSE.txt
 *
 * The user-facing messages and the Git-not-installed handling are LatexDo's.
 */

export type GitErrorCode =
  | "RepositoryIsLocked"
  | "AuthenticationFailed"
  | "NotAGitRepository"
  | "BadConfigFile"
  | "CantCreatePipe"
  | "RepositoryNotFound"
  | "CantAccessRemote"
  | "BranchNotFullyMerged"
  | "NoRemoteReference"
  | "BranchAlreadyExists"
  | "InvalidBranchName"
  | "DirtyWorkTree"
  | "NotASafeGitRepository"
  | "NoUserNameConfigured"
  | "UnmergedChanges"
  | "NothingToCommit"
  | "PushRejected"
  | "NoUpstreamBranch"
  | "NoRemoteRepositorySpecified"
  | "RemoteConnectionError"
  | "PermissionDenied"
  | "Conflict"
  | "LocalChangesOverwritten"
  | "NoLocalChanges"
  | "NoStashFound"
  | "StashConflict"
  | "GitNotFound";

/** Classifies what Git printed. `output` is stderr followed by stdout. */
export function getGitErrorCode(output: string): GitErrorCode | undefined {
  if (
    /Another git process seems to be running in this repository|If no other git process is currently running/.test(
      output,
    )
  ) {
    return "RepositoryIsLocked";
  } else if (/^error: failed to push some refs to\b/m.test(output)) {
    return "PushRejected";
  } else if (/The current branch .* has no upstream branch/.test(output)) {
    return "NoUpstreamBranch";
  } else if (
    /No remote repository specified\.|No configured push destination|does not appear to be a git repository/.test(
      output,
    )
  ) {
    return "NoRemoteRepositorySpecified";
  } else if (/Could not read from remote repository/.test(output)) {
    return /Permission.*denied/.test(output)
      ? "PermissionDenied"
      : "RemoteConnectionError";
  } else if (/Permission.*denied/.test(output)) {
    return "PermissionDenied";
  } else if (/No local changes to save/.test(output)) {
    return "NoLocalChanges";
  } else if (/No stash (?:entries )?found/.test(output)) {
    return "NoStashFound";
  } else if (
    /Your local changes to the following files would be overwritten/.test(output)
  ) {
    return "LocalChangesOverwritten";
  } else if (/^CONFLICT \([^)]+\)/m.test(output)) {
    return "Conflict";
  } else if (/Authentication failed/i.test(output)) {
    return "AuthenticationFailed";
  } else if (/Not a git repository/i.test(output)) {
    return "NotAGitRepository";
  } else if (/bad config file/.test(output)) {
    return "BadConfigFile";
  } else if (
    /cannot make pipe for command substitution|cannot create standard input pipe/.test(
      output,
    )
  ) {
    return "CantCreatePipe";
  } else if (/Repository not found/.test(output)) {
    return "RepositoryNotFound";
  } else if (/unable to access/.test(output)) {
    return "CantAccessRemote";
  } else if (/branch '.+' is not fully merged/.test(output)) {
    return "BranchNotFullyMerged";
  } else if (/Couldn't find remote ref/.test(output)) {
    return "NoRemoteReference";
  } else if (/A branch named '.+' already exists/.test(output)) {
    return "BranchAlreadyExists";
  } else if (/'.+' is not a valid branch name/.test(output)) {
    return "InvalidBranchName";
  } else if (/Please,? commit your changes or stash them/.test(output)) {
    return "DirtyWorkTree";
  } else if (/detected dubious ownership in repository at/.test(output)) {
    return "NotASafeGitRepository";
  } else if (/Please tell me who you are\./.test(output)) {
    return "NoUserNameConfigured";
  } else if (/not possible because you have unmerged files/.test(output)) {
    return "UnmergedChanges";
  } else if (
    /nothing to commit|no changes added to commit|nothing added to commit/.test(output)
  ) {
    return "NothingToCommit";
  }
  return undefined;
}

const gitErrorMessages: Partial<Record<GitErrorCode, string>> = {
  RepositoryIsLocked:
    "Another Git process is using this repository. Wait for it to finish, then try again.",
  AuthenticationFailed:
    "Git could not sign in to the remote repository. Check your credentials.",
  NotAGitRepository: "Not a Git repository",
  RepositoryNotFound:
    "The remote repository was not found. Check the address and that you have access.",
  CantAccessRemote:
    "Could not reach the remote repository. Check your connection and the address.",
  DirtyWorkTree: "Commit or stash your changes first.",
  NotASafeGitRepository:
    "Git does not trust this folder because another user owns it. To allow it, run: git config --global --add safe.directory <folder>",
  NoUserNameConfigured:
    'Git does not know who you are yet. Run: git config --global user.name "Your Name" and git config --global user.email "you@example.com", then commit again.',
  UnmergedChanges: "Resolve the merge conflicts before committing.",
  NothingToCommit: "There is nothing staged to commit. Stage your changes first.",
  PushRejected:
    "Can't push: the remote has commits you don't have. Pull first to integrate them, then push.",
  NoUpstreamBranch: "This branch is not on the remote yet. Use Publish Branch.",
  NoRemoteRepositorySpecified:
    "This repository has no remote. Use Publish Branch and enter the repository address.",
  RemoteConnectionError:
    "Could not connect to the remote repository. Check your connection, your SSH key or credentials, and the address.",
  PermissionDenied:
    "The remote repository refused access. Check that you can push to it.",
  Conflict:
    "Git stopped on merge conflicts. Fix the files marked with conflicts, stage them, then commit.",
  LocalChangesOverwritten:
    "Your local changes would be overwritten. Commit or stash them first.",
  NoLocalChanges: "There are no changes to stash.",
  NoStashFound: "There is no stash to restore.",
  StashConflict:
    "The stash was restored with conflicts. Fix the files marked with conflicts.",
  GitNotFound:
    "Git is not installed or is not on the PATH. Install it from https://git-scm.com and restart LatexDo.",
};

/** A message a person can act on, or null to show what Git printed. */
export function gitErrorMessage(code: GitErrorCode | undefined): string | null {
  return (code && gitErrorMessages[code]) ?? null;
}

const maxLockedAttempts = 10;

/**
 * Runs a Git operation again while the repository is locked by another Git
 * process (an index.lock left by a command still running), with quadratic
 * backoff: 50 ms, 200 ms, 450 ms, …
 */
export async function retryWhileRepositoryIsLocked<T>(
  run: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      attempt += 1;
      return await run();
    } catch (error) {
      const locked =
        (error as { gitErrorCode?: GitErrorCode }).gitErrorCode ===
        "RepositoryIsLocked";
      if (!locked || attempt > maxLockedAttempts) throw error;
      await wait(Math.pow(attempt, 2) * 50);
    }
  }
}

const exclusiveQueues = new Map<string, Promise<unknown>>();

/**
 * Runs LatexDo's own index-changing operations on a project one at a time, so
 * quick repeated clicks (stage, stage, commit) cannot collide on the index.
 */
export function runGitExclusive<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = exclusiveQueues.get(key) ?? Promise.resolve();
  const next = previous.then(run, run);
  const settled = next.catch(() => undefined);
  exclusiveQueues.set(key, settled);
  void settled.then(() => {
    if (exclusiveQueues.get(key) === settled) exclusiveQueues.delete(key);
  });
  return next;
}
