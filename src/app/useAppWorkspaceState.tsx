import { hasFigureToTikzExtension } from "../extensions";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { notify } from "../features/notifications/notifications";
import { productConfig, productIsPro } from "../productConfig";
import {
  saveAiConfig,
  aiConfigStorageKey,
  layoutPresetFlags,
  type AiAccessConfig,
  type AiConfig,
} from "../features/ai/aiConfig";
import {
  detectOllama,
  downloadModel,
  getSystemCapabilities,
  importModel,
  listModels,
  subscribeDownload,
} from "../features/ai/aiClient";
import { generateStepCloud } from "../features/ai/aiCloud";
import {
  loadCloudCredential,
  migrateLegacyCloudApiKey,
  removeCloudCredential,
  saveCloudCredential,
} from "../features/ai/cloudCredentials";
import { findCloudProvider } from "../features/ai/cloudProviders";
import { localModelCatalog } from "../features/ai/aiModels";
import {
  fastTierAvailability,
  type LatexDoAiTierDefinition,
} from "../features/ai/product/latexDoAiTiers";
import type {
  AiSystemCapabilities,
  ImportedModelManifest,
} from "../features/ai/aiTypes";
import {
  loadEnterpriseState,
  saveEnterpriseState,
  type EnterpriseState,
} from "../features/enterprise/enterprise";
import type { AiSidebarApi } from "../components/AiSidebar";
import type { Engine, OpenProject } from "../types";
import { useCollaborationContext } from "../collaboration/CollaborationContext";
import { type CitationProjectFile } from "../latex/citationAnalysis";
import { type ProjectSearchFile } from "../search/projectSearch";
import { useDocuments } from "../features/editor/useDocuments";
import { loadNextEditConfig } from "../features/editor/nextEdit/nextEditConfig";
import {
  hasAcceptedLegalPolicies,
  legalPolicyVersion,
} from "../features/settings/settings";
import { useSettings } from "../features/settings/useSettings";
import { useProject } from "../features/project/useProject";
import {
  ActivationWorkspaceSnapshot,
  AiChatTab,
  CustomLatexDoAiModelRecord,
  LocalAiProviderMode,
  SidebarView,
  getResolvedAppearance,
  importedLatexDoAiModelId,
  installCustomLatexDoAiModels,
  labelForGgufFile,
  loadAiConfigForApp,
  loadCustomLatexDoAiModels,
  loadLocalAiProviderMode,
  loadPersistedAiChatTabs,
  localRuntimeSelectionForTier,
  predefinedLatexDoAiModelFileNames,
  saveCustomLatexDoAiModels,
  saveLocalAiProviderMode,
  savePersistedAiChatTabs,
  tierAvailabilityLabel,
  useSystemPrefersDark,
} from "./appShared";

export function useAppWorkspaceState() {
  const collaboration = useCollaborationContext();
  useEffect(() => {
    document.title = productConfig.documentTitle;
  }, []);

  const {
    projectId,
    setProjectId,
    projectPath,
    setProjectPath,
    projectEntries,
    setProjectEntries,
    hideProjectEntries,
    setHideProjectEntries,
    welcomeOpen,
    setWelcomeOpen,
    createDialog,
    setCreateDialog,
    createPath,
    setCreatePath,
    createError,
    setCreateError,
    creating,
    setCreating,
    docxImporting,
    setDocxImporting,
    markdownImporting,
    setMarkdownImporting,
    pdfImporting,
    setPdfImporting,
    templateCreating,
    setTemplateCreating,
  } = useProject();
  const { documents, setDocuments, activePath, setActivePath, activeDocument } =
    useDocuments();
  const [statusMessage, setStatusMessageState] = useState(
    () => `Welcome to ${productConfig.shortName}`,
  );
  // Every status message is also logged in the notification center (#260).
  const setStatusMessage = useCallback<Dispatch<SetStateAction<string>>>((value) => {
    setStatusMessageState(value);
    if (typeof value === "string") notify(value);
  }, []);
  const [paperReviewImporting, setPaperReviewImporting] = useState(false);
  const [projectDisplayName, setProjectDisplayName] = useState("");
  const [activeResearchSpace, setActiveResearchSpace] = useState<
    OpenProject["researchSpace"] | null
  >(null);
  const {
    settings,
    setSettings,
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    setSettingsTab,
    extensionCatalog,
    extensionCatalogSource,
    extensionCatalogLoading,
    extensionCatalogError,
    extensionQuery,
    setExtensionQuery,
    extensionCategoryFilter,
    setExtensionCategoryFilter,
    installedExtensionIdSet,
    installedExtensions,
    installedExtensionSnippets,
    availableWelcomeTemplates,
    filteredExtensions,
    refreshExtensionCatalog,
    installExtension,
    uninstallExtension,
  } = useSettings(setStatusMessage);
  const systemPrefersDark = useSystemPrefersDark();
  const resolvedAppearance = getResolvedAppearance(
    settings.appearanceMode,
    systemPrefersDark,
  );
  const legalAcceptanceRequired = !hasAcceptedLegalPolicies(settings);
  const legalAcceptanceRequiredRef = useRef(legalAcceptanceRequired);
  useEffect(() => {
    legalAcceptanceRequiredRef.current = legalAcceptanceRequired;
  }, [legalAcceptanceRequired]);
  const acceptLegalPolicies = useCallback(() => {
    setSettings((current) => ({
      ...current,
      legalAccepted: true,
      legalAcceptedAt: new Date().toISOString(),
      legalPolicyVersion,
    }));
    setStatusMessage("Terms of Use and Privacy Policy accepted.");
  }, [setSettings, setStatusMessage]);
  const requireLegalAcceptance = useCallback(() => {
    if (!legalAcceptanceRequiredRef.current) {
      return false;
    }
    setStatusMessage("Accept the Terms of Use and Privacy Policy to continue.");
    return true;
  }, [setStatusMessage]);
  // Tables, notation and citations are built in. The Figure → TikZ Converter
  // is a store extension: it appears only once that extension is installed.
  const figureToTikzInstalled = hasFigureToTikzExtension(installedExtensions);
  const extensionToolInstallation = useMemo(
    () => ({
      projectBibliography: true,
      tableGenerator: true,
      tikzConverter: figureToTikzInstalled,
      notationManager: true,
    }),
    [figureToTikzInstalled],
  );
  const extensionToolAvailability = useMemo(
    () => ({
      projectBibliography: true,
      tableGenerator: settings.tableGeneratorEnabled,
      tikzConverter: figureToTikzInstalled && settings.tikzConverterEnabled,
      notationManager: settings.notationManagerEnabled,
    }),
    [
      figureToTikzInstalled,
      settings.tableGeneratorEnabled,
      settings.tikzConverterEnabled,
      settings.notationManagerEnabled,
    ],
  );
  const [activeSidebar, setActiveSidebar] = useState<SidebarView>("explorer");
  const initialAiConfig = useMemo(() => loadAiConfigForApp(), []);
  const initialWorkspaceFlags = useMemo(
    () => layoutPresetFlags[initialAiConfig.layoutPreset],
    [initialAiConfig.layoutPreset],
  );
  const [aiConfig, setAiConfig] = useState<AiConfig>(initialAiConfig);
  const nextEditConfig = useMemo(() => loadNextEditConfig(), []);
  const [localAiProviderMode, setLocalAiProviderMode] = useState<LocalAiProviderMode>(
    () => loadLocalAiProviderMode(initialAiConfig),
  );
  const [enterpriseState, setEnterpriseState] =
    useState<EnterpriseState>(loadEnterpriseState);
  const [aiSidebarExpanded, setAiSidebarExpanded] = useState(false);
  const initialAiChatTabs = useMemo(() => loadPersistedAiChatTabs(), []);
  const [aiChats, setAiChats] = useState<AiChatTab[]>(initialAiChatTabs.chats);
  const [activeAiChatId, setActiveAiChatId] = useState(initialAiChatTabs.activeId);
  const nextAiChatNumberRef = useRef(initialAiChatTabs.nextNumber);
  const [aiWizardOpen, setAiWizardOpen] = useState(!initialAiConfig.setupComplete);
  const [activationTourLaunchNonce, setActivationTourLaunchNonce] = useState(0);
  const activationWorkspaceSnapshotRef = useRef<ActivationWorkspaceSnapshot | null>(
    null,
  );
  // Selection-AI: ref to the active chat's imperative handle.
  const activeAiSidebarApiRef = useRef<AiSidebarApi | null>(null);
  // Selection-AI: reformulation in-flight state for cancellation support.
  const reformulationInFlightRef = useRef(false);
  const reformulationCancelledRef = useRef(false);
  const reformulationRequestIdRef = useRef<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const aiIsDesktop = Boolean((window as { aiApi?: unknown }).aiApi);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaModelFetchState, setOllamaModelFetchState] = useState<
    "idle" | "loading" | "ready" | "unavailable"
  >("idle");
  const [ollamaModelFetchMessage, setOllamaModelFetchMessage] = useState("");
  const [cloudConnectionState, setCloudConnectionState] = useState<
    "idle" | "testing" | "ok" | "error"
  >("idle");
  const [cloudConnectionMessage, setCloudConnectionMessage] = useState("");
  const [settingsCloudKey, setSettingsCloudKey] = useState("");
  const [settingsCloudKeySaving, setSettingsCloudKeySaving] = useState(false);
  const [settingsCloudKeyError, setSettingsCloudKeyError] = useState("");
  const [customLatexDoAiModels, setCustomLatexDoAiModels] = useState(
    loadCustomLatexDoAiModels,
  );
  const [downloadedLatexDoAiModelFiles, setDownloadedLatexDoAiModelFiles] = useState<
    Set<string>
  >(() => new Set());
  const [latexDoAiDownload, setLatexDoAiDownload] = useState<{
    modelId: string;
    receivedBytes: number;
    totalBytes: number | null;
  } | null>(null);
  const [latexDoAiModelMessage, setLatexDoAiModelMessage] = useState("");
  const [importingLatexDoAiModel, setImportingLatexDoAiModel] = useState(false);
  const [aiSystemCapabilities, setAiSystemCapabilities] =
    useState<AiSystemCapabilities | null>(null);
  const [aiSystemCapabilitiesState, setAiSystemCapabilitiesState] = useState<
    "idle" | "loading" | "ready" | "unavailable"
  >(aiIsDesktop ? "loading" : "unavailable");
  useEffect(() => {
    // Move any legacy localStorage API key into the OS credential vault before
    // the save effect below overwrites (and sanitizes) the stored config.
    void (async () => {
      try {
        const raw = window.localStorage.getItem(aiConfigStorageKey);
        const migrated = await migrateLegacyCloudApiKey(raw);
        if (migrated) {
          window.localStorage.setItem(aiConfigStorageKey, migrated);
        }
      } catch {
        // Best effort; the key stays out of the next save either way.
      }
    })();
  }, []);
  useEffect(() => {
    saveAiConfig(aiConfig);
  }, [aiConfig]);
  useEffect(() => {
    savePersistedAiChatTabs({
      chats: aiChats,
      activeId: aiChats.some((chat) => chat.id === activeAiChatId)
        ? activeAiChatId
        : (aiChats[0]?.id ?? "ai-chat-1"),
      nextNumber: nextAiChatNumberRef.current,
    });
  }, [activeAiChatId, aiChats]);
  useEffect(() => {
    saveLocalAiProviderMode(localAiProviderMode);
  }, [localAiProviderMode]);
  useEffect(() => {
    installCustomLatexDoAiModels(customLatexDoAiModels);
    saveCustomLatexDoAiModels(customLatexDoAiModels);
  }, [customLatexDoAiModels]);
  useEffect(() => {
    if (productIsPro) {
      saveEnterpriseState(enterpriseState);
    }
  }, [enterpriseState]);
  const setAiAccess = useCallback(
    (key: keyof AiAccessConfig, value: boolean) => {
      setAiConfig((current) => ({
        ...current,
        access: { ...current.access, [key]: value },
      }));
    },
    [setAiConfig],
  );
  const openExternalLink = useCallback((url: string) => {
    const api = (
      window as {
        latexdo?: {
          openExternalUrl?: (u: string) => unknown;
          openExternal?: (u: string) => unknown;
        };
      }
    ).latexdo;
    const openInBrowser = () => {
      window.open(url, "_blank", "noopener,noreferrer");
    };
    void (async () => {
      if (api?.openExternalUrl) {
        try {
          await api.openExternalUrl(url);
          return;
        } catch {
          // Fall back below so external-link buttons never fail silently.
        }
      }
      if (api?.openExternal) {
        try {
          await api.openExternal(url);
          return;
        } catch {
          // Fall back to the browser runtime.
        }
      }
      openInBrowser();
    })();
  }, []);
  const openAiSettings = useCallback(() => {
    setSettingsTab("ai");
    setSettingsOpen(true);
  }, [setSettingsOpen, setSettingsTab]);
  const refreshAiSystemCapabilities = useCallback(async () => {
    if (!aiIsDesktop) {
      setAiSystemCapabilities(null);
      setAiSystemCapabilitiesState("unavailable");
      return null;
    }
    setAiSystemCapabilitiesState("loading");
    const capabilities = await getSystemCapabilities();
    setAiSystemCapabilities(capabilities);
    setAiSystemCapabilitiesState(capabilities ? "ready" : "unavailable");
    return capabilities;
  }, [aiIsDesktop]);
  useEffect(() => {
    void refreshAiSystemCapabilities();
  }, [refreshAiSystemCapabilities]);
  const refreshLatexDoAiModels = useCallback(async () => {
    const models = await listModels();
    const downloaded = new Set(
      models
        .filter((model) => model.downloaded && model.fileName.endsWith(".gguf"))
        .map((model) => model.fileName),
    );
    const imported = models
      .filter(
        (model) =>
          model.downloaded &&
          model.fileName.endsWith(".gguf") &&
          !predefinedLatexDoAiModelFileNames.has(model.fileName),
      )
      .map((model) => ({
        id: importedLatexDoAiModelId(model.fileName),
        name: labelForGgufFile(model.fileName),
        fileName: model.fileName,
        sizeBytes: model.sizeBytes,
        manifest: model.manifest,
      }));

    if (imported.length) {
      setCustomLatexDoAiModels((current) => {
        const merged = new Map(current.map((model) => [model.fileName, model]));
        for (const model of imported) merged.set(model.fileName, model);
        return Array.from(merged.values());
      });
    }

    setDownloadedLatexDoAiModelFiles(downloaded);
    setAiConfig((current) => {
      const selected = localModelCatalog.find((model) => model.id === current.modelId);
      if (!selected || current.provider !== "local") return current;
      const downloadedSelected = downloaded.has(selected.fileName);
      return current.modelDownloaded === downloadedSelected
        ? current
        : { ...current, modelDownloaded: downloadedSelected };
    });
  }, []);
  const downloadLatexDoAiModel = useCallback(
    async (tier: LatexDoAiTierDefinition) => {
      const capabilities =
        aiSystemCapabilities ?? (await refreshAiSystemCapabilities());
      if (capabilities) {
        const availability = fastTierAvailability(tier, capabilities);
        if (availability.state !== "available") {
          setLatexDoAiModelMessage(tierAvailabilityLabel(availability));
          return;
        }
      }
      if (!tier.runtime.downloadUrl) {
        setLatexDoAiModelMessage("This LatexDo AI tier cannot be downloaded.");
        return;
      }
      setLatexDoAiModelMessage("");
      setLatexDoAiDownload({
        modelId: tier.runtime.modelId,
        receivedBytes: 0,
        totalBytes: null,
      });
      const unsubscribe = subscribeDownload((progress) => {
        if (progress.modelId !== tier.runtime.modelId) return;
        if (progress.stage === "verifying") {
          setLatexDoAiModelMessage("Verifying downloaded model…");
          return;
        }
        setLatexDoAiDownload({
          modelId: tier.runtime.modelId,
          receivedBytes: progress.receivedBytes,
          totalBytes: progress.totalBytes,
        });
        if (progress.error) setLatexDoAiModelMessage(progress.error);
      });
      const result = await downloadModel(tier.id);
      unsubscribe();
      setLatexDoAiDownload(null);
      if (!result.ok) {
        setLatexDoAiModelMessage(result.error ?? "Model download failed.");
        return;
      }
      setAiConfig((current) => ({
        ...current,
        ...localRuntimeSelectionForTier(tier),
        modelId: tier.runtime.modelId,
        modelDownloaded: true,
      }));
      setLocalAiProviderMode("latexdo-ai");
      setLatexDoAiModelMessage(`${tier.name} is ready on this machine.`);
      await refreshLatexDoAiModels();
    },
    [aiSystemCapabilities, refreshAiSystemCapabilities, refreshLatexDoAiModels],
  );
  const rememberImportedLatexDoAiModel = useCallback(
    (imported: ImportedModelManifest) => {
      const record: CustomLatexDoAiModelRecord = {
        id: importedLatexDoAiModelId(imported.fileName),
        name: labelForGgufFile(imported.fileName),
        fileName: imported.fileName,
        sizeBytes: imported.fileSizeBytes ?? imported.sizeBytes,
        manifest: imported,
      };
      setCustomLatexDoAiModels((current) => [
        ...current.filter((model) => model.fileName !== record.fileName),
        record,
      ]);
      installCustomLatexDoAiModels([record]);
      setDownloadedLatexDoAiModelFiles((current) => {
        const next = new Set(current);
        next.add(record.fileName);
        return next;
      });
      return record;
    },
    [],
  );
  const importLatexDoAiModel = useCallback(async () => {
    if (!aiIsDesktop) {
      setLatexDoAiModelMessage("GGUF model import requires the desktop app.");
      return;
    }
    setImportingLatexDoAiModel(true);
    setLatexDoAiModelMessage("");
    try {
      const imported = await importModel();
      if (!imported) return;
      const record = rememberImportedLatexDoAiModel(imported);
      setAiConfig((current) => ({
        ...current,
        provider: "local",
        selection: {
          mode: "custom",
          custom: { kind: "gguf", modelId: record.id },
        },
        modelId: record.id,
        modelDownloaded: true,
      }));
      setLocalAiProviderMode("local-model");
      setLatexDoAiModelMessage(`${record.name} was imported as a GGUF model.`);
      await refreshLatexDoAiModels();
    } catch (error) {
      setLatexDoAiModelMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setImportingLatexDoAiModel(false);
    }
  }, [aiIsDesktop, refreshLatexDoAiModels, rememberImportedLatexDoAiModel]);
  const selectCloudAiProvider = useCallback((providerId: string) => {
    const preset = findCloudProvider(providerId);
    if (!preset) return;
    setCloudConnectionState("idle");
    setCloudConnectionMessage("");
    setAiConfig((current) => ({
      ...current,
      provider: "cloud",
      cloud: {
        ...current.cloud,
        providerId,
        vendor: preset.apiShape,
        baseUrl: preset.baseUrl,
        model: preset.defaultModel || current.cloud.model,
      },
      selection: {
        mode: "custom",
        custom: {
          kind: "cloud",
          providerId,
          model: preset.defaultModel || current.cloud.model,
          baseUrl: preset.baseUrl,
          credentialId: `credential-${providerId}-primary`,
        },
      },
    }));
  }, []);
  const patchCloudConfig = useCallback((part: Partial<AiConfig["cloud"]>) => {
    setCloudConnectionState("idle");
    setCloudConnectionMessage("");
    setAiConfig((current) => ({
      ...current,
      cloud: { ...current.cloud, ...part },
      selection:
        current.selection.mode === "custom" && current.selection.custom.kind === "cloud"
          ? {
              mode: "custom",
              custom: {
                ...current.selection.custom,
                providerId: part.providerId ?? current.cloud.providerId,
                model: part.model ?? current.cloud.model,
                baseUrl: part.baseUrl ?? current.cloud.baseUrl,
              },
            }
          : current.selection,
    }));
  }, []);
  const testCloudConnection = useCallback(async () => {
    setCloudConnectionState("testing");
    setCloudConnectionMessage("");
    const apiKey = (await loadCloudCredential(aiConfig.cloud.credentialId)) ?? "";
    if (!apiKey) {
      setCloudConnectionState("error");
      setCloudConnectionMessage("No API key stored. Enter one in the field below.");
      return;
    }
    const step = await generateStepCloud(
      {
        requestId: "settings-test",
        provider: "cloud",
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        tools: [],
        options: {
          cloudVendor: aiConfig.cloud.vendor,
          cloudBaseUrl: aiConfig.cloud.baseUrl,
          cloudModel: aiConfig.cloud.model,
          cloudApiKey: apiKey,
          maxTokens: 16,
          temperature: 0,
        },
      },
      () => {},
    );
    if (step.type === "error") {
      setCloudConnectionState("error");
      setCloudConnectionMessage(step.content);
      return;
    }
    setCloudConnectionState("ok");
    setCloudConnectionMessage(step.content.trim().slice(0, 80) || "Connected.");
  }, [aiConfig.cloud]);
  const saveSettingsCloudKey = useCallback(async () => {
    if (!settingsCloudKey.trim()) return;
    setSettingsCloudKeySaving(true);
    setSettingsCloudKeyError("");
    const ok = await saveCloudCredential(
      aiConfig.cloud.credentialId,
      settingsCloudKey.trim(),
    );
    setSettingsCloudKeySaving(false);
    if (ok) {
      setSettingsCloudKey("");
      patchCloudConfig({ credentialConfigured: true });
    } else {
      setSettingsCloudKeyError(
        "Secure credential storage is unavailable on this system; the key was not saved.",
      );
    }
  }, [settingsCloudKey, aiConfig.cloud.credentialId, patchCloudConfig]);
  const clearSettingsCloudKey = useCallback(async () => {
    await removeCloudCredential(aiConfig.cloud.credentialId);
    setSettingsCloudKey("");
    patchCloudConfig({ credentialConfigured: false });
  }, [aiConfig.cloud.credentialId, patchCloudConfig]);
  const refreshOllamaModels = useCallback(async () => {
    if (!aiIsDesktop) {
      setOllamaModels([]);
      setOllamaModelFetchState("unavailable");
      setOllamaModelFetchMessage("Ollama models require the desktop app.");
      return;
    }
    setOllamaModelFetchState("loading");
    setOllamaModelFetchMessage("");
    const result = await detectOllama(aiConfig.ollamaBaseUrl);
    if (!result.available) {
      setOllamaModels([]);
      setOllamaModelFetchState("unavailable");
      setOllamaModelFetchMessage("Ollama is not reachable at this base URL.");
      return;
    }
    setOllamaModels(result.models);
    setOllamaModelFetchState("ready");
    setOllamaModelFetchMessage(
      result.models.length
        ? `Found ${result.models.length} installed model${
            result.models.length === 1 ? "" : "s"
          }.`
        : "No installed Ollama models were returned.",
    );
  }, [aiConfig.ollamaBaseUrl, aiIsDesktop]);
  const createAiChat = useCallback(() => {
    const number = nextAiChatNumberRef.current;
    nextAiChatNumberRef.current += 1;
    const chat: AiChatTab = {
      id: `ai-chat-${number}-${Date.now().toString(36)}`,
      title: `Chat ${number}`,
    };
    setAiChats((current) => [...current, chat]);
    setActiveAiChatId(chat.id);
  }, []);
  const closeAiChat = useCallback((chatId: string) => {
    setAiChats((current) => {
      const index = current.findIndex((chat) => chat.id === chatId);
      if (index < 0) return current;

      if (current.length === 1) {
        const number = nextAiChatNumberRef.current;
        nextAiChatNumberRef.current += 1;
        const replacement: AiChatTab = {
          id: `ai-chat-${number}-${Date.now().toString(36)}`,
          title: `Chat ${number}`,
        };
        setActiveAiChatId(replacement.id);
        return [replacement];
      }

      const next = current.filter((chat) => chat.id !== chatId);
      setActiveAiChatId((activeId) =>
        activeId === chatId
          ? (next[Math.min(index, next.length - 1)]?.id ?? next[0].id)
          : activeId,
      );
      return next;
    });
  }, []);
  const handleAiSidebarClickCapture = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest('button[title="New chat"]')) return;
      event.preventDefault();
      event.stopPropagation();
      createAiChat();
    },
    [createAiChat],
  );
  useEffect(() => {
    if (!settingsOpen || settingsTab !== "ai" || aiConfig.provider !== "ollama") {
      return;
    }
    void refreshOllamaModels();
  }, [aiConfig.provider, refreshOllamaModels, settingsOpen, settingsTab]);
  useEffect(() => {
    if (!settingsOpen || settingsTab !== "ai" || aiConfig.provider !== "local") {
      return;
    }
    void refreshLatexDoAiModels();
  }, [aiConfig.provider, refreshLatexDoAiModels, settingsOpen, settingsTab]);
  // Trust the models on disk, not only the saved flag: after an update the
  // downloaded GGUF is still in <userData>/models, so it must not be offered
  // for download again (#262).
  useEffect(() => {
    if (!aiIsDesktop || aiConfig.provider !== "local") return;
    void refreshLatexDoAiModels();
  }, [aiConfig.provider, aiIsDesktop, refreshLatexDoAiModels]);
  const editorPreviewRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine>(settings.defaultEngine);
  const [rootFile, setRootFile] = useState("main.tex");
  const [sidebarVisible, setSidebarVisible] = useState(
    () => initialWorkspaceFlags.sidebarVisible,
  );
  const [previewVisible, setPreviewVisible] = useState(
    () => initialWorkspaceFlags.previewVisible,
  );
  const [tikzCanvasOpen, setTikzCanvasOpen] = useState(false);
  const [tableCanvasOpen, setTableCanvasOpen] = useState(false);
  const [tikzConverterOpen, setTikzConverterOpen] = useState(false);
  const [notationManagerOpen, setNotationManagerOpen] = useState(false);
  const [citationManagerOpen, setCitationManagerOpen] = useState(false);
  const [wordCountOpen, setWordCountOpen] = useState(false);
  const [wordCountOffset, setWordCountOffset] = useState<number | null>(null);
  /** The extension whose details page is open in a tab ("" when closed). */
  const [extensionDetailsId, setExtensionDetailsId] = useState("");
  const [citationProjectFiles, setCitationProjectFiles] = useState<
    CitationProjectFile[]
  >([]);
  const [citationLibraryLoading, setCitationLibraryLoading] = useState(false);
  const [citationLibraryError, setCitationLibraryError] = useState("");
  const [projectSearchFiles, setProjectSearchFiles] = useState<ProjectSearchFile[]>([]);
  const [projectSearchLoading, setProjectSearchLoading] = useState(false);

  useEffect(() => {
    if (tableCanvasOpen && !extensionToolAvailability.tableGenerator) {
      setTableCanvasOpen(false);
    }
    if (tikzConverterOpen && !extensionToolAvailability.tikzConverter) {
      setTikzConverterOpen(false);
    }
    if (notationManagerOpen && !extensionToolAvailability.notationManager) {
      setNotationManagerOpen(false);
    }
    if (citationManagerOpen && !extensionToolAvailability.projectBibliography) {
      setCitationManagerOpen(false);
    }
  }, [
    citationManagerOpen,
    extensionToolAvailability.notationManager,
    extensionToolAvailability.projectBibliography,
    extensionToolAvailability.tableGenerator,
    extensionToolAvailability.tikzConverter,
    notationManagerOpen,
    tableCanvasOpen,
    tikzConverterOpen,
  ]);

  useEffect(() => {
    const unavailableExtensionSettingsTab =
      (settingsTab === "citation" && !extensionToolInstallation.projectBibliography) ||
      (settingsTab === "tikz" && !extensionToolInstallation.tikzConverter) ||
      (settingsTab === "notation" && !extensionToolInstallation.notationManager);

    if (unavailableExtensionSettingsTab) {
      setSettingsTab("editor");
    }
  }, [
    extensionToolInstallation.notationManager,
    extensionToolInstallation.projectBibliography,
    extensionToolInstallation.tikzConverter,
    setSettingsTab,
    settingsTab,
  ]);
  const [projectSearchError, setProjectSearchError] = useState("");
  const [projectSearchRefreshNonce, setProjectSearchRefreshNonce] = useState(0);

  return {
    collaboration,
    projectId,
    setProjectId,
    projectPath,
    setProjectPath,
    projectEntries,
    setProjectEntries,
    hideProjectEntries,
    setHideProjectEntries,
    welcomeOpen,
    setWelcomeOpen,
    createDialog,
    setCreateDialog,
    createPath,
    setCreatePath,
    createError,
    setCreateError,
    creating,
    setCreating,
    docxImporting,
    setDocxImporting,
    markdownImporting,
    setMarkdownImporting,
    pdfImporting,
    setPdfImporting,
    templateCreating,
    setTemplateCreating,
    documents,
    setDocuments,
    activePath,
    setActivePath,
    activeDocument,
    statusMessage,
    setStatusMessage,
    paperReviewImporting,
    setPaperReviewImporting,
    projectDisplayName,
    setProjectDisplayName,
    activeResearchSpace,
    setActiveResearchSpace,
    settings,
    setSettings,
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    setSettingsTab,
    extensionCatalog,
    extensionCatalogSource,
    extensionCatalogLoading,
    extensionCatalogError,
    extensionQuery,
    setExtensionQuery,
    extensionCategoryFilter,
    setExtensionCategoryFilter,
    installedExtensionIdSet,
    installedExtensions,
    installedExtensionSnippets,
    availableWelcomeTemplates,
    filteredExtensions,
    refreshExtensionCatalog,
    installExtension,
    uninstallExtension,
    resolvedAppearance,
    legalAcceptanceRequired,
    acceptLegalPolicies,
    requireLegalAcceptance,
    extensionToolInstallation,
    extensionToolAvailability,
    activeSidebar,
    setActiveSidebar,
    initialWorkspaceFlags,
    aiConfig,
    setAiConfig,
    nextEditConfig,
    localAiProviderMode,
    setLocalAiProviderMode,
    enterpriseState,
    setEnterpriseState,
    aiSidebarExpanded,
    setAiSidebarExpanded,
    aiChats,
    activeAiChatId,
    setActiveAiChatId,
    aiWizardOpen,
    setAiWizardOpen,
    activationTourLaunchNonce,
    setActivationTourLaunchNonce,
    activationWorkspaceSnapshotRef,
    activeAiSidebarApiRef,
    reformulationInFlightRef,
    reformulationCancelledRef,
    reformulationRequestIdRef,
    profileOpen,
    setProfileOpen,
    aiIsDesktop,
    ollamaModels,
    ollamaModelFetchState,
    ollamaModelFetchMessage,
    cloudConnectionState,
    cloudConnectionMessage,
    settingsCloudKey,
    setSettingsCloudKey,
    settingsCloudKeySaving,
    settingsCloudKeyError,
    setSettingsCloudKeyError,
    customLatexDoAiModels,
    downloadedLatexDoAiModelFiles,
    latexDoAiDownload,
    latexDoAiModelMessage,
    setLatexDoAiModelMessage,
    importingLatexDoAiModel,
    aiSystemCapabilities,
    aiSystemCapabilitiesState,
    setAiAccess,
    openExternalLink,
    openAiSettings,
    refreshAiSystemCapabilities,
    downloadLatexDoAiModel,
    rememberImportedLatexDoAiModel,
    importLatexDoAiModel,
    selectCloudAiProvider,
    patchCloudConfig,
    testCloudConnection,
    saveSettingsCloudKey,
    clearSettingsCloudKey,
    refreshOllamaModels,
    closeAiChat,
    handleAiSidebarClickCapture,
    editorPreviewRef,
    engine,
    setEngine,
    rootFile,
    setRootFile,
    sidebarVisible,
    setSidebarVisible,
    previewVisible,
    setPreviewVisible,
    tikzCanvasOpen,
    setTikzCanvasOpen,
    tableCanvasOpen,
    setTableCanvasOpen,
    tikzConverterOpen,
    setTikzConverterOpen,
    notationManagerOpen,
    setNotationManagerOpen,
    citationManagerOpen,
    setCitationManagerOpen,
    wordCountOpen,
    setWordCountOpen,
    wordCountOffset,
    setWordCountOffset,
    extensionDetailsId,
    setExtensionDetailsId,
    citationProjectFiles,
    setCitationProjectFiles,
    citationLibraryLoading,
    setCitationLibraryLoading,
    citationLibraryError,
    setCitationLibraryError,
    projectSearchFiles,
    setProjectSearchFiles,
    projectSearchLoading,
    setProjectSearchLoading,
    projectSearchError,
    setProjectSearchError,
    projectSearchRefreshNonce,
    setProjectSearchRefreshNonce,
  };
}
