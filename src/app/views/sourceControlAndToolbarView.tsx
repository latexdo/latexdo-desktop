import {
  Bookmark,
  BookOpenCheck,
  BookOpenText,
  Bold,
  ChevronDown,
  Code2,
  ExternalLink,
  Heading1,
  Heading2,
  History,
  Italic,
  Link,
  List,
  ListOrdered,
  LoaderCircle,
  MessageSquare,
  Play,
  Sigma,
  Underline,
  User,
  WandSparkles,
  X,
} from "lucide-react";
import { TableSizePicker } from "../../components/TableSizePicker";
import { KnowledgeGraphView } from "../../components/KnowledgeGraphView";
import { pathForDisplay } from "../../pathDisplay";
import type { AppCtx } from "../appContext";
import {
  CommitContextMenu,
  SourceControlView,
} from "../../components/SourceControlView";

export function renderScmContextMenu(ctx: AppCtx) {
  const { entry, area, x, y } = ctx.gitContextMenu!;
  const action = (
    label: string,
    run: () => unknown,
    danger = false,
    disabled = false,
  ) => (
    <button
      type="button"
      role="menuitem"
      className={danger ? "danger" : undefined}
      disabled={disabled}
      onClick={() => {
        ctx.setGitContextMenu(null);
        void run();
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      className="scm-context-menu scm-file-context-menu"
      role="menu"
      aria-label={`Actions for ${entry.path}`}
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 288)),
        top: Math.max(8, Math.min(y, window.innerHeight - 380)),
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {action("Open Changes", () => ctx.openGitDiffEditor(entry, area))}
      {action(
        "Open File",
        () => ctx.openGitFile(entry.path),
        false,
        entry.worktreeStatus === "deleted",
      )}
      {action(
        "Open Changes at HEAD",
        () =>
          ctx.openGitCommitRevisionDiff(
            ctx.gitStatus!.headHash!,
            entry.originalPath ?? entry.path,
          ),
        false,
        !ctx.gitStatus?.headHash || entry.untracked || entry.indexStatus === "added",
      )}
      {action("File History", () => ctx.openGitFileHistory(entry.path))}
      <span className="scm-context-menu-separator" role="separator" />
      {area === "staged"
        ? action("Unstage Changes", () => ctx.unstageGitEntry(entry.path))
        : action("Stage Changes", () => ctx.stageGitEntry(entry.path))}
      {area === "changes" &&
        action("Revert Changes…", () => ctx.discardGitEntry(entry.path), true)}
      <span className="scm-context-menu-separator" role="separator" />
      {action("Reveal in File Manager", () => ctx.revealGitFile(entry.path))}
      {action(
        "Reveal in Explorer",
        async () => {
          await ctx.openGitFile(entry.path);
          ctx.openSidebar("explorer");
        },
        false,
        entry.worktreeStatus === "deleted",
      )}
      <span className="scm-context-menu-separator" role="separator" />
      {action(
        "Copy Changes (Patch)",
        () => ctx.copyGitPatch(entry.path, area),
        false,
        entry.untracked || entry.conflicted,
      )}
      {action("Copy Relative Path", () => ctx.copyGitPath(entry.path))}
    </div>
  );
}

export function renderSidebarPanel(ctx: AppCtx) {
  const {
    commitScm,
    createBranch,
    deleteBranch,
    discardAllGitEntries,
    discardGitEntry,
    gitActionBusy,
    gitCommitMessage,
    gitContextMenu,
    gitDiffSession,
    gitLoading,
    gitRepoInfo,
    gitStatus,
    initRepository,
    openGitDiffEditor,
    openGitFile,
    pickBranch,
    publishBranch,
    refreshSourceControl,
    runScmAction,
    scmError,
    setGitCommitMessage,
    setGitContextMenu,
    setScmError,
    stageAllGitEntries,
    stageGitEntry,
    stashChanges,
    unstageAllGitEntries,
    unstageGitEntry,
    aiAvailable,
    branchActions,
    chooseGraphRefs,
    commitFiles,
    commitMenu,
    commitMessageHistory,
    commitState,
    expandedCommits,
    goToCurrentCommit,
    graphCommits,
    graphHasMore,
    graphLoading,
    graphRefs,
    loadMoreGraph,
    openGitCommitRevisionDiff,
    refreshGraph,
    revealCommit,
    runCommitAction,
    setCommitMenu,
    suggestCommitMessage,
    suggestingMessage,
    toggleCommit,
  } = ctx;
  return (
    <div className="sidebar-panel source-control-panel">
      <SourceControlView
        status={gitStatus ?? null}
        info={gitRepoInfo}
        loading={gitLoading}
        busy={gitActionBusy}
        error={scmError}
        onDismissError={() => setScmError("")}
        message={gitCommitMessage}
        onMessageChange={setGitCommitMessage}
        activeDiff={
          gitDiffSession &&
          (gitDiffSession.modifiedRef.kind === "index" ||
            gitDiffSession.modifiedRef.kind === "working-tree")
            ? {
                path: gitDiffSession.relativePath,
                area:
                  gitDiffSession.modifiedRef.kind === "index" ? "staged" : "changes",
              }
            : null
        }
        onCommit={(options) => void commitScm(options)}
        onAction={(action) => void runScmAction(action)}
        onRefresh={() => void refreshSourceControl()}
        onInit={() => void initRepository()}
        onPickBranch={() => void pickBranch()}
        onCreateBranch={() => void createBranch()}
        onDeleteBranch={() => void deleteBranch()}
        onPublish={() => void publishBranch()}
        onStash={() => void stashChanges()}
        onStage={(path) => void stageGitEntry(path)}
        onUnstage={(path) => void unstageGitEntry(path)}
        onDiscard={(path) => void discardGitEntry(path)}
        onStageAll={() => void stageAllGitEntries()}
        onUnstageAll={() => void unstageAllGitEntries()}
        onDiscardAll={() => void discardAllGitEntries()}
        onOpenDiff={(entry, area) => void openGitDiffEditor(entry, area)}
        onOpenFile={(path) => void openGitFile(path)}
        onContextMenu={(entry, area, x, y) => setGitContextMenu({ entry, area, x, y })}
        messageHistory={commitMessageHistory}
        commitState={commitState}
        onSuggestMessage={aiAvailable ? () => void suggestCommitMessage() : undefined}
        suggestingMessage={suggestingMessage}
        graph={{
          commits: graphCommits,
          loading: graphLoading,
          hasMore: graphHasMore,
          refs: graphRefs,
          expanded: expandedCommits,
          files: commitFiles,
          revealHash: revealCommit,
          onLoadMore: loadMoreGraph,
          onToggle: (commit) => void toggleCommit(commit),
          onOpenFile: (commit, file) =>
            void openGitCommitRevisionDiff(commit.hash, file.path, commit.parents[0]),
          onContextMenu: (commit, x, y) => setCommitMenu({ commit, x, y }),
          onBranchContextMenu: (branch) => void branchActions(branch),
          onChooseRefs: () => void chooseGraphRefs(),
          onGoToCurrent: goToCurrentCommit,
          onRefresh: () => void refreshGraph(),
        }}
      />
      {gitContextMenu ? renderScmContextMenu(ctx) : null}
      {commitMenu ? (
        <CommitContextMenu
          commit={commitMenu.commit}
          x={commitMenu.x}
          y={commitMenu.y}
          onClose={() => setCommitMenu(null)}
          onOpen={() => {
            const commit = commitMenu.commit;
            setCommitMenu(null);
            if (!expandedCommits.has(commit.hash)) void toggleCommit(commit);
          }}
          onAction={(kind) => void runCommitAction(kind, commitMenu.commit)}
        />
      ) : null}
    </div>
  );
}

export function renderSourceToolbar(ctx: AppCtx) {
  const {
    activeDocumentIsAsymptote,
    activeDocumentIsLatex,
    applyLatexPrettier,
    applyLatexToolbarCommand,
    cancelCompile,
    collaborationState,
    compile,
    compileProgress,
    compiling,
    currentLineHasBookmark,
    documentOutline,
    insertLatexTable,
    latexEditorView,
    mode,
    openLinkAtCursor,
    openShareDialog,
    revealOutlineLine,
    reviewPaperWithAi,
    rootFile,
    setLatexEditorView,
    setMode,
    setRootFile,
    shareButtonDisabled,
    shareButtonLabel,
    shareButtonTitle,
    texFiles,
    toggleBookmarkAtCurrentLine,
  } = ctx;
  return (
    <div className="source-toolbar">
      <div className="root-control">
        <span className="control-label">ROOT</span>
        <div className="select-wrap">
          <select
            value={rootFile}
            onChange={(event) => setRootFile(event.target.value)}
          >
            {texFiles.map((entry) => (
              <option key={entry.path} value={entry.relativePath}>
                {pathForDisplay(entry.relativePath)}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </div>
      </div>

      {activeDocumentIsLatex && documentOutline.length ? (
        <div className="root-control outline-control">
          <span className="control-label">NAV</span>
          <div className="select-wrap">
            <select
              value=""
              aria-label="Document outline"
              onChange={(event) => {
                const item = documentOutline.find(
                  (outlineItem) => outlineItem.id === event.target.value,
                );
                event.currentTarget.value = "";
                if (item) {
                  revealOutlineLine(item.line, item.column);
                }
              }}
            >
              <option value="">Outline</option>
              {documentOutline.map((item) => {
                const count = ctx.documentWordCounts?.sections?.find(
                  (section) =>
                    section.line === item.line && section.column === item.column,
                );
                return (
                  <option key={item.id} value={item.id}>
                    {`${"  ".repeat(Math.max(0, item.level - 2))}${item.detail} ${item.label}${count ? ` — ${count.words} words` : ""}`}
                  </option>
                );
              })}
            </select>
            <ChevronDown size={13} />
          </div>
        </div>
      ) : null}

      <div className="root-control">
        <span className="control-label">MODE</span>
        <div className="mode-selector-toolbar">
          <button
            className={`mode-button-mini ${mode === "author" ? "active" : ""}`}
            onClick={() => setMode("author")}
            title="Author Mode"
          >
            <User size={13} />
            <span>Author</span>
          </button>
          <button
            className={`mode-button-mini ${mode === "reviewer" ? "active" : ""}`}
            onClick={() => setMode("reviewer")}
            title="Reviewer Mode"
          >
            <MessageSquare size={13} />
            <span>Reviewer</span>
          </button>
          <button
            className={`mode-button-mini ${mode === "rebuttal" ? "active" : ""}`}
            onClick={() => setMode("rebuttal")}
            title="Rebuttal Mode"
          >
            <History size={13} />
            <span>Rebuttal</span>
          </button>
        </div>
      </div>

      {activeDocumentIsLatex ? (
        <div className="latex-editor-view-toggle" role="group" aria-label="Editor view">
          <button
            type="button"
            className={latexEditorView === "code" ? "active" : ""}
            onClick={() => setLatexEditorView("code")}
            aria-pressed={latexEditorView === "code"}
            title="Code editor"
          >
            <Code2 size={13} />
            <span>Code</span>
          </button>
          <button
            type="button"
            className={latexEditorView === "visual" ? "active" : ""}
            onClick={() => setLatexEditorView("visual")}
            aria-pressed={latexEditorView === "visual"}
            title="Visual editor"
          >
            <BookOpenText size={13} />
            <span>Visual</span>
          </button>
        </div>
      ) : null}

      <div className="collaboration-control">
        <button
          type="button"
          className={`collaboration-button ${collaborationState.enabled ? "active" : ""}`}
          onClick={openShareDialog}
          disabled={shareButtonDisabled}
          title={shareButtonTitle}
          aria-label={shareButtonTitle}
        >
          <Link size={14} />
          <span>{shareButtonLabel}</span>
        </button>
      </div>

      {activeDocumentIsLatex && latexEditorView === "code" ? (
        <div
          className="tex-format-toolbar"
          role="toolbar"
          aria-label="LaTeX formatting"
        >
          <button
            type="button"
            className="tex-format-button icon-only"
            onClick={() => applyLatexToolbarCommand("bold")}
            title={"Bold (\\textbf{})"}
            aria-label="Bold"
          >
            <Bold size={14} />
          </button>
          <button
            type="button"
            className="tex-format-button icon-only"
            onClick={() => applyLatexToolbarCommand("italic")}
            title={"Italic (\\emph{})"}
            aria-label="Italic"
          >
            <Italic size={14} />
          </button>
          <button
            type="button"
            className="tex-format-button icon-only"
            onClick={() => applyLatexToolbarCommand("underline")}
            title={"Underline (\\underline{})"}
            aria-label="Underline"
          >
            <Underline size={14} />
          </button>
          <button
            type="button"
            className="tex-format-button icon-only"
            onClick={() => applyLatexToolbarCommand("math")}
            title="Inline math"
            aria-label="Inline math"
          >
            <Sigma size={14} />
          </button>

          <span className="tex-format-divider" aria-hidden="true" />

          <button
            type="button"
            className="tex-format-button"
            onClick={() => applyLatexToolbarCommand("section")}
            title={"Section (\\section{})"}
          >
            <Heading1 size={14} />
            <span>Section</span>
          </button>
          <button
            type="button"
            className="tex-format-button"
            onClick={() => applyLatexToolbarCommand("subsection")}
            title={"Subsection (\\subsection{})"}
          >
            <Heading2 size={14} />
            <span>Subsection</span>
          </button>
          <button
            type="button"
            className="tex-format-button"
            onClick={() => applyLatexToolbarCommand("equation")}
            title="Equation block"
          >
            <Sigma size={14} />
            <span>Equation</span>
          </button>

          <span className="tex-format-divider" aria-hidden="true" />

          <button
            type="button"
            className="tex-format-button icon-only"
            onClick={() => applyLatexToolbarCommand("itemize")}
            title="Bullet list"
            aria-label="Bullet list"
          >
            <List size={14} />
          </button>
          <button
            type="button"
            className="tex-format-button icon-only"
            onClick={() => applyLatexToolbarCommand("enumerate")}
            title="Numbered list"
            aria-label="Numbered list"
          >
            <ListOrdered size={14} />
          </button>
          <button
            type="button"
            className="tex-format-button"
            onClick={() => applyLatexToolbarCommand("cite")}
            title={"Citation (\\cite{})"}
            data-tour-id="citation"
          >
            <BookOpenText size={14} />
            <span>Cite</span>
          </button>
          <button
            type="button"
            className="tex-format-button"
            onClick={() => applyLatexToolbarCommand("ref")}
            title={"Reference (\\ref{})"}
          >
            <Link size={14} />
            <span>Ref</span>
          </button>
          <button
            type="button"
            className="tex-format-button icon-only"
            onClick={() => applyLatexToolbarCommand("href")}
            title={"Link (\\href{}{})"}
            aria-label="Link"
          >
            <Link size={14} />
          </button>
          <button
            type="button"
            className="tex-format-button icon-only"
            onClick={() => void openLinkAtCursor()}
            title="Open link at cursor"
            aria-label="Open link at cursor"
          >
            <ExternalLink size={14} />
          </button>
          <TableSizePicker
            onInsert={insertLatexTable}
            onAlignColumns={() => applyLatexToolbarCommand("formatTable")}
          />
          <button
            type="button"
            className={`tex-format-button icon-only ${
              currentLineHasBookmark ? "active" : ""
            }`}
            onClick={toggleBookmarkAtCurrentLine}
            title={
              currentLineHasBookmark
                ? "Remove bookmark at cursor"
                : "Bookmark current line"
            }
            aria-label={
              currentLineHasBookmark
                ? "Remove bookmark at cursor"
                : "Bookmark current line"
            }
            aria-pressed={currentLineHasBookmark}
          >
            <Bookmark size={14} />
          </button>

          <span className="tex-format-divider" aria-hidden="true" />

          <button
            type="button"
            className="tex-format-button"
            onClick={applyLatexPrettier}
            title="Tidy the layout: one blank line around sections, indented lists and environments (Shift+Alt+F)"
            aria-label="Tidy up the LaTeX layout"
          >
            <WandSparkles size={14} />
            <span>Tidy</span>
          </button>
        </div>
      ) : null}

      {rootFile ? (
        <button
          type="button"
          className="ai-review-button"
          onClick={() => void reviewPaperWithAi()}
          title="Review this paper with AI: a full peer review that follows your language, AI and project settings (Cmd/Ctrl+Alt+R)"
          aria-label="Review this paper with AI"
        >
          <BookOpenCheck size={14} />
          <span>Review</span>
        </button>
      ) : null}

      <button
        className={`compile-button ${compiling ? "compiling" : ""}`}
        onClick={() => void compile()}
        disabled={!rootFile && !activeDocumentIsAsymptote}
        data-tour-id="compile"
        title={
          compiling
            ? "Start another background compile"
            : activeDocumentIsAsymptote
              ? "Compile Asymptote"
              : "Compile"
        }
      >
        {compiling ? (
          <>
            <LoaderCircle size={15} className="spin" />
            <span className="compile-button-progress">
              {compileProgress > 0 ? `${compileProgress}%` : "Compiling"}
            </span>
          </>
        ) : (
          <Play size={14} fill="currentColor" />
        )}
      </button>
      {compiling ? (
        <button
          type="button"
          className="compile-cancel-button"
          onClick={() => void cancelCompile()}
          title="Cancel compile"
          aria-label="Cancel compile"
        >
          <X size={15} />
        </button>
      ) : null}
    </div>
  );
}

export function renderKnowledgeGraphTab(ctx: AppCtx) {
  const {
    citationAnalysis,
    citationEntriesByKey,
    graphFilter,
    graphViewState,
    handleAppendBibEntry,
    insertCitationKey,
    knowledgeGraph,
    knowledgeGraphParams,
    openExternalLink,
    planKnowledgeGraphDiscoveryWithAi,
    recommendCitationsForSelection,
    setGraphFilter,
    setGraphViewState,
    setKnowledgeGraphParams,
  } = ctx;
  return (
    <div className="knowledge-graph-tab" role="tabpanel" aria-label="Knowledge Graph">
      <KnowledgeGraphView
        graph={knowledgeGraph}
        params={knowledgeGraphParams}
        onParamsChange={setKnowledgeGraphParams}
        entriesByKey={citationEntriesByKey}
        filter={graphFilter}
        viewState={graphViewState}
        onViewStateChange={setGraphViewState}
        onInsertCitation={insertCitationKey}
        onRecommendForSelection={recommendCitationsForSelection}
        onClearFilter={() =>
          setGraphFilter({ keys: null, label: "All bibliography entries" })
        }
        bibFiles={citationAnalysis.bibFiles}
        onAppendBibEntry={handleAppendBibEntry}
        onOpenExternal={openExternalLink}
        onPlanDiscoveryWithAi={planKnowledgeGraphDiscoveryWithAi}
      />
    </div>
  );
}
