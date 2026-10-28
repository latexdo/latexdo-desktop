import { toolTabIds } from "./features/workspace/toolTabs";
import { VoiceSettingsSection } from "./components/VoiceSettingsPanel";
import { Check, ChevronDown, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { productConfig } from "./productConfig";
import { appVersion } from "./appVersion";
import { ReviewSidebar } from "./components/ReviewSidebar";
import { RebuttalSidebar } from "./components/RebuttalSidebar";
import { FindPanel } from "./components/FindPanel";
import { normalizeRelativePath } from "./features/project/projectUtils";
import { EnterpriseDashboard } from "./components/EnterpriseDashboard";
import { ExtensionsSidebar } from "./components/ExtensionsSidebar";
import { SetupWizard } from "./components/SetupWizard";
import { LegalAcceptanceGate } from "./components/LegalAcceptanceGate";
import { ProfileDialog } from "./components/ProfileDialog";
import { WhatsNewModal } from "./components/WhatsNewModal";
import { UpdateRestartCountdown } from "./components/UpdateRestartCountdown";
import { NotificationCenter } from "./components/NotificationCenter";
import { TourOverlay } from "./features/onboarding/presentation/TourOverlay";
import { editorActivationTour } from "./features/onboarding/tours/editorActivation";
import {
  StatusBarCursor,
  formatRam,
  statusbarEngineNames,
  tierAvailabilityLabel,
} from "./app/appShared";
import "./features/editor/nextEdit/nextEdit.css";
import { useAppWorkspaceState } from "./app/useAppWorkspaceState";
import { useAppPanelAndGitState } from "./app/useAppPanelAndGitState";
import { useAppProjectFiles } from "./app/useAppProjectFiles";
import { useAppProjectLifecycle } from "./app/useAppProjectLifecycle";
import { useAppSourcePdfSync } from "./app/useAppSourcePdfSync";
import { useAppEditorDecorations } from "./app/useAppEditorDecorations";
import { useAppCitationSearch } from "./app/useAppCitationSearch";
import { useAppMonacoSetup } from "./app/useAppMonacoSetup";
import { useAppCollaboration } from "./app/useAppCollaboration";
import { statusbarStateFor, useNetworkOnline } from "./app/statusbarState";
import { useAppProjectCreation } from "./app/useAppProjectCreation";
import { useAppAiActions } from "./app/useAppAiActions";
import { useAppWorkspaceLayout } from "./app/useAppWorkspaceLayout";
import { useAppGitNavigation } from "./app/useAppGitNavigation";
import { useAppReviewActions } from "./app/useAppReviewActions";
import { useAppRebuttalAndHistory } from "./app/useAppRebuttalAndHistory";
import { useAppDerivedState } from "./app/useAppDerivedState";
import { useAppCitationAssistant } from "./app/useAppCitationAssistant";
import { useAppSessionRestore } from "./app/useAppSessionRestore";
import { useAppPaperReview } from "./app/useAppPaperReview";
import { useAppViewLayout } from "./app/useAppViewLayout";
import { useAppMenuCommands } from "./app/useAppMenuCommands";
import { SettingsShell } from "./components/SettingsShell";
import { KeyboardShortcutsDialog } from "./components/KeyboardShortcutsDialog";
import {
  renderActivityBar,
  renderFileTree,
  renderReviewFiles,
  renderSidebar,
  renderSmallIcon,
  renderTitlebar,
} from "./app/views/titlebarAndSidebarView";
import { renderSidebarPanel } from "./app/views/sourceControlAndToolbarView";
import {
  renderAiCustomizePanel,
  renderAiSelectionCard,
  renderMainArea,
  renderModalBackdrop,
  renderShareProjectDialog,
  renderStatusbarGroup,
  renderUpdateBanner,
} from "./app/views/mainAreaAndAiSettingsView";
import {
  renderCloudForm,
  renderCloudForm2,
  renderSettingsSectionHeading,
  renderSettingsSectionHeading2,
} from "./app/views/settingsEditorView";
import {
  renderSettingsSectionHeading10,
  renderSettingsSectionHeading3,
  renderSettingsSectionHeading4,
  renderSettingsSectionHeading5,
  renderSettingsSectionHeading6,
  renderSettingsSectionHeading7,
  renderSettingsSectionHeading8,
  renderSettingsSectionHeading9,
} from "./app/views/settingsToolsView";
import {
  renderSettingsFooter,
  renderSettingsSectionHeading11,
  renderSettingsSectionHeading12,
} from "./app/views/settingsAboutView";

export default function App() {
  const networkOnline = useNetworkOnline();
  // The component's state and handlers live in src/app, split by area. Each
  // hook receives what the earlier ones returned, so the hooks run in a fixed order.
  const s01 = useAppWorkspaceState();
  const s02 = { ...s01, ...useAppPanelAndGitState(s01) };
  const s03 = { ...s02, ...useAppProjectFiles(s02) };
  const s04 = { ...s03, ...useAppProjectLifecycle(s03) };
  const s05 = { ...s04, ...useAppSourcePdfSync(s04) };
  const s06 = { ...s05, ...useAppEditorDecorations(s05) };
  const s07 = { ...s06, ...useAppCitationSearch(s06) };
  const s08 = { ...s07, ...useAppMonacoSetup(s07) };
  const s09 = { ...s08, ...useAppCollaboration(s08) };
  const s10 = { ...s09, ...useAppProjectCreation(s09) };
  const s11 = { ...s10, ...useAppAiActions(s10) };
  const s12 = { ...s11, ...useAppWorkspaceLayout(s11) };
  const s13 = { ...s12, ...useAppGitNavigation(s12) };
  const s14 = { ...s13, ...useAppReviewActions(s13) };
  const s15 = { ...s14, ...useAppRebuttalAndHistory(s14) };
  const s16 = { ...s15, ...useAppDerivedState(s15) };
  const s17 = { ...s16, ...useAppCitationAssistant(s16) };
  const s18 = { ...s17, ...useAppSessionRestore(s17) };
  const s19 = { ...s18, ...useAppPaperReview(s18) };
  const s20 = { ...s19, ...useAppViewLayout(s19) };
  const s21 = { ...s20, ...useAppMenuCommands(s20) };
  const ctx = s21;
  const {
    openInstalledExtension,
    openExtensionDetails,
    activePath,
    extensionDetailsId,
    acceptLegalPolicies,
    activationTourLaunchNonce,
    activeAiSelectionValue,
    activeDocumentIsLatex,
    activeSidebar,
    aiSidebarExpanded,
    activeTextDocument,
    editorRef,
    aiConfig,
    aiIsDesktop,
    aiSystemCapabilities,
    aiSystemCapabilitiesState,
    aiWizardOpen,
    availableUpdateVersion,
    closeWhatsNewDialog,
    completeAiSetup,
    createDialog,
    downloadLatexDoAiModel,
    engine,
    enterpriseState,
    exportEnterpriseReport,
    extensionCatalog,
    extensionCatalogError,
    extensionCatalogLoading,
    extensionCategoryFilter,
    extensionQuery,
    filteredExtensions,
    handleAddRebuttalItem,
    handleAddRebuttalToSource,
    handleAddReviewChat,
    handleAddReviewComment,
    handleDeleteRebuttalItem,
    handleDeleteReviewChat,
    handleGenerateRebuttalLetter,
    rebuttalLetterPath,
    openRebuttalLetter,
    allProjectEntries,
    handleInsertRebuttalItemIntoTex,
    handleInsertReviewChatIntoTex,
    handleJumpToReviewSelection,
    handleOpenProjectSearchMatch,
    handleUpdateRebuttalItem,
    hasVisibleProject,
    importOverleafProject,
    installExtension,
    installedExtensionIdSet,
    latexDoAiModelMessage,
    legalAcceptanceRequired,
    localAiProviderMode,
    mode,
    nudgeSidebar,
    openExternalLink,
    openPdfFileForReview,
    openProject,
    pdfReviewInputRef,
    prepareActivationTutorial,
    profileOpen,
    projectName,
    projectSearchError,
    projectSearchFiles,
    projectSearchLoading,
    rebuttalItems,
    refreshAiSystemCapabilities,
    refreshGitData,
    refreshProject,
    rememberImportedLatexDoAiModel,
    resetSidebarWidth,
    resolvedAppearance,
    restoreActivationWorkspace,
    revealActivationStep,
    reviewChats,
    selectedImportedCompatibility,
    selectedLatexDoAiDownloadLabel,
    selectedLatexDoAiModelDownloading,
    selectedLatexDoAiTier,
    selectedLatexDoAiTierAvailability,
    selectedLatexDoAiTierCanRun,
    selectedLatexDoAiTierDownloaded,
    setAiAccess,
    setAiConfig,
    setDismissedUpdateVersion,
    setEnterpriseState,
    setExtensionCategoryFilter,
    setExtensionQuery,
    setProfileOpen,
    setProjectSearchRefreshNonce,
    setSettings,
    setSettingsOpen,
    setSettingsTab,
    setStatusMessage,
    settings,
    settingsOpen,
    settingsTab,
    extensionToolInstallation,
    showLegalAcceptanceGate,
    showWelcome,
    sidebarVisible,
    sidebarWidthStyle,
    startSidebarResize,
    updateBannerVisible,
    updateProgressPercent,
    updatingNow,
    viewFullReleaseNotes,
    whatsNew,
    whatsNewOpen,
  } = ctx;
  const statusbarState = statusbarStateFor({
    compileResult: ctx.compileResult,
    sharing: ctx.collaborationState.enabled,
    onlineCopy: ctx.hasVisibleProject && Boolean(ctx.collaborationState.hosted),
    onlineBusy: ctx.collaborationBusy,
    liveConnection: ctx.liveConnection,
    online: networkOnline,
  });
  const projectHasFile = (relativePath: string) =>
    allProjectEntries.some(
      (entry) => entry.type === "file" && entry.relativePath === relativePath,
    );
  // Expanded AI chat is its own full view: it replaces the editor and preview.
  const aiStandalone = sidebarVisible && activeSidebar === "ai" && aiSidebarExpanded;

  return (
    <div
      className="app-shell"
      data-theme={settings.colorTheme}
      data-appearance={settings.appearanceMode}
      data-resolved-appearance={resolvedAppearance}
    >
      <input
        ref={pdfReviewInputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        aria-label="Choose a PDF to review"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            void openPdfFileForReview(file);
          }
        }}
      />
      {aiWizardOpen && (
        <SetupWizard
          initialConfig={aiConfig}
          isDesktop={aiIsDesktop}
          onApplyTheme={(colorTheme, appearanceMode) =>
            setSettings((current) => ({ ...current, colorTheme, appearanceMode }))
          }
          colorTheme={settings.colorTheme}
          appearance={resolvedAppearance}
          onComplete={completeAiSetup}
          systemCapabilities={aiSystemCapabilities}
          systemCapabilitiesState={aiSystemCapabilitiesState}
          onRefreshSystemCapabilities={refreshAiSystemCapabilities}
          onImportedModel={rememberImportedLatexDoAiModel}
          legalAccepted={!legalAcceptanceRequired}
          onAcceptLegal={acceptLegalPolicies}
          onOpenExternal={openExternalLink}
          productName={productConfig.shortName}
          productSetupName={`${productConfig.shortName} Setup`}
        />
      )}
      {showLegalAcceptanceGate && (
        <LegalAcceptanceGate
          onAccept={acceptLegalPolicies}
          onOpenExternal={openExternalLink}
          productName={productConfig.shortName}
        />
      )}
      {!aiWizardOpen && !showLegalAcceptanceGate ? (
        <TourOverlay
          tour={editorActivationTour}
          // The tour teaches on a real document, so it waits for one.
          launchNonce={
            activeDocumentIsLatex && hasVisibleProject ? activationTourLaunchNonce : 0
          }
          onPrepare={prepareActivationTutorial}
          onRestore={restoreActivationWorkspace}
          onRevealStep={revealActivationStep}
        />
      ) : null}
      {profileOpen && (
        <ProfileDialog
          profile={aiConfig.profile}
          onChange={(profile) => setAiConfig((c) => ({ ...c, profile }))}
          onClose={() => setProfileOpen(false)}
          onOpenExternal={openExternalLink}
          onImportOverleafProject={importOverleafProject}
        />
      )}
      {renderTitlebar(ctx)}

      <div
        className={`workbench workspace-layout-${aiConfig.layoutPreset} ${aiStandalone ? "ai-standalone" : ""} ${ctx.focusMode ? "focus-mode" : ""}`}
        data-layout-preset={aiConfig.layoutPreset}
        data-tour-id="workspace"
      >
        {renderActivityBar(ctx)}

        {sidebarVisible ? (
          activeSidebar === "ai" ? (
            renderSidebar(ctx)
          ) : (
            <aside
              className={`sidebar ${activeSidebar === "sourceControl" ? "source-control-sidebar" : ""}`}
              data-view={activeSidebar}
              style={sidebarWidthStyle}
            >
              {activeSidebar === "sourceControl" ? null : (
                <div className="sidebar-header">
                  <span>
                    {activeSidebar === "explorer"
                      ? "EXPLORER"
                      : activeSidebar === "enterprise"
                        ? "ENTERPRISE"
                        : "EXTENSIONS"}
                  </span>
                  <div>
                    {activeSidebar === "enterprise" ? (
                      <button
                        className="small-icon"
                        onClick={exportEnterpriseReport}
                        title="Export compliance report"
                      >
                        <Download size={14} />
                      </button>
                    ) : activeSidebar === "explorer" ? (
                      <button
                        className="small-icon"
                        onClick={() => void refreshProject()}
                        title="Refresh"
                        disabled={!hasVisibleProject}
                      >
                        <RefreshCw size={14} />
                      </button>
                    ) : activeSidebar === "extensions" ? (
                      renderSmallIcon(ctx)
                    ) : null}
                  </div>
                </div>
              )}
              {activeSidebar === "enterprise" ? (
                <div className="sidebar-panel enterprise-panel">
                  <EnterpriseDashboard
                    state={enterpriseState}
                    projectName={projectName}
                    activeDocumentPath={activeTextDocument?.relativePath}
                    onChange={setEnterpriseState}
                    onExportReport={exportEnterpriseReport}
                    onStatusMessage={setStatusMessage}
                  />
                </div>
              ) : activeSidebar === "explorer" ? (
                <>
                  <button className="project-heading" onClick={openProject}>
                    <ChevronDown size={13} />
                    <span>{projectName.toUpperCase()}</span>
                  </button>
                  <div
                    className={`file-tree ${
                      hasVisibleProject && mode !== "author" ? "with-review" : ""
                    }`}
                  >
                    {!hasVisibleProject ? (
                      <div className="sidebar-empty-state">
                        No project open. Create a project or open an existing folder.
                      </div>
                    ) : mode === "author" ? (
                      renderFileTree(ctx)
                    ) : (
                      <>
                        {mode === "reviewer" ? (
                          <ReviewSidebar
                            chats={reviewChats}
                            onAddChat={handleAddReviewChat}
                            onAddComment={handleAddReviewComment}
                            onDeleteChat={(chatId) =>
                              void handleDeleteReviewChat(chatId)
                            }
                            onJumpToSelection={handleJumpToReviewSelection}
                            onInsertIntoTex={(chat) =>
                              void handleInsertReviewChatIntoTex(chat)
                            }
                          />
                        ) : (
                          <RebuttalSidebar
                            items={rebuttalItems}
                            onAddItem={handleAddRebuttalItem}
                            onAddRebuttalToSource={handleAddRebuttalToSource}
                            onUpdateItem={handleUpdateRebuttalItem}
                            onDeleteItem={handleDeleteRebuttalItem}
                            onGenerateLetter={handleGenerateRebuttalLetter}
                            letterPath={rebuttalLetterPath}
                            letterExists={projectHasFile(rebuttalLetterPath)}
                            onOpenLetter={() => void openRebuttalLetter()}
                            onInsertItemIntoTex={handleInsertRebuttalItemIntoTex}
                          />
                        )}
                        {/* Reviewing still needs the project files at hand. */}
                        {renderReviewFiles(ctx)}
                      </>
                    )}
                  </div>
                </>
              ) : activeSidebar === "extensions" ? (
                <ExtensionsSidebar
                  catalog={extensionCatalog}
                  catalogLoading={extensionCatalogLoading}
                  catalogError={extensionCatalogError}
                  query={extensionQuery}
                  onQueryChange={setExtensionQuery}
                  categoryFilter={extensionCategoryFilter}
                  onCategoryFilterChange={setExtensionCategoryFilter}
                  installedExtensionIdSet={installedExtensionIdSet}
                  filteredExtensions={filteredExtensions}
                  onInstallExtension={installExtension}
                  onOpenExtension={openInstalledExtension}
                  onShowDetails={(extension) => openExtensionDetails(extension.id)}
                  selectedExtensionId={
                    activePath === toolTabIds.extensionDetails ? extensionDetailsId : ""
                  }
                />
              ) : activeSidebar === "sourceControl" ? (
                renderSidebarPanel(ctx)
              ) : null}
            </aside>
          )
        ) : null}
        {sidebarVisible && !aiStandalone ? (
          <div
            className="sidebar-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            title="Drag to resize · double-click to reset"
            tabIndex={0}
            onPointerDown={startSidebarResize}
            onDoubleClick={resetSidebarWidth}
            onKeyDown={nudgeSidebar}
          />
        ) : null}

        {renderMainArea(ctx)}
      </div>

      {updateBannerVisible && availableUpdateVersion ? renderUpdateBanner(ctx) : null}

      <footer
        className="statusbar"
        data-state={statusbarState}
        aria-label="Project diagnostics"
      >
        {renderStatusbarGroup(ctx)}
        <div className="statusbar-group">
          {mode !== "author" ? (
            <span className="statusbar-item">
              {mode === "reviewer" ? "Reviewer mode" : "Rebuttal mode"}
            </span>
          ) : null}
          {activeTextDocument && !showWelcome ? <StatusBarCursor /> : null}
          {activeDocumentIsLatex ? (
            <span className="statusbar-item">{statusbarEngineNames[engine]}</span>
          ) : null}
          {availableUpdateVersion ? (
            <button
              type="button"
              className="statusbar-update"
              onClick={() =>
                setDismissedUpdateVersion(
                  updateBannerVisible ? availableUpdateVersion : null,
                )
              }
              title={`${productConfig.shortName} ${availableUpdateVersion} is available`}
              aria-label={`Update available: ${availableUpdateVersion}`}
              aria-expanded={updateBannerVisible}
            >
              {updatingNow ? (
                <LoaderCircle size={12} className="spin" aria-hidden="true" />
              ) : (
                <Download size={12} aria-hidden="true" />
              )}
              {updatingNow && updateProgressPercent !== null
                ? `Updating ${Math.round(updateProgressPercent)}%`
                : updatingNow
                  ? "Updating"
                  : "Update"}
            </button>
          ) : null}
          <span className="statusbar-item" title={`${productConfig.shortName} version`}>
            v{appVersion}
          </span>
          <NotificationCenter />
        </div>
      </footer>

      {renderShareProjectDialog(ctx)}

      {createDialog ? renderModalBackdrop(ctx) : null}

      {settingsOpen ? (
        <div className="settings-backdrop">
          <SettingsShell
            activePage={settingsTab}
            onSelectPage={setSettingsTab}
            onClose={() => setSettingsOpen(false)}
            footer={renderSettingsFooter(ctx)}
            pages={[
              {
                id: "editor",
                title: "General",
                group: "LatexDo",
                content: renderSettingsSectionHeading(ctx),
              },
              {
                id: "ai",
                title: "AI Assistant",
                group: "LatexDo",
                content: (
                  <div className="ai-settings-panel">
                    <div className="settings-section-heading">
                      <strong>Model</strong>
                    </div>
                    {renderAiSelectionCard(ctx)}

                    {activeAiSelectionValue !== "customize" && selectedLatexDoAiTier ? (
                      <div className="ai-tier-settings-card">
                        <div className="ai-tier-settings-head">
                          <div>
                            <strong>{selectedLatexDoAiTier.name}</strong>
                            <span>{selectedLatexDoAiTier.description}</span>
                          </div>
                          {selectedLatexDoAiTierDownloaded &&
                          selectedLatexDoAiTierCanRun ? (
                            <span className="ai-model-status ready">
                              <Check size={13} /> Installed
                            </span>
                          ) : null}
                        </div>
                        <p className="settings-hint compact">
                          {tierAvailabilityLabel(selectedLatexDoAiTierAvailability)}
                        </p>
                        <div className="ai-tier-actions">
                          {selectedLatexDoAiTierAvailability.state ===
                            "memory-pressure" ||
                          selectedLatexDoAiTierAvailability.state ===
                            "storage-pressure" ? (
                            <button
                              type="button"
                              className="ai-wizard-ghost"
                              onClick={() => void refreshAiSystemCapabilities()}
                            >
                              <RefreshCw size={13} /> Check again
                            </button>
                          ) : null}
                          {selectedLatexDoAiTierCanRun &&
                          !selectedLatexDoAiTierDownloaded ? (
                            <button
                              type="button"
                              className="ai-model-action"
                              onClick={() =>
                                void downloadLatexDoAiModel(selectedLatexDoAiTier)
                              }
                              disabled={selectedLatexDoAiModelDownloading}
                            >
                              {selectedLatexDoAiModelDownloading ? (
                                <>
                                  <LoaderCircle size={13} className="spin" />{" "}
                                  {selectedLatexDoAiDownloadLabel || "Download"}
                                </>
                              ) : (
                                <>
                                  <Download size={13} /> Download
                                </>
                              )}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {activeAiSelectionValue === "customize"
                      ? renderAiCustomizePanel(ctx)
                      : null}

                    {activeAiSelectionValue === "customize" &&
                    aiConfig.provider === "cloud"
                      ? renderCloudForm(ctx)
                      : null}
                    {activeAiSelectionValue === "customize" &&
                    aiConfig.provider === "ollama"
                      ? renderCloudForm2(ctx)
                      : null}
                    {activeAiSelectionValue === "customize" &&
                    aiConfig.provider === "local" &&
                    localAiProviderMode === "local-model" &&
                    selectedImportedCompatibility ? (
                      <p className="settings-hint compact">
                        {selectedImportedCompatibility.state === "compatible"
                          ? `Estimated memory: ${formatRam(
                              selectedImportedCompatibility.estimatedRamBytes ?? 0,
                            )}. Tool support: unknown.`
                          : selectedImportedCompatibility.state === "memory-pressure"
                            ? `Temporarily unavailable: estimated memory ${formatRam(
                                selectedImportedCompatibility.estimatedRamBytes ?? 0,
                              )}, currently available ${formatRam(
                                selectedImportedCompatibility.availableRamBytes ?? 0,
                              )}.`
                            : selectedImportedCompatibility.state === "unsupported"
                              ? `Not supported: ${selectedImportedCompatibility.reason ?? "estimated memory exceeds this machine."}`
                              : "Compatibility unknown. Advanced users may still try this model."}
                      </p>
                    ) : null}
                    {latexDoAiModelMessage && aiConfig.provider === "local" ? (
                      <p className="settings-hint compact">{latexDoAiModelMessage}</p>
                    ) : null}

                    <div className="settings-section-heading">
                      <strong>Context access</strong>
                    </div>
                    <label className="settings-row settings-toggle">
                      <span>
                        <strong>Chat history</strong>
                      </span>
                      <input
                        type="checkbox"
                        checked={aiConfig.access.chatHistory}
                        onChange={(event) =>
                          setAiAccess("chatHistory", event.target.checked)
                        }
                      />
                    </label>
                    <label className="settings-row settings-toggle">
                      <span>
                        <strong>Current editor</strong>
                      </span>
                      <input
                        type="checkbox"
                        checked={aiConfig.access.currentEditor}
                        onChange={(event) =>
                          setAiAccess("currentEditor", event.target.checked)
                        }
                      />
                    </label>
                    <label className="settings-row settings-toggle">
                      <span>
                        <strong>Project files</strong>
                      </span>
                      <input
                        type="checkbox"
                        checked={aiConfig.access.projectFiles}
                        onChange={(event) =>
                          setAiAccess("projectFiles", event.target.checked)
                        }
                      />
                    </label>
                    <label className="settings-row settings-toggle">
                      <span>
                        <strong>Bibliography and citations</strong>
                      </span>
                      <input
                        type="checkbox"
                        checked={aiConfig.access.bibliography}
                        onChange={(event) =>
                          setAiAccess("bibliography", event.target.checked)
                        }
                      />
                    </label>
                    <label className="settings-row settings-toggle">
                      <span>
                        <strong>Researcher profile</strong>
                      </span>
                      <input
                        type="checkbox"
                        checked={aiConfig.access.researcherProfile}
                        onChange={(event) =>
                          setAiAccess("researcherProfile", event.target.checked)
                        }
                      />
                    </label>

                    <div className="settings-section-heading">Writing assistance</div>
                    <label className="settings-row settings-toggle">
                      <span>
                        <strong>Suggest text as I type</strong>
                        <small>
                          Grey text continues what you are writing. Tab accepts it,
                          ⌘/Ctrl+→ accepts one word, Esc hides it and ⌥/Alt+\ asks for a
                          suggestion now.
                        </small>
                      </span>
                      <input
                        type="checkbox"
                        checked={aiConfig.sentenceCompletionEnabled}
                        onChange={(event) =>
                          setAiConfig((current) => ({
                            ...current,
                            sentenceCompletionEnabled: event.target.checked,
                          }))
                        }
                      />
                    </label>

                    <VoiceSettingsSection aiConfig={aiConfig} />

                    <div className="settings-section-heading">AI edit safety</div>
                    <label className="settings-row settings-toggle">
                      <span>
                        <strong>Ask before the assistant edits files</strong>
                        <small>
                          {aiConfig.autoApproveEdits
                            ? "Edits from the AI chat are applied right away. You can still undo them in the editor."
                            : "Each edit from the AI chat is shown for approval before it is applied."}
                        </small>
                      </span>
                      <input
                        type="checkbox"
                        checked={!aiConfig.autoApproveEdits}
                        onChange={(event) =>
                          setAiConfig((current) => ({
                            ...current,
                            autoApproveEdits: !event.target.checked,
                          }))
                        }
                      />
                    </label>
                  </div>
                ),
              },
              {
                id: "language",
                title: "Language",
                group: "Writing",
                content: renderSettingsSectionHeading2(ctx),
              },
              {
                id: "conference",
                title: "Conference Checker",
                group: "Checks",
                content: renderSettingsSectionHeading3(ctx),
              },
              ...(extensionToolInstallation.projectBibliography
                ? [
                    {
                      id: "citation",
                      title: "Citation Assistant",
                      group: "Checks",
                      content: renderSettingsSectionHeading4(ctx),
                    },
                  ]
                : []),
              {
                id: "structure",
                title: "Structure Assistant",
                group: "Checks",
                content: renderSettingsSectionHeading5(ctx),
              },
              {
                id: "reproducibility",
                title: "Reproducibility",
                group: "Checks",
                content: renderSettingsSectionHeading6(ctx),
              },
              {
                id: "acronym",
                title: "Acronym Manager",
                group: "Checks",
                content: renderSettingsSectionHeading7(ctx),
              },
              ...(extensionToolInstallation.notationManager
                ? [
                    {
                      id: "notation",
                      title: "Notation",
                      group: "Checks",
                      content: renderSettingsSectionHeading10(ctx),
                    },
                  ]
                : []),
              {
                id: "pdf",
                title: "PDF Compliance",
                group: "Checks",
                content: renderSettingsSectionHeading11(ctx),
              },
              {
                id: "doctor",
                title: "Error Doctor",
                group: "Build",
                content: renderSettingsSectionHeading8(ctx),
              },
              ...(extensionToolInstallation.tikzConverter
                ? [
                    {
                      id: "tikz",
                      title: "TikZ Converter",
                      group: "Tools",
                      content: renderSettingsSectionHeading9(ctx),
                    },
                  ]
                : []),
              {
                id: "application",
                title: "About",
                group: "Application",
                content: renderSettingsSectionHeading12(ctx),
              },
            ]}
          />
        </div>
      ) : null}

      <UpdateRestartCountdown />
      {hasVisibleProject ? (
        <FindPanel
          files={projectSearchFiles}
          activeFile={
            activeTextDocument
              ? {
                  path: normalizeRelativePath(activeTextDocument.relativePath),
                  content: activeTextDocument.content,
                }
              : null
          }
          loading={projectSearchLoading}
          error={projectSearchError}
          onOpenMatch={(match) => {
            void handleOpenProjectSearchMatch(match, { focus: false });
          }}
          onRefresh={() => setProjectSearchRefreshNonce((value) => value + 1)}
          onClosed={() => editorRef.current?.focus()}
        />
      ) : null}
      <KeyboardShortcutsDialog
        open={ctx.shortcutsOpen}
        onClose={() => ctx.setShortcutsOpen(false)}
      />
      {whatsNewOpen && whatsNew ? (
        <WhatsNewModal
          fromVersion={whatsNew.fromVersion}
          toVersion={whatsNew.toVersion}
          releases={whatsNew.releases}
          notesAvailable={whatsNew.notesAvailable}
          buildChanges={whatsNew.buildChanges}
          onClose={closeWhatsNewDialog}
          onViewFullNotes={viewFullReleaseNotes}
        />
      ) : null}
    </div>
  );
}
