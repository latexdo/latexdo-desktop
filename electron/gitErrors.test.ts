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
