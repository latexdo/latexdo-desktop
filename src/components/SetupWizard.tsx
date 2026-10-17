import { AiIcon } from "./AiIcon";
import React from "react";
import {
  User,
  Palette,
  Cpu,
  Check,
  Download,
  Cloud,
  FileUp,
  ArrowRight,
  ArrowLeft,
  Loader2,
  RefreshCw,
  ShieldCheck,
  GitCompareArrows,
  HardDrive,
  CircleSlash,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  colorThemeOptions,
  legalPrivacyUrl,
  legalTermsUrl,
  type ColorTheme,
} from "../features/settings/settings";
import { type AiConfig, type AiProvider } from "../features/ai/aiConfig";
import type { ResearcherProfile } from "../features/ai/researcherProfile";
import {
  fastTierAvailability,
  fastTierRuntimeAvailability,
  latexDoAiTiers,
  tierCapabilityCatalog,
  tierUnlockGuidance,
  type LatexDoAiTierDefinition,
} from "../features/ai/product/latexDoAiTiers";
import {
  detectOllama,
  downloadModel,
  importModel,
  getSpeechRuntimeStatus,
  getTexRuntimeStatus,
  installSpeechRuntime,
  installTexRuntime,
  subscribeDownload,
  subscribeSpeechInstall,
  subscribeTexInstall,
} from "../features/ai/aiClient";
import type {
  AiSystemCapabilities,
  ImportedModelManifest,
  SpeechInstallProgress,
  TexInstallProgress,
  TierAvailability,
} from "../features/ai/aiTypes";
import { CloudProviderForm } from "./CloudProviderForm";
import {
  SetupIntroCaption,
  SetupIntroStage,
  useSetupIntroSlide,
} from "./SetupIntroShowcase";

function openExternalUrl(url: string): void {
  const api = (
    window as {
      latexdo?: {
        openExternalUrl?: (u: string) => unknown;
        openExternal?: (u: string) => unknown;
      };
    }
  ).latexdo;
  const openInBrowser = () => window.open(url, "_blank", "noopener,noreferrer");
  void (async () => {
    if (api?.openExternalUrl) {
      try {
        await api.openExternalUrl(url);
        return;
      } catch {
        // Fall back below so provider links never fail silently.
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
}

interface SetupWizardProps {
  initialConfig: AiConfig;
  isDesktop: boolean;
  onApplyTheme: (theme: ColorTheme) => void;
  /** Light or dark, so theme swatches match what the app shows. */
  appearance?: "light" | "dark";
  onComplete: (config: AiConfig) => void;
  systemCapabilities?: AiSystemCapabilities | null;
  systemCapabilitiesState?: "idle" | "loading" | "ready" | "unavailable";
  onRefreshSystemCapabilities?: () => Promise<AiSystemCapabilities | null>;
  onImportedModel?: (model: ImportedModelManifest) => void;
  legalAccepted?: boolean;
  onAcceptLegal?: () => void;
  onOpenExternal?: (url: string) => void;
  productName?: string;
  productSetupName?: string;
}

type Step = "welcome" | "personalize" | "model" | "install" | "ready";
type InstallStage = "idle" | "ai" | "speech" | "tex" | "ready";
type InstallPart = "ai" | "speech" | "tex";
type InstallBytes = Record<InstallPart, { received: number; total: number }>;
/** How the PDF builder (TeX) ended up on this computer during setup. */
type TexSetupState = "pending" | "present" | "installed" | "unsupported" | "skipped";

const emptyInstallBytes: InstallBytes = {
  ai: { received: 0, total: 0 },
  speech: { received: 0, total: 0 },
  tex: { received: 0, total: 0 },
};
const etaWindowMs = 15_000;

function formatTimeLeft(seconds: number): string {
  if (seconds < 60) return "Less than a minute left";
  return `About ${Math.ceil(seconds / 60)} min left`;
}
const steps: Step[] = ["welcome", "personalize", "model", "install", "ready"];
// What the user sees: installing and the ready summary are one "Finish" stage.
const stageLabels = ["Welcome", "Make it yours", "Assistant", "Finish"];
const modelStepIndex = steps.indexOf("model");
const installStepIndex = steps.indexOf("install");
const readyStepIndex = steps.indexOf("ready");
const defaultProductName = "LatexDo";

type ProfileNameParts = {
  firstName: string;
  lastName: string;
};

function splitDisplayName(displayName: string): ProfileNameParts {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function displayNameFromParts(parts: ProfileNameParts): string {
  return [parts.firstName, parts.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function speechInstallMessage(progress: SpeechInstallProgress): string {
  if (progress.error) return progress.error;
  if (progress.message) return progress.message;
  switch (progress.stage) {
    case "checking":
      return "Checking local speech support";
    case "downloading-runtime":
      return "Downloading local speech runtime";
    case "downloading-model":
      return "Downloading speech model";
    case "verifying":
      return "Verifying speech support";
    case "installing":
      return "Installing local speech support";
    case "ready":
      return "Local speech support is ready";
    default:
      return "Preparing local speech support";
  }
}

function initialSpeechInstallProgress(): SpeechInstallProgress {
  return {
    stage: "checking",
    receivedBytes: 0,
    totalBytes: null,
    done: false,
    message: "Checking local speech support",
  };
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : String(error || fallback);
}

function formatRam(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function importedModelId(fileName: string): string {
  return `imported-gguf:${fileName}`;
}

function labelForGgufFile(fileName: string): string {
  return (
    fileName
      .replace(/\.gguf$/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || fileName
  );
}

function availabilityLabel(availability: TierAvailability): string {
  if (availability.state === "available") return "Available on this machine";
  if (availability.state === "memory-pressure") {
    return `Temporarily unavailable. Needs ${formatRam(
      availability.requiredAvailableBytes,
    )} available; ${formatRam(availability.availableBytes)} available now.`;
  }
  if (availability.state === "storage-pressure") {
    return `Not enough storage. Needs ${formatRam(
      availability.requiredAvailableStorageBytes,
    )} free; ${formatRam(availability.availableStorageBytes)} free now.`;
  }
  if (
    typeof availability.requiredSystemRamBytes === "number" &&
    typeof availability.detectedSystemRamBytes === "number"
  ) {
    return `Not supported. Requires ${formatRam(
      availability.requiredSystemRamBytes,
    )} RAM; detected ${formatRam(availability.detectedSystemRamBytes)}.`;
  }
  return availability.reason;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({
  initialConfig,
  isDesktop,
  onApplyTheme,
  appearance = "dark",
  onComplete,
  systemCapabilities = null,
  systemCapabilitiesState = isDesktop ? "loading" : "unavailable",
  onRefreshSystemCapabilities,
  onImportedModel,
  legalAccepted = true,
  onAcceptLegal,
  onOpenExternal = openExternalUrl,
  productName = defaultProductName,
  productSetupName = `${productName} Setup`,
}) => {
  const [stepIndex, setStepIndex] = React.useState(0);
  const [config, setConfig] = React.useState<AiConfig>(initialConfig);
  const [legalConsent, setLegalConsent] = React.useState(legalAccepted);
  const [downloading, setDownloading] = React.useState(false);
  const [progress, setProgress] = React.useState<{
    received: number;
    total: number | null;
  }>({
    received: 0,
    total: null,
  });
  const [downloadError, setDownloadError] = React.useState("");
  const [downloaded, setDownloaded] = React.useState(false);
  const [installing, setInstalling] = React.useState(false);
  const [installStage, setInstallStage] = React.useState<InstallStage>("idle");
  const [installError, setInstallError] = React.useState("");
  const [speechInstalling, setSpeechInstalling] = React.useState(false);
  const [speechInstallProgress, setSpeechInstallProgress] =
    React.useState<SpeechInstallProgress>(() => initialSpeechInstallProgress());
  const [texInstalling, setTexInstalling] = React.useState(false);
  const [texInstallProgress, setTexInstallProgress] =
    React.useState<TexInstallProgress | null>(null);
  const [texSetupState, setTexSetupState] = React.useState<TexSetupState>("pending");
  const [installBytes, setInstallBytes] =
    React.useState<InstallBytes>(emptyInstallBytes);
  const [installSecondsLeft, setInstallSecondsLeft] = React.useState<number | null>(
    null,
  );
  const installSamplesRef = React.useRef<{ at: number; bytes: number }[]>([]);
  const [pendingCompleteConfig, setPendingCompleteConfig] =
    React.useState<AiConfig | null>(null);
  const [readyConfig, setReadyConfig] = React.useState<AiConfig | null>(null);
  const [ollamaModels, setOllamaModels] = React.useState<string[]>([]);
  const [ollamaMessage, setOllamaMessage] = React.useState("");
  const [ollamaLoading, setOllamaLoading] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [importedManifest, setImportedManifest] =
    React.useState<ImportedModelManifest | null>(null);
  const [profileNameParts, setProfileNameParts] = React.useState<ProfileNameParts>(() =>
    splitDisplayName(initialConfig.profile.displayName || initialConfig.userName),
  );

  const step = steps[stepIndex];
  const introSlide = useSetupIntroSlide(step === "welcome");
  const [selectedTheme, setSelectedTheme] = React.useState<ColorTheme | null>(null);
  const setupBusy = installing || downloading || speechInstalling || texInstalling;
  const setInstallPart = (part: InstallPart, received: number, total: number) =>
    setInstallBytes((current) => ({
      ...current,
      [part]: { received: Math.min(received, total), total },
    }));
  const installReceivedBytes =
    installBytes.ai.received + installBytes.speech.received + installBytes.tex.received;
  const installTotalBytes =
    installBytes.ai.total + installBytes.speech.total + installBytes.tex.total;

  // Time left comes from the measured download speed over the last few seconds.
  React.useEffect(() => {
    if (!installing || installTotalBytes <= 0) {
      installSamplesRef.current = [];
      setInstallSecondsLeft(null);
      return;
    }
    const now = Date.now();
    const samples = installSamplesRef.current.filter(
      (sample) => now - sample.at <= etaWindowMs,
    );
    samples.push({ at: now, bytes: installReceivedBytes });
    installSamplesRef.current = samples;
    const first = samples[0];
    const elapsedSeconds = (now - first.at) / 1000;
    const transferred = installReceivedBytes - first.bytes;
    if (elapsedSeconds < 1 || transferred <= 0) return;
    setInstallSecondsLeft(
      (installTotalBytes - installReceivedBytes) / (transferred / elapsedSeconds),
    );
  }, [installing, installReceivedBytes, installTotalBytes]);
  const patch = (p: Partial<AiConfig>) => {
    setPendingCompleteConfig(null);
    setReadyConfig(null);
    setInstallError("");
    setInstallStage("idle");
    setConfig((c) => ({ ...c, ...p }));
  };

  const goNext = () => setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  // Installing and the ready summary are one stage, so Back leaves both.
  const goBack = () =>
    setStepIndex((i) => (i > modelStepIndex ? modelStepIndex : Math.max(i - 1, 0)));
  const legalReady = legalConsent;

  React.useEffect(() => {
    if (legalAccepted) {
      setLegalConsent(true);
    }
  }, [legalAccepted]);

  const openPolicy = (event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    onOpenExternal(url);
  };

  const updateKnownProfile = (part: Partial<ResearcherProfile>) => {
    const displayName = (part.displayName ?? config.profile.displayName).trim();
    const nextProfile: ResearcherProfile = {
      ...config.profile,
      ...part,
      mode: displayName ? "orcid" : "anonymous",
      displayName,
      includeInContext: Boolean(displayName),
    };
    patch({
      profile: nextProfile,
      userName: nextProfile.displayName,
      access: {
        ...config.access,
        researcherProfile: Boolean(displayName),
      },
    });
  };

  const updateProfileName = (part: Partial<ProfileNameParts>) => {
    setProfileNameParts((current) => {
      const next = { ...current, ...part };
      updateKnownProfile({ displayName: displayNameFromParts(next) });
      return next;
    });
  };

  const continueFromIntro = () => {
    if (!legalReady) return;
    if (!legalAccepted) {
      onAcceptLegal?.();
    }
    goNext();
  };

  const chooseTheme = (theme: ColorTheme) => {
    setSelectedTheme(theme);
    onApplyTheme(theme);
  };

  const selectProvider = (provider: AiProvider) => {
    if (provider === "cloud") {
      patch({
        provider,
        selection: {
          mode: "custom",
          custom: {
            kind: "cloud",
            providerId: config.cloud.providerId,
            model: config.cloud.model,
            baseUrl: config.cloud.baseUrl,
            credentialId: `credential-${config.cloud.providerId}-primary`,
          },
        },
      });
    } else if (provider === "ollama") {
      patch({
        provider,
        selection: {
          mode: "custom",
          custom: {
            kind: "ollama",
            baseUrl: config.ollamaBaseUrl,
            model: config.ollamaModel,
          },
        },
      });
    } else if (provider === "off") {
      patch({ provider, selection: { mode: "off" } });
    } else {
      patch({ provider });
    }
    setDownloaded(false);
    setDownloadError("");
  };

  const tierAvailability = (tier: LatexDoAiTierDefinition): TierAvailability => {
    if (!isDesktop) {
      return {
        state: "unsupported",
        reason: "Local AI requires the LatexDo desktop app.",
      };
    }
    if (systemCapabilities) return fastTierAvailability(tier, systemCapabilities);
    if (systemCapabilitiesState === "loading") {
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

  const tierRunAvailability = (tier: LatexDoAiTierDefinition): TierAvailability => {
    if (!isDesktop) {
      return {
        state: "unsupported",
        reason: "Local AI requires the LatexDo desktop app.",
      };
    }
    if (systemCapabilities) {
      return fastTierRuntimeAvailability(tier, systemCapabilities);
    }
    if (systemCapabilitiesState === "loading") {
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

  const selectTier = (tier: LatexDoAiTierDefinition) => {
    const tierInstalled =
      config.provider === "local" &&
      config.modelId === tier.runtime.modelId &&
      (downloaded || config.modelDownloaded);
    const availability = tierInstalled
      ? tierRunAvailability(tier)
      : tierAvailability(tier);
    if (availability.state !== "available") {
      setDownloadError(availabilityLabel(availability));
      return;
    }
    patch({
      provider: "local",
      selection: { mode: "latexdo", tier: tier.id },
      modelId: tier.runtime.modelId,
      modelDownloaded: tierInstalled,
    });
    setDownloaded(tierInstalled);
    setDownloadError("");
  };

  const selectGguf = () => {
    const modelId = importedManifest ? importedModelId(importedManifest.fileName) : "";
    patch({
      provider: "local",
      selection: { mode: "custom", custom: { kind: "gguf", modelId } },
      modelId,
      modelDownloaded:
        Boolean(importedManifest) &&
        importedManifest?.compatibility.state !== "memory-pressure" &&
        importedManifest?.compatibility.state !== "unsupported",
    });
    setDownloaded(false);
  };

  const refreshOllamaModels = async () => {
    if (!isDesktop) {
      setOllamaModels([]);
      setOllamaMessage("Ollama requires the LatexDo desktop app.");
      return;
    }
    setOllamaLoading(true);
    setOllamaMessage("");
    const result = await detectOllama(config.ollamaBaseUrl);
    setOllamaLoading(false);
    if (!result.available) {
      setOllamaModels([]);
      setOllamaMessage("Ollama is not reachable at this base URL.");
      return;
    }
    setOllamaModels(result.models);
    setOllamaMessage(
      result.models.length
        ? `Found ${result.models.length} model(s).`
        : "No models found.",
    );
  };

  const importGguf = async () => {
    if (!isDesktop) {
      setDownloadError("GGUF model import requires the LatexDo desktop app.");
      return;
    }
    setImporting(true);
    setDownloadError("");
    try {
      const manifest = await importModel();
      if (!manifest) return;
      setImportedManifest(manifest);
      onImportedModel?.(manifest);
      patch({
        provider: "local",
        selection: {
          mode: "custom",
          custom: { kind: "gguf", modelId: importedModelId(manifest.fileName) },
        },
        modelId: importedModelId(manifest.fileName),
        modelDownloaded:
          manifest.compatibility.state === "compatible" ||
          manifest.compatibility.state === "unknown",
      });
      setDownloaded(
        manifest.compatibility.state === "compatible" ||
          manifest.compatibility.state === "unknown",
      );
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  };

  const finalConfigForInstall = (source: AiConfig): AiConfig => ({
    ...source,
    setupComplete: true,
    modelDownloaded:
      source.provider === "local" ? downloaded || source.modelDownloaded : false,
  });

  const tierForConfig = (source: AiConfig): LatexDoAiTierDefinition | null => {
    const selection = source.selection;
    if (source.provider !== "local" || selection.mode !== "latexdo") {
      return null;
    }
    return (
      latexDoAiTiers.find((tier) => tier.id === selection.tier) ?? latexDoAiTiers[1]
    );
  };

  const runFinalInstall = async (nextConfig: AiConfig) => {
    let completedConfig = nextConfig;
    let currentStage: InstallStage = "ai";
    setPendingCompleteConfig(nextConfig);
    setReadyConfig(null);
    setInstalling(true);
    setInstallStage(currentStage);
    setInstallError("");
    setDownloadError("");
    setProgress({ received: 0, total: null });
    setSpeechInstallProgress(initialSpeechInstallProgress());
    setTexInstallProgress(null);
    setTexSetupState("pending");
    setInstallBytes(emptyInstallBytes);

    try {
      const tierToDownload = tierForConfig(nextConfig);
      const aiModelReady =
        tierToDownload &&
        nextConfig.modelId === tierToDownload.runtime.modelId &&
        (downloaded || nextConfig.modelDownloaded);

      // Check what this computer already has, so the bar covers only what is
      // really downloaded.
      const [speechStatus, texStatus] = isDesktop
        ? await Promise.all([
            getSpeechRuntimeStatus().catch(() => null),
            getTexRuntimeStatus().catch(() => null),
          ])
        : [null, null];
      const aiBytes =
        tierToDownload && !aiModelReady ? tierToDownload.runtime.downloadBytes : 0;
      const speechBytes =
        speechStatus && !speechStatus.installed ? (speechStatus.downloadBytes ?? 0) : 0;
      const texNeeded = Boolean(
        texStatus && !texStatus.installed && texStatus.supported !== false,
      );
      const texBytes = texNeeded ? (texStatus?.downloadBytes ?? 0) : 0;
      setInstallBytes({
        ai: { received: 0, total: aiBytes },
        speech: { received: 0, total: speechBytes },
        tex: { received: 0, total: texBytes },
      });

      if (tierToDownload && !aiModelReady) {
        const capabilities =
          systemCapabilities ?? (await onRefreshSystemCapabilities?.()) ?? null;
        if (capabilities) {
          const availability = fastTierAvailability(tierToDownload, capabilities);
          if (availability.state !== "available") {
            throw new Error(availabilityLabel(availability));
          }
        }

        setDownloading(true);
        const unsub = subscribeDownload((p) => {
          if (p.modelId !== tierToDownload.runtime.modelId) return;
          if (p.error) {
            setInstallError(p.error);
            setDownloadError(p.error);
            return;
          }
          setProgress({ received: p.receivedBytes, total: p.totalBytes });
          setInstallPart("ai", p.receivedBytes, p.totalBytes ?? aiBytes);
        });
        try {
          const result = await downloadModel(tierToDownload.id);
          if (!result.ok) {
            throw new Error(result.error ?? "Model download failed.");
          }
        } finally {
          unsub();
          setDownloading(false);
        }

        setDownloaded(true);
        setInstallBytes((current) => ({
          ...current,
          ai: { received: current.ai.total, total: current.ai.total },
        }));
        completedConfig = {
          ...completedConfig,
          provider: "local",
          selection: { mode: "latexdo", tier: tierToDownload.id },
          modelId: tierToDownload.runtime.modelId,
          modelDownloaded: true,
        };
        setConfig(completedConfig);
      } else if (completedConfig.provider !== "local") {
        completedConfig = {
          ...completedConfig,
          modelDownloaded: false,
        };
      }

      setPendingCompleteConfig(completedConfig);
      currentStage = "speech";
      setInstallStage(currentStage);

      if (isDesktop) {
        setSpeechInstalling(true);
        const unsub = subscribeSpeechInstall((speechProgress) => {
          setSpeechInstallProgress(speechProgress);
          if (speechProgress.error) setInstallError(speechProgress.error);
          else if (speechBytes > 0) {
            setInstallPart("speech", speechProgress.receivedBytes, speechBytes);
          }
        });
        try {
          const result = await installSpeechRuntime();
          if (!result.ok) {
            throw new Error(result.error ?? "Speech support install failed.");
          }
        } finally {
          unsub();
          setSpeechInstalling(false);
        }
        setSpeechInstallProgress({
          stage: "ready",
          receivedBytes: 0,
          totalBytes: null,
          done: true,
          message: "Local speech support is ready",
        });
      } else {
        setSpeechInstallProgress({
          stage: "ready",
          receivedBytes: 0,
          totalBytes: null,
          done: true,
          message: "Local speech support is only installed in the desktop app.",
        });
      }

      setInstallBytes((current) => ({
        ...current,
        speech: { received: current.speech.total, total: current.speech.total },
      }));
      currentStage = "tex";
      setInstallStage(currentStage);

      if (texNeeded) {
        setTexInstalling(true);
        const unsub = subscribeTexInstall((texProgress) => {
          setTexInstallProgress(texProgress);
          setInstallPart("tex", texProgress.receivedBytes, texBytes);
        });
        try {
          const result = await installTexRuntime();
          if (!result.ok) {
            throw new Error(result.error ?? "PDF builder install failed.");
          }
        } finally {
          unsub();
          setTexInstalling(false);
        }
        setInstallBytes((current) => ({
          ...current,
          tex: { received: current.tex.total, total: current.tex.total },
        }));
        setTexSetupState("installed");
      } else {
        setTexSetupState(
          texStatus?.installed
            ? "present"
            : texStatus?.supported === false
              ? "unsupported"
              : "skipped",
        );
      }

      setInstallStage("ready");
      setInstalling(false);
      setPendingCompleteConfig(completedConfig);
      setReadyConfig(completedConfig);
      setConfig(completedConfig);
      setStepIndex(readyStepIndex);
    } catch (error) {
      const message = messageFromError(error, "Setup install failed.");
      setInstallError(message);
      if (currentStage === "speech") {
        setSpeechInstallProgress((speechProgress) => ({
          ...speechProgress,
          done: true,
          error: message,
          message,
        }));
      } else if (currentStage === "ai") {
        setDownloadError(message);
      }
      setDownloading(false);
      setSpeechInstalling(false);
      setTexInstalling(false);
      setInstalling(false);
      return;
    }
  };

  const finish = () => {
    const nextConfig = finalConfigForInstall(config);
    setStepIndex(installStepIndex);
    void runFinalInstall(nextConfig);
  };

  const skipAiSetup = () => {
    const nextConfig = finalConfigForInstall({
      ...config,
      provider: "off",
      selection: { mode: "off" },
      modelDownloaded: false,
    });
    setStepIndex(installStepIndex);
    void runFinalInstall(nextConfig);
  };

  // "Skip setup" keeps the defaults. The default assistant is a local model,
  // which only the desktop app can download, so elsewhere skipping means no AI.
  const skipSetup = () => {
    if (!isDesktop && config.provider === "local") skipAiSetup();
    else finish();
  };

  const retryInstall = () => {
    if (!pendingCompleteConfig) return;
    setStepIndex(installStepIndex);
    void runFinalInstall(pendingCompleteConfig);
  };

  const completeReady = () => {
    onComplete(readyConfig ?? pendingCompleteConfig ?? finalConfigForInstall(config));
  };

  const selectedTierId =
    config.provider === "local" && config.selection.mode === "latexdo"
      ? config.selection.tier
      : null;
  const latexDoTierSelected = selectedTierId !== null;
  const selectedTier = selectedTierId
    ? (latexDoAiTiers.find((tier) => tier.id === selectedTierId) ?? latexDoAiTiers[1])
    : latexDoAiTiers[1];
  const selectedTierInstalled =
    config.provider === "local" &&
    config.modelId === selectedTier.runtime.modelId &&
    (downloaded || config.modelDownloaded);
  const selectedTierAvailability = selectedTierInstalled
    ? tierRunAvailability(selectedTier)
    : tierAvailability(selectedTier);
  const [modelDetailsOpen, setModelDetailsOpen] = React.useState(false);
  // The settings of a provider choice open under the list; bring them into view.
  const revealChoicePanel = React.useCallback((panel: HTMLDivElement | null) => {
    panel?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, []);
  const customProvider =
    config.provider === "ollama"
      ? "ollama"
      : config.provider === "local" && config.selection.mode === "custom"
        ? "gguf"
        : config.provider === "off"
          ? "off"
          : "cloud";
  // "Yes, on this computer" installs the model that suits this computer, so a
  // newcomer never has to compare tiers: the one already installed, else the
  // recommended one, else the light one when the recommended does not fit.
  const tierInstalledHere = (tier: LatexDoAiTierDefinition) =>
    config.provider === "local" &&
    config.modelId === tier.runtime.modelId &&
    (downloaded || config.modelDownloaded);
  const tierFitsHere = (tier: LatexDoAiTierDefinition) =>
    (tierInstalledHere(tier) ? tierRunAvailability(tier) : tierAvailability(tier))
      .state === "available";
  const recommendedTier =
    latexDoAiTiers.find((tier) => tier.id === "latexdo-ai-plus") ?? latexDoAiTiers[0];
  const bestTier =
    latexDoAiTiers.find((tier) => tierInstalledHere(tier) && tierFitsHere(tier)) ??
    [recommendedTier, latexDoAiTiers.find((tier) => tier.id === "latexdo-ai")].find(
      (tier): tier is LatexDoAiTierDefinition => Boolean(tier && tierFitsHere(tier)),
    ) ??
    null;
  const localTier =
    config.selection.mode === "latexdo" && tierFitsHere(selectedTier)
      ? selectedTier
      : bestTier;
  // A recommended model that does not fit is swapped for the one that does,
  // so "Yes, on this computer" always means something that will install.
  const swapToTier =
    step === "model" &&
    config.selection.mode === "latexdo" &&
    !tierFitsHere(selectedTier) &&
    bestTier &&
    bestTier.id !== selectedTier.id
      ? bestTier
      : null;
  React.useEffect(() => {
    if (swapToTier) selectTier(swapToTier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapToTier?.id]);
  const localChoiceNote = !isDesktop
    ? "Needs the LatexDo desktop app."
    : !systemCapabilities && systemCapabilitiesState === "loading"
      ? "Checking this computer…"
      : !localTier
        ? availabilityLabel(tierAvailability(recommendedTier))
        : tierInstalledHere(localTier)
          ? `${localTier.name} is already installed.`
          : `Installs ${localTier.name} · ${formatBytes(localTier.runtime.downloadBytes)} download`;
  const [moreOptionsOpen, setMoreOptionsOpen] = React.useState(
    () =>
      config.provider === "ollama" ||
      (config.provider === "local" && config.selection.mode === "custom"),
  );
  const importedCompatibility = importedManifest?.compatibility ?? null;
  const canContinueFromModel = latexDoTierSelected
    ? selectedTierAvailability.state === "available"
    : config.provider === "cloud"
      ? config.cloud.credentialConfigured
      : config.provider === "ollama"
        ? isDesktop && config.ollamaModel.trim().length > 0
        : config.provider === "local"
          ? isDesktop &&
            (downloaded || config.modelDownloaded) &&
            (!importedCompatibility ||
              importedCompatibility.state === "compatible" ||
              importedCompatibility.state === "unknown")
          : true;
  const installConfig = readyConfig ?? pendingCompleteConfig;
  const installTier = installConfig ? tierForConfig(installConfig) : null;
  const installAiReady = Boolean(
    readyConfig ||
    downloaded ||
    installConfig?.modelDownloaded ||
    (installConfig && !installTier),
  );
  const installAiPercent = progress.total
    ? Math.min(100, Math.round((progress.received / progress.total) * 100))
    : null;
  const speechInstallPercent = speechInstallProgress.totalBytes
    ? Math.min(
        100,
        Math.round(
          (speechInstallProgress.receivedBytes / speechInstallProgress.totalBytes) *
            100,
        ),
      )
    : null;
  const installAiTitle = installTier
    ? installTier.name
    : installConfig?.provider === "cloud"
      ? "Cloud AI provider"
      : installConfig?.provider === "ollama"
        ? "Ollama model"
        : installConfig?.provider === "local"
          ? "Imported local model"
          : "AI assistant";
  const installAiStatus = installTier
    ? installAiReady
      ? "Local AI model is ready."
      : downloading
        ? "Downloading the selected local AI model."
        : "Selected local AI model will download here."
    : installConfig?.provider === "cloud"
      ? "No local AI download needed. Your configured provider will be used."
      : installConfig?.provider === "ollama"
        ? "No LatexDo model download needed. LatexDo will use your Ollama model."
        : installConfig?.provider === "local"
          ? "No LatexDo model download needed. Your imported GGUF model is selected."
          : "AI is turned off.";
  const speechInstallStatus = isDesktop
    ? speechInstallMessage(speechInstallProgress)
    : "No local speech download is needed in the browser build.";
  const texInstallStatus =
    texSetupState === "present"
      ? "Already installed on this computer."
      : texSetupState === "installed"
        ? "PDF builder is ready."
        : texSetupState === "unsupported"
          ? "Automatic install is not available on this system. Install TeX Live with latexmk."
          : texSetupState === "skipped"
            ? "PDF building runs in the desktop app."
            : (texInstallProgress?.message ??
              `${productName} checks this computer and installs it if missing.`);
  const texInstallDone = texSetupState !== "pending";
  const installPercent =
    installTotalBytes > 0
      ? Math.min(100, Math.round((installReceivedBytes / installTotalBytes) * 100))
      : installing
        ? null
        : 100;
  const installTimeLabel = installError
    ? "Setup stopped"
    : !installing
      ? "Ready"
      : installTotalBytes > 0 && installReceivedBytes < installTotalBytes
        ? installSecondsLeft === null
          ? "Estimating time left…"
          : formatTimeLeft(installSecondsLeft)
        : "Finishing installation…";

  return (
    <div className="ai-wizard-overlay">
      <div
        className="ai-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-wizard-title"
      >
        <div className="ai-wizard-top">
          <div className="ai-wizard-brand">
            <ShieldCheck size={18} />
            <span>{productSetupName}</span>
          </div>
          <ol className="ai-wizard-steps" aria-label="Setup progress">
            {stageLabels.map((label, i) => {
              const stageIndex = Math.min(stepIndex, stageLabels.length - 1);
              return (
                <li
                  key={label}
                  className={i === stageIndex ? "active" : i < stageIndex ? "done" : ""}
                  aria-current={i === stageIndex ? "step" : undefined}
                >
                  <span className="ai-wizard-step-dot">
                    {i < stageIndex ? <Check size={12} /> : i + 1}
                  </span>
                  <span className="ai-wizard-step-label">{label}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="ai-wizard-main">
          <div className={`ai-wizard-body step-${step}`}>
            {step === "welcome" && (
              <div className="ai-wizard-section setup-intro-section">
                <SetupIntroStage index={introSlide} />
                <div className="setup-intro-side">
                  <h2 id="ai-wizard-title">Set up your {productName} workspace</h2>
                  <SetupIntroCaption index={introSlide} />
                  <label className="setup-legal-check">
                    <input
                      type="checkbox"
                      checked={legalConsent}
                      onChange={(event) => setLegalConsent(event.target.checked)}
                      aria-label="Accept Terms of Use and Privacy Policy"
                    />
                    <span>
                      Required once before using {productName}. I accept the{" "}
                      <a
                        href={legalTermsUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => openPolicy(event, legalTermsUrl)}
                      >
                        Terms of Use
                      </a>{" "}
                      and{" "}
                      <a
                        href={legalPrivacyUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => openPolicy(event, legalPrivacyUrl)}
                      >
                        Privacy Policy
                      </a>
                      .
                    </span>
                  </label>
                </div>
              </div>
            )}

            {step === "personalize" && (
              <div className="ai-wizard-section setup-personalize">
                <h2 id="ai-wizard-title">Make {productName} yours</h2>
                <p className="ai-wizard-lead">
                  Two quick choices. You can change both later.
                </p>

                <section className="setup-block" aria-labelledby="setup-name-title">
                  <h3 id="setup-name-title">
                    <User size={14} /> Your name
                    <span>Optional. Leave it empty to stay anonymous.</span>
                  </h3>
                  <div className="setup-name-row">
                    <input
                      className="ai-wizard-input"
                      autoFocus
                      aria-label="First name"
                      placeholder="First name"
                      value={profileNameParts.firstName}
                      maxLength={60}
                      onChange={(event) =>
                        updateProfileName({ firstName: event.target.value })
                      }
                      onKeyDown={(event) => event.key === "Enter" && goNext()}
                    />
                    <input
                      className="ai-wizard-input"
                      aria-label="Last name"
                      placeholder="Last name"
                      value={profileNameParts.lastName}
                      maxLength={80}
                      onChange={(event) =>
                        updateProfileName({ lastName: event.target.value })
                      }
                      onKeyDown={(event) => event.key === "Enter" && goNext()}
                    />
                  </div>
                </section>

                <section className="setup-block" aria-labelledby="setup-theme-title">
                  <h3 id="setup-theme-title">
                    <Palette size={14} /> Theme
                  </h3>
                  <div className="ai-wizard-theme-grid">
                    {colorThemeOptions.map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        className={`ai-wizard-theme-swatch ${
                          selectedTheme === theme.id ? "selected" : ""
                        }`}
                        onClick={() => chooseTheme(theme.id)}
                        aria-pressed={selectedTheme === theme.id}
                        title={theme.description}
                      >
                        <div className="ai-wizard-swatch-row">
                          {theme.swatches[appearance].map((c) => (
                            <span key={c} style={{ background: c }} />
                          ))}
                        </div>
                        <span className="ai-wizard-theme-name">{theme.name}</span>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {step === "model" && (
              <div className="ai-wizard-section ai-wizard-model-step">
                <Cpu size={28} className="ai-wizard-hero-icon" />
                <h2 id="ai-wizard-title">Do you want an AI assistant?</h2>
                <p className="ai-wizard-lead">
                  It explains LaTeX errors, rewrites sentences and suggests citations.
                  You can change this any time in Settings.
                </p>

                {isDesktop &&
                systemCapabilitiesState === "loading" &&
                !systemCapabilities ? (
                  <div
                    className="ai-wizard-resource-scan"
                    role="status"
                    aria-label="Detecting machine resources"
                  >
                    <div className="ai-wizard-resource-scan-head">
                      <Cpu size={15} />
                      <strong>Detecting this machine</strong>
                      <span>RAM, storage, and local AI runtime</span>
                    </div>
                    <div className="ai-wizard-resource-grid" aria-hidden="true">
                      {["RAM", "Storage", "Runtime"].map((label, index) => (
                        <div
                          key={label}
                          className="ai-wizard-resource-tile"
                          style={
                            {
                              "--scan-delay": `${index * 140}ms`,
                            } as React.CSSProperties
                          }
                        >
                          <span>{label}</span>
                          <div className="ai-wizard-resource-track" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div
                  className="ai-choice-list simple"
                  role="radiogroup"
                  aria-label="Assistant"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={
                      config.selection.mode === "latexdo" && Boolean(localTier)
                    }
                    aria-label="Choose an assistant on this computer"
                    className={`ai-choice ${
                      config.selection.mode === "latexdo" && localTier ? "selected" : ""
                    }`}
                    disabled={!localTier}
                    onClick={() => {
                      if (localTier) selectTier(localTier);
                    }}
                  >
                    <span className="ai-choice-radio" aria-hidden="true" />
                    <span className="ai-choice-body">
                      <span className="ai-choice-title">
                        <ShieldCheck size={15} aria-hidden="true" />
                        Yes, on this computer
                        <span className="ai-choice-badge">Recommended</span>
                      </span>
                      <span className="ai-choice-desc">
                        Free and private: it runs here and nothing is uploaded.
                      </span>
                      <span
                        className={bestTier ? "ai-choice-meta" : "ai-choice-warning"}
                      >
                        {localChoiceNote}
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    role="radio"
                    aria-checked={config.provider === "cloud"}
                    aria-label="Choose an AI provider"
                    className={`ai-choice ${config.provider === "cloud" ? "selected" : ""}`}
                    onClick={() => {
                      if (config.provider !== "cloud") selectProvider("cloud");
                    }}
                  >
                    <span className="ai-choice-radio" aria-hidden="true" />
                    <span className="ai-choice-body">
                      <span className="ai-choice-title">
                        <Cloud size={15} aria-hidden="true" />
                        Yes, with my API key
                      </span>
                      <span className="ai-choice-desc">
                        OpenAI, Anthropic, Google and others. Your text is sent to that
                        company.
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    role="radio"
                    aria-checked={config.provider === "off"}
                    aria-label="Choose no assistant"
                    className={`ai-choice ${config.provider === "off" ? "selected" : ""}`}
                    onClick={() => selectProvider("off")}
                  >
                    <span className="ai-choice-radio" aria-hidden="true" />
                    <span className="ai-choice-body">
                      <span className="ai-choice-title">
                        <CircleSlash size={15} aria-hidden="true" />
                        Not now
                      </span>
                      <span className="ai-choice-desc">
                        Everything else in {productName} works without AI.
                      </span>
                    </span>
                  </button>
                </div>

                {config.provider === "cloud" ? (
                  <div className="ai-choice-panel plain" ref={revealChoicePanel}>
                    <CloudProviderForm
                      cloud={config.cloud}
                      onChange={(cloud) =>
                        patch({
                          cloud,
                          provider: "cloud",
                          selection: {
                            mode: "custom",
                            custom: {
                              kind: "cloud",
                              providerId: cloud.providerId,
                              model: cloud.model,
                              baseUrl: cloud.baseUrl,
                              credentialId: `credential-${cloud.providerId}-primary`,
                            },
                          },
                        })
                      }
                      onOpenExternal={onOpenExternal}
                    />
                  </div>
                ) : null}

                <div className="ai-wizard-more">
                  <button
                    type="button"
                    className="ai-wizard-more-toggle"
                    aria-expanded={moreOptionsOpen}
                    onClick={() => setMoreOptionsOpen((open) => !open)}
                  >
                    {moreOptionsOpen ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                    More options
                  </button>
                  {moreOptionsOpen ? (
                    <div className="ai-wizard-more-body">
                      <p className="ai-wizard-more-hint">
                        Pick a specific model, or use one you already have.
                      </p>
                      <div
                        className="ai-choice-list"
                        role="radiogroup"
                        aria-label="Specific model"
                      >
                        {latexDoAiTiers.map((tier) => {
                          const tierInstalled =
                            config.provider === "local" &&
                            config.modelId === tier.runtime.modelId &&
                            (downloaded || config.modelDownloaded);
                          const availability = tierInstalled
                            ? tierRunAvailability(tier)
                            : tierAvailability(tier);
                          const available = availability.state === "available";
                          const selected =
                            config.selection.mode === "latexdo" &&
                            config.selection.tier === tier.id;
                          const guidance = tierUnlockGuidance(availability);
                          return (
                            <button
                              key={tier.id}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              aria-label={`Choose ${tier.name}`}
                              className={`ai-choice ${selected ? "selected" : ""}`}
                              disabled={!available}
                              onClick={() => selectTier(tier)}
                            >
                              <span className="ai-choice-radio" aria-hidden="true" />
                              <span className="ai-choice-body">
                                <span className="ai-choice-title">
                                  <AiIcon size={14} aria-hidden="true" />
                                  {tier.name}
                                  {tier.id === "latexdo-ai-plus" ? (
                                    <span className="ai-choice-badge">Recommended</span>
                                  ) : null}
                                  {tierInstalled ? (
                                    <span className="ai-choice-badge installed">
                                      <Check size={11} /> Installed
                                    </span>
                                  ) : null}
                                </span>
                                <span className="ai-choice-desc">
                                  {tier.description}
                                </span>
                                <span className="ai-choice-meta">
                                  {tierInstalled
                                    ? "Ready on this computer"
                                    : `${formatBytes(tier.runtime.downloadBytes)} download`}
                                  {" · "}
                                  needs {formatRam(
                                    tier.requirements.minSystemRamBytes,
                                  )}{" "}
                                  RAM
                                </span>
                                {selected && available && !tierInstalled ? (
                                  <span className="ai-choice-note">
                                    Will download during install
                                  </span>
                                ) : null}
                                {!available && isDesktop ? (
                                  <span className="ai-choice-warning">
                                    {availabilityLabel(availability)}
                                  </span>
                                ) : null}
                                {guidance && isDesktop ? (
                                  <span className="ai-choice-guidance">
                                    <strong>{guidance.heading}</strong>{" "}
                                    {guidance.steps.join(" ")}
                                  </span>
                                ) : null}
                                {selected && downloadError ? (
                                  <span className="ai-choice-warning">
                                    {downloadError}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          );
                        })}

                        <button
                          type="button"
                          role="radio"
                          aria-checked={
                            customProvider === "ollama" || customProvider === "gguf"
                          }
                          aria-label="Choose Ollama or a model file"
                          className={`ai-choice ${
                            customProvider === "ollama" || customProvider === "gguf"
                              ? "selected"
                              : ""
                          }`}
                          disabled={!isDesktop}
                          onClick={() => {
                            if (
                              customProvider !== "ollama" &&
                              customProvider !== "gguf"
                            ) {
                              selectProvider("ollama");
                            }
                          }}
                        >
                          <span className="ai-choice-radio" aria-hidden="true" />
                          <span className="ai-choice-body">
                            <span className="ai-choice-title">
                              <HardDrive size={14} aria-hidden="true" />
                              Ollama or a model file
                            </span>
                            <span className="ai-choice-desc">
                              A model you already run with Ollama, or a .gguf file you
                              have.
                            </span>
                            {!isDesktop ? (
                              <span className="ai-choice-warning">
                                Needs the LatexDo desktop app.
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </div>
                      {customProvider === "ollama" || customProvider === "gguf" ? (
                        <div className="ai-choice-panel" ref={revealChoicePanel}>
                          <div
                            className="ai-choice-segmented"
                            role="group"
                            aria-label="Source"
                          >
                            <button
                              type="button"
                              className={customProvider === "ollama" ? "active" : ""}
                              aria-pressed={customProvider === "ollama"}
                              onClick={() => selectProvider("ollama")}
                            >
                              Ollama
                            </button>
                            <button
                              type="button"
                              className={customProvider === "gguf" ? "active" : ""}
                              aria-pressed={customProvider === "gguf"}
                              onClick={selectGguf}
                            >
                              Model file (.gguf)
                            </button>
                          </div>

                          {customProvider === "ollama" ? (
                            <div className="ai-wizard-custom-group">
                              <label className="cloud-form-field">
                                <span>Server URL</span>
                                <input
                                  type="url"
                                  value={config.ollamaBaseUrl}
                                  onChange={(event) =>
                                    patch({
                                      ollamaBaseUrl: event.target.value,
                                      selection: {
                                        mode: "custom",
                                        custom: {
                                          kind: "ollama",
                                          baseUrl: event.target.value,
                                          model: config.ollamaModel,
                                        },
                                      },
                                    })
                                  }
                                />
                              </label>
                              <label className="cloud-form-field">
                                <span>Model</span>
                                <select
                                  value={config.ollamaModel}
                                  onChange={(event) =>
                                    patch({
                                      ollamaModel: event.target.value,
                                      selection: {
                                        mode: "custom",
                                        custom: {
                                          kind: "ollama",
                                          baseUrl: config.ollamaBaseUrl,
                                          model: event.target.value,
                                        },
                                      },
                                    })
                                  }
                                >
                                  <option value="">Select model</option>
                                  {config.ollamaModel &&
                                  !ollamaModels.includes(config.ollamaModel) ? (
                                    <option value={config.ollamaModel}>
                                      {config.ollamaModel}
                                    </option>
                                  ) : null}
                                  {ollamaModels.map((model) => (
                                    <option key={model} value={model}>
                                      {model}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button
                                type="button"
                                className="ai-wizard-ghost"
                                onClick={() => void refreshOllamaModels()}
                                disabled={ollamaLoading}
                              >
                                {ollamaLoading ? (
                                  <>
                                    <Loader2 size={13} className="spin" /> Refreshing
                                  </>
                                ) : (
                                  <>
                                    <RefreshCw size={13} /> Refresh models
                                  </>
                                )}
                              </button>
                              {ollamaMessage && (
                                <span className="cloud-form-ok">{ollamaMessage}</span>
                              )}
                            </div>
                          ) : (
                            <div className="ai-wizard-custom-group">
                              <button
                                type="button"
                                className="ai-wizard-ghost"
                                onClick={() => void importGguf()}
                                disabled={importing}
                              >
                                {importing ? (
                                  <>
                                    <Loader2 size={13} className="spin" /> Importing
                                  </>
                                ) : (
                                  <>
                                    <FileUp size={13} /> Import .gguf
                                  </>
                                )}
                              </button>
                              {importedManifest ? (
                                <div className="ai-wizard-imported-model">
                                  <strong>
                                    {labelForGgufFile(importedManifest.fileName)}
                                  </strong>
                                  <span>
                                    {formatBytes(importedManifest.fileSizeBytes)}
                                  </span>
                                  <span>
                                    {importedManifest.compatibility.state ===
                                    "compatible"
                                      ? "Compatible with this machine"
                                      : importedManifest.compatibility.state ===
                                          "memory-pressure"
                                        ? "Temporarily unavailable because of memory pressure"
                                        : importedManifest.compatibility.state ===
                                            "unsupported"
                                          ? "Not supported on this machine"
                                          : "Compatibility unknown"}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          )}
                          {downloadError ? (
                            <div className="ai-wizard-error">{downloadError}</div>
                          ) : null}
                        </div>
                      ) : null}

                      <details
                        className="ai-wizard-model-details"
                        open={modelDetailsOpen}
                      >
                        <summary
                          onClick={(event) => {
                            event.preventDefault();
                            setModelDetailsOpen((open) => !open);
                          }}
                        >
                          <GitCompareArrows size={14} />
                          <span>Compare what each LatexDo model can do</span>
                        </summary>
                        {modelDetailsOpen ? (
                          <div className="ai-wizard-compare">
                            <table className="ai-wizard-compare-table">
                              <caption className="sr-only">
                                What each LatexDo model can do
                              </caption>
                              <thead>
                                <tr>
                                  <th scope="col">Capability</th>
                                  {latexDoAiTiers.map((tier) => (
                                    <th
                                      key={tier.id}
                                      scope="col"
                                      className={
                                        config.selection.mode === "latexdo" &&
                                        config.selection.tier === tier.id
                                          ? "ai-wizard-compare-selected"
                                          : ""
                                      }
                                    >
                                      <span className="ai-wizard-compare-tier">
                                        {tier.name}
                                      </span>
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {tierCapabilityCatalog.map((capability) => (
                                  <tr key={capability.id}>
                                    <th scope="row">
                                      <strong>{capability.label}</strong>
                                      <span className="ai-wizard-compare-detail">
                                        {capability.detail}
                                      </span>
                                    </th>
                                    {latexDoAiTiers.map((tier) => (
                                      <td
                                        key={tier.id}
                                        className={
                                          config.selection.mode === "latexdo" &&
                                          config.selection.tier === tier.id
                                            ? "ai-wizard-compare-selected"
                                            : ""
                                        }
                                      >
                                        {tier.capabilities.includes(capability.id) ? (
                                          <Check
                                            size={14}
                                            className="ai-wizard-compare-yes"
                                            aria-label={`${tier.name}: included`}
                                          />
                                        ) : (
                                          <span
                                            className="ai-wizard-compare-no"
                                            aria-label={`${tier.name}: not included`}
                                          >
                                            —
                                          </span>
                                        )}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                      </details>
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {(step === "install" || step === "ready") && (
              <div className="ai-wizard-section ai-wizard-install-step">
                <Download size={28} className="ai-wizard-hero-icon" />
                <h2 id="ai-wizard-title">
                  {step === "ready"
                    ? `${productName} is ready`
                    : "Installing your selected setup"}
                </h2>
                {step === "ready" && (
                  <p className="ai-wizard-lead" role="status">
                    Welcome to {productName}! Your setup is complete. Start writing when
                    you’re ready.
                  </p>
                )}
                <div
                  className="ai-wizard-install-overall"
                  role="status"
                  aria-live="polite"
                >
                  <div
                    className={`ai-wizard-progress-bar ${
                      installPercent === null ? "indeterminate" : ""
                    }`}
                    role="progressbar"
                    aria-label="Setup progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={installPercent ?? undefined}
                  >
                    <div
                      className="ai-wizard-progress-fill"
                      style={{ width: `${installPercent ?? 40}%` }}
                    />
                  </div>
                  <div className="ai-wizard-install-overall-meta">
                    <span>{installTimeLabel}</span>
                    {installPercent !== null ? <span>{installPercent}%</span> : null}
                  </div>
                </div>
                {installError ? (
                  <div className="ai-wizard-install-error" role="alert">
                    {installError}
                  </div>
                ) : null}
                <div
                  className={`ai-wizard-install-panel ${
                    installError ? "has-error" : ""
                  } stage-${installStage}`}
                >
                  <div className="ai-wizard-install-row">
                    <div className="ai-wizard-install-marker">
                      {downloading ? (
                        <Loader2 size={15} className="spin" />
                      ) : installAiReady ? (
                        <Check size={15} />
                      ) : (
                        <Download size={15} />
                      )}
                    </div>
                    <div className="ai-wizard-install-copy">
                      <strong>{installAiTitle}</strong>
                      <span>{installAiStatus}</span>
                    </div>
                    <span className="ai-wizard-install-state">
                      {downloading
                        ? "Downloading"
                        : installAiReady
                          ? "Ready"
                          : installTier
                            ? "Queued"
                            : "No download"}
                    </span>
                    {downloading ? (
                      <div className="ai-wizard-install-progress">
                        <div className="ai-wizard-progress-bar">
                          <div
                            className="ai-wizard-progress-fill"
                            style={{ width: `${installAiPercent ?? 40}%` }}
                          />
                        </div>
                        <span>
                          {progress.total
                            ? `${formatBytes(progress.received)} / ${formatBytes(
                                progress.total,
                              )}`
                            : `${formatBytes(progress.received)} received`}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="ai-wizard-install-row">
                    <div className="ai-wizard-install-marker">
                      {speechInstalling ? (
                        <Loader2 size={15} className="spin" />
                      ) : speechInstallProgress.done &&
                        !speechInstallProgress.error &&
                        isDesktop ? (
                        <Check size={15} />
                      ) : (
                        <Download size={15} />
                      )}
                    </div>
                    <div className="ai-wizard-install-copy">
                      <strong>Local speech-to-text</strong>
                      <span>{speechInstallStatus}</span>
                    </div>
                    <span className="ai-wizard-install-state">
                      {speechInstalling
                        ? "Downloading"
                        : speechInstallProgress.error
                          ? "Failed"
                          : !isDesktop
                            ? "Skipped"
                            : speechInstallProgress.done
                              ? "Ready"
                              : isDesktop
                                ? "Queued"
                                : "Skipped"}
                    </span>
                    {speechInstalling ? (
                      <div className="ai-wizard-install-progress">
                        <div className="ai-wizard-progress-bar">
                          <div
                            className="ai-wizard-progress-fill"
                            style={{ width: `${speechInstallPercent ?? 40}%` }}
                          />
                        </div>
                        <span>
                          {speechInstallProgress.totalBytes
                            ? `${formatBytes(
                                speechInstallProgress.receivedBytes,
                              )} / ${formatBytes(speechInstallProgress.totalBytes)}`
                            : "Preparing download"}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="ai-wizard-install-row">
                    <div className="ai-wizard-install-marker">
                      {texInstalling ? (
                        <Loader2 size={15} className="spin" />
                      ) : texSetupState === "present" ||
                        texSetupState === "installed" ? (
                        <Check size={15} />
                      ) : (
                        <Download size={15} />
                      )}
                    </div>
                    <div className="ai-wizard-install-copy">
                      <strong>PDF builder (TeX)</strong>
                      <span>{texInstallStatus}</span>
                    </div>
                    <span className="ai-wizard-install-state">
                      {texInstalling
                        ? "Downloading"
                        : texSetupState === "present" || texSetupState === "installed"
                          ? "Ready"
                          : texInstallDone
                            ? "Skipped"
                            : "Queued"}
                    </span>
                    {texInstalling && texInstallProgress?.totalBytes ? (
                      <div className="ai-wizard-install-progress">
                        <div className="ai-wizard-progress-bar">
                          <div
                            className="ai-wizard-progress-fill"
                            style={{
                              width: `${Math.min(
                                100,
                                Math.round(
                                  (texInstallProgress.receivedBytes /
                                    texInstallProgress.totalBytes) *
                                    100,
                                ),
                              )}%`,
                            }}
                          />
                        </div>
                        <span>
                          {formatBytes(texInstallProgress.receivedBytes)} /{" "}
                          {formatBytes(texInstallProgress.totalBytes)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="ai-wizard-footer">
            <div>
              {stepIndex > 0 && (step !== "install" || installError) && (
                <button
                  className="ai-wizard-ghost"
                  onClick={goBack}
                  disabled={setupBusy}
                >
                  <ArrowLeft size={14} /> Back
                </button>
              )}
            </div>
            <div className="ai-wizard-footer-right">
              {step === "personalize" && (
                <button
                  className="ai-wizard-ghost"
                  onClick={skipSetup}
                  disabled={setupBusy}
                  title="Keep the defaults and finish setup now."
                >
                  Skip setup
                </button>
              )}
              {step === "model" ? (
                <>
                  <button
                    className="ai-wizard-primary"
                    onClick={finish}
                    disabled={!canContinueFromModel || setupBusy}
                    title={
                      canContinueFromModel
                        ? ""
                        : "Choose an option first, or set up your API key."
                    }
                  >
                    Continue <ArrowRight size={15} />
                  </button>
                </>
              ) : step === "install" ? (
                installError ? (
                  <button className="ai-wizard-primary" onClick={retryInstall}>
                    <RefreshCw size={13} /> Retry install
                  </button>
                ) : (
                  <button className="ai-wizard-primary" disabled>
                    <Loader2 size={13} className="spin" /> Installing
                  </button>
                )
              ) : step === "ready" ? (
                <button className="ai-wizard-primary" onClick={completeReady}>
                  Start writing <Check size={15} />
                </button>
              ) : (
                <button
                  className="ai-wizard-primary"
                  onClick={step === "welcome" ? continueFromIntro : goNext}
                  disabled={(step === "welcome" && !legalReady) || setupBusy}
                  title={
                    step === "welcome" && !legalReady
                      ? "Accept the Terms of Use and Privacy Policy to continue."
                      : ""
                  }
                >
                  Continue <ArrowRight size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
