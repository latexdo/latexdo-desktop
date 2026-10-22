// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  getGitErrorCode,
  gitErrorMessage,
  retryWhileRepositoryIsLocked,
  runGitExclusive,
} from "./gitErrors.js";

describe("getGitErrorCode", () => {
  it.each([
    [
      "fatal: Unable to create '/repo/.git/index.lock': File exists.\n\nAnother git process seems to be running in this repository",
      "RepositoryIsLocked",
    ],
    [
      "fatal: Authentication failed for 'https://example.com/a.git/'",
      "AuthenticationFailed",
    ],
    [
      "fatal: not a git repository (or any of the parent directories): .git",
      "NotAGitRepository",
    ],
    ["remote: Repository not found.", "RepositoryNotFound"],
    [
      "fatal: unable to access 'https://example.com/': Could not resolve host",
      "CantAccessRemote",
    ],
    [
      "fatal: detected dubious ownership in repository at '/repo'",
      "NotASafeGitRepository",
    ],
    [
      "*** Please tell me who you are.\n\nRun\n  git config --global user.email",
      "NoUserNameConfigured",
    ],
    [
      "error: Committing is not possible because you have unmerged files.",
      "UnmergedChanges",
    ],
    ["On branch main\nnothing to commit, working tree clean", "NothingToCommit"],
  ])("recognises %j", (output, code) => {
    expect(getGitErrorCode(output)).toBe(code);
    expect(gitErrorMessage(getGitErrorCode(output))).toEqual(expect.any(String));
  });

  it("leaves unknown failures to Git's own words", () => {
    expect(getGitErrorCode("fatal: something unusual")).toBeUndefined();
    expect(gitErrorMessage(undefined)).toBeNull();
  });
});

describe("retryWhileRepositoryIsLocked", () => {
  const locked = Object.assign(new Error("locked"), {
    gitErrorCode: "RepositoryIsLocked" as const,
  });

  it("retries with quadratic backoff until the lock clears", async () => {
    const waits: number[] = [];
    const run = vi
      .fn()
      .mockRejectedValueOnce(locked)
      .mockRejectedValueOnce(locked)
      .mockResolvedValue("done");
    await expect(
      retryWhileRepositoryIsLocked(run, async (ms) => void waits.push(ms)),
    ).resolves.toBe("done");
    expect(waits).toEqual([50, 200]);
  });

  it("gives up after ten retries and never retries other failures", async () => {
    const alwaysLocked = vi.fn().mockRejectedValue(locked);
    await expect(
      retryWhileRepositoryIsLocked(alwaysLocked, async () => undefined),
    ).rejects.toBe(locked);
    expect(alwaysLocked).toHaveBeenCalledTimes(11);

    const other = vi.fn().mockRejectedValue(new Error("bad revision"));
    await expect(
      retryWhileRepositoryIsLocked(other, async () => undefined),
    ).rejects.toThrow("bad revision");
    expect(other).toHaveBeenCalledTimes(1);
  });
});

describe("runGitExclusive", () => {
  it("runs operations on one project in order, even after a failure", async () => {
    const order: string[] = [];
    const slow = runGitExclusive("project", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("first");
      throw new Error("first failed");
    });
    const fast = runGitExclusive("project", async () => {
      order.push("second");
      return 2;
    });
    await expect(slow).rejects.toThrow("first failed");
    await expect(fast).resolves.toBe(2);
    expect(order).toEqual(["first", "second"]);
  });
});

describe("getGitErrorCode covers every recognised failure", () => {
  it.each([
    ["error: failed to push some refs to 'origin'", "PushRejected"],
    ["fatal: The current branch topic has no upstream branch.", "NoUpstreamBranch"],
    ["fatal: No configured push destination.", "NoRemoteRepositorySpecified"],
    [
      "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
      "PermissionDenied",
    ],
    ["fatal: Could not read from remote repository.", "RemoteConnectionError"],
    ["remote: Permission to a/b.git denied to someone.", "PermissionDenied"],
    ["No local changes to save", "NoLocalChanges"],
    ["error: No stash entries found.", "NoStashFound"],
    [
      "error: Your local changes to the following files would be overwritten by merge",
      "LocalChangesOverwritten",
    ],
    ["CONFLICT (content): Merge conflict in main.tex", "Conflict"],
    ["fatal: bad config file line 3 in .git/config", "BadConfigFile"],
    ["cannot create standard input pipe", "CantCreatePipe"],
    ["error: The branch 'topic' is not fully merged.", "BranchNotFullyMerged"],
    ["fatal: Couldn't find remote ref topic", "NoRemoteReference"],
    ["fatal: A branch named 'topic' already exists.", "BranchAlreadyExists"],
    ["fatal: 'bad..name' is not a valid branch name", "InvalidBranchName"],
    [
      "error: cannot pull with rebase: Please commit your changes or stash them.",
      "DirtyWorkTree",
    ],
    ["nothing added to commit but untracked files present", "NothingToCommit"],
  ])("recognises %j", (output, code) => {
    expect(getGitErrorCode(output)).toBe(code);
  });

  it("gives a readable message only for known codes", () => {
    expect(gitErrorMessage("PushRejected")).toMatch(/Pull first/);
    expect(gitErrorMessage("BadConfigFile")).toBeNull();
    expect(gitErrorMessage(undefined)).toBeNull();
  });
});

describe("retryWhileRepositoryIsLocked default wait", () => {
  it("waits with real timers between attempts", async () => {
    vi.useFakeTimers();
    try {
      const run = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(
          Object.assign(new Error("locked"), {
            gitErrorCode: "RepositoryIsLocked",
          }),
        )
        .mockResolvedValue("done");
      const result = retryWhileRepositoryIsLocked(run);
      await vi.advanceTimersByTimeAsync(49);
      expect(run).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toBe("done");
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
