import { AiIcon } from "../../components/AiIcon";
import {
  BookOpenText,
  Box,
  Building2,
  Files,
  GitBranch,
  ImageUp,
  Link,
  Pencil,
  Puzzle,
  RefreshCw,
  Settings,
  Waypoints,
  User,
  Variable,
  X,
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
    focusMode,
    layoutMode,
    resetPaneSizes,
    setLayoutMode,
    toggleFocusMode,
    openShareDialog,
    panelVisible,
    projectId,
    projectName,
    shareButtonDisabled,
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
        {projectId ? null : (
          // With a project open, Share lives in the editor toolbar; here it
          // only joins someone else's project from the welcome screen.
          <button
            type="button"
            className="title-history-button"
            onClick={openShareDialog}
            disabled={shareButtonDisabled}
            title="Join shared project"
            aria-label="Join shared project"
          >
            <Link size={15} aria-hidden="true" />
            <span>Join</span>
          </button>
        )}
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
    handleAiSidebarClickCapture,
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
      onClickCapture={handleAiSidebarClickCapture}
    >
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
                onClick={() => setActiveAiChatId(chat.id)}
              >
                {chat.title}
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
