import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppScm } from "./useAppScm";
import type { AppCtx11 } from "./appContext";
import type { GitGraphCommit, OpenDocument } from "../types";
const ai = vi.hoisted(() => ({
  generateCommitMessage: vi.fn(),
  sendsDiffOnline: vi.fn(),
}));
vi.mock("../features/git/commitMessageAi", () => ai);
vi.mock("../features/ai/aiConfig", () => ({ isAiReady: () => true }));
const commit = {
  hash: "abc123",
  shortHash: "abc",
  subject: "Change",
  isHead: true,
} as GitGraphCommit;
const info = () => ({
  branches: [
    { name: "main", kind: "local", current: true },
    { name: "feature", kind: "local", current: false },
    { name: "origin/feature", kind: "remote", current: false },
  ],
  remotes: [{ name: "origin" }],
});
const api = {
  runGitAction: vi.fn(),
  getGitRepositoryInfo: vi.fn(),
  getGitGraph: vi.fn(),
  getGitCommitDetails: vi.fn(),
  getGitDiffForCommitMessage: vi.fn(),
};
function setup(overrides: Record<string, unknown> = {}) {
  const ctx = {
    gitStatus: {
      isRepo: true,
      branch: "main",
      headHash: "abc123",
      ahead: 0,
      behind: 0,
      entries: [{ path: "main.tex", staged: true }],
    },
    gitActionBusy: null,
    gitCommitMessage: "message",
    projectIdRef: { current: "p" },
    documentsRef: { current: [] as OpenDocument[] },
    saveDocument: vi.fn().mockResolvedValue(undefined),
    refreshProject: vi.fn().mockResolvedValue([]),
    setGitActionBusy: vi.fn(),
    setGitCommitMessage: vi.fn(),
    setStatusMessage: vi.fn(),
    aiConfig: {},
    aiIsDesktop: true,
    ...overrides,
  };
  const deps = {
    refreshGitData: vi.fn().mockResolvedValue(undefined),
    reloadOpenDocumentsFromDisk: vi.fn().mockResolvedValue(undefined),
    closeGitDiffSession: vi.fn(),
    commitGitChanges: vi.fn().mockResolvedValue(true),
  };
  const hook = renderHook(() => useAppScm(ctx as unknown as AppCtx11, deps));
  let pending: Promise<unknown> = Promise.resolve();
  return {
    ...hook,
    ctx,
    deps,
    async start(action: () => Promise<unknown>) {
      await act(async () => {
        pending = action();
      });
    },
    async choose(id?: string, value = "", button?: string) {
      expect(hook.result.current.quickPick).not.toBeNull();
      await act(async () => {
        const pick = hook.result.current.quickPick!;
        pick.onAccept(id ? { id, label: id } : null, value, button);
      });
    },
    async cancel() {
      await act(async () => {
        hook.result.current.quickPick!.onCancel();
      });
    },
    async done() {
      await act(async () => {
        await pending;
      });
    },
  };
}
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  api.runGitAction.mockReset().mockResolvedValue({ message: "done" });
  api.getGitRepositoryInfo.mockReset().mockResolvedValue(info());
  api.getGitGraph.mockReset().mockResolvedValue({ commits: [commit], hasMore: true });
  api.getGitCommitDetails.mockReset().mockResolvedValue({ files: [] });
  api.getGitDiffForCommitMessage.mockReset().mockResolvedValue("diff");
  ai.generateCommitMessage.mockReset().mockResolvedValue("Suggested");
  ai.sendsDiffOnline.mockReset().mockReturnValue(false);
  window.latexdo = api as unknown as typeof window.latexdo;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("source control actions", () => {
  it("saves dirty text before checkout and reloads open files afterwards", async () => {
    const h = setup();
    h.ctx.documentsRef.current = [
      { kind: "text", content: "new", savedContent: "old" } as OpenDocument,
      { kind: "asset" } as OpenDocument,
    ];
    await act(() =>
      h.result.current.runScmAction({ kind: "checkout", branch: "feature" }),
    );
    expect(h.ctx.saveDocument).toHaveBeenCalledTimes(1);
    expect(h.deps.closeGitDiffSession).toHaveBeenCalled();
    expect(h.deps.reloadOpenDocumentsFromDisk).toHaveBeenCalled();
    expect(h.ctx.setGitActionBusy).toHaveBeenLastCalledWith(null);
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith("done");
    api.runGitAction.mockResolvedValueOnce({
      message: "undone",
      commitMessage: "previous",
    });
    await act(() => h.result.current.runScmAction({ kind: "undo-last-commit" }));
    expect(h.ctx.setGitCommitMessage).toHaveBeenCalledWith("previous");
  });
  it("reports errors and tolerates failed refreshes", async () => {
    const h = setup();
    api.runGitAction.mockRejectedValue(new Error("conflict"));
    h.deps.refreshGitData.mockRejectedValue(new Error("offline"));
    await act(async () => {
      expect(await h.result.current.runScmAction({ kind: "pull" })).toBe(false);
    });
    expect(h.result.current.scmError).toBe("conflict");
    expect(h.ctx.setGitActionBusy).toHaveBeenLastCalledWith(null);
    h.ctx.projectIdRef.current = "";
    api.runGitAction.mockClear();
    await act(() => h.result.current.initRepository());
    expect(api.runGitAction).not.toHaveBeenCalled();
  });
  it("commits staged changes, records history and resets the success indicator", async () => {
    const h = setup();
    await act(() => h.result.current.commitScm());
    expect(h.deps.commitGitChanges).toHaveBeenCalled();
    expect(h.result.current.commitState).toBe("success");
    expect(h.result.current.commitMessageHistory()).toEqual(["message"]);
    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(h.result.current.commitState).toBe("idle");
    h.deps.commitGitChanges.mockResolvedValue(false);
    await act(() => h.result.current.commitScm());
    expect(h.result.current.commitState).toBe("error");
    await act(() => vi.advanceTimersByTimeAsync(2600));
    expect(h.result.current.commitState).toBe("idle");
  });
  it("requires a message, changes and conflict resolution", async () => {
    const h = setup({ gitCommitMessage: " " });
    await act(() => h.result.current.commitScm());
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith("Enter a commit message.");
    h.ctx.gitCommitMessage = "message";
    h.ctx.gitStatus.entries = [];
    h.rerender();
    await act(() => h.result.current.commitScm());
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "There are no changes to commit.",
    );
    h.ctx.gitStatus.entries = [{ path: "a", staged: true, conflicted: true } as never];
    h.rerender();
    await act(() => h.result.current.commitScm());
    expect(h.result.current.scmError).toContain("merge conflicts");
  });
  it("asks before smart commits and remembers Always", async () => {
    const h = setup();
    h.ctx.gitStatus.entries[0].staged = false;
    await h.start(() => h.result.current.commitScm());
    await h.cancel();
    await h.done();
    expect(api.runGitAction).not.toHaveBeenCalled();
    await h.start(() => h.result.current.commitScm({ sync: true }));
    await h.choose("always");
    await h.done();
    expect(localStorage.getItem("latexdo.git.smartCommit")).toBe("always");
    expect(api.runGitAction).toHaveBeenCalledWith(
      "p",
      expect.objectContaining({ kind: "commit", all: true }),
    );
    expect(api.runGitAction).toHaveBeenCalledWith("p", { kind: "sync" });
    await act(() => h.result.current.commitScm());
    expect(h.result.current.quickPick).toBeNull();
  });
  it("requires confirmation for amend", async () => {
    const h = setup();
    await h.start(() => h.result.current.commitScm({ amend: true }));
    await h.choose("cancel");
    await h.done();
    expect(api.runGitAction).not.toHaveBeenCalled();
    await h.start(() => h.result.current.commitScm({ amend: true, push: true }));
    await h.choose("amend");
    await h.done();
    expect(api.runGitAction).toHaveBeenCalledWith(
      "p",
      expect.objectContaining({ kind: "commit", amend: true, push: true }),
    );
  });
});
describe("branch pickers", () => {
  it("validates branch creation and supports cancellation", async () => {
    const h = setup();
    await h.start(() => h.result.current.createBranch());
    expect(h.result.current.quickPick!.validate?.("")).toBeNull();
    expect(h.result.current.quickPick!.validate?.("bad name")).toBeTruthy();
    await h.choose(undefined, " feature2 ");
    await h.done();
    expect(api.runGitAction).toHaveBeenCalledWith("p", {
      kind: "create-branch",
      branch: "feature2",
    });
    api.runGitAction.mockClear();
    await h.start(() => h.result.current.createBranch());
    await h.cancel();
    await h.done();
    expect(api.runGitAction).not.toHaveBeenCalled();
  });
  it.each(["checkout", "merge", "delete", "rename"])(
    "performs branch action %s",
    async (kind) => {
      const h = setup();
      await h.start(() => h.result.current.branchActions("feature"));
      await h.choose(kind);
      if (kind === "merge" || kind === "delete") await h.choose("ok");
      if (kind === "rename") {
        expect(h.result.current.quickPick!.validate?.("feature")).toBe(
          "Enter a different name.",
        );
        expect(h.result.current.quickPick!.validate?.("new-feature")).toBeNull();
        await h.choose(undefined, "new-feature");
      }
      await h.done();
      expect(api.runGitAction).toHaveBeenCalledWith(
        "p",
        expect.objectContaining({
          kind: kind === "checkout" ? kind : `${kind}-branch`,
          branch: "feature",
        }),
      );
    },
  );
  it("reports missing branches and skips unavailable repositories", async () => {
    const h = setup();
    await act(() => h.result.current.branchActions("missing"));
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "Branch missing was not found.",
    );
    api.getGitRepositoryInfo.mockRejectedValue(new Error("unavailable"));
    await act(() => h.result.current.pickBranch());
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "Open a Git repository first.",
    );
    await act(() => h.result.current.deleteBranch());
    expect(h.result.current.quickPick).toBeNull();
  });
  it.each(["feature", "main", "+create"])(
    "selects %s in the branch picker",
    async (id) => {
      const h = setup();
      await h.start(() => h.result.current.pickBranch());
      await h.choose(id);
      if (id === "+create") await h.choose(undefined, "new");
      await h.done();
      if (id === "main") expect(api.runGitAction).not.toHaveBeenCalled();
      else
        expect(api.runGitAction).toHaveBeenCalledWith(
          "p",
          expect.objectContaining({
            kind: id === "+create" ? "create-branch" : "checkout",
          }),
        );
    },
  );
  it("deletes another branch and reports when only the current branch remains", async () => {
    const h = setup();
    await h.start(() => h.result.current.deleteBranch());
    await h.choose("feature");
    await h.done();
    expect(api.runGitAction).toHaveBeenCalledWith("p", {
      kind: "delete-branch",
      branch: "feature",
    });
    api.getGitRepositoryInfo.mockResolvedValue({
      ...info(),
      branches: [info().branches[0]],
    });
    await act(() => h.result.current.deleteBranch());
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("no other local branch"),
    );
  });
  it("publishes to an existing remote or asks for a valid URL", async () => {
    const h = setup();
    await act(() => h.result.current.publishBranch());
    expect(api.runGitAction).toHaveBeenCalledWith("p", { kind: "publish" });
    api.getGitRepositoryInfo.mockResolvedValue({ ...info(), remotes: [] });
    await h.start(() => h.result.current.publishBranch());
    expect(h.result.current.quickPick!.validate?.("bad")).toBeTruthy();
    expect(
      h.result.current.quickPick!.validate?.("https://example.org/repo"),
    ).toBeNull();
    await h.choose(undefined, "https://example.org/repo");
    await h.done();
    expect(api.runGitAction).toHaveBeenCalledWith("p", {
      kind: "publish",
      remoteUrl: "https://example.org/repo",
    });
  });
  it("stashes with an optional message and initializes a repository", async () => {
    const h = setup();
    await h.start(() => h.result.current.stashChanges());
    await h.choose(undefined, "draft");
    await h.done();
    expect(api.runGitAction).toHaveBeenCalledWith("p", {
      kind: "stash",
      message: "draft",
    });
    await act(() => h.result.current.initRepository());
    expect(api.runGitAction).toHaveBeenCalledWith("p", { kind: "init" });
  });
});
describe("commit graph and AI", () => {
  it("loads more, expands commit files, and reveals HEAD", async () => {
    const h = setup();
    await act(async () => {});
    expect(h.result.current.graphCommits).toEqual([commit]);
    await act(async () => {
      h.result.current.loadMoreGraph();
    });
    expect(api.getGitGraph).toHaveBeenLastCalledWith("p", { limit: 200, refs: "auto" });
    await act(() => h.result.current.toggleCommit(commit));
    expect(h.result.current.expandedCommits.has(commit.hash)).toBe(true);
    expect(h.result.current.commitFiles.get(commit.hash)).toEqual({ files: [] });
    await act(() => h.result.current.toggleCommit(commit));
    expect(h.result.current.expandedCommits.size).toBe(0);
    await act(() => h.result.current.toggleCommit(commit));
    expect(h.result.current.expandedCommits.size).toBe(1);
    act(() => h.result.current.goToCurrentCommit());
    expect(h.result.current.revealCommit).toBe(commit.hash);
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(h.result.current.revealCommit).toBeNull();
    await h.start(() => h.result.current.chooseGraphRefs());
    await h.choose("all");
    await h.done();
    expect(h.result.current.graphRefs).toBe("all");
  });
  it("reports details failures and handles graph failures", async () => {
    const h = setup();
    api.getGitCommitDetails.mockRejectedValue(new Error("gone"));
    await act(() => h.result.current.toggleCommit(commit));
    expect(h.result.current.commitFiles.get(commit.hash)).toEqual({ error: "gone" });
    api.getGitGraph.mockRejectedValue(new Error("offline"));
    await act(() => h.result.current.refreshGraph());
    expect(h.result.current.graphHasMore).toBe(false);
    expect(h.result.current.graphLoading).toBe(false);
  });
  it("gets consent before sending a diff online and handles empty/error results", async () => {
    const h = setup();
    ai.sendsDiffOnline.mockReturnValue(true);
    await h.start(() => h.result.current.suggestCommitMessage());
    await h.choose("no");
    await h.done();
    expect(api.getGitDiffForCommitMessage).not.toHaveBeenCalled();
    await h.start(() => h.result.current.suggestCommitMessage());
    await h.choose("yes");
    await h.done();
    expect(h.ctx.setGitCommitMessage).toHaveBeenCalledWith("Suggested");
    expect(localStorage.getItem("latexdo.git.aiCommitConsent")).toBe("yes");
    api.getGitDiffForCommitMessage.mockResolvedValue(" ");
    await act(() => h.result.current.suggestCommitMessage());
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "There are no changes to describe.",
    );
    api.getGitDiffForCommitMessage.mockRejectedValue(new Error("offline"));
    await act(() => h.result.current.suggestCommitMessage());
    expect(h.result.current.scmError).toBe("offline");
    expect(h.result.current.suggestingMessage).toBe(false);
  });
  it.each(["tag", "branch-at", "cherry-pick", "revert", "checkout-commit"] as const)(
    "confirms graph action %s",
    async (kind) => {
      const h = setup();
      await h.start(() => h.result.current.runCommitAction(kind, commit));
      if (kind === "tag" || kind === "branch-at") await h.choose(undefined, "new");
      else await h.choose("ok");
      await h.done();
      expect(api.runGitAction).toHaveBeenCalledWith(
        "p",
        expect.objectContaining({ kind, commit: commit.hash }),
      );
    },
  );
  it("copies commit identity and message", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const h = setup();
    await act(() => h.result.current.runCommitAction("copy-hash", commit));
    await act(() => h.result.current.runCommitAction("copy-message", commit));
    expect(writeText.mock.calls).toEqual([[commit.hash], [commit.subject]]);
    vi.unstubAllGlobals();
  });
});
