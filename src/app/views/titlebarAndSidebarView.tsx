import { AiIcon } from "../../components/AiIcon";
import {
  BookOpenCheck,
  BookOpenText,
  Box,
  Building2,
  Files,
  GitBranch,
  ImageUp,
  Link,
  ClipboardCheck,
  MessageCircleMore,
  History,
  Pencil,
  Plus,
  MessageSquare,
  Puzzle,
  RefreshCw,
  Settings,
  Waypoints,
  User,
  Variable,
  X,
  WandSparkles,
} from "lucide-react";
import FileTree from "../../FileTree";
import { LayoutMenu } from "../../components/LayoutMenu";
import { ActivityItems } from "../../components/ActivityItems";
import { productConfig, productIsPro } from "../../productConfig";
import { AiSidebar } from "../../components/AiSidebar";
import { pathForDisplay } from "../../pathDisplay";
import { flattenEntries } from "../../features/project/projectUtils";
import { AppIcon, aiChatStateStorageKey, tierAvailabilityLabel } from "../appShared";
import {
  applyChatModelOption,
  buildChatModelOptions,
} from "../../features/ai/chatModelOptions";
import { latexDoAiTiers } from "../../features/ai/product/latexDoAiTiers";
import { toolTabIds } from "../../features/workspace/toolTabs";
import type { AppCtx } from "../appContext";

export function renderTitlebar(ctx: AppCtx) {
  const {
    activeDocumentIsLatex,
    applyLatexPrettier,
    latexEditorView,
    collaborationState,
    focusMode,
    layoutMode,
    resetPaneSizes,
    reviewPaperWithAi,
    rootFile,
    setLayoutMode,
    toggleFocusMode,
    openShareDialog,
    panelVisible,
    projectId,
    projectName,
    shareButtonDisabled,
    shareButtonLabel,
    shareButtonTitle,
    sidebarVisible,
    togglePanel,
    toggleSidebar,
  } = ctx;
  return (
    <header className="titlebar">
      <div className="titlebar-drag">
        <span className="title-center">
          <AppIcon className="app-mark" />
          <span className="title-project">{projectName}</span>
          <span className="title-separator">—</span>
          <span>{productConfig.shortName}</span>
        </span>
      </div>
      <div className="title-actions">
        {rootFile ? (
          <button
            type="button"
            className="title-history-button"
            onClick={() => void reviewPaperWithAi()}
            title="Review this paper with AI: a full peer review that follows your language, AI and project settings (Cmd/Ctrl+Alt+R)"
            aria-label="Review this paper with AI"
          >
            <BookOpenCheck size={15} aria-hidden="true" />
            <span>Review</span>
          </button>
        ) : null}

        <button
          type="button"
          className={`title-history-button ${collaborationState.enabled ? "active" : ""}`}
          onClick={openShareDialog}
          disabled={shareButtonDisabled}
          title={shareButtonTitle}
          aria-label={shareButtonTitle}
        >
          <Link size={15} aria-hidden="true" />
          <span>{projectId ? shareButtonLabel : "Join"}</span>
        </button>
        {activeDocumentIsLatex && latexEditorView === "code" ? (
          <button
            type="button"
            className="title-history-button"
            onClick={applyLatexPrettier}
            title="Tidy the layout: one blank line around sections, indented lists and environments (Shift+Alt+F)"
            aria-label="Tidy up the LaTeX layout"
          >
            <WandSparkles size={15} aria-hidden="true" />
            <span>Tidy</span>
          </button>
        ) : null}
        {projectId ? (
          <LayoutMenu
            mode={layoutMode}
            focusMode={focusMode}
            sidebarVisible={sidebarVisible}
            panelVisible={panelVisible}
            onSelectMode={(mode) => void setLayoutMode(mode)}
            onToggleFocusMode={toggleFocusMode}
            onToggleSidebar={toggleSidebar}
            onTogglePanel={togglePanel}
            onResetSizes={resetPaneSizes}
          />
        ) : null}
      </div>
    </header>
  );
}

export function renderActivityBar(ctx: AppCtx) {
  const {
    activeSidebar,
    extensionToolAvailability,
    knowledgeGraphActive,
    openKnowledgeGraph,
    openSidebar,
    profileOpen,
    setProfileOpen,
    setSettingsOpen,
    settingsOpen,
    sidebarVisible,
    activePath,
    toggleToolTab,
  } = ctx;
  const changedFileCount = new Set(
    ctx.gitStatus?.entries?.map((entry) => entry.path) ?? [],
  ).size;
  const discussionTotals = ctx.discussion.totals;
  return (
    <nav className="activity-bar">
      <ActivityItems>
        <button
          className={`activity-button ${
            sidebarVisible && activeSidebar === "explorer" ? "active" : ""
          }`}
          onClick={() => openSidebar("explorer")}
          title="Explorer"
        >
          <Files size={22} />
        </button>
        <button
          className={`activity-button ${
            sidebarVisible && activeSidebar === "sourceControl" ? "active" : ""
          }`}
          onClick={() => openSidebar("sourceControl")}
          title="Source control"
          aria-label={`Source control${changedFileCount ? ` (${changedFileCount} changed ${changedFileCount === 1 ? "file" : "files"})` : ""}`}
        >
          <GitBranch size={21} />
          {changedFileCount > 0 && (
            <span className="activity-change-badge" aria-hidden="true">
              {changedFileCount > 99 ? "99+" : changedFileCount}
            </span>
          )}
        </button>
        <button
          className={`activity-button ${sidebarVisible && activeSidebar === "reviews" ? "active" : ""}`}
          onClick={() => openSidebar("reviews")}
          title="Reviews"
          aria-label="Reviews"
        >
          <ClipboardCheck size={21} />
          {ctx.reviewChats?.length > 0 ? (
            <span className="activity-change-badge" aria-hidden="true">
              {ctx.reviewChats.length}
            </span>
          ) : null}
        </button>
        <button
          className={`activity-button ${
            sidebarVisible && activeSidebar === "discussion" ? "active" : ""
          }`}
          onClick={() => openSidebar("discussion")}
          title="Discussion"
          aria-label={`Discussion${
            discussionTotals.unread
              ? ` (${discussionTotals.unread} unread${
                  discussionTotals.mentions
                    ? `, ${discussionTotals.mentions} for you`
                    : ""
                })`
              : ""
          }`}
        >
          <MessageCircleMore size={21} />
          {discussionTotals.unread > 0 && (
            <span
              className={`activity-change-badge discussion-activity-badge ${
                discussionTotals.mentions ? "is-mention" : ""
              }`}
              aria-hidden="true"
            >
              {discussionTotals.unread > 99 ? "99+" : discussionTotals.unread}
            </span>
          )}
        </button>
        {ctx.discussion.available ? (
          <button
            className={`activity-button ${
              sidebarVisible && activeSidebar === "history" ? "active" : ""
            }`}
            onClick={() => openSidebar("history")}
            title="History"
            aria-label="History: who changed what"
          >
            <History size={21} />
          </button>
        ) : null}
        {productIsPro ? (
          <button
            className={`activity-button ${
              sidebarVisible && activeSidebar === "enterprise" ? "active" : ""
            }`}
            onClick={() => openSidebar("enterprise")}
            title="Enterprise"
          >
            <Building2 size={21} />
          </button>
        ) : null}
        <button
          className={`activity-button ${knowledgeGraphActive ? "active" : ""}`}
          onClick={openKnowledgeGraph}
          title="Knowledge graph"
        >
          <Waypoints size={21} />
        </button>
        <button
          className={`activity-button ${
            sidebarVisible && activeSidebar === "ai" ? "active" : ""
          }`}
          onClick={() => openSidebar("ai")}
          title="AI assistant"
        >
          <AiIcon size={21} />
        </button>
        <button
          className={`activity-button ${activePath === toolTabIds.tikzCanvas ? "active" : ""}`}
          onClick={() => toggleToolTab(toolTabIds.tikzCanvas)}
          title="TikZ drawing"
        >
          <Pencil size={21} />
        </button>
        {extensionToolAvailability.tableGenerator ? (
          <button
            className={`activity-button ${
              activePath === toolTabIds.tableGenerator ? "active" : ""
            }`}
            onClick={() => toggleToolTab(toolTabIds.tableGenerator)}
            title="Table Generator"
          >
            <Box size={21} />
          </button>
        ) : null}
        {extensionToolAvailability.tikzConverter ? (
          <button
            className={`activity-button ${
              activePath === toolTabIds.tikzConverter ? "active" : ""
            }`}
            onClick={() => toggleToolTab(toolTabIds.tikzConverter)}
            title="Figure → TikZ Converter"
          >
            <ImageUp size={21} />
          </button>
        ) : null}
        {extensionToolAvailability.notationManager ? (
          <button
            className={`activity-button ${
              activePath === toolTabIds.notationManager ? "active" : ""
            }`}
            onClick={() => toggleToolTab(toolTabIds.notationManager)}
            title="Notation Manager"
          >
            <Variable size={21} />
          </button>
        ) : null}
        {extensionToolAvailability.projectBibliography ? (
          <button
            className={`activity-button ${
              activePath === toolTabIds.citationManager ? "active" : ""
            }`}
            onClick={() => toggleToolTab(toolTabIds.citationManager)}
            title="Citation Manager"
          >
            <BookOpenText size={21} />
          </button>
        ) : null}
        <button
          className={`activity-button ${
            sidebarVisible && activeSidebar === "extensions" ? "active" : ""
          }`}
          onClick={() => openSidebar("extensions")}
          title="Extensions"
        >
          <Puzzle size={21} />
        </button>
      </ActivityItems>
      <div>
        <button
          type="button"
          className={`activity-button ${profileOpen ? "active" : ""}`}
          onClick={() => setProfileOpen(true)}
          title="Account"
          aria-label="Open account"
          aria-pressed={profileOpen}
        >
          <User size={21} />
        </button>
        <button
          type="button"
          className={`activity-button ${settingsOpen ? "active" : ""}`}
          onClick={() => setSettingsOpen(true)}
          title="Settings"
          aria-label="Open settings"
          aria-pressed={settingsOpen}
        >
          <Settings size={21} />
        </button>
      </div>
    </nav>
  );
}

export function renderSidebar(ctx: AppCtx) {
  const {
    activeAiChatId,
    activeAiSidebarApiRef,
    activeWorkspaceTab,
    aiChats,
    aiConfig,
    aiIsDesktop,
    aiSidebarExpanded,
    aiTabTargets,
    closeAiChat,
    contextForWorkspaceTab,
    documents,
    createAiChat,
    openAiSettings,
    openExternalLink,
    setActiveAiChatId,
    setAiSidebarExpanded,
    setAiTabTargets,
    setSidebarVisible,
    sidebarWidthStyle,
    workspaceTabs,
  } = ctx;
  // The chat's model menu, with the same availability rules as Settings.
  const modelOptions = buildChatModelOptions({
    config: aiConfig,
    isDesktop: aiIsDesktop,
    ollamaModels: ctx.ollamaModels,
    tiers: latexDoAiTiers.map((tier) => {
      const downloaded =
        ctx.downloadedLatexDoAiModelFiles.has(tier.runtime.fileName) ||
        (aiConfig.modelId === tier.runtime.modelId && aiConfig.modelDownloaded);
      if (!downloaded) {
        return { tier, ready: false, reason: "Download it in AI settings" };
      }
      const availability = ctx.localTierRuntimeAvailability(tier);
      return availability.state === "available"
        ? { tier, ready: true }
        : { tier, ready: false, reason: tierAvailabilityLabel(availability) };
    }),
  });
  const selectModel = (id: string) => {
    if (id.startsWith("tier:")) ctx.setLocalAiProviderMode("latexdo-ai");
    ctx.setAiConfig(
      (current) => applyChatModelOption(current, id, latexDoAiTiers) ?? current,
    );
  };
  return (
    <aside
      className={`sidebar ${aiSidebarExpanded ? "ai-sidebar-expanded" : ""}`}
      data-view="ai"
      style={sidebarWidthStyle}
      data-tour-id="ai-sidebar"
    >
      <div className="sidebar-header">
        <span>LatexDo AI</span>
      </div>
      <div className="ai-chat-navigation">
        <div className="ai-chat-tabs" role="tablist" aria-label="AI chats">
          {aiChats.map((chat) => {
            const active = chat.id === activeAiChatId;
            return (
              <div
                key={chat.id}
                className={`ai-chat-tab-shell ${active ? "active" : ""}`}
              >
                <button
                  type="button"
                  id={`ai-tab-${chat.id}`}
                  role="tab"
                  className="ai-chat-tab"
                  aria-selected={active}
                  aria-controls={`ai-panel-${chat.id}`}
                  title={chat.title}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setActiveAiChatId(chat.id)}
                  onKeyDown={(event) => {
                    const index = aiChats.findIndex((item) => item.id === chat.id);
                    const nextIndex =
                      event.key === "ArrowRight"
                        ? (index + 1) % aiChats.length
                        : event.key === "ArrowLeft"
                          ? (index - 1 + aiChats.length) % aiChats.length
                          : event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? aiChats.length - 1
                              : null;
                    if (nextIndex === null) return;
                    event.preventDefault();
                    const nextChat = aiChats[nextIndex];
                    setActiveAiChatId(nextChat.id);
                    document.getElementById(`ai-tab-${nextChat.id}`)?.focus();
                  }}
                >
                  <MessageSquare size={13} aria-hidden="true" />
                  <span>{chat.title}</span>
                </button>
                <button
                  type="button"
                  className="ai-chat-tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeAiChat(chat.id);
                  }}
                  aria-label={`Close ${chat.title}`}
                  title={`Close ${chat.title}`}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="ai-new-chat-button"
          title="New chat"
          onClick={createAiChat}
        >
          <Plus size={14} aria-hidden="true" />
          New chat
        </button>
      </div>
      <div className="ai-chat-panes">
        {aiChats.map((chat) => {
          const active = chat.id === activeAiChatId;
          const targetId = aiTabTargets[chat.id] ?? "active";
          const resolvedTarget = targetId === "active" ? activeWorkspaceTab : targetId;
          return (
            <div
              key={chat.id}
              id={`ai-panel-${chat.id}`}
              role="tabpanel"
              aria-labelledby={`ai-tab-${chat.id}`}
              className={`ai-chat-pane ${active ? "active" : ""}`}
            >
              <AiSidebar
                storageKey={aiChatStateStorageKey(chat.id)}
                config={aiConfig}
                ctx={contextForWorkspaceTab(resolvedTarget)}
                workspaceTarget={{
                  value: targetId,
                  tabs: workspaceTabs.map((tab) => ({
                    id: tab.id,
                    label:
                      documents.find((doc) => doc.path === tab.id)?.relativePath ??
                      tab.label,
                  })),
                  activeLabel:
                    workspaceTabs.find((tab) => tab.id === activeWorkspaceTab)?.label ??
                    "No tab",
                  onChange: (id) => {
                    setAiTabTargets((current) => ({
                      ...current,
                      [chat.id]: id,
                    }));
                    workspaceTabs.find((tab) => tab.id === id)?.onSelect();
                  },
                }}
                isDesktop={aiIsDesktop}
                expanded={aiSidebarExpanded}
                onToggleExpanded={() => setAiSidebarExpanded((expanded) => !expanded)}
                onOpenSettings={openAiSettings}
                onOpenExternal={openExternalLink}
                apiRef={active ? activeAiSidebarApiRef : undefined}
                modelOptions={modelOptions}
                onSelectModel={selectModel}
                onInsertFigure={(code) => void ctx.insertFigure(code)}
                compileResult={ctx.compileResult}
                compiling={ctx.compiling}
              />
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="small-icon ai-sidebar-app-close"
        onClick={() => setSidebarVisible(false)}
        aria-label="Close AI assistant"
        title="Close AI assistant"
      >
        <X size={15} />
      </button>
    </aside>
  );
}

export function renderSmallIcon(ctx: AppCtx) {
  const { extensionCatalogLoading, refreshExtensionCatalog } = ctx;
  return (
    <>
      <button
        className="small-icon"
        onClick={() => void refreshExtensionCatalog()}
        title="Refresh extensions"
        aria-label="Refresh extensions"
        disabled={extensionCatalogLoading}
      >
        <RefreshCw size={14} className={extensionCatalogLoading ? "spin" : ""} />
      </button>
    </>
  );
}

export function renderFileTree(ctx: AppCtx) {
  const {
    activePath,
    chooseImportFiles,
    compileEntry,
    copyEntry,
    copyRelativePath,
    deleteEntry,
    deleteEntries,
    importExternalFiles,
    insertImageReference,
    moveEntry,
    openCreateDialogInDirectory,
    openDocument,
    projectEntries,
    revealGitFile,
    rootFileRef,
    setRootFile,
    setStatusMessage,
  } = ctx;
  return (
    <FileTree
      key={ctx.projectId}
      entries={projectEntries}
      activePath={activePath}
      onOpen={openDocument}
      onCompileFile={(entry) => void compileEntry(entry)}
      onSetRootFile={(entry) => {
        setRootFile(entry.relativePath);
        rootFileRef.current = entry.relativePath;
        setStatusMessage(`Main file set to ${pathForDisplay(entry.relativePath)}`);
      }}
      onMoveEntry={moveEntry}
      onImportExternalFiles={(files, destination) =>
        void importExternalFiles(files, destination)
      }
      onChooseImportFilesInDirectory={chooseImportFiles}
      onCreateFileInDirectory={(entry) => openCreateDialogInDirectory("file", entry)}
      onCreateFolderInDirectory={(entry) =>
        openCreateDialogInDirectory("folder", entry)
      }
      onCopyRelativePath={(entry) => void copyRelativePath(entry)}
      onInsertFileReference={insertImageReference}
      onRevealFile={(entry) => void revealGitFile(entry.relativePath)}
      onCopyPath={(entry) => {
        void navigator.clipboard
          ?.writeText(entry.path)
          .then(() => setStatusMessage(`Copied ${pathForDisplay(entry.path)}`))
          .catch(() => setStatusMessage("Could not copy the path."));
      }}
      onRenameEntry={(entry, newName) => void moveEntry(entry.path, null, newName)}
      onDeleteEntry={(entry) => void deleteEntry(entry)}
      onDeleteEntries={deleteEntries}
      onDuplicateEntry={(entry) => {
        const parent = entry.relativePath.includes("/")
          ? (flattenEntries(projectEntries).find(
              (candidate) =>
                candidate.type === "directory" &&
                candidate.relativePath ===
                  entry.relativePath.slice(0, entry.relativePath.lastIndexOf("/")),
            ) ?? null)
          : null;
        void copyEntry(entry.path, parent);
      }}
      onPasteEntry={(sourcePath, mode, destination) =>
        mode === "cut"
          ? moveEntry(sourcePath, destination)
          : copyEntry(sourcePath, destination)
      }
    />
  );
}

export function renderReviewFiles(ctx: AppCtx) {
  const {
    activePath,
    chooseImportFiles,
    compileEntry,
    copyEntry,
    copyRelativePath,
    deleteEntry,
    deleteEntries,
    importExternalFiles,
    insertImageReference,
    moveEntry,
    openCreateDialogInDirectory,
    openDocument,
    projectEntries,
    revealGitFile,
    rootFileRef,
    setRootFile,
    setStatusMessage,
  } = ctx;
  return (
    <details className="review-files" open>
      <summary>Files</summary>
      <FileTree
        key={ctx.projectId}
        entries={projectEntries}
        activePath={activePath}
        onOpen={openDocument}
        onCompileFile={(entry) => void compileEntry(entry)}
        onSetRootFile={(entry) => {
          setRootFile(entry.relativePath);
          rootFileRef.current = entry.relativePath;
          setStatusMessage(`Main file set to ${pathForDisplay(entry.relativePath)}`);
        }}
        onMoveEntry={moveEntry}
        onImportExternalFiles={(files, destination) =>
          void importExternalFiles(files, destination)
        }
        onChooseImportFilesInDirectory={chooseImportFiles}
        onCreateFileInDirectory={(entry) => openCreateDialogInDirectory("file", entry)}
        onCreateFolderInDirectory={(entry) =>
          openCreateDialogInDirectory("folder", entry)
        }
        onCopyRelativePath={(entry) => void copyRelativePath(entry)}
        onInsertFileReference={insertImageReference}
        onRevealFile={(entry) => void revealGitFile(entry.relativePath)}
        onCopyPath={(entry) => {
          void navigator.clipboard
            ?.writeText(entry.path)
            .then(() => setStatusMessage(`Copied ${pathForDisplay(entry.path)}`))
            .catch(() => setStatusMessage("Could not copy the path."));
        }}
        onRenameEntry={(entry, newName) => void moveEntry(entry.path, null, newName)}
        onDeleteEntry={(entry) => void deleteEntry(entry)}
        onDeleteEntries={deleteEntries}
        onDuplicateEntry={(entry) => {
          const parent = entry.relativePath.includes("/")
            ? (flattenEntries(projectEntries).find(
                (candidate) =>
                  candidate.type === "directory" &&
                  candidate.relativePath ===
                    entry.relativePath.slice(0, entry.relativePath.lastIndexOf("/")),
              ) ?? null)
            : null;
          void copyEntry(entry.path, parent);
        }}
        onPasteEntry={(sourcePath, mode, destination) =>
          mode === "cut"
            ? moveEntry(sourcePath, destination)
            : copyEntry(sourcePath, destination)
        }
      />
    </details>
  );
}
