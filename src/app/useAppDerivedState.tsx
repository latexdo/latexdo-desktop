import {
  BookOpenText,
  Box,
  Code2,
  FileImage,
  GitBranch,
  ImageUp,
  Pencil,
  Variable,
  Waypoints,
  Puzzle,
} from "lucide-react";
import { findCloudProvider } from "../features/ai/cloudProviders";
import { localModelCatalog } from "../features/ai/aiModels";
import {
  fastTierAvailability,
  fastTierRuntimeAvailability,
  findLatexDoAiTierByModelId,
  latexDoAiTiers,
  type LatexDoAiTierDefinition,
} from "../features/ai/product/latexDoAiTiers";
import type { TierAvailability } from "../features/ai/aiTypes";
import { type WorkspaceTab } from "../components/WorkspaceTabs";
import { knowledgeGraphTabId } from "../features/graph/graphWorkspace";
import {
  toolTabIds,
  toolTabLabels,
  type ToolTabKey,
} from "../features/workspace/toolTabs";

const toolTabIcons: Record<ToolTabKey, typeof Pencil> = {
  tikzCanvas: Pencil,
  tikzConverter: ImageUp,
  tableGenerator: Box,
  notationManager: Variable,
  citationManager: BookOpenText,
  extensionDetails: Puzzle,
};
import { pathForDisplay } from "../pathDisplay";
import { gitDiffTabLabel } from "../features/git/gitUi";
import {
  formatUpdateAttempt,
  formatBuildLabel,
  formatUpdateProgress,
} from "../features/pdf/updateFormatting";
import {
  AiPrimarySelectionValue,
  AppIcon,
  CustomAiProviderSelectValue,
  formatFileSize,
  isImportedLatexDoAiModelId,
  isTextDocument,
  latexDoAiTierSelectValue,
} from "./appShared";
import type { AppCtx15 } from "./appContext";

export function useAppDerivedState(ctx: AppCtx15) {
  const {
    activeDocument,
    activePath,
    activePathRef,
    extensionCatalog,
    extensionDetailsId,
    aiConfig,
    aiIsDesktop,
    aiSystemCapabilities,
    aiSystemCapabilitiesState,
    aiWizardOpen,
    closeDocument,
    closeGitDiffSession,
    closeKnowledgeGraph,
    closeWelcomePage,
    currentBuildVersion,
    customLatexDoAiModels,
    documents,
    downloadedLatexDoAiModelFiles,
    gitDiffSession,
    knowledgeGraphActive,
    toolTabActive,
    toolTabOpen,
    openToolTab,
    closeToolTab,
    knowledgeGraphOpen,
    latexDoAiDownload,
    legalAcceptanceRequired,
    localAiProviderMode,
    ollamaModels,
    openKnowledgeGraph,
    setActivePath,
    setWelcomeOpen,
    showWelcome,
    showWelcomePage,
    updateAttemptStatus,
    updateInfo,
    updateProgress,
    updatingNow,
    welcomeOpen,
  } = ctx;

  const latestBuildVersion =
    updateProgress?.latestVersion ?? updateInfo?.latestVersion ?? null;
  const updateHasResult = Boolean(updateInfo || updateProgress);
  const updateHasAvailableBuild = Boolean(
    updateInfo?.updateAvailable && latestBuildVersion,
  );
  const updateBuildSummary = updateHasAvailableBuild
    ? `Current build ${formatBuildLabel(
        currentBuildVersion,
        updateInfo?.currentCommit,
      )}. Available build ${formatBuildLabel(
        latestBuildVersion ?? "",
        updateInfo?.latestCommit,
      )}.`
    : updateHasResult && !updateInfo?.error && currentBuildVersion !== "Unknown"
      ? `Current build ${currentBuildVersion}. You are up to date.`
      : `Current build ${currentBuildVersion}.`;
  const updateActionText =
    updateInfo?.updateAvailable && updateInfo.automaticInstallAvailable === false
      ? "Open update"
      : updateInfo?.updateAvailable
        ? "Install update"
        : "Update manually";
  const updateProgressLabel = updateProgress
    ? formatUpdateProgress(updateProgress)
    : null;
  const updateProgressPercent =
    updateProgress?.percent === null || updateProgress?.percent === undefined
      ? null
      : Math.max(0, Math.min(100, updateProgress.percent));
  const updateProgressActive = Boolean(
    updateProgress &&
    updateProgress.status !== "done" &&
    updateProgress.status !== "confirmed" &&
    updateProgress.status !== "restart-required" &&
    (updatingNow || updateProgress.status !== "checking"),
  );
  const updateAttemptLabel = updateAttemptStatus
    ? formatUpdateAttempt(updateAttemptStatus)
    : null;
  const updateAttemptFailed = updateAttemptStatus?.status === "failed";
  const updateAttemptConfirmed = updateAttemptStatus?.status === "confirmed";
  const localTierAvailability = (tier: LatexDoAiTierDefinition): TierAvailability => {
    if (!aiIsDesktop) {
      return {
        state: "unsupported",
        reason: "Local AI requires the LatexDo desktop app.",
      };
    }
    if (aiSystemCapabilities) return fastTierAvailability(tier, aiSystemCapabilities);
    if (aiSystemCapabilitiesState === "loading") {
      return {
        state: "unsupported",
        reason: "Checking this machine's memory and storage.",
      };
    }
    return {
      state: "unsupported",
      reason: "LatexDo could not check this machine's memory and storage.",
    };
  };
  const localTierRuntimeAvailability = (
    tier: LatexDoAiTierDefinition,
  ): TierAvailability => {
    if (!aiIsDesktop) {
      return {
        state: "unsupported",
        reason: "Local AI requires the LatexDo desktop app.",
      };
    }
    if (aiSystemCapabilities) {
      return fastTierRuntimeAvailability(tier, aiSystemCapabilities);
    }
    if (aiSystemCapabilitiesState === "loading") {
      return {
        state: "unsupported",
        reason: "Checking this machine's memory.",
      };
    }
    return {
      state: "unsupported",
      reason: "LatexDo could not check this machine's memory.",
    };
  };
  const tierAvailabilityById = new Map(
    latexDoAiTiers.map((tier) => [tier.id, localTierAvailability(tier)]),
  );
  const importedLocalModels = localModelCatalog.filter(
    (model) => model.tier !== "inline" && isImportedLatexDoAiModelId(model.id),
  );
  const importedLocalRecordsById = new Map(
    customLatexDoAiModels.map((model) => [model.id, model]),
  );
  const selectedCloudProvider = findCloudProvider(aiConfig.cloud.providerId);
  const cloudModelOptions = selectedCloudProvider?.models ?? [];
  const showCloudBaseUrl = Boolean(
    selectedCloudProvider?.custom || aiConfig.cloud.baseUrl.length > 0,
  );
  const selectedLatexDoAiTierId =
    aiConfig.selection.mode === "latexdo" ? aiConfig.selection.tier : null;
  const selectedLatexDoAiTier = selectedLatexDoAiTierId
    ? (latexDoAiTiers.find((tier) => tier.id === selectedLatexDoAiTierId) ??
      findLatexDoAiTierByModelId(aiConfig.modelId) ??
      latexDoAiTiers[1] ??
      null)
    : (findLatexDoAiTierByModelId(aiConfig.modelId) ?? latexDoAiTiers[1] ?? null);
  const activeAiSelectionValue: AiPrimarySelectionValue =
    aiConfig.provider === "local" && aiConfig.selection.mode === "latexdo"
      ? latexDoAiTierSelectValue(aiConfig.selection.tier)
      : "customize";
  const activeCustomProviderValue: CustomAiProviderSelectValue =
    aiConfig.provider === "cloud"
      ? `cloud:${aiConfig.cloud.providerId}`
      : aiConfig.provider === "ollama"
        ? "ollama"
        : aiConfig.provider === "local" && localAiProviderMode === "local-model"
          ? "local-model"
          : "off";
  const selectedLatexDoAiTierDownloaded = selectedLatexDoAiTier
    ? downloadedLatexDoAiModelFiles.has(selectedLatexDoAiTier.runtime.fileName) ||
      (aiConfig.modelId === selectedLatexDoAiTier.runtime.modelId &&
        aiConfig.modelDownloaded)
    : false;
  const selectedLatexDoAiTierInstallAvailability = selectedLatexDoAiTier
    ? (tierAvailabilityById.get(selectedLatexDoAiTier.id) ?? {
        state: "unsupported",
        reason: "Unknown LatexDo AI tier.",
      })
    : ({
        state: "unsupported",
        reason: "No LatexDo AI tier selected.",
      } satisfies TierAvailability);
  const selectedLatexDoAiTierAvailability =
    selectedLatexDoAiTier && selectedLatexDoAiTierDownloaded
      ? localTierRuntimeAvailability(selectedLatexDoAiTier)
      : selectedLatexDoAiTierInstallAvailability;
  const selectedLatexDoAiTierCanRun =
    selectedLatexDoAiTierAvailability.state === "available";
  const selectedLatexDoAiModel =
    selectedLatexDoAiTier && selectedLatexDoAiTierCanRun
      ? (localModelCatalog.find(
          (model) => model.id === selectedLatexDoAiTier.runtime.modelId,
        ) ?? null)
      : null;
  const selectedLatexDoAiModelDownloaded = selectedLatexDoAiTierDownloaded;
  const selectedLatexDoAiModelDownloading =
    Boolean(selectedLatexDoAiTier) &&
    latexDoAiDownload?.modelId === selectedLatexDoAiTier?.runtime.modelId;
  const selectedLatexDoAiDownloadLabel =
    selectedLatexDoAiModelDownloading && latexDoAiDownload
      ? latexDoAiDownload.totalBytes
        ? `${formatFileSize(latexDoAiDownload.receivedBytes)} / ${formatFileSize(
            latexDoAiDownload.totalBytes,
          )}`
        : formatFileSize(latexDoAiDownload.receivedBytes)
      : "";
  const selectedImportedLocalModel =
    importedLocalModels.find((model) => model.id === aiConfig.modelId) ??
    importedLocalModels[0] ??
    null;
  const selectedImportedLocalRecord = selectedImportedLocalModel
    ? (importedLocalRecordsById.get(selectedImportedLocalModel.id) ?? null)
    : null;
  const selectedImportedCompatibility =
    selectedImportedLocalRecord?.manifest?.compatibility ?? null;
  const selectedImportedLocalModelCanRun =
    !selectedImportedCompatibility ||
    selectedImportedCompatibility.state === "compatible" ||
    selectedImportedCompatibility.state === "unknown";
  const selectedImportedLocalModelDownloaded = selectedImportedLocalModel
    ? downloadedLatexDoAiModelFiles.has(selectedImportedLocalModel.fileName) ||
      (aiConfig.modelId === selectedImportedLocalModel.id && aiConfig.modelDownloaded)
    : false;
  const activeLocalProviderReady =
    localAiProviderMode === "local-model"
      ? selectedImportedLocalModelDownloaded && selectedImportedLocalModelCanRun
      : selectedLatexDoAiModelDownloaded && selectedLatexDoAiTierCanRun;
  const activeAiModelValue =
    aiConfig.provider === "cloud"
      ? aiConfig.cloud.model
      : aiConfig.provider === "ollama"
        ? aiConfig.ollamaModel
        : localAiProviderMode === "local-model"
          ? (selectedImportedLocalModel?.id ?? "")
          : (selectedLatexDoAiModel?.id ?? "");
  const activeAiModelAvailable =
    activeAiSelectionValue !== "customize"
      ? selectedLatexDoAiTierDownloaded && selectedLatexDoAiTierCanRun
      : aiConfig.provider === "cloud"
        ? Boolean(aiConfig.cloud.model)
        : aiConfig.provider === "ollama"
          ? Boolean(aiConfig.ollamaModel && ollamaModels.includes(aiConfig.ollamaModel))
          : aiConfig.provider === "local"
            ? activeLocalProviderReady
            : false;
  const showLegalAcceptanceGate = legalAcceptanceRequired && !aiWizardOpen;

  const workspaceTabs: WorkspaceTab[] = [
    ...(welcomeOpen
      ? [
          {
            id: "workspace:welcome",
            label: "Welcome",
            icon: <AppIcon className="welcome-tab-mark" />,
            active: showWelcome,
            onSelect: showWelcomePage,
            onClose: closeWelcomePage,
          },
        ]
      : []),
    ...(gitDiffSession
      ? [
          {
            id: "workspace:diff",
            label: gitDiffTabLabel(gitDiffSession),
            icon: <GitBranch size={14} />,
            active:
              !showWelcome &&
              !activeDocument &&
              !knowledgeGraphActive &&
              !toolTabActive,
            onSelect: () => {
              setWelcomeOpen(false);
              setActivePath("");
              activePathRef.current = "";
            },
            onClose: closeGitDiffSession,
          },
        ]
      : []),
    ...documents.map((document) => ({
      id: document.path,
      label: pathForDisplay(document.name),
      icon: document.kind === "asset" ? <FileImage size={14} /> : <Code2 size={14} />,
      active: !showWelcome && activePath === document.path,
      dirty: isTextDocument(document) && document.content !== document.savedContent,
      onSelect: () => {
        setActivePath(document.path);
        activePathRef.current = document.path;
      },
      onClose: () => closeDocument(document.path),
    })),
    ...(knowledgeGraphOpen
      ? [
          {
            id: knowledgeGraphTabId,
            label: "Knowledge Graph",
            icon: <Waypoints size={14} />,
            active: knowledgeGraphActive,
            onSelect: openKnowledgeGraph,
            onClose: closeKnowledgeGraph,
          },
        ]
      : []),
    ...(Object.keys(toolTabIds) as ToolTabKey[])
      .filter((key) => toolTabOpen[key])
      .map((key) => {
        const id = toolTabIds[key];
        const Icon = toolTabIcons[key];
        return {
          id,
          label:
            key === "extensionDetails"
              ? `Extension: ${
                  extensionCatalog.extensions.find(
                    (extension) => extension.id === extensionDetailsId,
                  )?.name ?? ""
                }`
              : toolTabLabels[key],
          icon: <Icon size={14} />,
          active: activePath === id,
          onSelect: () => openToolTab(id),
          onClose: () => closeToolTab(id),
        };
      }),
  ];
  const activeWorkspaceTab = workspaceTabs.find((tab) => tab.active)?.id ?? "";

  return {
    updateBuildSummary,
    updateActionText,
    updateProgressLabel,
    updateProgressPercent,
    updateProgressActive,
    updateAttemptLabel,
    updateAttemptFailed,
    updateAttemptConfirmed,
    localTierAvailability,
    localTierRuntimeAvailability,
    tierAvailabilityById,
    importedLocalModels,
    importedLocalRecordsById,
    selectedCloudProvider,
    cloudModelOptions,
    showCloudBaseUrl,
    selectedLatexDoAiTier,
    activeAiSelectionValue,
    activeCustomProviderValue,
    selectedLatexDoAiTierDownloaded,
    selectedLatexDoAiTierAvailability,
    selectedLatexDoAiTierCanRun,
    selectedLatexDoAiModelDownloading,
    selectedLatexDoAiDownloadLabel,
    selectedImportedLocalModel,
    selectedImportedCompatibility,
    selectedImportedLocalModelCanRun,
    selectedImportedLocalModelDownloaded,
    activeAiModelValue,
    activeAiModelAvailable,
    showLegalAcceptanceGate,
    workspaceTabs,
    activeWorkspaceTab,
  };
}
