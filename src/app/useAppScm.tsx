import { useCallback, useEffect, useRef, useState } from "react";
import { Cloud, Ellipsis, GitBranch, Plus, Trash2 } from "lucide-react";
import type { GitAction, GitRepositoryInfo } from "../../electron/gitActions";
import type { GitGraphCommit } from "../types";
import type { CommitFilesState } from "../components/scm/ScmGraph";
import {
  generateCommitMessage,
  sendsDiffOnline,
} from "../features/git/commitMessageAi";
import { isAiReady } from "../features/ai/aiConfig";
import { branchNameProblem } from "../../electron/gitBranchName";
import type { QuickPickItem, QuickPickRequest } from "../components/QuickPick";
import type { ScmCommitOptions } from "../components/SourceControlView";
import { ipcErrorMessage, isTextDocument } from "./appShared";
import type { AppCtx11 } from "./appContext";

const smartCommitKey = "latexdo.git.smartCommit";
const messageHistoryKey = "latexdo.git.commitMessages";
const graphPageSize = 100;
const onlineConsentKey = "latexdo.git.aiCommitConsent";

export type CommitButtonState = "idle" | "busy" | "success" | "error";

function readMessageHistory(): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(messageHistoryKey) ?? "[]");
    return Array.isArray(stored)
      ? stored.filter((item) => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function rememberMessage(message: string): void {
  try {
    const history = [
      message,
      ...readMessageHistory().filter((item) => item !== message),
    ];
    window.localStorage.setItem(
      messageHistoryKey,
      JSON.stringify(history.slice(0, 30)),
    );
  } catch {
    // Message history is a convenience.
  }
}

/** The "…" button on a branch row; right-clicking the row presses it too. */
const branchActionsButton = {
  id: "actions",
  label: "Branch actions",
  icon: <Ellipsis size={14} />,
};

/** Actions after which the files on disk may differ from the open tabs. */
const changesFiles = new Set<GitAction["kind"]>([
  "pull",
  "sync",
  "checkout",
  "merge-branch",
  "stash",
  "stash-pop",
  "publish",
]);

interface ScmDeps {
  refreshGitData: () => Promise<void>;
  reloadOpenDocumentsFromDisk: (options?: {
    includeUnsaved?: boolean;
  }) => Promise<void>;
  closeGitDiffSession: () => void;
  commitGitChanges: () => Promise<boolean>;
}

/**
 * Source Control actions in the manner of Visual Studio Code's Git extension:
 * smart commit, commit & push / sync, branches through a quick pick, publish,
 * stash, undo last commit. Open files are saved first and reloaded after.
 */
export function useAppScm(ctx: AppCtx11, deps: ScmDeps) {
  const latest = useRef({ ctx, deps });
  latest.current = { ctx, deps };
  const { gitStatus } = ctx;
  const isRepoForGraph = Boolean(gitStatus?.isRepo);
  const graphStatusKey = gitStatus
    ? `${gitStatus.branch}:${gitStatus.headHash}:${gitStatus.ahead}:${gitStatus.behind}`
    : "";
  const refreshGraphRef = useRef<() => Promise<void>>(async () => {});
  const refreshGitRepoInfoRef = useRef<() => Promise<GitRepositoryInfo | null>>(
    async () => null,
  );
  const [gitRepoInfo, setGitRepoInfo] = useState<GitRepositoryInfo | null>(null);
  const [scmError, setScmError] = useState("");
  const [quickPick, setQuickPick] = useState<QuickPickRequest | null>(null);
  /** Shows a quick pick and resolves with the choice, or null on Escape. */
  const ask = useCallback(
    (request: Omit<QuickPickRequest, "onAccept" | "onCancel">) =>
      new Promise<{
        item: QuickPickItem | null;
        value: string;
        button?: string;
      } | null>((resolve) => {
        setQuickPick({
          ...request,
          onAccept: (item, value, button) => {
            setQuickPick(null);
            resolve({ item, value, button });
          },
          onCancel: () => {
            setQuickPick(null);
            resolve(null);
          },
        });
      }),
    [],
  );

  const confirm = useCallback(
    async (title: string, action: string) =>
      (
        await ask({
          title,
          placeholder: "Continue?",
          items: [
            { id: "ok", label: action },
            { id: "cancel", label: "Cancel" },
          ],
        })
      )?.item?.id === "ok",
    [ask],
  );

  const refreshGitRepoInfo = useCallback(async () => {
    const project = latest.current.ctx.projectIdRef.current;
    if (!project || !window.latexdo.getGitRepositoryInfo) {
      setGitRepoInfo(null);
      return null;
    }
    try {
      const info = await window.latexdo.getGitRepositoryInfo(project);
      setGitRepoInfo(info);
      return info;
    } catch {
      setGitRepoInfo(null);
      return null;
    }
  }, []);

  refreshGitRepoInfoRef.current = refreshGitRepoInfo;
  const isRepo = Boolean(gitStatus?.isRepo);
  const statusKey = gitStatus
    ? `${gitStatus.branch}:${gitStatus.headHash}:${gitStatus.upstream}:${gitStatus.ahead}:${gitStatus.behind}:${gitStatus.entries.length}`
    : "";
  useEffect(() => {
    if (isRepo) void refreshGitRepoInfo();
    else setGitRepoInfo(null);
  }, [isRepo, statusKey, refreshGitRepoInfo]);

  /** Saves edited tabs, so a commit or checkout works on what is on screen. */
  const saveDirtyDocuments = useCallback(async () => {
    const { documentsRef, saveDocument } = latest.current.ctx;
    const dirty = documentsRef.current.filter(
      (document) =>
        isTextDocument(document) && document.content !== document.savedContent,
    );
    for (const document of dirty) await saveDocument(document);
  }, []);

  const runScmAction = useCallback(
    async (action: GitAction): Promise<boolean> => {
      const { ctx: c, deps: d } = latest.current;
      const project = c.projectIdRef.current;
      if (!project) return false;
      c.setGitActionBusy(action.kind);
      setScmError("");
      try {
        if (changesFiles.has(action.kind) || action.kind === "commit") {
          await saveDirtyDocuments();
        }
        const result = await window.latexdo.runGitAction(project, action);
        if (action.kind === "commit") c.setGitCommitMessage("");
        if (result.commitMessage !== undefined)
          c.setGitCommitMessage(result.commitMessage);
        if (changesFiles.has(action.kind)) {
          d.closeGitDiffSession();
          await c.refreshProject(project);
          await d.reloadOpenDocumentsFromDisk();
        }
        if (action.kind === "commit" || action.kind === "undo-last-commit") {
          d.closeGitDiffSession();
        }
        await d.refreshGitData();
        await refreshGitRepoInfo();
        void refreshGraphRef.current();
        c.setStatusMessage(result.message);
        return true;
      } catch (error) {
        const message = ipcErrorMessage(error, "Git could not complete the action");
        setScmError(message);
        c.setStatusMessage(message);
        await d.refreshGitData().catch(() => undefined);
        return false;
      } finally {
        c.setGitActionBusy(null);
      }
    },
    [refreshGitRepoInfo, saveDirtyDocuments],
  );

  /** VS Code's commit: smart commit when nothing is staged, then push or sync. */
  const commitScm = useCallback(
    async (options: ScmCommitOptions = {}) => {
      const { ctx: c, deps: d } = latest.current;
      const status = c.gitStatus;
      if (!status?.isRepo || c.gitActionBusy) return;
      const message = c.gitCommitMessage.trim();
      if (!message && !options.amend) {
        setScmError("");
        c.setStatusMessage("Enter a commit message.");
        document.querySelector<HTMLTextAreaElement>(".scm-input textarea")?.focus();
        return;
      }
      const staged = status.entries.filter(
        (entry) => entry.staged && !entry.conflicted,
      );
      if (status.entries.some((entry) => entry.conflicted)) {
        setScmError(
          "Resolve the merge conflicts and stage the files before committing.",
        );
        return;
      }
      if (options.amend) {
        const answer = await ask({
          title: "Amend rewrites the last commit.",
          placeholder: "Replace the last commit with one that includes these changes?",
          items: [
            { id: "amend", label: "Amend the last commit" },
            { id: "cancel", label: "Cancel" },
          ],
        });
        if (answer?.item?.id !== "amend") return;
      }
      let all = Boolean(options.all);
      if (!all && !staged.length && !options.amend) {
        if (!status.entries.length) {
          c.setStatusMessage("There are no changes to commit.");
          return;
        }
        let always = false;
        try {
          always = window.localStorage.getItem(smartCommitKey) === "always";
        } catch {
          // No stored preference: ask.
        }
        if (!always) {
          const answer = await ask({
            title: "There are no staged changes to commit.",
            placeholder: "Stage all your changes and commit them directly?",
            items: [
              { id: "yes", label: "Yes", description: "Stage everything and commit" },
              { id: "always", label: "Always", description: "Don't ask again" },
              { id: "no", label: "Cancel" },
            ],
          });
          if (!answer || answer.item?.id === "no") return;
          if (answer.item?.id === "always") {
            try {
              window.localStorage.setItem(smartCommitKey, "always");
            } catch {
              // The answer still applies to this commit.
            }
          }
        }
        all = true;
      }
      setCommitState("busy");
      let committed: boolean;
      if (!all && !options.amend && !options.push && !options.sync) {
        await saveDirtyDocuments();
        committed = await d.commitGitChanges();
        await refreshGitRepoInfo();
      } else {
        committed = await runScmAction({
          kind: "commit",
          message,
          amend: options.amend,
          all,
          push: options.push,
        });
        if (committed && options.sync) await runScmAction({ kind: "sync" });
      }
      if (committed && message) rememberMessage(message);
      flashCommitState(committed ? "success" : "error");
      if (committed) void refreshGraphRef.current();
    },
    [ask, refreshGitRepoInfo, runScmAction, saveDirtyDocuments],
  );

  const createBranch = useCallback(async () => {
    const answer = await ask({
      title: "Create Branch",
      placeholder: "Please provide a new branch name",
      validate: (value) => (value.trim() ? branchNameProblem(value) : null),
    });
    if (!answer?.value.trim()) return;
    await runScmAction({ kind: "create-branch", branch: answer.value.trim() });
  }, [ask, runScmAction]);

  /** Right-click on a branch: checkout, merge, rename or delete it. */
  const branchActions = useCallback(
    async (name: string) => {
      const info = await refreshGitRepoInfo();
      const branch = info?.branches.find((candidate) => candidate.name === name);
      if (!info || !branch) {
        latest.current.ctx.setStatusMessage(`Branch ${name} was not found.`);
        return;
      }
      const current = info.branches.find(
        (candidate) => candidate.kind === "local" && candidate.current,
      );
      const local = branch.kind === "local";
      const items = [
        ...(branch.current
          ? []
          : [
              {
                id: "checkout",
                label: local ? "Checkout" : "Checkout (track locally)",
                icon: <GitBranch size={14} />,
              },
            ]),
        ...(!branch.current && current
          ? [{ id: "merge", label: `Merge into ${current.name}…` }]
          : []),
        ...(local ? [{ id: "rename", label: "Rename…" }] : []),
        ...(local && !branch.current
          ? [{ id: "delete", label: "Delete…", icon: <Trash2 size={14} /> }]
          : []),
      ];
      if (!items.length) return;
      const answer = await ask({
        title: name,
        placeholder: `Actions for ${name}`,
        items,
      });
      switch (answer?.item?.id) {
        case "checkout":
          await runScmAction({ kind: "checkout", branch: name });
          return;
        case "merge":
          if (
            current &&
            (await confirm(`Merge ${name} into ${current.name}?`, "Merge"))
          )
            await runScmAction({ kind: "merge-branch", branch: name });
          return;
        case "rename": {
          const renamed = await ask({
            title: `Rename ${name}`,
            placeholder: "New branch name",
            value: name,
            validate: (value) =>
              value.trim() === name
                ? "Enter a different name."
                : branchNameProblem(value),
          });
          const newName = renamed?.value.trim();
          if (newName && newName !== name)
            await runScmAction({ kind: "rename-branch", branch: name, newName });
          return;
        }
        case "delete":
          if (await confirm(`Delete the branch ${name}?`, "Delete"))
            await runScmAction({ kind: "delete-branch", branch: name });
          return;
      }
    },
    [ask, confirm, refreshGitRepoInfo, runScmAction],
  );

  const branchItems = (
    info: GitRepositoryInfo,
    kinds: ("local" | "remote")[],
    options: { deletable?: boolean } = {},
  ) =>
    kinds.flatMap((kind) => {
      const branches = info.branches.filter((branch) => branch.kind === kind);
      if (!branches.length) return [];
      return [
        {
          id: `separator:${kind}`,
          label: kind === "local" ? "branches" : "remote branches",
          separator: true,
        },
        ...branches.map((branch) => ({
          id: branch.name,
          label: branch.name,
          icon: kind === "local" ? <GitBranch size={14} /> : <Cloud size={14} />,
          description: `${branch.current ? "• " : ""}${branch.shortHash}`,
          detail: branch.subject,
          buttons: [
            branchActionsButton,
            ...(options.deletable && kind === "local" && !branch.current
              ? [{ id: "delete", label: "Delete branch", icon: <Trash2 size={14} /> }]
              : []),
          ],
        })),
      ];
    });

  /** Checkout to…: create a branch or switch to a local or remote one. */
  const pickBranch = useCallback(async () => {
    const info = (await refreshGitRepoInfo()) ?? latest.current.ctx.gitStatus;
    if (!info || !("branches" in info)) {
      latest.current.ctx.setStatusMessage("Open a Git repository first.");
      return;
    }
    const answer = await ask({
      placeholder: "Select a branch or tag to checkout",
      contextButton: branchActionsButton.id,
      items: [
        { id: "+create", label: "Create new branch…", icon: <Plus size={14} /> },
        ...branchItems(info, ["local", "remote"], { deletable: true }),
      ],
    });
    if (!answer?.item) return;
    if (answer.button === branchActionsButton.id) {
      await branchActions(answer.item.id);
      return;
    }
    if (answer.button === "delete") {
      await runScmAction({ kind: "delete-branch", branch: answer.item.id });
      return;
    }
    if (answer.item.id === "+create") {
      await createBranch();
      return;
    }
    const target = info.branches.find((branch) => branch.name === answer.item!.id);
    if (target?.current) return;
    await runScmAction({ kind: "checkout", branch: answer.item.id });
  }, [ask, branchActions, createBranch, refreshGitRepoInfo, runScmAction]);

  const deleteBranch = useCallback(async () => {
    const info = await refreshGitRepoInfo();
    if (!info) return;
    const others = {
      ...info,
      branches: info.branches.filter(
        (branch) => branch.kind === "local" && !branch.current,
      ),
    };
    if (!others.branches.length) {
      latest.current.ctx.setStatusMessage("There is no other local branch to delete.");
      return;
    }
    const answer = await ask({
      placeholder: "Select a branch to delete",
      items: branchItems(others, ["local"]),
    });
    if (answer?.item)
      await runScmAction({ kind: "delete-branch", branch: answer.item.id });
  }, [ask, refreshGitRepoInfo, runScmAction]);

  const publishBranch = useCallback(async () => {
    const info = await refreshGitRepoInfo();
    if (info?.remotes.length) {
      await runScmAction({ kind: "publish" });
      return;
    }
    const answer = await ask({
      title: "Publish Branch",
      placeholder: "Repository URL, e.g. https://github.com/you/paper.git",
      validate: (value) =>
        !value.trim() ||
        /^(?:https?:\/\/|ssh:\/\/|git@|file:\/\/|\/)\S+$/.test(value.trim())
          ? null
          : "Enter an https:// or git@ address of an empty repository.",
    });
    if (!answer?.value.trim()) return;
    await runScmAction({ kind: "publish", remoteUrl: answer.value.trim() });
  }, [ask, refreshGitRepoInfo, runScmAction]);

  const stashChanges = useCallback(async () => {
    const answer = await ask({
      title: "Stash (Include Untracked)",
      placeholder: "Stash message (optional)",
    });
    if (!answer) return;
    await runScmAction({ kind: "stash", message: answer.value });
  }, [ask, runScmAction]);

  const initRepository = useCallback(async () => {
    await runScmAction({ kind: "init" });
  }, [runScmAction]);

  const [commitState, setCommitState] = useState<CommitButtonState>("idle");
  const commitStateTimer = useRef<number | null>(null);
  /** Success and failure show on the button for a moment, then it resets. */
  const flashCommitState = useCallback((state: "success" | "error") => {
    setCommitState(state);
    if (commitStateTimer.current !== null)
      window.clearTimeout(commitStateTimer.current);
    commitStateTimer.current = window.setTimeout(
      () => setCommitState("idle"),
      state === "success" ? 1600 : 2600,
    );
  }, []);

  // --- Graph ---------------------------------------------------------------
  const [graphCommits, setGraphCommits] = useState<GitGraphCommit[]>([]);
  const [graphHasMore, setGraphHasMore] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphRefs, setGraphRefs] = useState<string>("auto");
  const [graphLimit, setGraphLimit] = useState(graphPageSize);
  const [expandedCommits, setExpandedCommits] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [commitFiles, setCommitFiles] = useState<ReadonlyMap<string, CommitFilesState>>(
    () => new Map(),
  );
  const [revealCommit, setRevealCommit] = useState<string | null>(null);
  const graphRequest = useRef(0);

  const refreshGraph = useCallback(
    async (options: { limit?: number; refs?: string } = {}) => {
      const project = latest.current.ctx.projectIdRef.current;
      if (!project || !window.latexdo.getGitGraph) return;
      const request = ++graphRequest.current;
      setGraphLoading(true);
      try {
        const result = await window.latexdo.getGitGraph(project, {
          limit: options.limit ?? graphLimit,
          refs: options.refs ?? graphRefs,
        });
        if (request !== graphRequest.current) return;
        // Keep the old rows until the new ones arrive: no flashing on refresh.
        setGraphCommits(result.commits);
        setGraphHasMore(result.hasMore);
        // Opened commits stay open while they still exist.
        const present = new Set(result.commits.map((commit) => commit.hash));
        setExpandedCommits(
          (current) => new Set([...current].filter((hash) => present.has(hash))),
        );
      } catch {
        if (request === graphRequest.current) setGraphHasMore(false);
      } finally {
        if (request === graphRequest.current) setGraphLoading(false);
      }
    },
    [graphLimit, graphRefs],
  );

  useEffect(() => {
    if (isRepoForGraph) void refreshGraph();
    else {
      setGraphCommits([]);
      setGraphHasMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRepoForGraph, graphStatusKey, graphRefs]);

  refreshGraphRef.current = () => refreshGraph();

  const loadMoreGraph = useCallback(() => {
    if (graphLoading) return;
    const limit = graphLimit + graphPageSize;
    setGraphLimit(limit);
    void refreshGraph({ limit });
  }, [graphLimit, graphLoading, refreshGraph]);

  const expandedRef = useRef(expandedCommits);
  expandedRef.current = expandedCommits;
  const toggleCommit = useCallback(async (commit: GitGraphCommit) => {
    const opening = !expandedRef.current.has(commit.hash);
    const next = new Set(expandedRef.current);
    if (opening) next.add(commit.hash);
    else next.delete(commit.hash);
    expandedRef.current = next;
    setExpandedCommits(next);
    const project = latest.current.ctx.projectIdRef.current;
    if (!opening || !project) return;
    setCommitFiles((current) => {
      if (current.get(commit.hash) && current.get(commit.hash) !== "loading")
        return current;
      return new Map(current).set(commit.hash, "loading");
    });
    try {
      const details = await window.latexdo.getGitCommitDetails(project, commit.hash);
      setCommitFiles((current) => new Map(current).set(commit.hash, details));
    } catch (error) {
      setCommitFiles((current) =>
        new Map(current).set(commit.hash, {
          error: ipcErrorMessage(error, "Could not read this commit."),
        }),
      );
    }
  }, []);

  const chooseGraphRefs = useCallback(async () => {
    const info = latest.current.ctx.gitStatus?.isRepo
      ? await refreshGitRepoInfoRef.current()
      : null;
    const branches = info?.branches ?? [];
    const answer = await ask({
      placeholder: "Select the branches to show in the graph",
      contextButton: branchActionsButton.id,
      items: [
        {
          id: "auto",
          label: "Auto",
          description: "The current branch and its remote",
        },
        { id: "all", label: "All branches" },
        ...branches.map((branch) => ({
          id: branch.name,
          label: branch.name,
          description:
            branch.kind === "remote" ? "remote" : branch.current ? "current" : "",
          buttons: [branchActionsButton],
        })),
      ],
    });
    if (!answer?.item) return;
    if (answer.button === branchActionsButton.id) {
      await branchActions(answer.item.id);
      return;
    }
    setGraphLimit(graphPageSize);
    setGraphRefs(answer.item.id);
  }, [ask, branchActions]);

  const goToCurrentCommit = useCallback(() => {
    const head = graphCommits.find((commit) => commit.isHead);
    if (head) setRevealCommit(`${head.hash}`);
    setTimeout(() => setRevealCommit(null), 50);
  }, [graphCommits]);

  // --- Commit message ------------------------------------------------------
  const [suggestingMessage, setSuggestingMessage] = useState(false);
  const aiAvailable = isAiReady(ctx.aiConfig, ctx.aiIsDesktop);
  const suggestCommitMessage = useCallback(async () => {
    const { ctx: c } = latest.current;
    const project = c.projectIdRef.current;
    if (!project) return;
    if (sendsDiffOnline(c.aiConfig)) {
      let consented = false;
      try {
        consented = window.localStorage.getItem(onlineConsentKey) === "yes";
      } catch {
        // Ask again.
      }
      if (!consented) {
        const answer = await ask({
          title: "Your changes will be sent to your AI provider to write the message.",
          placeholder: "Send the diff to your AI provider?",
          items: [
            { id: "yes", label: "Send it", description: "Don't ask again" },
            { id: "no", label: "Cancel" },
          ],
        });
        if (answer?.item?.id !== "yes") return;
        try {
          window.localStorage.setItem(onlineConsentKey, "yes");
        } catch {
          // The answer applies to this request.
        }
      }
    }
    setSuggestingMessage(true);
    setScmError("");
    try {
      const diff = await window.latexdo.getGitDiffForCommitMessage(project);
      if (!diff.trim()) {
        c.setStatusMessage("There are no changes to describe.");
        return;
      }
      c.setGitCommitMessage(await generateCommitMessage(c.aiConfig, diff));
    } catch (error) {
      setScmError(ipcErrorMessage(error, "The assistant could not suggest a message."));
    } finally {
      setSuggestingMessage(false);
    }
  }, [ask]);

  // --- Commit actions from the graph ---------------------------------------
  const [commitMenu, setCommitMenu] = useState<{
    commit: GitGraphCommit;
    x: number;
    y: number;
  } | null>(null);

  const runCommitAction = useCallback(
    async (
      kind:
        | "copy-hash"
        | "copy-message"
        | "branch-at"
        | "tag"
        | "cherry-pick"
        | "revert"
        | "checkout-commit",
      commit: GitGraphCommit,
    ) => {
      setCommitMenu(null);
      const short = commit.shortHash;
      if (kind === "copy-hash" || kind === "copy-message") {
        await navigator.clipboard?.writeText(
          kind === "copy-hash" ? commit.hash : commit.subject,
        );
        latest.current.ctx.setStatusMessage(
          kind === "copy-hash" ? `Copied ${short}` : "Copied the commit message",
        );
        return;
      }
      if (kind === "branch-at" || kind === "tag") {
        const answer = await ask({
          title:
            kind === "tag" ? `Create a tag at ${short}` : `Create a branch at ${short}`,
          placeholder: kind === "tag" ? "Tag name" : "Branch name",
          validate: (value) => (value.trim() ? branchNameProblem(value) : null),
        });
        const name = answer?.value.trim();
        if (!name) return;
        await runScmAction(
          kind === "tag"
            ? { kind: "tag", tag: name, commit: commit.hash }
            : { kind: "branch-at", branch: name, commit: commit.hash },
        );
        void refreshGraphRef.current();
        return;
      }
      const prompts = {
        "cherry-pick": [
          `Apply the changes of ${short} on top of this branch, as a new commit?`,
          "Cherry-pick",
        ],
        revert: [`Undo ${short} with a new commit that reverses it?`, "Revert"],
        "checkout-commit": [
          `Check out ${short}? You will leave your branch (detached HEAD); switch back to a branch to keep working.`,
          "Check out",
        ],
      } as const;
      const [title, label] = prompts[kind];
      if (!(await confirm(title, label))) return;
      await runScmAction({ kind, commit: commit.hash });
      void refreshGraphRef.current();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ask, confirm],
  );

  return {
    commitState,
    graphCommits,
    graphHasMore,
    graphLoading,
    graphRefs,
    refreshGraph,
    loadMoreGraph,
    expandedCommits,
    commitFiles,
    toggleCommit,
    chooseGraphRefs,
    goToCurrentCommit,
    revealCommit,
    aiAvailable,
    suggestingMessage,
    suggestCommitMessage,
    commitMessageHistory: readMessageHistory,
    commitMenu,
    setCommitMenu,
    runCommitAction,
    gitRepoInfo,
    scmError,
    setScmError,
    quickPick,
    askQuickPick: ask,
    runScmAction,
    commitScm,
    pickBranch,
    branchActions,
    createBranch,
    deleteBranch,
    publishBranch,
    stashChanges,
    initRepository,
  };
}
