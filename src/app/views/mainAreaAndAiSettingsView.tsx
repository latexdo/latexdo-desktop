import {
  AlertTriangle,
  Check,
  CircleAlert,
  Download,
  FilePlus2,
  FileUp,
  FolderPlus,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  CloudUpload,
} from "lucide-react";
import { CitationSearchPopup } from "../../components/CitationSearchPopup";
import { productConfig } from "../../productConfig";
import { ShareProjectDialog } from "../../components/ShareProjectDialog";
import { collaboratorLook } from "../../collaboration/collaboratorLook";
import { pathForDisplay } from "../../pathDisplay";
import { collaborationClientId } from "../../collaboration/collaborationStorage";
import { cloudProviders } from "../../features/ai/cloudProviders";
import { latexDoAiTiers } from "../../features/ai/product/latexDoAiTiers";
import { WorkspaceTabs } from "../../components/WorkspaceTabs";
import {
  AiPrimarySelectionValue,
  CustomAiProviderSelectValue,
  citationSearchShortcutLabel,
  formatFileSize,
  isCloudProviderSelectValue,
  isLatexDoAiTierSelectValue,
  latexDoAiTierSelectValue,
  localRuntimeSelectionForTier,
  tierAvailabilityLabel,
  tierFromSelectValue,
} from "../appShared";
import { QuickPick } from "../../components/QuickPick";
import type { AppCtx } from "../appContext";
import { renderSourcePane, renderSplitHandle } from "./editorPaneView";
import { renderPanelContent, renderPanelTabs } from "./bottomPanelView";

export function renderMainArea(ctx: AppCtx) {
  const {
    citationAnalysis,
    citationCitedKeySet,
    citationSearchFocusRequest,
    citationSearchPopupRef,
    clearCitationSearchFocusRequest,
    editorPreviewRef,
    editorRef,
    extensionToolAvailability,
    gitDiffSession,
    layoutMode,
    addOnlineCitation,
    pickCitation,
    readCitationContext,
    searchCitationsOnline,
    panelHeight,
    panelVisible,
    previewShown,
    projectId,
    setCitationSearchAnchor,
    showWelcome,
    splitPercent,
    startPanelResize,
    resetPanelHeight,
    nudgePanel,
    workspaceTabs,
  } = ctx;
  const citationSearchAnchor = ctx.citationSearchAnchor!;
  return (
    <main className="main-area">
      <WorkspaceTabs key={projectId || "no-project"} tabs={workspaceTabs} />

      <div
        ref={editorPreviewRef}
        className={`editor-preview ${previewShown ? "with-preview" : "without-preview"} ${layoutMode === "pdf" ? "pdf-only" : ""}`}
        style={
          {
            "--source-width": previewShown ? `${splitPercent}%` : "100%",
          } as React.CSSProperties
        }
      >
        {renderSourcePane(ctx)}

        {previewShown ? renderSplitHandle(ctx) : null}
      </div>

      {citationSearchAnchor && !showWelcome && !gitDiffSession ? (
        <CitationSearchPopup
          ref={citationSearchPopupRef}
          anchor={citationSearchAnchor}
          entries={citationAnalysis.entries}
          citedKeys={citationCitedKeySet}
          focusRequest={citationSearchFocusRequest}
          shortcutLabel={citationSearchShortcutLabel}
          onFocusHandled={clearCitationSearchFocusRequest}
          onPick={pickCitation}
          readContext={readCitationContext}
          onSearchOnline={searchCitationsOnline}
          onAddOnline={addOnlineCitation}
          onDismiss={() => editorRef.current?.focus()}
          onLeave={() => {
            window.setTimeout(() => {
              if (!editorRef.current?.hasTextFocus?.()) {
                setCitationSearchAnchor(null);
              }
            }, 0);
          }}
        />
      ) : null}

      {ctx.quickPick ? <QuickPick request={ctx.quickPick} /> : null}

      {panelVisible ? (
        <section className="bottom-panel" style={{ height: panelHeight }}>
          <div
            className="panel-resize-handle"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize bottom panel"
            title="Drag to resize · double-click to reset"
            tabIndex={0}
            onPointerDown={startPanelResize}
            onDoubleClick={resetPanelHeight}
            onKeyDown={nudgePanel}
          />
          {renderPanelTabs(ctx)}
          {renderPanelContent(ctx)}
        </section>
      ) : null}
    </main>
  );
}

export function renderUpdateBanner(ctx: AppCtx) {
  const {
    setDismissedUpdateVersion,
    updateInfo,
    updateNow,
    updateProgressActive,
    updatingNow,
  } = ctx;
  const availableUpdateVersion = ctx.availableUpdateVersion!;
  const updateProgressLabel = ctx.updateProgressLabel!;
  const updateProgressPercent = ctx.updateProgressPercent!;
  return (
    <section
      className="update-banner"
      role="status"
      aria-live="polite"
      aria-label="Update available"
    >
      <div className="update-banner-main">
        <Download size={17} />
        <span>
          <strong>Update available</strong>
          <small>
            {updateProgressActive && updateProgressLabel
              ? updateProgressLabel
              : `A new version of ${productConfig.shortName} is ready.`}
          </small>
          {updateProgressActive ? (
            <div
              className={`update-progress-bar ${
                updateProgressPercent === null ? "is-indeterminate" : ""
              }`}
              role="progressbar"
              aria-label="Update download progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                updateProgressPercent === null
                  ? undefined
                  : Math.round(updateProgressPercent)
              }
            >
              <span
                style={
                  updateProgressPercent === null
                    ? undefined
                    : { width: `${updateProgressPercent}%` }
                }
              />
            </div>
          ) : null}
        </span>
      </div>
      <div className="update-banner-actions">
        <button
          type="button"
          onClick={() => setDismissedUpdateVersion(availableUpdateVersion)}
          disabled={updatingNow}
        >
          Later
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void updateNow()}
          disabled={updatingNow}
        >
          {updatingNow ? <LoaderCircle size={13} className="spin" /> : null}
          {updatingNow
            ? "Updating…"
            : updateInfo?.automaticInstallAvailable === false
              ? "Open update"
              : "Update now"}
        </button>
      </div>
    </section>
  );
}

export function renderStatusbarGroup(ctx: AppCtx) {
  const {
    activePanel,
    errors,
    gitActionBusy,
    hasVisibleProject,
    pickBranch,
    publishBranch,
    runScmAction,
    openPanel,
    openSidebar,
    panelVisible,
    statusMessage,
    warnings,
  } = ctx;
  const gitStatus = ctx.gitStatus!;
  const sharing = ctx.collaborationState;
  // The shared copy of a project: Git and local builds live in the owner's
  // folder, so the status bar says where you are instead of "No repository".
  const inSharedProject =
    hasVisibleProject && (sharing.enabled || Boolean(sharing.hosted));
  const sharingLive =
    sharing.enabled && (!sharing.hosted || sharing.host?.active !== false);
  const ownClientId = collaborationClientId();
  const others = sharing.enabled
    ? sharing.users.filter((user) => user.clientId !== ownClientId)
    : [];
  return (
    <div className="statusbar-group">
      {inSharedProject ? (
        <button
          type="button"
          className="statusbar-sharing"
          onClick={ctx.openShareDialog}
          title={
            sharingLive
              ? "Sharing is on — manage it or stop sharing"
              : "You are in the shared copy — go back to your folder"
          }
          aria-label={sharingLive ? "Sharing is on" : "Shared copy"}
        >
          <span
            className={`statusbar-sharing-dot ${sharingLive ? "live" : ""}`}
            aria-hidden="true"
          />
          {sharingLive ? "Sharing" : "Shared copy"}
        </button>
      ) : null}
      {others.length ? (
        <span className="statusbar-people" aria-label="People in this project">
          {others.slice(0, 6).map((user) => {
            const look = collaboratorLook(user.clientId);
            const where = user.currentFile
              ? `in ${pathForDisplay(user.currentFile)}`
              : "not in a file";
            return (
              <button
                key={user.clientId}
                type="button"
                className="statusbar-avatar"
                style={{ borderColor: look.color, background: `${look.color}33` }}
                onClick={() =>
                  user.currentFile ? void ctx.openGitFile(user.currentFile) : undefined
                }
                title={`${user.name || "Guest"} — ${where}${user.currentFile ? " (click to go there)" : ""}`}
                aria-label={`${user.name || "Guest"}, ${where}`}
              >
                {look.emoji}
              </button>
            );
          })}
          {others.length > 6 ? (
            <span className="statusbar-people-more">+{others.length - 6}</span>
          ) : null}
        </span>
      ) : null}
      {hasVisibleProject && !inSharedProject ? (
        <button
          type="button"
          onClick={() =>
            gitStatus?.isRepo ? void pickBranch() : openSidebar("sourceControl")
          }
          title={
            gitStatus?.isRepo
              ? `${gitStatus.branch || "Detached HEAD"}${
                  gitStatus.entries.length ? ", with changes" : ""
                } — Checkout Branch…`
              : "This project is not a Git repository — Open source control"
          }
          aria-label={gitStatus?.isRepo ? "Checkout branch" : "Open source control"}
        >
          <GitBranch size={12} aria-hidden="true" />
          {gitStatus?.isRepo
            ? `${gitStatus.branch || "Detached HEAD"}${
                gitStatus.entries.length ? "*" : ""
              }`
            : "No repository"}
        </button>
      ) : null}
      {hasVisibleProject && gitStatus?.isRepo && gitStatus.branch ? (
        <button
          type="button"
          onClick={() =>
            void (gitStatus.upstream ? runScmAction({ kind: "sync" }) : publishBranch())
          }
          disabled={gitActionBusy !== null}
          title={
            gitStatus.upstream
              ? `Synchronize Changes — ${gitStatus.behind ?? 0} to pull, ${gitStatus.ahead ?? 0} to push`
              : "Publish Branch"
          }
          aria-label={gitStatus.upstream ? "Synchronize changes" : "Publish branch"}
        >
          {gitStatus.upstream ? (
            <>
              <RefreshCw
                size={12}
                aria-hidden="true"
                className={gitActionBusy === "sync" ? "spin" : ""}
              />
              {gitStatus.behind ? ` ${gitStatus.behind}↓` : ""}
              {gitStatus.ahead ? ` ${gitStatus.ahead}↑` : ""}
            </>
          ) : (
            <CloudUpload size={12} aria-hidden="true" />
          )}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => openPanel("problems")}
        title={`${errors} error${errors === 1 ? "" : "s"} — Show problems`}
        aria-label={`Show problems: ${errors} error${errors === 1 ? "" : "s"}`}
        aria-controls="problems-panel"
        aria-expanded={panelVisible && activePanel === "problems"}
      >
        <CircleAlert size={13} aria-hidden="true" /> {errors}
      </button>
      <button
        type="button"
        onClick={() => openPanel("problems")}
        title={`${warnings} warning${warnings === 1 ? "" : "s"} — Show problems`}
        aria-label={`Show problems: ${warnings} warning${warnings === 1 ? "" : "s"}`}
        aria-controls="problems-panel"
        aria-expanded={panelVisible && activePanel === "problems"}
      >
        <AlertTriangle size={13} aria-hidden="true" /> {warnings}
      </button>
      {/* The latest status line, drawn from the attribute so it is not a
              second copy of the Output panel's text for assistive tech. */}
      <span
        className="statusbar-message"
        data-message={statusMessage}
        title={statusMessage}
      />
    </div>
  );
}

export function renderShareProjectDialog(ctx: AppCtx) {
  const {
    cancelJoinCollaboration,
    changeCollaborationApproval,
    collaborationBusy,
    collaborationCopied,
    collaborationDisplayName,
    collaborationPermissions,
    collaborationState,
    copyToClipboard,
    createCollaborationLink,
    currentUserRole,
    handleRemoveCollaborator,
    handleUpdatePermission,
    hostingAvailable,
    isProjectAdmin,
    joinCollaborationBusy,
    joinCollaborationError,
    joinCollaborationFromDialog,
    shareStartError,
    joinTokenDraft,
    joinWaitingMessage,
    loadCollaborationPermissions,
    projectId,
    projectIdRef,
    regenerateCollaborationLink,
    resolveCollaborationRequest,
    saveSharedProjectToFolder,
    setCollaborationCopied,
    setJoinCollaborationError,
    setJoinTokenDraft,
    setShareDialogOpen,
    setStatusMessage,
    shareDialogOpen,
    stopCollaboration,
  } = ctx;
  return (
    <ShareProjectDialog
      open={shareDialogOpen}
      state={collaborationState}
      copied={collaborationCopied}
      busy={collaborationBusy}
      joinToken={joinTokenDraft}
      joining={joinCollaborationBusy}
      joinError={joinCollaborationError}
      startError={shareStartError}
      displayName={collaborationDisplayName}
      permissions={collaborationPermissions}
      isAdmin={isProjectAdmin}
      currentUserRole={currentUserRole}
      onCopy={(text) => {
        void (async () => {
          await copyToClipboard(text);
          setCollaborationCopied(true);
          window.setTimeout(() => setCollaborationCopied(false), 1800);
          setStatusMessage(
            text === collaborationState.inviteCode || text.includes("/join#")
              ? "Link copied"
              : text === collaborationState.shareUrl
                ? "Collaboration link copied"
                : "Collaboration token copied",
          );
        })();
      }}
      hostingAvailable={hostingAvailable}
      hasProject={Boolean(projectId)}
      joinWaitingMessage={joinWaitingMessage}
      onCancelJoin={cancelJoinCollaboration}
      onStartSharing={(mode) => void createCollaborationLink(mode)}
      onStopSharing={() => void stopCollaboration()}
      onSaveToFolder={
        collaborationState.hosted ? () => void saveSharedProjectToFolder() : undefined
      }
      onReturnToFolder={
        collaborationState.hosted ? () => void ctx.returnToOwnFolder() : undefined
      }
      onRequireApprovalChange={(value) => void changeCollaborationApproval(value)}
      onResolveRequest={(clientId, approve) =>
        void resolveCollaborationRequest(clientId, approve)
      }
      onJoinTokenChange={(value) => {
        setJoinTokenDraft(value);
        if (joinWaitingMessage) {
          cancelJoinCollaboration();
        }
        if (joinCollaborationError) {
          setJoinCollaborationError("");
        }
      }}
      onEditName={() => {
        setShareDialogOpen(false);
        ctx.setProfileOpen(true);
      }}
      onJoin={() => void joinCollaborationFromDialog()}
      onRegenerate={() => void regenerateCollaborationLink()}
      onClose={() => {
        if (joinWaitingMessage) {
          cancelJoinCollaboration();
        }
        setShareDialogOpen(false);
      }}
      onUpdatePermission={handleUpdatePermission}
      onRemoveCollaborator={handleRemoveCollaborator}
      onRefreshPermissions={async () => {
        const currentProject = projectIdRef.current;
        if (currentProject) {
          await loadCollaborationPermissions(currentProject);
        }
      }}
    />
  );
}

export function renderModalBackdrop(ctx: AppCtx) {
  const {
    createError,
    createPath,
    creating,
    projectName,
    setCreateDialog,
    setCreatePath,
    submitCreate,
  } = ctx;
  const createDialog = ctx.createDialog!;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setCreateDialog(null);
        }
      }}
    >
      <form className="create-dialog" onSubmit={submitCreate}>
        <div className="dialog-icon">
          {createDialog === "file" ? <FilePlus2 size={20} /> : <FolderPlus size={20} />}
        </div>
        <div className="dialog-copy">
          <h2>Create new {createDialog}</h2>
          <p>
            Add it inside <strong>{projectName}</strong>. Nested paths such as{" "}
            <code>chapters/introduction.tex</code> are supported.
          </p>
        </div>
        <label htmlFor="create-path">
          {createDialog === "file" ? "File path" : "Folder path"}
        </label>
        <input
          id="create-path"
          autoFocus
          value={createPath}
          onChange={(event) => setCreatePath(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          spellCheck={false}
        />
        {createError ? (
          <div className="dialog-error">
            <CircleAlert size={14} />
            {createError}
          </div>
        ) : null}
        <div className="dialog-actions">
          <button
            type="button"
            className="dialog-cancel"
            onClick={() => setCreateDialog(null)}
          >
            Cancel
          </button>
          <button type="submit" className="dialog-submit" disabled={creating}>
            {creating ? "Creating…" : `Create ${createDialog}`}
          </button>
        </div>
      </form>
    </div>
  );
}

export function renderAiSelectionCard(ctx: AppCtx) {
  const {
    activeAiSelectionValue,
    aiConfig,
    downloadedLatexDoAiModelFiles,
    localTierAvailability,
    localTierRuntimeAvailability,
    selectCloudAiProvider,
    setAiConfig,
    setLatexDoAiModelMessage,
    setLocalAiProviderMode,
    tierAvailabilityById,
  } = ctx;
  return (
    <div className="ai-selection-card">
      <label className="settings-row ai-selection-row">
        <span>
          <strong>Choose AI</strong>
        </span>
        <select
          aria-label="AI selection"
          value={activeAiSelectionValue}
          onChange={(event) => {
            const selection = event.target.value as AiPrimarySelectionValue;
            setLatexDoAiModelMessage("");
            if (isLatexDoAiTierSelectValue(selection)) {
              const tier = latexDoAiTiers.find(
                (item) => item.id === tierFromSelectValue(selection),
              );
              if (!tier) return;
              const tierDownloaded =
                downloadedLatexDoAiModelFiles.has(tier.runtime.fileName) ||
                (aiConfig.modelId === tier.runtime.modelId && aiConfig.modelDownloaded);
              const availability = tierDownloaded
                ? localTierRuntimeAvailability(tier)
                : (tierAvailabilityById.get(tier.id) ?? localTierAvailability(tier));
              if (availability.state !== "available") {
                setLatexDoAiModelMessage(tierAvailabilityLabel(availability));
                return;
              }
              setLocalAiProviderMode("latexdo-ai");
              setAiConfig((c) => ({
                ...c,
                ...localRuntimeSelectionForTier(tier),
                modelDownloaded: downloadedLatexDoAiModelFiles.has(
                  tier.runtime.fileName,
                ),
              }));
              return;
            }
            selectCloudAiProvider(aiConfig.cloud.providerId);
          }}
        >
          {latexDoAiTiers.map((tier) => {
            const tierDownloaded =
              downloadedLatexDoAiModelFiles.has(tier.runtime.fileName) ||
              (aiConfig.modelId === tier.runtime.modelId && aiConfig.modelDownloaded);
            const availability = tierDownloaded
              ? localTierRuntimeAvailability(tier)
              : (tierAvailabilityById.get(tier.id) ?? localTierAvailability(tier));
            return (
              <option
                key={tier.id}
                value={latexDoAiTierSelectValue(tier.id)}
                disabled={availability.state !== "available"}
              >
                {tier.name}
                {availability.state === "available" ? "" : " (unavailable)"}
              </option>
            );
          })}
          <option value="customize">Customize</option>
        </select>
      </label>
    </div>
  );
}

export function renderAiCustomizePanel(ctx: AppCtx) {
  const {
    activeAiModelAvailable,
    activeAiModelValue,
    activeCustomProviderValue,
    aiConfig,
    aiIsDesktop,
    cloudModelOptions,
    downloadedLatexDoAiModelFiles,
    importLatexDoAiModel,
    importedLocalModels,
    importedLocalRecordsById,
    importingLatexDoAiModel,
    localAiProviderMode,
    ollamaModelFetchState,
    ollamaModels,
    patchCloudConfig,
    refreshOllamaModels,
    selectCloudAiProvider,
    selectedCloudProvider,
    selectedImportedLocalModel,
    selectedImportedLocalModelCanRun,
    selectedImportedLocalModelDownloaded,
    setAiConfig,
    setLatexDoAiModelMessage,
    setLocalAiProviderMode,
  } = ctx;
  return (
    <div className="ai-customize-panel">
      <label className="settings-row ai-selection-row">
        <span>
          <strong>Customize</strong>
        </span>
        <select
          aria-label="Custom provider"
          value={activeCustomProviderValue}
          onChange={(event) => {
            const provider = event.target.value as CustomAiProviderSelectValue;
            setLatexDoAiModelMessage("");
            if (isCloudProviderSelectValue(provider)) {
              selectCloudAiProvider(provider.slice("cloud:".length));
              return;
            }
            if (provider === "local-model") {
              const model =
                selectedImportedLocalModel ?? importedLocalModels[0] ?? null;
              setLocalAiProviderMode("local-model");
              setAiConfig((c) => ({
                ...c,
                provider: "local",
                selection: {
                  mode: "custom",
                  custom: {
                    kind: "gguf",
                    modelId: model?.id ?? "",
                  },
                },
                modelId: model?.id ?? "",
                modelDownloaded: model
                  ? downloadedLatexDoAiModelFiles.has(model.fileName) ||
                    (c.modelId === model.id && c.modelDownloaded)
                  : false,
              }));
              return;
            }
            if (provider === "ollama") {
              setAiConfig((c) => ({
                ...c,
                provider: "ollama",
                selection: {
                  mode: "custom",
                  custom: {
                    kind: "ollama",
                    baseUrl: c.ollamaBaseUrl,
                    model: c.ollamaModel,
                  },
                },
              }));
              return;
            }
            setAiConfig((c) => ({
              ...c,
              provider,
              selection: { mode: "off" },
            }));
          }}
        >
          {cloudProviders.map((provider) => (
            <option key={provider.id} value={`cloud:${provider.id}`}>
              API Provider: {provider.label}
            </option>
          ))}
          <option value="ollama" disabled={!aiIsDesktop}>
            Ollama{aiIsDesktop ? "" : " (desktop only)"}
          </option>
          <option value="local-model" disabled={!aiIsDesktop}>
            Local GGUF Model{aiIsDesktop ? "" : " (desktop only)"}
          </option>
          <option value="off">Off</option>
        </select>
      </label>

      <label className="settings-row ai-selection-row">
        <span>
          <strong>Model</strong>
        </span>
        <div className="ai-model-control">
          {aiConfig.provider === "cloud" && selectedCloudProvider?.custom ? (
            <input
              aria-label="Model"
              type="text"
              value={aiConfig.cloud.model}
              onChange={(event) => patchCloudConfig({ model: event.target.value })}
            />
          ) : (
            <select
              aria-label="Model"
              value={activeAiModelValue}
              disabled={
                aiConfig.provider === "off" ||
                (aiConfig.provider === "local" &&
                  localAiProviderMode === "local-model" &&
                  importedLocalModels.length === 0)
              }
              onChange={(event) => {
                const modelId = event.target.value;
                if (aiConfig.provider === "cloud") {
                  patchCloudConfig({ model: modelId });
                  return;
                }
                if (aiConfig.provider === "ollama") {
                  setAiConfig((c) => ({
                    ...c,
                    ollamaModel: modelId,
                    selection: {
                      mode: "custom",
                      custom: {
                        kind: "ollama",
                        baseUrl: c.ollamaBaseUrl,
                        model: modelId,
                      },
                    },
                  }));
                  return;
                }
                if (
                  aiConfig.provider === "local" &&
                  localAiProviderMode === "local-model"
                ) {
                  const model = importedLocalModels.find((item) => item.id === modelId);
                  setAiConfig((c) => ({
                    ...c,
                    provider: "local",
                    selection: {
                      mode: "custom",
                      custom: { kind: "gguf", modelId },
                    },
                    modelId,
                    modelDownloaded: model
                      ? downloadedLatexDoAiModelFiles.has(model.fileName) ||
                        (c.modelId === model.id && c.modelDownloaded)
                      : false,
                  }));
                }
              }}
            >
              {aiConfig.provider === "cloud" ? (
                <>
                  {aiConfig.cloud.model &&
                    !cloudModelOptions.includes(aiConfig.cloud.model) && (
                      <option value={aiConfig.cloud.model}>
                        {aiConfig.cloud.model}
                      </option>
                    )}
                  {cloudModelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </>
              ) : aiConfig.provider === "ollama" ? (
                <>
                  <option value="">Select model</option>
                  {aiConfig.ollamaModel &&
                    !ollamaModels.includes(aiConfig.ollamaModel) && (
                      <option value={aiConfig.ollamaModel}>
                        {aiConfig.ollamaModel}
                      </option>
                    )}
                  {ollamaModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </>
              ) : aiConfig.provider === "local" &&
                localAiProviderMode === "local-model" ? (
                <>
                  {importedLocalModels.length === 0 ? (
                    <option value="">No imported GGUF models</option>
                  ) : null}
                  {importedLocalModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} ·{" "}
                      {formatFileSize(
                        importedLocalRecordsById.get(model.id)?.sizeBytes,
                      )}
                    </option>
                  ))}
                </>
              ) : (
                <option value="">Off</option>
              )}
            </select>
          )}
          {aiConfig.provider === "cloud" ? (
            activeAiModelAvailable ? (
              <span className="ai-model-status ready">
                <Check size={13} /> OK
              </span>
            ) : null
          ) : aiConfig.provider === "ollama" ? (
            activeAiModelAvailable ? (
              <span className="ai-model-status ready">
                <Check size={13} /> OK
              </span>
            ) : (
              <button
                type="button"
                className="ai-model-action"
                onClick={() => void refreshOllamaModels()}
                disabled={ollamaModelFetchState === "loading"}
              >
                {ollamaModelFetchState === "loading" ? (
                  <>
                    <LoaderCircle size={13} className="spin" /> Fetch
                  </>
                ) : (
                  <>
                    <RefreshCw size={13} /> Fetch
                  </>
                )}
              </button>
            )
          ) : aiConfig.provider === "local" && localAiProviderMode === "local-model" ? (
            selectedImportedLocalModelDownloaded && selectedImportedLocalModelCanRun ? (
              <span className="ai-model-status ready">
                <Check size={13} /> OK
              </span>
            ) : (
              <button
                type="button"
                className="ai-model-action"
                onClick={() => void importLatexDoAiModel()}
                disabled={importingLatexDoAiModel}
              >
                {importingLatexDoAiModel ? (
                  <>
                    <LoaderCircle size={13} className="spin" /> Import
                  </>
                ) : (
                  <>
                    <FileUp size={13} /> Import
                  </>
                )}
              </button>
            )
          ) : null}
        </div>
      </label>
    </div>
  );
}
