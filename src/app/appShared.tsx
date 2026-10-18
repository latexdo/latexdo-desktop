import type * as Monaco from "monaco-editor";
import { AlertTriangle, CircleCheck, Download, ExternalLink } from "lucide-react";
import { lazy, useEffect, useState, type MutableRefObject } from "react";
import appIconUrl from "../../build/icon.svg";
import {
  loadAiConfig,
  aiConfigStorageKey,
  type AiConfig,
  type AiProvider,
  type LayoutPreset,
} from "../features/ai/aiConfig";
import {
  getTexRuntimeStatus,
  installTexRuntime,
  subscribeTexInstall,
} from "../features/ai/aiClient";
import { localModelCatalog, type LocalModelInfo } from "../features/ai/aiModels";
import {
  type LatexDoAiTier,
  type LatexDoAiTierDefinition,
} from "../features/ai/product/latexDoAiTiers";
import type { ImportedModelManifest, TierAvailability } from "../features/ai/aiTypes";
import { useCursorPosition } from "../features/editor/cursorStore";
import type {
  CompileResult,
  Engine,
  OpenDocument,
  RebuttalItem,
  ReviewChat,
} from "../types";
import { type AppearanceMode } from "../features/settings/settings";
import { normalizeRelativePath } from "../features/project/projectUtils";
import { wordColumn } from "../features/pdf/sync";
import { findSourceWord } from "../features/pdf/wordMatch";

export const PdfPreview = lazy(() => import("../PdfPreview"));
export const TerminalPanel = lazy(() =>
  import("../components/TerminalPanel").then((module) => ({
    default: module.TerminalPanel,
  })),
);
export const MonacoEditor = lazy(() =>
  import("../components/MonacoEditor").then((module) => ({
    default: module.MonacoEditor,
  })),
);

export type MonacoNamespace = typeof Monaco;
export let monaco = null as unknown as MonacoNamespace;
// Other modules read `monaco` as a live binding; only this module may assign it.
export function setMonaco(instance: MonacoNamespace): void {
  monaco = instance;
}
export const monacoProviderGeneration = Math.random().toString(36);
export type MonacoProviderDisposableStore = typeof globalThis & {
  __latexdoMonacoProviderDisposables?: Monaco.IDisposable[];
  __latexdoMonacoProviderGeneration?: string;
};

export function offsetFromLineColumn(
  content: string,
  lineNumber: number,
  column: number,
): number | null {
  if (lineNumber < 1 || column < 1) {
    return null;
  }

  const lines = content.split("\n");
  if (lineNumber > lines.length) {
    return null;
  }

  let offset = 0;
  for (let line = 1; line < lineNumber; line += 1) {
    offset += lines[line - 1].length + 1;
  }

  return offset + Math.min(column - 1, lines[lineNumber - 1].length);
}

export function prepareMonacoProviderDisposables(): Monaco.IDisposable[] | null {
  const store = globalThis as MonacoProviderDisposableStore;
  if (store.__latexdoMonacoProviderGeneration === monacoProviderGeneration) {
    return null;
  }

  for (const disposable of store.__latexdoMonacoProviderDisposables ?? []) {
    disposable.dispose();
  }
  store.__latexdoMonacoProviderDisposables = [];
  store.__latexdoMonacoProviderGeneration = monacoProviderGeneration;
  return store.__latexdoMonacoProviderDisposables;
}

export type PanelKind = "problems" | "output" | "terminal";
export type SidebarView =
  | "explorer"
  | "sourceControl"
  | "extensions"
  | "ai"
  | "enterprise";

export interface ActivationWorkspaceSnapshot {
  sidebarVisible: boolean;
  activeSidebar: SidebarView;
  previewVisible: boolean;
  panelVisible: boolean;
  activePanel: PanelKind;
  latexEditorView: "code" | "visual";
}

export interface AiChatTab {
  id: string;
  title: string;
}
export const collaborationProjectReconciliationMs = 5 * 60_000;
export const forceSetupWizardEveryDevLaunch = import.meta.env.MODE === "development";
export const aiChatTabsStorageKey = "latexdo.ai.chatTabs.v1";
export const aiChatStateStoragePrefix = "latexdo.ai.chatState.";
export const missingLatexToolchainCode = "missing-latex-toolchain";
export const missingAsymptoteToolchainCode = "missing-asymptote-toolchain";
export const legacyDefaultOllamaModel = "qwen2.5-coder:3b";
export const customLatexDoAiModelsStorageKey = "latexdo.ai.customLocalModels.v1";
export const localAiProviderModeStorageKey = "latexdo.ai.localProviderMode.v1";
export const customLatexDoAiModelIdPrefix = "imported-gguf:";
export const latexDoAiTierSelectPrefix = "latexdo-tier:";
export const predefinedLatexDoAiModelFileNames = new Set(
  localModelCatalog.map((model) => model.fileName),
);
export type LocalAiProviderMode = "latexdo-ai" | "local-model";
export type AiPrimarySelectionValue = `latexdo-tier:${LatexDoAiTier}` | "customize";
export type CloudProviderSelectValue = `cloud:${string}`;
export type CustomAiProviderSelectValue =
  | Exclude<AiProvider, "local" | "cloud">
  | "local-model"
  | CloudProviderSelectValue;

export type CompilerSetupIssue = "latex" | "asymptote";

export const texInstallerOptions = [
  {
    id: "macos",
    label: "Mac",
    title: "Install MacTeX",
    body: "Best choice for most macOS students.",
    url: "https://www.tug.org/mactex/",
  },
  {
    id: "windows",
    label: "Windows",
    title: "Install MiKTeX",
    body: "Choose the normal installer and allow missing packages when asked.",
    url: "https://miktex.org/download",
  },
  {
    id: "linux",
    label: "Linux",
    title: "Install TeX Live",
    body: "Use your system software store or package manager.",
    url: "https://www.tug.org/texlive/",
  },
] as const;

export function preferredTexInstallerId(): (typeof texInstallerOptions)[number]["id"] {
  const platform = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "macos";
  return "linux";
}

export const citationSearchShortcutLabel = /mac/i.test(
  `${navigator.platform} ${navigator.userAgent}`,
)
  ? "⌘⌥C"
  : "Ctrl+Alt+C";

export function compilerSetupIssue(
  compileResult: CompileResult | null,
): CompilerSetupIssue | null {
  if (
    compileResult?.diagnostics.some(
      (diagnostic) => diagnostic.code === missingLatexToolchainCode,
    )
  ) {
    return "latex";
  }
  if (
    compileResult?.diagnostics.some(
      (diagnostic) => diagnostic.code === missingAsymptoteToolchainCode,
    )
  ) {
    return "asymptote";
  }
  return null;
}

export function ToolchainSetupCard({
  issue,
  onOpenExternal,
  onInstalled,
}: {
  issue: CompilerSetupIssue;
  onOpenExternal: (url: string) => void;
  onInstalled: () => void;
}) {
  // LatexDo installs the PDF builder itself where it can; the manual
  // installer links stay as the fallback.
  const [autoInstallAvailable, setAutoInstallAvailable] = useState(false);
  const [autoInstall, setAutoInstall] = useState<{
    running: boolean;
    percent: number | null;
    message: string;
    error: string;
  }>({ running: false, percent: null, message: "", error: "" });
  useEffect(() => {
    if (issue !== "latex") return;
    let cancelled = false;
    void getTexRuntimeStatus()
      .then((status) => {
        if (!cancelled) setAutoInstallAvailable(Boolean(status?.supported));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [issue]);
  const runAutoInstall = async () => {
    setAutoInstall({
      running: true,
      percent: null,
      message: "Preparing the PDF builder",
      error: "",
    });
    const unsubscribe = subscribeTexInstall((progress) =>
      setAutoInstall((current) => ({
        ...current,
        percent: progress.totalBytes
          ? Math.min(
              100,
              Math.round((progress.receivedBytes / progress.totalBytes) * 100),
            )
          : null,
        message: progress.message ?? current.message,
      })),
    );
    try {
      const result = await installTexRuntime();
      if (!result.ok) throw new Error(result.error ?? "PDF builder install failed.");
      setAutoInstall({ running: false, percent: 100, message: "", error: "" });
      onInstalled();
    } catch (error) {
      setAutoInstall({
        running: false,
        percent: null,
        message: "",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      unsubscribe();
    }
  };

  const preferredId = preferredTexInstallerId();
  const options = [...texInstallerOptions].sort((left, right) => {
    if (left.id === preferredId) return -1;
    if (right.id === preferredId) return 1;
    return 0;
  });
  const isAsymptote = issue === "asymptote";

  return (
    <div className="toolchain-setup-card">
      <div className="toolchain-setup-copy">
        <span className="toolchain-setup-icon">
          <AlertTriangle size={18} />
        </span>
        <div>
          <span className="toolchain-setup-kicker">One-time setup needed</span>
          <h3>
            {isAsymptote ? "Install the drawing builder" : "Install the PDF builder"}
          </h3>
          <p>
            {isAsymptote
              ? "LatexDo can edit this drawing now, but this computer needs Asymptote before it can make the PDF."
              : "Your .tex file may be fine. This computer just needs a LaTeX PDF builder before LatexDo can compile it."}
          </p>
        </div>
      </div>

      {autoInstallAvailable ? (
        <div className="toolchain-auto-install">
          <button
            type="button"
            className="toolchain-auto-install-button"
            onClick={() => void runAutoInstall()}
            disabled={autoInstall.running}
          >
            <Download size={14} />
            {autoInstall.running ? "Installing the PDF builder…" : "Install it for me"}
          </button>
          {autoInstall.running ? (
            <div className="toolchain-auto-install-progress" role="status">
              <div className="ai-wizard-progress-bar">
                <div
                  className="ai-wizard-progress-fill"
                  style={{ width: `${autoInstall.percent ?? 5}%` }}
                />
              </div>
              <span>
                {autoInstall.message}
                {autoInstall.percent !== null ? ` · ${autoInstall.percent}%` : ""}
              </span>
            </div>
          ) : null}
          {autoInstall.error ? (
            <span className="toolchain-auto-install-error" role="alert">
              {autoInstall.error}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="toolchain-setup-steps" aria-label="Setup steps">
        <span>
          <CircleCheck size={14} /> Pick your computer
        </span>
        <span>
          <CircleCheck size={14} /> Install once
        </span>
        <span>
          <CircleCheck size={14} /> Restart LatexDo
        </span>
        <span>
          <CircleCheck size={14} /> Press Compile again
        </span>
      </div>

      <div className="toolchain-install-grid">
        {options.map((option) => (
          <button
            className={option.id === preferredId ? "recommended" : ""}
            key={option.id}
            type="button"
            onClick={() => onOpenExternal(option.url)}
          >
            <span>
              {option.label}
              {option.id === preferredId ? <em>Recommended</em> : null}
            </span>
            <strong>{option.title}</strong>
            <small>{option.body}</small>
            <ExternalLink size={13} />
          </button>
        ))}
      </div>

      <details className="toolchain-setup-details">
        <summary>Show details</summary>
        <div>
          <span>
            After installing, close and reopen LatexDo. To check manually, open a
            terminal and run:
          </span>
          <code>{isAsymptote ? "asy -version" : "latexmk -version"}</code>
          <span>
            If the terminal cannot find it, the TeX installer did not finish or is not
            on this computer&apos;s PATH yet.
          </span>
        </div>
      </details>
    </div>
  );
}

export interface CustomLatexDoAiModelRecord {
  id: string;
  name: string;
  fileName: string;
  sizeBytes: number | null;
  manifest?: ImportedModelManifest;
}

export interface PersistedAiChatTabs {
  chats: AiChatTab[];
  activeId: string;
  nextNumber: number;
}

export function defaultAiChatTabs(): PersistedAiChatTabs {
  return {
    chats: [{ id: "ai-chat-1", title: "Chat 1" }],
    activeId: "ai-chat-1",
    nextNumber: 2,
  };
}

export function aiChatStateStorageKey(chatId: string): string {
  return `${aiChatStateStoragePrefix}${chatId}.v1`;
}

export function normalizePersistedAiChat(raw: unknown): AiChatTab | null {
  const value = raw as Partial<AiChatTab>;
  if (typeof value.id !== "string" || typeof value.title !== "string") {
    return null;
  }
  if (!value.id.startsWith("ai-chat-")) return null;
  return {
    id: value.id.slice(0, 120),
    title: value.title.slice(0, 80) || "Chat",
  };
}

export function loadPersistedAiChatTabs(): PersistedAiChatTabs {
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(aiChatTabsStorageKey) ?? "null",
    ) as Partial<PersistedAiChatTabs> | null;
    const chats = Array.isArray(raw?.chats)
      ? raw.chats
          .map(normalizePersistedAiChat)
          .filter((chat): chat is AiChatTab => chat !== null)
          .slice(0, 20)
      : [];
    if (chats.length === 0) return defaultAiChatTabs();
    const activeId =
      typeof raw?.activeId === "string" &&
      chats.some((chat) => chat.id === raw.activeId)
        ? raw.activeId
        : chats[0].id;
    const highestTitleNumber = chats.reduce((highest, chat) => {
      const match = /^Chat\s+(\d+)$/i.exec(chat.title);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    const nextNumber =
      typeof raw?.nextNumber === "number" && Number.isFinite(raw.nextNumber)
        ? Math.max(raw.nextNumber, highestTitleNumber + 1, 1)
        : Math.max(highestTitleNumber + 1, chats.length + 1, 2);
    return { chats, activeId, nextNumber };
  } catch {
    return defaultAiChatTabs();
  }
}

export function bookmarkLinesEqual(left: number[], right: number[]): boolean {
  return (
    left.length === right.length && left.every((line, index) => line === right[index])
  );
}

export function savePersistedAiChatTabs(state: PersistedAiChatTabs): void {
  try {
    window.localStorage.setItem(aiChatTabsStorageKey, JSON.stringify(state));
  } catch {
    // Ignore localStorage failures; chats remain available for this session.
  }
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return "unknown size";
  }
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function importedLatexDoAiModelId(fileName: string): string {
  return `${customLatexDoAiModelIdPrefix}${fileName}`;
}

export function isImportedLatexDoAiModelId(modelId: string): boolean {
  return modelId.startsWith(customLatexDoAiModelIdPrefix);
}

export function isCloudProviderSelectValue(
  value: string,
): value is CloudProviderSelectValue {
  return value.startsWith("cloud:");
}

export function latexDoAiTierSelectValue(tier: LatexDoAiTier): AiPrimarySelectionValue {
  return `${latexDoAiTierSelectPrefix}${tier}` as AiPrimarySelectionValue;
}

export function isLatexDoAiTierSelectValue(
  value: string,
): value is `latexdo-tier:${LatexDoAiTier}` {
  return value.startsWith(latexDoAiTierSelectPrefix);
}

export function tierFromSelectValue(
  value: `latexdo-tier:${LatexDoAiTier}`,
): LatexDoAiTier {
  return value.slice(latexDoAiTierSelectPrefix.length) as LatexDoAiTier;
}

export function formatRam(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function tierAvailabilityLabel(availability: TierAvailability): string {
  if (availability.state === "available") return "Available on this machine";
  if (availability.state === "memory-pressure") {
    return `Temporarily unavailable: needs ${formatRam(
      availability.requiredAvailableBytes,
    )} available, ${formatRam(availability.availableBytes)} available now`;
  }
  if (availability.state === "storage-pressure") {
    return `Not enough storage: needs ${formatRam(
      availability.requiredAvailableStorageBytes,
    )} free, ${formatRam(availability.availableStorageBytes)} free now`;
  }
  if (
    typeof availability.requiredSystemRamBytes === "number" &&
    typeof availability.detectedSystemRamBytes === "number"
  ) {
    return `Not supported: requires ${formatRam(
      availability.requiredSystemRamBytes,
    )} RAM, detected ${formatRam(availability.detectedSystemRamBytes)}`;
  }
  return `Not supported: ${availability.reason}`;
}

export function localRuntimeSelectionForTier(
  tier: LatexDoAiTierDefinition,
): Pick<AiConfig, "provider" | "selection" | "modelId" | "modelDownloaded"> {
  return {
    provider: "local",
    selection: { mode: "latexdo", tier: tier.id },
    modelId: tier.runtime.modelId,
    modelDownloaded: false,
  };
}

export function labelForGgufFile(fileName: string): string {
  return (
    fileName
      .replace(/\.gguf$/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || fileName
  );
}

export function normalizeCustomLatexDoAiModelRecord(
  raw: unknown,
): CustomLatexDoAiModelRecord | null {
  const value = raw as Partial<CustomLatexDoAiModelRecord>;
  if (
    typeof value.fileName !== "string" ||
    !value.fileName.toLowerCase().endsWith(".gguf")
  ) {
    return null;
  }
  const fileName = value.fileName.split(/[\\/]/).pop() ?? value.fileName;
  return {
    id:
      typeof value.id === "string" && value.id.startsWith(customLatexDoAiModelIdPrefix)
        ? value.id
        : importedLatexDoAiModelId(fileName),
    name:
      typeof value.name === "string" && value.name.trim()
        ? value.name.trim()
        : labelForGgufFile(fileName),
    fileName,
    sizeBytes:
      typeof value.sizeBytes === "number" && Number.isFinite(value.sizeBytes)
        ? value.sizeBytes
        : value.manifest &&
            typeof value.manifest.fileSizeBytes === "number" &&
            Number.isFinite(value.manifest.fileSizeBytes)
          ? value.manifest.fileSizeBytes
          : null,
    manifest:
      value.manifest && typeof value.manifest === "object"
        ? (value.manifest as ImportedModelManifest)
        : undefined,
  };
}

export function loadCustomLatexDoAiModels(): CustomLatexDoAiModelRecord[] {
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(customLatexDoAiModelsStorageKey) ?? "[]",
    ) as unknown[];
    if (!Array.isArray(raw)) return [];
    const records = raw
      .map(normalizeCustomLatexDoAiModelRecord)
      .filter((record): record is CustomLatexDoAiModelRecord => record !== null);
    return Array.from(
      new Map(records.map((record) => [record.fileName, record])).values(),
    );
  } catch {
    return [];
  }
}

export function saveCustomLatexDoAiModels(records: CustomLatexDoAiModelRecord[]): void {
  window.localStorage.setItem(customLatexDoAiModelsStorageKey, JSON.stringify(records));
}

export function loadLocalAiProviderMode(config: AiConfig): LocalAiProviderMode {
  try {
    const saved = window.localStorage.getItem(localAiProviderModeStorageKey);
    if (saved === "latexdo-ai" || saved === "local-model") return saved;
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
  return config.provider === "local" && isImportedLatexDoAiModelId(config.modelId)
    ? "local-model"
    : "latexdo-ai";
}

export function saveLocalAiProviderMode(mode: LocalAiProviderMode): void {
  window.localStorage.setItem(localAiProviderModeStorageKey, mode);
}

export function installCustomLatexDoAiModels(
  records: CustomLatexDoAiModelRecord[],
): void {
  const catalog = localModelCatalog as LocalModelInfo[];
  for (let i = catalog.length - 1; i >= 0; i -= 1) {
    if (catalog[i].id.startsWith(customLatexDoAiModelIdPrefix)) {
      catalog.splice(i, 1);
    }
  }
  for (const record of records) {
    catalog.push({
      id: record.id,
      name: record.name,
      description: `Imported GGUF model (${formatFileSize(record.sizeBytes)}).`,
      params: "GGUF",
      downloadSize: formatFileSize(record.sizeBytes),
      ramEstimate: "Depends on model",
      minSystemRamGb: 0,
      minAvailableRamGb: 0,
      tier: "balanced",
      quant: "Imported",
      downloadUrl: "",
      fileName: record.fileName,
      supportsTools: false,
      strengths: ["Imported", "Local"],
    });
  }
}

export function loadAiConfigForApp(): AiConfig {
  const customModels = loadCustomLatexDoAiModels();
  installCustomLatexDoAiModels(customModels);
  const config = loadAiConfig();
  const prepareConfig = (nextConfig: AiConfig): AiConfig =>
    forceSetupWizardEveryDevLaunch
      ? { ...nextConfig, setupComplete: false }
      : nextConfig;
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(aiConfigStorageKey) ?? "{}",
    ) as Partial<AiConfig>;
    const savedModelId = typeof saved.modelId === "string" ? saved.modelId : "";
    if (customModels.some((model) => model.id === savedModelId)) {
      return prepareConfig({
        ...config,
        selection: {
          mode: "custom",
          custom: { kind: "gguf", modelId: savedModelId },
        },
        modelId: savedModelId,
        modelDownloaded: true,
        ollamaModel:
          typeof saved.ollamaModel === "string" &&
          saved.ollamaModel !== legacyDefaultOllamaModel
            ? saved.ollamaModel
            : "",
      });
    }
    if (
      typeof saved.ollamaModel !== "string" ||
      saved.ollamaModel === legacyDefaultOllamaModel
    ) {
      return prepareConfig({ ...config, ollamaModel: "" });
    }
  } catch {
    return prepareConfig({ ...config, ollamaModel: "" });
  }
  return prepareConfig(config);
}

export function WorkspaceLayoutPreview({ preset }: { preset: LayoutPreset }) {
  const hasSidebar = preset !== "focus";
  const hasPanel = preset === "power";
  const hasMinimap = preset !== "focus";

  return (
    <div
      className={`workspace-preset-figure workspace-preset-${preset}`}
      role="img"
      aria-label={`${preset} workspace preview`}
    >
      <div className="workspace-preset-titlebar">
        <span />
        <span />
        <span />
      </div>
      <div className="workspace-preset-shell">
        {hasSidebar ? (
          <div className="workspace-preset-sidebar">
            <span />
            <span />
            <span />
          </div>
        ) : null}
        <div className="workspace-preset-main">
          <div className="workspace-preset-split">
            <div className="workspace-preset-editor">
              <span className="wide" />
              <span className="medium" />
              <span className="short" />
              {hasMinimap ? <i aria-hidden="true" /> : null}
            </div>
            <div className="workspace-preset-pdf">
              <em />
              <span />
              <span className="short" />
            </div>
          </div>
          {hasPanel ? (
            <div className="workspace-preset-bottom">
              <span />
              <span />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type LatexToolbarCommand =
  | "bold"
  | "italic"
  | "underline"
  | "math"
  | "section"
  | "subsection"
  | "equation"
  | "itemize"
  | "enumerate"
  | "cite"
  | "ref"
  | "href"
  | "formatTable";

export type PendingSourceLocation = {
  path: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  word?: string;
  /** The PDF word's neighbours, to find its exact occurrence in the source. */
  before?: string[];
  after?: string[];
  /** False keeps focus where it is (the find panel steps through matches). */
  focus?: boolean;
};

export type SourceRevealOptions = {
  focus?: boolean;
  highlight?: boolean;
  select?: boolean;
};

export type OpenDocumentOptions = {
  announce?: boolean;
};

export type TextOpenDocument = OpenDocument & { kind?: "text" };

export function isTextDocument(
  document: OpenDocument | null | undefined,
): document is TextOpenDocument {
  return Boolean(document && (document.kind ?? "text") === "text");
}

const closedTabHistoryLimit = 20;

/** Records a closed tab so Cmd/Ctrl+Z (or Cmd/Ctrl+Shift+T) can reopen it. */
export function rememberClosedTab(
  closedTabPathsRef: MutableRefObject<string[]>,
  reopenClosedTabArmedRef: MutableRefObject<boolean>,
  path: string,
): void {
  const history = closedTabPathsRef.current.filter((item) => item !== path);
  history.push(path);
  closedTabPathsRef.current = history.slice(-closedTabHistoryLimit);
  reopenClosedTabArmedRef.current = true;
}

export function isPreviewAssetMimeType(mimeType: string | null): mimeType is string {
  return Boolean(
    mimeType && (mimeType.startsWith("image/") || mimeType === "application/pdf"),
  );
}

export function assetPreviewTypeLabel(mimeType?: string): string {
  return mimeType === "application/pdf" ? "PDF" : "Image";
}

export function formatAssetSize(bytes?: number): string {
  if (!bytes || bytes < 1) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function clampModelLine(
  model: Monaco.editor.ITextModel,
  lineNumber: number,
): number {
  const safeLine = Number.isFinite(lineNumber) ? Math.floor(lineNumber) : 1;
  return Math.min(Math.max(1, safeLine), model.getLineCount());
}

export function clampModelColumn(
  model: Monaco.editor.ITextModel,
  lineNumber: number,
  column: number,
): number {
  const safeColumn = Number.isFinite(column) ? Math.floor(column) : 1;
  return Math.min(Math.max(1, safeColumn), model.getLineMaxColumn(lineNumber));
}

export function modelRange(
  model: Monaco.editor.ITextModel,
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number,
): Monaco.IRange {
  const startLine = clampModelLine(model, startLineNumber);
  const endLine = clampModelLine(model, endLineNumber);
  const orderedEndLine = Math.max(startLine, endLine);
  const start = clampModelColumn(model, startLine, startColumn);
  let end =
    orderedEndLine === startLine
      ? clampModelColumn(model, startLine, Math.max(start, endColumn))
      : clampModelColumn(model, orderedEndLine, endColumn);

  if (orderedEndLine === startLine && end <= start) {
    end = Math.min(model.getLineMaxColumn(startLine), start + 1);
  }

  return {
    startLineNumber: startLine,
    startColumn: start,
    endLineNumber: orderedEndLine,
    endColumn: end,
  };
}

export function sourceSelectionRange(
  model: Monaco.editor.ITextModel,
  pending: PendingSourceLocation,
): Monaco.IRange {
  const line = clampModelLine(model, pending.line);
  const column = clampModelColumn(model, line, pending.column);

  if (pending.word) {
    // The exact word clicked in the PDF: matched with its neighbours near the
    // line SyncTeX named (which knows no columns and can be a line off).
    const exact = findSourceWord(model.getValue(), line, {
      word: pending.word,
      before: pending.before ?? [],
      after: pending.after ?? [],
    });
    if (exact) {
      return modelRange(
        model,
        exact.line,
        exact.column,
        exact.line,
        exact.column + exact.length,
      );
    }
    const match = wordColumn(model.getLineContent(line), pending.word, column);
    if (match.length > 0) {
      return modelRange(model, line, match.column, line, match.column + match.length);
    }
  }

  if (pending.endLine !== undefined || pending.endColumn !== undefined) {
    return modelRange(
      model,
      line,
      column,
      pending.endLine ?? line,
      pending.endColumn ?? column + 1,
    );
  }

  const wordAtColumn = model.getWordAtPosition({ lineNumber: line, column });
  if (wordAtColumn) {
    return modelRange(
      model,
      line,
      wordAtColumn.startColumn,
      line,
      wordAtColumn.endColumn,
    );
  }

  const lineContent = model.getLineContent(line);
  const firstTextIndex = lineContent.search(/\S/);
  if (firstTextIndex >= 0) {
    return modelRange(
      model,
      line,
      firstTextIndex + 1,
      line,
      model.getLineMaxColumn(line),
    );
  }

  return modelRange(model, line, column, line, column + 1);
}

export function completionRangeAtPosition(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  completion: { rangeStartColumn: number; rangeEndColumn: number },
): Monaco.IRange {
  return modelRange(
    model,
    position.lineNumber,
    completion.rangeStartColumn,
    position.lineNumber,
    completion.rangeEndColumn,
  );
}

export function completionReplacementRangeAtPosition(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  completion: { rangeStartColumn: number; rangeEndColumn: number },
): Monaco.languages.CompletionItemRanges {
  const range = completionRangeAtPosition(model, position, completion);
  return { insert: range, replace: range };
}

export function isSafeIpcProjectId(value: string): boolean {
  return Boolean(value.trim()) && !/[\u0000-\u001f\u007f]/.test(value);
}

export function isSafeIpcRelativePath(
  filePath: string,
  allowedExtensions?: readonly string[],
): boolean {
  const normalized = normalizeRelativePath(filePath).replace(/\/+/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    /^[a-z][a-z0-9+.-]*:/i.test(normalized) ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return false;
  }

  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment === ".git" ||
        segment === "node_modules",
    )
  ) {
    return false;
  }

  if (!allowedExtensions) {
    return true;
  }
  const lowerPath = normalized.toLowerCase();
  return allowedExtensions.some((extension) => lowerPath.endsWith(extension));
}

export function clampSelectionToModel(
  model: Monaco.editor.ITextModel,
  selection: Monaco.Selection,
): Monaco.ISelection {
  const startLine = clampModelLine(model, selection.selectionStartLineNumber);
  const positionLine = clampModelLine(model, selection.positionLineNumber);

  return {
    selectionStartLineNumber: startLine,
    selectionStartColumn: clampModelColumn(
      model,
      startLine,
      selection.selectionStartColumn,
    ),
    positionLineNumber: positionLine,
    positionColumn: clampModelColumn(model, positionLine, selection.positionColumn),
  };
}

export function editorModelMatchesPath(
  editor: Monaco.editor.IStandaloneCodeEditor | null,
  filePath: string,
): boolean {
  const uri = editor?.getModel()?.uri;
  if (!uri) return false;
  // The browser build names documents by URI ("browser://latexdo/…/main.tex"),
  // which has no file-system path to compare.
  if (uri.toString() === filePath || uri.toString(true) === filePath) return true;
  const modelPath = normalizeRelativePath(uri.fsPath);
  const targetPath = normalizeRelativePath(filePath);
  if (modelPath === targetPath) return true;
  // Cloud projects use relative paths ("chapters/intro.tex"), which Monaco
  // turns into file:///chapters/intro.tex, so the model path gains a "/".
  return !targetPath.startsWith("/") && modelPath === `/${targetPath}`;
}

export function getNearbyCitationContext(
  editor: Monaco.editor.IStandaloneCodeEditor | null,
  radius = 1200,
): string {
  if (!editor) return "";

  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return "";

  const start = model.getOffsetAt({
    lineNumber: selection.startLineNumber,
    column: selection.startColumn,
  });
  const end = model.getOffsetAt({
    lineNumber: selection.endLineNumber,
    column: selection.endColumn,
  });
  const text = model.getValue();

  return text.slice(Math.max(0, start - radius), Math.min(text.length, end + radius));
}

export function AppIcon({ className }: { className?: string }) {
  return (
    <img
      src={appIconUrl}
      className={["app-icon", className].filter(Boolean).join(" ")}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

export function pluralCount(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

export function pdfImportStatsSummary(stats: {
  sections: number;
  equations: number;
  figures: number;
  tables: number;
  references: number;
  lowConfidenceMath: number;
}): string {
  const recovered = [
    pluralCount(stats.sections, "heading"),
    pluralCount(stats.equations, "equation"),
    pluralCount(stats.figures, "figure"),
    pluralCount(stats.tables, "table"),
    pluralCount(stats.references, "reference"),
  ].join(", ");
  return stats.lowConfidenceMath
    ? `${recovered}; ${pluralCount(stats.lowConfidenceMath, "formula")} need review`
    : recovered;
}

export function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(false);
  useEffect(() => {
    const query = window.matchMedia;
    if (typeof query !== "function") {
      return;
    }
    const media = query("(prefers-color-scheme: dark)");
    setPrefersDark(media.matches);
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return prefersDark;
}

export function getResolvedAppearance(
  mode: AppearanceMode,
  systemPrefersDark: boolean,
): "light" | "dark" {
  return mode === "auto" ? (systemPrefersDark ? "dark" : "light") : mode;
}

export function StatusBarCursor() {
  const { line, column } = useCursorPosition();
  return (
    <span className="statusbar-item" title="Cursor position">
      Ln {line}, Col {column}
    </span>
  );
}

export const statusbarEngineNames: Record<Engine, string> = {
  pdflatex: "pdfLaTeX",
  xelatex: "XeLaTeX",
  lualatex: "LuaLaTeX",
};

/** An error from the main process, without Electron's transport wrapping. */
export function ipcErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback;
  return error.message
    .replace(/^Error invoking remote method '[^']+': /, "")
    .replace(/^[A-Za-z]*Error: /, "");
}

export function reviewSnapshot(chats: ReviewChat[], items: RebuttalItem[]): string {
  return JSON.stringify({ chats, items });
}
