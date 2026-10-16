import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  parseGitBlamePorcelain,
  parseGitStatusPorcelainV2,
  readGitBlame,
  type GitRepositoryContext,
} from "../electron/git.js";

const execFileAsync = promisify(execFile);

const context: GitRepositoryContext = {
  projectRoot: "/repo",
  repositoryRoot: "/repo",
  projectPrefix: "",
  gitDirectory: "/repo/.git",
  commonGitDirectory: "/repo/.git",
};

describe("Git porcelain parsers", () => {
  it("preserves independent index/worktree state and rename paths", () => {
    const hash = "a".repeat(40);
    const output = [
      `# branch.oid ${hash}`,
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      `1 MM N... 100644 100644 100644 ${hash} ${hash} main.tex`,
      `2 R. N... 100644 100644 100644 ${hash} ${hash} R100 new name.tex`,
      "old name.tex",
      "? new file.tex",
      `u UU N... 100644 100644 100644 100644 ${hash} ${hash} ${hash} conflict.tex`,
      "",
    ].join("\0");

    const status = parseGitStatusPorcelainV2(output, context);

    expect(status).toMatchObject({
      branch: "main",
      headHash: hash,
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    });
    expect(status.entries).toEqual([
      {
        path: "main.tex",
        indexStatus: "modified",
        worktreeStatus: "modified",
        staged: true,
        unstaged: true,
        untracked: false,
        conflicted: false,
      },
      {
        path: "new name.tex",
        originalPath: "old name.tex",
        indexStatus: "renamed",
        worktreeStatus: "unmodified",
        staged: true,
        unstaged: false,
        untracked: false,
        conflicted: false,
      },
      {
        path: "new file.tex",
        indexStatus: "unmodified",
        worktreeStatus: "untracked",
        staged: false,
        unstaged: true,
        untracked: true,
        conflicted: false,
      },
      {
        path: "conflict.tex",
        indexStatus: "conflicted",
        worktreeStatus: "conflicted",
        staged: true,
        unstaged: true,
        untracked: false,
        conflicted: true,
      },
    ]);
  });

  it("parses blame metadata by final line number", () => {
    const hash = "b".repeat(40);
    const output = [
      `${hash} 10 4 1`,
      "author Test User",
      "author-time 1720000000",
      "author-tz +0200",
      "summary Explain the equation",
      "filename main.tex",
      "\t\\section{Method}",
      "",
    ].join("\n");

    expect(parseGitBlamePorcelain(output)).toEqual([
      {
        line: 4,
        hash,
        shortHash: hash.slice(0, 7),
        author: "Test User",
        authorTime: new Date(1720000000 * 1000).toISOString(),
        summary: "Explain the equation",
      },
    ]);
  });

  it("returns empty blame for folders that are not git repositories", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "latexdo-non-git-"));
    try {
      await expect(
        readGitBlame(directory, "main.tex", { kind: "working-tree" }),
      ).resolves.toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns empty blame when git cannot produce blame data", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "latexdo-empty-git-"));
    try {
      await execFileAsync("git", ["init", "-q"], { cwd: directory });

      await expect(
        readGitBlame(directory, "missing.tex", { kind: "working-tree" }),
      ).resolves.toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
