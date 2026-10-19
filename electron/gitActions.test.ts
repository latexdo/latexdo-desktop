// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const git = vi.hoisted(() => ({
  responses: new Map<string, string | Error>(),
  calls: [] as string[][],
  prefix: "",
}));

vi.mock("./git.js", () => ({
  getGitRepositoryContext: vi.fn(async () => ({
    repositoryRoot: "/repo",
    projectPrefix: git.prefix,
  })),
  runGitText: vi.fn(async (_root: string, args: string[]) => {
    git.calls.push(args);
    const response = git.responses.get(args.join(" "));
    if (response instanceof Error) throw response;
    return response ?? "";
  }),
}));

import {
  assertCommit,
  parseGitAction,
  readDiffForCommitMessage,
  readGitRepositoryInfo,
  runGitAction,
} from "./gitActions.js";

const head = "rev-parse --abbrev-ref HEAD";
const upstream = "rev-parse --abbrev-ref --symbolic-full-name @{u}";

function respond(args: string, value: string | Error) {
  git.responses.set(args, value);
}

function ran(args: string) {
  return git.calls.some((call) => call.join(" ") === args);
}

beforeEach(() => {
  git.responses.clear();
  git.calls = [];
  git.prefix = "";
});

describe("readGitRepositoryInfo", () => {
  it("lists branches, skips remote HEAD refs and counts stashes", async () => {
    const sep = "\u001f";
    respond(
      `for-each-ref --format=%(refname)${sep}%(refname:short)${sep}%(HEAD)${sep}%(upstream:short)${sep}%(objectname:short)${sep}%(contents:subject) --sort=-committerdate refs/heads refs/remotes`,
      [
        ["refs/heads/main", "main", "*", "origin/main", "abc1234", "Init"].join(sep),
        "",
        ["refs/remotes/origin/HEAD", "origin", "", "", "abc1234", "Init"].join(sep),
        ["refs/remotes/origin/main", "origin/main", "", "", "abc1234", "Init"].join(sep),
      ].join("\n"),
    );
    respond("stash list", "stash@{0}\nstash@{1}\n");
    respond("log -1 --format=%B", "Init\n");
    respond("remote", "origin\n upstream \n\n");
    expect(await readGitRepositoryInfo("/repo/paper")).toEqual({
      remotes: ["origin", "upstream"],
      branches: [
        {
          name: "main",
          kind: "local",
          current: true,
          upstream: "origin/main",
          shortHash: "abc1234",
          subject: "Init",
        },
        {
          name: "origin/main",
          kind: "remote",
          current: false,
          upstream: undefined,
          shortHash: "abc1234",
          subject: "Init",
        },
      ],
      stashCount: 2,
      headSubject: "Init",
      hasCommits: true,
    });
  });

  it("tolerates an empty repository", async () => {
    respond("stash list", new Error("no stash"));
    respond("log -1 --format=%B", new Error("no commits"));
    expect(await readGitRepositoryInfo("/repo")).toMatchObject({
      branches: [],
      stashCount: 0,
      headSubject: undefined,
      hasCommits: false,
      remotes: [],
    });
  });
});

describe("runGitAction", () => {
  it("initializes in the project folder", async () => {
    expect(await runGitAction("/new", { kind: "init" })).toEqual({
      message: "Initialized a Git repository.",
    });
    expect(git.calls).toEqual([["init"]]);
  });

  it("fetches all remotes", async () => {
    expect((await runGitAction("/repo", { kind: "fetch" })).message).toBe(
      "Fetched from all remotes.",
    );
    expect(ran("fetch --all --prune")).toBe(true);
  });

  it("pulls with merge unless rebase is configured", async () => {
    await runGitAction("/repo", { kind: "pull" });
    expect(ran("pull --no-rebase --no-edit")).toBe(true);
    git.calls = [];
    respond("config --get pull.rebase", "true\n");
    expect((await runGitAction("/repo", { kind: "pull" })).message).toBe("Pulled.");
    expect(ran("pull --no-edit")).toBe(true);
  });

  it("pushes to the upstream", async () => {
    respond(head, "main\n");
    respond(upstream, "origin/main\n");
    expect((await runGitAction("/repo", { kind: "push" })).message).toBe("Pushed main.");
    expect(ran("push")).toBe(true);
  });

  it("publishes a branch without upstream to origin, or to the first remote", async () => {
    respond(head, "draft");
    respond(upstream, new Error("no upstream"));
    respond("remote", "backup\norigin\n");
    expect((await runGitAction("/repo", { kind: "push" })).message).toBe(
      "Published draft to origin.",
    );
    expect(ran("push --set-upstream origin draft")).toBe(true);
    respond("remote", "backup\n");
    expect((await runGitAction("/repo", { kind: "push" })).message).toBe(
      "Published draft to backup.",
    );
  });

  it("explains a push without remotes", async () => {
    respond(head, "draft");
    await expect(runGitAction("/repo", { kind: "push" })).rejects.toThrow("no remote");
  });

  it.each([["HEAD"], [""], [new Error("fatal")]])(
    "refuses to push on a detached HEAD (%s)",
    async (response) => {
      respond(head, response);
      await expect(runGitAction("/repo", { kind: "push" })).rejects.toThrow(
        "detached HEAD",
      );
    },
  );

  it("syncs by pulling then pushing, or only pushing without upstream", async () => {
    respond(head, "main");
    respond(upstream, "origin/main");
    expect((await runGitAction("/repo", { kind: "sync" })).message).toBe("Synced main.");
    expect(ran("pull --no-rebase --no-edit")).toBe(true);

    git.calls = [];
    respond(upstream, "");
    respond("remote", "origin");
    expect((await runGitAction("/repo", { kind: "sync" })).message).toBe(
      "Published main to origin.",
    );
    expect(git.calls.some((call) => call[0] === "pull")).toBe(false);
  });

  it("publishes, adding or updating origin from a given address", async () => {
    respond(head, "main");
    respond("remote", "origin");
    await runGitAction("/repo", {
      kind: "publish",
      remoteUrl: " https://github.com/you/paper.git ",
    });
    expect(ran("remote set-url origin https://github.com/you/paper.git")).toBe(true);

    respond("remote", "");
    await expect(
      runGitAction("/repo", { kind: "publish", remoteUrl: "git@github.com:you/p.git" }),
    ).rejects.toThrow("no remote");
    expect(ran("remote add origin git@github.com:you/p.git")).toBe(true);

    await expect(
      runGitAction("/repo", { kind: "publish", remoteUrl: "--upload-pack=evil" }),
    ).rejects.toThrow("Enter a repository address");
  });

  it("publishes without a new address", async () => {
    respond(head, "main");
    respond("remote", "origin");
    expect((await runGitAction("/repo", { kind: "publish" })).message).toBe(
      "Published main to origin.",
    );
  });

  it("checks out local branches, remote branches with a local copy, and tracks new ones", async () => {
    respond("branch --format=%(refname:short)", "main\ndraft\n");
    expect((await runGitAction("/repo", { kind: "checkout", branch: "draft" })).message).toBe(
      "Switched to draft.",
    );
    expect(
      (await runGitAction("/repo", { kind: "checkout", branch: "origin/draft" })).message,
    ).toBe("Switched to draft.");
    expect(
      (await runGitAction("/repo", { kind: "checkout", branch: "origin/new" })).message,
    ).toBe("Switched to new, tracking origin/new.");
    expect(ran("checkout --track origin/new")).toBe(true);
  });

  it("creates, deletes, renames and merges branches", async () => {
    respond(head, "main");
    expect((await runGitAction("/repo", { kind: "create-branch", branch: "x" })).message).toBe(
      "Created and switched to x.",
    );
    expect((await runGitAction("/repo", { kind: "delete-branch", branch: "x" })).message).toBe(
      "Deleted x.",
    );
    expect(
      (await runGitAction("/repo", { kind: "rename-branch", branch: "a", newName: "b" }))
        .message,
    ).toBe("Renamed a to b.");
    expect((await runGitAction("/repo", { kind: "merge-branch", branch: "b" })).message).toBe(
      "Merged b into main.",
    );
    expect(ran("merge --no-edit b")).toBe(true);
    await expect(
      runGitAction("/repo", { kind: "create-branch", branch: "-evil" }),
    ).rejects.toThrow("not a valid branch name");
  });

  it("commits, optionally staging everything in the project and pushing", async () => {
    git.prefix = "paper";
    expect((await runGitAction("/repo", { kind: "commit", message: " Fix " })).message).toBe(
      "Committed.",
    );
    expect(ran("commit -m Fix")).toBe(true);

    respond(head, "main");
    respond(upstream, "origin/main");
    expect(
      (
        await runGitAction("/repo", {
          kind: "commit",
          message: "",
          amend: true,
          all: true,
          push: true,
        })
      ).message,
    ).toBe("Amended the last commit. Pushed main.");
    expect(ran("add --all -- paper")).toBe(true);
    expect(ran("commit --amend --no-edit")).toBe(true);

    git.prefix = "";
    await runGitAction("/repo", { kind: "commit", message: "All", all: true });
    expect(ran("add --all -- .")).toBe(true);

    await expect(runGitAction("/repo", { kind: "commit", message: "  " })).rejects.toThrow(
      "Enter a commit message.",
    );
  });

  it("undoes the last commit, keeping its message", async () => {
    respond("log -1 --format=%B", "Message\n\n");
    expect(await runGitAction("/repo", { kind: "undo-last-commit" })).toEqual({
      message: "Undid the last commit; its changes are staged.",
      commitMessage: "Message",
    });
    expect(ran("reset --soft HEAD~1")).toBe(true);

    respond("rev-parse --verify HEAD~1", new Error("no parent"));
    await runGitAction("/repo", { kind: "undo-last-commit" });
    expect(ran("update-ref -d HEAD")).toBe(true);
  });

  it("stashes with an optional message and refuses a clean tree", async () => {
    await expect(runGitAction("/repo", { kind: "stash" })).rejects.toThrow(
      "no changes to stash",
    );
    respond("status --porcelain", " M main.tex\n");
    await runGitAction("/repo", { kind: "stash", message: " wip " });
    expect(ran("stash push --include-untracked -m wip")).toBe(true);
    expect((await runGitAction("/repo", { kind: "stash", message: "  " })).message).toBe(
      "Stashed your changes.",
    );
    expect(ran("stash push --include-untracked")).toBe(true);
    expect((await runGitAction("/repo", { kind: "stash-pop" })).message).toBe(
      "Restored the latest stash.",
    );
  });

  it("runs commit-level actions on validated hashes", async () => {
    const commit = "abcdef1234";
    expect(
      (await runGitAction("/repo", { kind: "branch-at", branch: "fix", commit })).message,
    ).toBe("Created fix at abcdef1.");
    expect((await runGitAction("/repo", { kind: "tag", tag: "v1", commit })).message).toBe(
      "Tagged abcdef1 as v1.",
    );
    expect((await runGitAction("/repo", { kind: "cherry-pick", commit })).message).toBe(
      "Applied abcdef1 on this branch.",
    );
    expect((await runGitAction("/repo", { kind: "revert", commit })).message).toBe(
      "Reverted abcdef1 in a new commit.",
    );
    expect((await runGitAction("/repo", { kind: "checkout-commit", commit })).message).toContain(
      "detached HEAD",
    );
    await expect(
      runGitAction("/repo", { kind: "revert", commit: "HEAD~1" }),
    ).rejects.toThrow("Invalid commit.");
  });
});

describe("assertCommit", () => {
  it("accepts hashes only", () => {
    expect(assertCommit("ABCDEF1")).toBe("ABCDEF1");
    for (const value of ["abc", "--all", "a..b", "g".repeat(7)]) {
      expect(() => assertCommit(value)).toThrow("Invalid commit.");
    }
  });
});

describe("readDiffForCommitMessage", () => {
  it("prefers the staged diff", async () => {
    respond("diff --cached --stat --patch -- .", "staged diff");
    expect(await readDiffForCommitMessage("/repo")).toBe("staged diff");
  });

  it("falls back to working tree changes and new files in the project", async () => {
    git.prefix = "paper";
    respond("diff --stat --patch -- paper", "tracked diff");
    respond("ls-files --others --exclude-standard -- paper", "a.tex\nb.tex\n");
    expect(await readDiffForCommitMessage("/repo/paper")).toBe(
      "tracked diff\nnew file: a.tex\nnew file: b.tex",
    );
  });

  it("returns nothing for a clean tree", async () => {
    expect(await readDiffForCommitMessage("/repo")).toBe("");
  });
});

describe("parseGitAction", () => {
  it.each([null, "fetch", 3])("rejects non-objects (%j)", (value) => {
    expect(() => parseGitAction(value)).toThrow("Invalid Git action.");
  });

  it("rejects unknown kinds", () => {
    expect(() => parseGitAction({ kind: "rm -rf" })).toThrow("Unknown Git action.");
  });

  it.each(["init", "fetch", "pull", "push", "sync", "undo-last-commit", "stash-pop"])(
    "accepts the simple action %s",
    (kind) => {
      expect(parseGitAction({ kind, extra: 1 })).toEqual({ kind });
    },
  );

  it("parses publish with and without an address", () => {
    expect(parseGitAction({ kind: "publish", remoteUrl: "https://x" })).toEqual({
      kind: "publish",
      remoteUrl: "https://x",
    });
    expect(parseGitAction({ kind: "publish" })).toEqual({
      kind: "publish",
      remoteUrl: undefined,
    });
    expect(() => parseGitAction({ kind: "publish", remoteUrl: "x".repeat(2049) })).toThrow(
      "Invalid Git action field: remoteUrl",
    );
    expect(() => parseGitAction({ kind: "publish", remoteUrl: 5 })).toThrow(
      "Invalid Git action field: remoteUrl",
    );
  });

  it.each(["checkout", "create-branch", "delete-branch", "merge-branch"])(
    "validates the branch for %s",
    (kind) => {
      expect(parseGitAction({ kind, branch: " feature " })).toEqual({
        kind,
        branch: "feature",
      });
      expect(() => parseGitAction({ kind })).toThrow("Please provide a branch name.");
    },
  );

  it("validates both names when renaming", () => {
    expect(parseGitAction({ kind: "rename-branch", branch: "a", newName: "b" })).toEqual({
      kind: "rename-branch",
      branch: "a",
      newName: "b",
    });
    expect(() => parseGitAction({ kind: "rename-branch", branch: "a" })).toThrow();
    expect(() => parseGitAction({ kind: "rename-branch", newName: "b" })).toThrow();
  });

  it("parses commit flags strictly", () => {
    expect(parseGitAction({ kind: "commit", message: "m", amend: true, all: "yes" })).toEqual({
      kind: "commit",
      message: "m",
      amend: true,
      all: false,
      push: false,
    });
    expect(parseGitAction({ kind: "commit" })).toMatchObject({ message: "" });
  });

  it("parses stash messages", () => {
    expect(parseGitAction({ kind: "stash", message: "wip" })).toEqual({
      kind: "stash",
      message: "wip",
    });
    expect(() => parseGitAction({ kind: "stash", message: "x".repeat(501) })).toThrow();
  });

  it("validates branch-at and tag", () => {
    expect(parseGitAction({ kind: "branch-at", branch: "b", commit: "abcdef1" })).toEqual({
      kind: "branch-at",
      branch: "b",
      commit: "abcdef1",
    });
    expect(parseGitAction({ kind: "tag", tag: "v1", commit: "abcdef1" })).toEqual({
      kind: "tag",
      tag: "v1",
      commit: "abcdef1",
    });
    expect(() => parseGitAction({ kind: "branch-at", commit: "abcdef1" })).toThrow();
    expect(() => parseGitAction({ kind: "branch-at", branch: "b" })).toThrow("Invalid commit.");
    expect(() => parseGitAction({ kind: "tag", commit: "abcdef1" })).toThrow();
    expect(() => parseGitAction({ kind: "tag", tag: "v1" })).toThrow("Invalid commit.");
  });

  it.each(["cherry-pick", "revert", "checkout-commit"])("validates the commit for %s", (kind) => {
    expect(parseGitAction({ kind, commit: "abcdef1" })).toEqual({ kind, commit: "abcdef1" });
    expect(() => parseGitAction({ kind })).toThrow("Invalid commit.");
  });
});
