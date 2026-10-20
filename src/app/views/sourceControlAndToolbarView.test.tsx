import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCtx } from "../appContext";

const captured = vi.hoisted(() => ({
  scm: null as Record<string, unknown> | null,
  commitMenu: null as Record<string, unknown> | null,
  graph: null as Record<string, unknown> | null,
  table: null as Record<string, unknown> | null,
}));

vi.mock("../../components/SourceControlView", () => ({
  SourceControlView: (props: Record<string, unknown>) => {
    captured.scm = props;
    return <div data-testid="scm" />;
  },
  CommitContextMenu: (props: Record<string, unknown>) => {
    captured.commitMenu = props;
    return <div data-testid="commit-menu" />;
  },
}));

vi.mock("../../components/KnowledgeGraphView", () => ({
  KnowledgeGraphView: (props: Record<string, unknown>) => {
    captured.graph = props;
    return <div data-testid="graph" />;
  },
}));

vi.mock("../../components/TableSizePicker", () => ({
  TableSizePicker: (props: Record<string, unknown>) => {
    captured.table = props;
    return <div data-testid="table-picker" />;
  },
}));

import {
  renderKnowledgeGraphTab,
  renderScmContextMenu,
  renderSidebarPanel,
  renderSourceToolbar,
} from "./sourceControlAndToolbarView";

/** A context whose unspecified members are spies. */
function makeCtx(
  values: Record<string, unknown> = {},
): AppCtx & Record<string, ReturnType<typeof vi.fn>> {
  const spies = new Map<string, ReturnType<typeof vi.fn>>();
  return new Proxy(values, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (!spies.has(key))
        spies.set(
          key,
          vi.fn(async () => undefined),
        );
      return spies.get(key);
    },
    has: () => true,
  }) as never;
}

beforeEach(() => {
  captured.scm = captured.commitMenu = captured.graph = captured.table = null;
});

const entry = { path: "chapters/a.tex" };

describe("renderScmContextMenu", () => {
  it.each([
    ["Open Diff", "openGitDiffEditor", [entry, "changes"]],
    ["Open File", "openGitFile", ["chapters/a.tex"]],
    ["Stage Changes", "stageGitEntry", ["chapters/a.tex"]],
    ["Discard Changes", "discardGitEntry", ["chapters/a.tex"]],
    ["Reveal in File Manager", "revealGitFile", ["chapters/a.tex"]],
    ["Copy Path", "copyGitPath", ["chapters/a.tex"]],
    ["Open File History", "openGitFileHistory", ["chapters/a.tex"]],
  ])("%s closes the menu and runs %s", (label, method, args) => {
    const ctx = makeCtx({ gitContextMenu: { entry, area: "changes", x: 10, y: 20 } });
    render(renderScmContextMenu(ctx));
    const menu = screen.getByRole("menu", { name: "Actions for chapters/a.tex" });
    expect(menu.style.left).toBe("10px");
    expect(screen.queryByText("Unstage Changes")).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(`${label}$`) }));
    expect(ctx.setGitContextMenu).toHaveBeenCalledWith(null);
    expect(ctx[method]).toHaveBeenCalledWith(...args);
  });

  it("offers unstaging for staged files and keeps the menu on screen", () => {
    const ctx = makeCtx({
      gitContextMenu: { entry, area: "staged", x: 99999, y: 99999 },
    });
    render(renderScmContextMenu(ctx));
    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe(`${window.innerWidth - 210}px`);
    expect(menu.style.top).toBe(`${window.innerHeight - 260}px`);
    expect(screen.queryByText("Stage Changes")).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /Unstage Changes/ }));
    expect(ctx.unstageGitEntry).toHaveBeenCalledWith("chapters/a.tex");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    menu.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("renderSidebarPanel", () => {
  const commit = { hash: "abc", parents: ["p0"] };

  function base(values: Record<string, unknown> = {}) {
    return makeCtx({
      gitStatus: undefined,
      gitRepoInfo: { branch: "main" },
      gitLoading: false,
      gitActionBusy: false,
      scmError: "",
      gitCommitMessage: "msg",
      gitDiffSession: null,
      gitContextMenu: null,
      commitMenu: null,
      aiAvailable: true,
      commitMessageHistory: [],
      commitState: null,
      suggestingMessage: false,
      graphCommits: [],
      graphLoading: false,
      graphHasMore: false,
      graphRefs: [],
      expandedCommits: new Set<string>(),
      commitFiles: {},
      revealCommit: null,
      goToCurrentCommit: vi.fn(),
      loadMoreGraph: vi.fn(),
      ...values,
    });
  }

  it("wires every source control callback", () => {
    const ctx = base();
    render(renderSidebarPanel(ctx));
    const props = captured.scm as Record<string, (...args: unknown[]) => unknown>;
    expect(props.status).toBeNull();
    expect(props.activeDiff).toBeNull();

    const calls: Array<[string, string, unknown[], unknown[]]> = [
      ["onDismissError", "setScmError", [], [""]],
      ["onCommit", "commitScm", [{ amend: true }], [{ amend: true }]],
      ["onAction", "runScmAction", ["pull"], ["pull"]],
      ["onRefresh", "refreshSourceControl", [], []],
      ["onInit", "initRepository", [], []],
      ["onPickBranch", "pickBranch", [], []],
      ["onCreateBranch", "createBranch", [], []],
      ["onDeleteBranch", "deleteBranch", [], []],
      ["onPublish", "publishBranch", [], []],
      ["onStash", "stashChanges", [], []],
      ["onStage", "stageGitEntry", ["a"], ["a"]],
      ["onUnstage", "unstageGitEntry", ["a"], ["a"]],
      ["onDiscard", "discardGitEntry", ["a"], ["a"]],
      ["onStageAll", "stageAllGitEntries", [], []],
      ["onUnstageAll", "unstageAllGitEntries", [], []],
      ["onDiscardAll", "discardAllGitEntries", [], []],
      ["onOpenDiff", "openGitDiffEditor", [entry, "staged"], [entry, "staged"]],
      ["onOpenFile", "openGitFile", ["a"], ["a"]],
      [
        "onContextMenu",
        "setGitContextMenu",
        [entry, "changes", 1, 2],
        [{ entry, area: "changes", x: 1, y: 2 }],
      ],
      ["onSuggestMessage", "suggestCommitMessage", [], []],
    ];
    for (const [prop, method, args, expected] of calls) {
      props[prop](...args);
      expect(ctx[method]).toHaveBeenCalledWith(...expected);
    }
    expect(props.onMessageChange).toBe(ctx.setGitCommitMessage);

    const graph = props.graph as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    graph.onToggle(commit);
    expect(ctx.toggleCommit).toHaveBeenCalledWith(commit);
    graph.onOpenFile(commit, { path: "f.tex" });
    expect(ctx.openGitCommitRevisionDiff).toHaveBeenCalledWith("abc", "f.tex", "p0");
    graph.onContextMenu(commit, 3, 4);
    expect(ctx.setCommitMenu).toHaveBeenCalledWith({ commit, x: 3, y: 4 });
    graph.onBranchContextMenu("dev");
    expect(ctx.branchActions).toHaveBeenCalledWith("dev");
    graph.onChooseRefs();
    expect(ctx.chooseGraphRefs).toHaveBeenCalled();
    graph.onRefresh();
    expect(ctx.refreshGraph).toHaveBeenCalled();
    expect(graph.onGoToCurrent).toBe(ctx.goToCurrentCommit);
    expect(graph.onLoadMore).toBe(ctx.loadMoreGraph);
  });

  it("has no message suggestions without AI", () => {
    render(renderSidebarPanel(base({ aiAvailable: false, gitStatus: { files: [] } })));
    expect(captured.scm!.onSuggestMessage).toBeUndefined();
    expect(captured.scm!.status).toEqual({ files: [] });
  });

  it.each([
    ["index", { path: "a.tex", area: "staged" }],
    ["working-tree", { path: "a.tex", area: "changes" }],
    ["commit", null],
  ])("marks the active %s diff", (kind, expected) => {
    render(
      renderSidebarPanel(
        base({ gitDiffSession: { relativePath: "a.tex", modifiedRef: { kind } } }),
      ),
    );
    expect(captured.scm!.activeDiff).toEqual(expected);
  });

  it("shows the file context menu and the commit menu", () => {
    const ctx = base({
      gitContextMenu: { entry, area: "changes", x: 0, y: 0 },
      commitMenu: { commit, x: 5, y: 6 },
    });
    render(renderSidebarPanel(ctx));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    const menu = captured.commitMenu as Record<string, (...args: unknown[]) => unknown>;
    expect(menu.x).toBe(5);
    menu.onClose();
    expect(ctx.setCommitMenu).toHaveBeenCalledWith(null);
    menu.onAction("revert");
    expect(ctx.runCommitAction).toHaveBeenCalledWith("revert", commit);
    menu.onOpen();
    expect(ctx.toggleCommit).toHaveBeenCalledWith(commit);
  });

  it("does not collapse an expanded commit when opening it from the menu", () => {
    const ctx = base({
      commitMenu: { commit, x: 0, y: 0 },
      expandedCommits: new Set(["abc"]),
    });
    render(renderSidebarPanel(ctx));
    (captured.commitMenu!.onOpen as () => void)();
    expect(ctx.toggleCommit).not.toHaveBeenCalled();
  });
});

describe("renderSourceToolbar", () => {
  function toolbar(values: Record<string, unknown> = {}) {
    const ctx = makeCtx({
      activeDocumentIsAsymptote: false,
      activeDocumentIsLatex: true,
      collaborationState: { enabled: false },
      compileProgress: 0,
      compiling: false,
      currentLineHasBookmark: false,
      documentOutline: [
        { id: "s1", line: 3, column: 1, level: 1, detail: "§", label: "Intro" },
        { id: "s2", line: 9, column: 2, level: 3, detail: "§§", label: "Deep" },
      ],
      latexEditorView: "code",
      mode: "author",
      rootFile: "main.tex",
      shareButtonDisabled: false,
      shareButtonLabel: "Share",
      shareButtonTitle: "Share project",
      texFiles: [
        { path: "/p/main.tex", relativePath: "main.tex" },
        { path: "/p/b.tex", relativePath: "chapters/b.tex" },
      ],
      ...values,
    });
    render(renderSourceToolbar(ctx));
    return ctx;
  }

  it("changes the root file and jumps through the outline", () => {
    const ctx = toolbar();
    const [root, outline] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    fireEvent.change(root, { target: { value: "chapters/b.tex" } });
    expect(ctx.setRootFile).toHaveBeenCalledWith("chapters/b.tex");
    expect(screen.getByRole("option", { name: /§§ Deep/ }).textContent).toBe(
      "  §§ Deep",
    );
    fireEvent.change(outline, { target: { value: "s2" } });
    expect(ctx.revealOutlineLine).toHaveBeenCalledWith(9, 2);
    expect(outline.value).toBe("");
    fireEvent.change(outline, { target: { value: "" } });
    expect(ctx.revealOutlineLine).toHaveBeenCalledTimes(1);
  });

  it("switches modes and editor views, and opens sharing", () => {
    const ctx = toolbar({ mode: "reviewer", collaborationState: { enabled: true } });
    expect(screen.getByTitle("Reviewer Mode")).toHaveClass("active");
    for (const [title, mode] of [
      ["Author Mode", "author"],
      ["Reviewer Mode", "reviewer"],
      ["Rebuttal Mode", "rebuttal"],
    ]) {
      fireEvent.click(screen.getByTitle(title));
      expect(ctx.setMode).toHaveBeenCalledWith(mode);
    }
    expect(screen.getByTitle("Code editor")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTitle("Code editor"));
    fireEvent.click(screen.getByTitle("Visual editor"));
    expect(vi.mocked(ctx.setLatexEditorView).mock.calls).toEqual([["code"], ["visual"]]);
    const share = screen.getByRole("button", { name: "Share project" });
    expect(share).toHaveClass("active");
    fireEvent.click(share);
    expect(ctx.openShareDialog).toHaveBeenCalled();
  });

  it("runs every formatting command", () => {
    const ctx = toolbar();
    const byTitle: Array<[string, string]> = [
      ["Bold (\\textbf{})", "bold"],
      ["Italic (\\emph{})", "italic"],
      ["Underline (\\underline{})", "underline"],
      ["Inline math", "math"],
      ["Section (\\section{})", "section"],
      ["Subsection (\\subsection{})", "subsection"],
      ["Equation block", "equation"],
      ["Bullet list", "itemize"],
      ["Numbered list", "enumerate"],
      ["Citation (\\cite{})", "cite"],
      ["Reference (\\ref{})", "ref"],
      ["Link (\\href{}{})", "href"],
    ];
    for (const [title, command] of byTitle) {
      fireEvent.click(screen.getByTitle(title));
      expect(ctx.applyLatexToolbarCommand).toHaveBeenLastCalledWith(command);
    }
    fireEvent.click(screen.getByTitle("Open link at cursor"));
    expect(ctx.openLinkAtCursor).toHaveBeenCalled();
    (captured.table!.onAlignColumns as () => void)();
    expect(ctx.applyLatexToolbarCommand).toHaveBeenLastCalledWith("formatTable");
    expect(captured.table!.onInsert).toBe(ctx.insertLatexTable);
    fireEvent.click(screen.getByRole("button", { name: "Bookmark current line" }));
    expect(ctx.toggleBookmarkAtCurrentLine).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tidy up the LaTeX layout" }));
    expect(ctx.applyLatexPrettier).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review this paper with AI" }));
    expect(ctx.reviewPaperWithAi).toHaveBeenCalled();
    const compile = screen.getByTitle("Compile");
    expect(compile).toBeEnabled();
    fireEvent.click(compile);
    expect(ctx.compile).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Cancel compile" })).toBeNull();
  });

  it("marks a bookmarked line", () => {
    toolbar({ currentLineHasBookmark: true });
    const button = screen.getByRole("button", { name: "Remove bookmark at cursor" });
    expect(button).toHaveClass("active");
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("hides the LaTeX tools for other documents and in the visual editor", () => {
    toolbar({ activeDocumentIsLatex: false });
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.queryByRole("group", { name: "Editor view" })).toBeNull();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("hides the formatting bar in the visual editor and an empty outline", () => {
    toolbar({ latexEditorView: "visual", documentOutline: [] });
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByTitle("Visual editor")).toHaveClass("active");
  });

  it("compiles Asymptote without a root file and shows progress while compiling", () => {
    const ctx = toolbar({
      rootFile: "",
      activeDocumentIsAsymptote: true,
      compiling: true,
      compileProgress: 40,
    });
    expect(
      screen.queryByRole("button", { name: "Review this paper with AI" }),
    ).toBeNull();
    expect(screen.getByTitle("Start another background compile")).toHaveTextContent(
      "40%",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel compile" }));
    expect(ctx.cancelCompile).toHaveBeenCalled();
  });

  it("says Compiling before progress is known, and names Asymptote compiles", () => {
    toolbar({ compiling: true, compileProgress: 0 });
    expect(screen.getByTitle("Start another background compile")).toHaveTextContent(
      "Compiling",
    );
  });

  it("titles an idle Asymptote compile and disables compiling without a root", () => {
    toolbar({ rootFile: "", activeDocumentIsAsymptote: true });
    expect(screen.getByTitle("Compile Asymptote")).toBeEnabled();
  });

  it("cannot compile without a root file", () => {
    toolbar({ rootFile: "" });
    expect(screen.getByTitle("Compile")).toBeDisabled();
  });
});

describe("renderKnowledgeGraphTab", () => {
  it("passes the graph state and clears the filter", () => {
    const ctx = makeCtx({
      citationAnalysis: { bibFiles: ["refs.bib"] },
      knowledgeGraph: { nodes: [] },
    });
    render(renderKnowledgeGraphTab(ctx));
    expect(
      screen.getByRole("tabpanel", { name: "Knowledge Graph" }),
    ).toBeInTheDocument();
    expect(captured.graph!.bibFiles).toEqual(["refs.bib"]);
    expect(captured.graph!.graph).toEqual({ nodes: [] });
    expect(captured.graph!.onInsertCitation).toBe(ctx.insertCitationKey);
    (captured.graph!.onClearFilter as () => void)();
    expect(ctx.setGraphFilter).toHaveBeenCalledWith({
      keys: null,
      label: "All bibliography entries",
    });
  });
});
