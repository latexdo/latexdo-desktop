import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  CommitContextMenu,
  SourceControlView,
  type SourceControlViewProps,
} from "./SourceControlView";
import { QuickPick } from "./QuickPick";
import type { GitChangeEntry, GitGraphCommit, GitStatusSummary } from "../types";
import { ScmGraph } from "./scm/ScmGraph";

const modified: GitChangeEntry = {
  path: "chapters/intro.tex",
  indexStatus: "unmodified",
  worktreeStatus: "modified",
  staged: false,
  unstaged: true,
  untracked: false,
  conflicted: false,
};

function view(
  status: Partial<GitStatusSummary>,
  extra: Partial<SourceControlViewProps> = {},
) {
  const props: SourceControlViewProps = {
    status: { isRepo: true, branch: "main", entries: [], ...status },
    info: { remotes: ["origin"], branches: [], stashCount: 0, hasCommits: true },
    loading: false,
    busy: null,
    error: "",
    onDismissError: vi.fn(),
    message: "",
    onMessageChange: vi.fn(),
    onCommit: vi.fn(),
    onAction: vi.fn(),
    onRefresh: vi.fn(),
    onInit: vi.fn(),
    onPickBranch: vi.fn(),
    onCreateBranch: vi.fn(),
    onDeleteBranch: vi.fn(),
    onPublish: vi.fn(),
    onStash: vi.fn(),
    onStage: vi.fn(),
    onUnstage: vi.fn(),
    onDiscard: vi.fn(),
    onStageAll: vi.fn(),
    onUnstageAll: vi.fn(),
    onDiscardAll: vi.fn(),
    onOpenDiff: vi.fn(),
    onOpenFile: vi.fn(),
    onContextMenu: vi.fn(),
    graph: undefined,
    ...extra,
  };
  render(<SourceControlView {...props} />);
  return props;
}

describe("SourceControlView", () => {
  it("offers the existing branch deletion action from Source Control (#246)", () => {
    const props = view({});
    fireEvent.click(
      screen.getByRole("button", { name: "More Source Control actions" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Branch…" }));
    expect(props.onDeleteBranch).toHaveBeenCalledOnce();
  });

  it("offers to initialize a folder without a repository", () => {
    const props = view({ isRepo: false, error: "Not a git repository" });
    fireEvent.click(screen.getByRole("button", { name: "Initialize Repository" }));
    expect(props.onInit).toHaveBeenCalled();
  });

  it("commits with Ctrl+Enter and from the split button's menu", () => {
    const props = view({ entries: [modified] }, { message: "Fix intro" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Commit message" }), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(props.onCommit).toHaveBeenCalledWith();
    fireEvent.click(screen.getByRole("button", { name: "More commit actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Commit & Push" }));
    expect(props.onCommit).toHaveBeenCalledWith({ push: true });
  });

  it("keeps Commit disabled on a clean branch and provides sync in the repository toolbar", () => {
    const props = view({ upstream: "origin/main", ahead: 2, behind: 1 });
    const sync = screen.getByRole("button", { name: "Sync Changes" });
    expect(sync).toHaveAttribute("title", "Sync 1 incoming and 2 outgoing commits");
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "More commit actions" })).toBeEnabled();
    fireEvent.click(sync);
    expect(props.onAction).toHaveBeenCalledWith({ kind: "sync" });
  });

  it("provides Publish Branch in the toolbar without an upstream", () => {
    const props = view({});
    fireEvent.click(screen.getByRole("button", { name: "Publish Branch" }));
    expect(props.onPublish).toHaveBeenCalled();
  });

  it("keeps branch and pull actions accessible and prevents empty commits", () => {
    const props = view({ upstream: "origin/main", entries: [modified] });
    fireEvent.click(screen.getByRole("button", { name: "Switch branch: main" }));
    expect(props.onPickBranch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Pull changes" }));
    expect(props.onAction).toHaveBeenCalledWith({ kind: "pull" });
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Commit message" }), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("shows status letters and VS Code's row actions", () => {
    const props = view({ entries: [modified] });
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByText("chapters")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stage chapters/intro.tex" }));
    expect(props.onStage).toHaveBeenCalledWith("chapters/intro.tex");
    fireEvent.click(screen.getByRole("button", { name: "Discard chapters/intro.tex" }));
    expect(props.onDiscard).toHaveBeenCalledWith("chapters/intro.tex");
  });

  it("puts conflicted files in Merge Changes", () => {
    view({ entries: [{ ...modified, conflicted: true }] });
    expect(screen.getByRole("button", { name: "Merge Changes" })).toBeInTheDocument();
    expect(screen.getByText("!")).toBeInTheDocument();
  });

  it("runs Git actions from the More Actions menu", () => {
    const props = view({ upstream: "origin/main" });
    fireEvent.click(
      screen.getByRole("button", { name: "More Source Control actions" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Pull" }));
    expect(props.onAction).toHaveBeenCalledWith({ kind: "pull" });
    fireEvent.click(
      screen.getByRole("button", { name: "More Source Control actions" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Checkout to…" }));
    expect(props.onPickBranch).toHaveBeenCalled();
  });
});

describe("SourceControlView details", () => {
  it("recalls earlier commit messages with the up arrow", () => {
    const onMessageChange = vi.fn();
    view(
      { entries: [modified] },
      { onMessageChange, messageHistory: () => ["Second", "First"] },
    );
    const box = screen.getByRole("textbox", { name: "Commit message" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(onMessageChange).toHaveBeenLastCalledWith("Second");
  });

  it("shows the commit result on the button", () => {
    view({ entries: [modified] }, { commitState: "success" });
    expect(screen.getByRole("button", { name: "Commit" })).toHaveTextContent(
      "Committed",
    );
  });

  it("offers the AI suggestion only when an assistant is set up", () => {
    const onSuggestMessage = vi.fn();
    view({ entries: [modified] }, { onSuggestMessage });
    fireEvent.click(
      screen.getByRole("button", { name: "Suggest a commit message with AI" }),
    );
    expect(onSuggestMessage).toHaveBeenCalled();
  });

  it("commits everything from the split button's menu", () => {
    const props = view({ entries: [modified] }, { message: "x" });
    fireEvent.click(screen.getByRole("button", { name: "More commit actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Commit All" }));
    expect(props.onCommit).toHaveBeenCalledWith({ all: true });
  });
});

const commits: GitGraphCommit[] = [
  {
    hash: "b".repeat(40),
    shortHash: "bbbbbbb",
    parents: ["a".repeat(40)],
    subject: "Some updates to the papers",
    authorName: "Omar",
    authorEmail: "o@example.invalid",
    authoredAt: "2026-10-14T10:00:00Z",
    refs: [{ name: "main", kind: "local-branch", current: true }],
    lane: 0,
    segments: [{ fromLane: 0, toLane: 0, kind: "vertical" }],
    isHead: true,
  },
  {
    hash: "a".repeat(40),
    shortHash: "aaaaaaa",
    parents: [],
    subject: "Adding users notes",
    authorName: "Omar",
    authorEmail: "o@example.invalid",
    authoredAt: "2026-10-13T10:00:00Z",
    refs: [],
    lane: 0,
    segments: [],
    isHead: false,
  },
];

describe("ScmGraph", () => {
  it("offers reverting the selected commit (#249)", () => {
    const onAction = vi.fn();
    render(
      <CommitContextMenu
        commit={commits[0]}
        x={0}
        y={0}
        onAction={onAction}
        onOpen={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Revert Commit…" }));
    expect(onAction).toHaveBeenCalledWith("revert");
  });

  it("lists commits with their branch and opens one to show its files", () => {
    const onToggle = vi.fn();
    const onOpenFile = vi.fn();
    const files = new Map([
      [
        commits[0].hash,
        {
          hash: commits[0].hash,
          changedFiles: [
            { path: "content/background.tex", status: "modified" as const },
          ],
        } as never,
      ],
    ]);
    render(
      <ScmGraph
        commits={commits}
        loading={false}
        hasMore={false}
        onLoadMore={vi.fn()}
        expanded={new Set([commits[0].hash])}
        onToggle={onToggle}
        files={files}
        onOpenFile={onOpenFile}
        onContextMenu={vi.fn()}
      />,
    );
    expect(screen.getByText("main")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("treeitem", { name: /Adding users notes/ }));
    expect(onToggle).toHaveBeenCalledWith(commits[1]);
    fireEvent.click(screen.getByRole("treeitem", { name: /background\.tex/ }));
    expect(onOpenFile).toHaveBeenCalledWith(commits[0], {
      path: "content/background.tex",
      status: "modified",
    });
  });

  it("opens branch actions when a branch label is right-clicked", () => {
    const onBranchContextMenu = vi.fn();
    const onContextMenu = vi.fn();
    render(
      <ScmGraph
        commits={commits}
        loading={false}
        hasMore={false}
        onLoadMore={vi.fn()}
        expanded={new Set()}
        onToggle={vi.fn()}
        files={new Map()}
        onOpenFile={vi.fn()}
        onContextMenu={onContextMenu}
        onBranchContextMenu={onBranchContextMenu}
      />,
    );
    fireEvent.contextMenu(screen.getByText("main"));
    expect(onBranchContextMenu).toHaveBeenCalledWith("main");
    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it("asks for more commits from the Load more row", () => {
    const onLoadMore = vi.fn();
    render(
      <ScmGraph
        commits={commits}
        loading={false}
        hasMore
        onLoadMore={onLoadMore}
        expanded={new Set()}
        onToggle={vi.fn()}
        files={new Map()}
        onOpenFile={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load more commits" }));
    expect(onLoadMore).toHaveBeenCalled();
  });
});

describe("QuickPick", () => {
  it("filters items and accepts with Enter", () => {
    const onAccept = vi.fn();
    render(
      <QuickPick
        request={{
          placeholder: "Select a branch",
          items: [
            { id: "main", label: "main" },
            { id: "draft", label: "draft" },
          ],
          onAccept,
          onCancel: vi.fn(),
        }}
      />,
    );
    const input = screen.getByRole("combobox", { name: "Select a branch" });
    fireEvent.change(input, { target: { value: "dra" } });
    expect(screen.queryByRole("option", { name: "main" })).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAccept).toHaveBeenCalledWith(
      expect.objectContaining({ id: "draft" }),
      "dra",
    );
  });

  it("presses the context button when an item is right-clicked", () => {
    const onAccept = vi.fn();
    render(
      <QuickPick
        request={{
          placeholder: "Select the branches to show in the graph",
          contextButton: "actions",
          items: [
            { id: "all", label: "All branches" },
            {
              id: "origin/master",
              label: "origin/master",
              buttons: [{ id: "actions", label: "Branch actions", icon: "…" }],
            },
          ],
          onAccept,
          onCancel: vi.fn(),
        }}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("option", { name: /All branches/ }));
    expect(onAccept).not.toHaveBeenCalled();
    fireEvent.contextMenu(screen.getByRole("option", { name: /origin\/master/ }));
    expect(onAccept).toHaveBeenCalledWith(
      expect.objectContaining({ id: "origin/master" }),
      "",
      "actions",
    );
  });

  it("reports an item's inline button without accepting the row", () => {
    const onAccept = vi.fn();
    render(
      <QuickPick
        request={{
          placeholder: "Select a branch",
          items: [
            { id: "main", label: "main" },
            {
              id: "draft",
              label: "draft",
              buttons: [{ id: "delete", label: "Delete branch", icon: "x" }],
            },
          ],
          onAccept,
          onCancel: vi.fn(),
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete branch draft" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(
      expect.objectContaining({ id: "draft" }),
      "",
      "delete",
    );
  });

  it("validates typed input and cancels with Escape", () => {
    const onAccept = vi.fn();
    const onCancel = vi.fn();
    render(
      <QuickPick
        request={{
          placeholder: "Branch name",
          validate: (value) => (value.includes(" ") ? "No spaces" : null),
          onAccept,
          onCancel,
        }}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Branch name" });
    fireEvent.change(input, { target: { value: "bad name" } });
    expect(screen.getByText("No spaces")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAccept).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "good-name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAccept).toHaveBeenCalledWith(null, "good-name");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("source-control navigation", () => {
  it("supports keyboard menu navigation, Escape and outside dismissal", () => {
    view({ entries: [modified] });
    fireEvent.click(screen.getByLabelText("More Source Control actions"));
    const menu = screen.getByRole("menu");
    const first = document.activeElement;
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).not.toBe(first);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByLabelText("More Source Control actions"));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("collapses nested folders, opens files and dispatches row actions", () => {
    localStorage.setItem("latexdo.scm.viewMode", "list");
    const props = view({ entries: [modified] });
    fireEvent.click(screen.getByLabelText("View as Tree"));
    const folder = screen.getByRole("button", { name: "chapters" });
    fireEvent.click(folder);
    expect(screen.queryByLabelText(/Open working tree diff/)).toBeNull();
    fireEvent.click(folder);
    const row = screen.getByLabelText(/Open working tree diff/);
    fireEvent.doubleClick(row);
    expect(props.onOpenFile).toHaveBeenCalledWith(modified.path);
    fireEvent.contextMenu(row, { clientX: 10, clientY: 20 });
    expect(props.onContextMenu).toHaveBeenCalledWith(modified, "changes", 10, 20);
    fireEvent.click(screen.getByLabelText(`Open file ${modified.path}`));
    fireEvent.click(screen.getByLabelText(`Discard ${modified.path}`));
    expect(props.onDiscard).toHaveBeenCalledWith(modified.path);
    fireEvent.click(screen.getByLabelText("View as List"));
    expect(screen.getByText("chapters")).toBeVisible();
  });
  it("edits commit messages, restores an empty draft and dismisses errors", () => {
    const props = view(
      { entries: [modified] },
      { messageHistory: () => ["Previous"], error: "Git failed" },
    );
    const box = screen.getByLabelText("Commit message");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(props.onMessageChange).toHaveBeenLastCalledWith("Previous");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(props.onMessageChange).toHaveBeenLastCalledWith("");
    fireEvent.change(box, { target: { value: "New message" } });
    expect(props.onMessageChange).toHaveBeenLastCalledWith("New message");
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(props.onDismissError).toHaveBeenCalledOnce();
  });
});

it("resizes and collapses the commit graph and runs its toolbar actions", () => {
  const graph: NonNullable<SourceControlViewProps["graph"]> = {
    commits,
    loading: false,
    hasMore: false,
    refs: "all",
    expanded: new Set(),
    files: new Map(),
    revealHash: null,
    onLoadMore: vi.fn(),
    onToggle: vi.fn(),
    onOpenFile: vi.fn(),
    onContextMenu: vi.fn(),
    onChooseRefs: vi.fn(),
    onGoToCurrent: vi.fn(),
    onRefresh: vi.fn(),
  };
  const props = view({ entries: [modified], upstream: "origin/main" }, { graph });
  const sash = screen.getByRole("separator", { name: "Resize the graph" });
  const section = document.querySelector<HTMLElement>(".scm-graph-section")!;
  const initial = section.style.height;
  fireEvent.keyDown(sash, { key: "ArrowUp" });
  expect(section.style.height).not.toBe(initial);
  fireEvent.keyDown(sash, { key: "ArrowDown" });
  expect(section.style.height).toBe(initial);
  fireEvent.pointerDown(sash, { clientY: 200 });
  fireEvent.pointerMove(window, { clientY: 250 });
  fireEvent.pointerUp(window);
  expect(section.style.height).not.toBe(initial);
  for (const kind of ["Fetch", "Pull", "Push"]) {
    fireEvent.click(screen.getByLabelText(kind));
    expect(props.onAction).toHaveBeenLastCalledWith({ kind: kind.toLowerCase() });
  }
  fireEvent.click(screen.getByLabelText("Choose the branches shown in the graph"));
  expect(graph.onChooseRefs).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByLabelText("Go to Current Commit"));
  expect(graph.onGoToCurrent).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByLabelText("Refresh the graph"));
  expect(graph.onRefresh).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByLabelText("Graph"));
  expect(screen.queryByRole("separator", { name: "Resize the graph" })).toBeNull();
});
