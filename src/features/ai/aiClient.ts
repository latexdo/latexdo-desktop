// Renderer transport. Routes a single generation step to the right place:
//   - cloud   -> direct fetch from the renderer (works in browser + desktop)
//   - local   -> Electron main via IPC (node-llama-cpp); desktop only
//   - ollama  -> Electron main via IPC (avoids mixed-content on hosted builds)
//
// Also exposes model management (list/download) which is desktop-only.

import type {
  AiSystemCapabilities,
  DownloadProgress,
  GenerateRequest,
  GenerationStep,
  ImportedModelManifest,
  ModelStatus,
  SetupRuntimeStatus,
  SpeechInstallProgress,
  TexInstallProgress,
  TierAvailability,
} from "./aiTypes";
import type { LatexDoAiTier } from "./product/latexDoAiTiers";
import {
  abortCloudGeneration,
  generateStepCloud,
  type GenerationActivity,
} from "./aiCloud";
import { loadCloudCredential } from "./cloudCredentials";

/** Shape of the `ai` object exposed by preload on window.electronApi. */
export interface AiBridge {
  generateStep(req: GenerateRequest): Promise<GenerationStep>;
  subscribeTokens(
    cb: (payload: {
      requestId: string;
      text: string;
      activity?: GenerationActivity;
    }) => void,
  ): () => void;
  abort(requestId: string): Promise<void>;
  listModels(): Promise<ModelStatus[]>;
  /**
   * Download an official LatexDo AI model. The renderer supplies ONLY the tier
   * id; the main process resolves the trusted URL, filename and integrity
   * checks from its own catalog.
   */
  downloadModel(tierId: string): Promise<{ ok: boolean; error?: string }>;
  subscribeDownload(cb: (p: DownloadProgress) => void): () => void;
  deleteModel(fileName: string): Promise<void>;
  importModel?(): Promise<ImportedModelManifest | null>;
  inspectLocalModel?(fileName: string): Promise<ImportedModelManifest>;
  detectOllama(baseUrl: string): Promise<{ available: boolean; models: string[] }>;
  ensureSpeechServer?(request: { baseUrl?: string; model?: string }): Promise<
    | {
        ok: true;
        baseUrl: string;
        model: string;
        alreadyRunning: boolean;
        bundled: boolean;
      }
    | {
        ok: false;
        code: string;
        error: string;
      }
  >;
  installSpeechRuntime?(): Promise<{ ok: boolean; error?: string }>;
  subscribeSpeechInstall?(cb: (p: SpeechInstallProgress) => void): () => void;
  getSpeechRuntimeStatus?(): Promise<SetupRuntimeStatus>;
  getTexRuntimeStatus?(): Promise<SetupRuntimeStatus>;
  installTexRuntime?(): Promise<{ ok: boolean; error?: string }>;
  subscribeTexInstall?(cb: (p: TexInstallProgress) => void): () => void;
  getSystemCapabilities?(): Promise<AiSystemCapabilities>;
  getTierAvailability?(tierId: LatexDoAiTier): Promise<TierAvailability>;
  /** Main-process OS credential vault. Only the desktop build exposes this. */
  credentialsSupported?(): Promise<boolean>;
  setCredential?(credentialId: string, secret: string): Promise<{ ok: boolean }>;
  getCredential?(credentialId: string): Promise<string | null>;
  hasCredential?(credentialId: string): Promise<boolean>;
  deleteCredential?(credentialId: string): Promise<{ ok: boolean }>;
}

function bridge(): AiBridge | null {
  return (globalThis as { aiApi?: AiBridge }).aiApi ?? null;
}

export function isLocalRuntimeAvailable(): boolean {
  return bridge() !== null;
}

/** Run one generation step, streaming tokens through onToken. */
export async function generateStep(
  req: GenerateRequest,
  onToken: (text: string) => void,
  onActivity: (activity: GenerationActivity) => void = () => {},
): Promise<GenerationStep> {
  if (req.provider === "cloud") {
    // The renderer never carries the secret in persisted state. Desktop builds
    // resolve it from the main-process vault for the duration of this request.
    const apiKey =
      req.options.cloudCredentialId && !req.options.cloudApiKey
        ? ((await loadCloudCredential(req.options.cloudCredentialId)) ?? "")
        : req.options.cloudApiKey;
    if (!apiKey) {
      return {
        type: "error",
        content:
          "The cloud AI API key is not available. Open AI settings and re-enter your API key.",
      };
    }
    return generateStepCloud(
      { ...req, options: { ...req.options, cloudApiKey: apiKey } },
      onToken,
      onActivity,
    );
  }
  const ai = bridge();
  if (!ai) {
    return {
      type: "error",
      content:
        "Local and Ollama models require the LatexDo desktop app. In the browser, choose a cloud provider in AI settings.",
    };
  }
  const unsub = ai.subscribeTokens((payload) => {
    if (payload.requestId !== req.requestId) return;
    if (payload.activity) onActivity(payload.activity);
    else onToken(payload.text);
  });
  try {
    return await ai.generateStep(req);
  } finally {
    unsub();
  }
}

export async function abortGeneration(requestId: string): Promise<void> {
  if (abortCloudGeneration(requestId)) return;
  await bridge()?.abort(requestId);
}

export async function listModels(): Promise<ModelStatus[]> {
  return (await bridge()?.listModels()) ?? [];
}

export async function downloadModel(
  tierId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ai = bridge();
  if (!ai) return { ok: false, error: "Model download requires the desktop app." };
  return ai.downloadModel(tierId);
}

export function subscribeDownload(cb: (p: DownloadProgress) => void): () => void {
  return bridge()?.subscribeDownload(cb) ?? (() => {});
}

export async function installSpeechRuntime(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const ai = bridge();
  if (!ai?.installSpeechRuntime) {
    return { ok: false, error: "Speech support install requires the desktop app." };
  }
  return ai.installSpeechRuntime();
}

export function subscribeSpeechInstall(
  cb: (p: SpeechInstallProgress) => void,
): () => void {
  return bridge()?.subscribeSpeechInstall?.(cb) ?? (() => {});
}

export async function getSpeechRuntimeStatus(): Promise<SetupRuntimeStatus | null> {
  return (await bridge()?.getSpeechRuntimeStatus?.()) ?? null;
}

/** Null when the status cannot be read (browser build or older desktop shell). */
export async function getTexRuntimeStatus(): Promise<SetupRuntimeStatus | null> {
  return (await bridge()?.getTexRuntimeStatus?.()) ?? null;
}

export async function installTexRuntime(): Promise<{ ok: boolean; error?: string }> {
  const ai = bridge();
  if (!ai?.installTexRuntime) {
    return { ok: false, error: "PDF builder install requires the desktop app." };
  }
  return ai.installTexRuntime();
}

export function subscribeTexInstall(cb: (p: TexInstallProgress) => void): () => void {
  return bridge()?.subscribeTexInstall?.(cb) ?? (() => {});
}

export async function detectOllama(
  baseUrl: string,
): Promise<{ available: boolean; models: string[] }> {
  return (await bridge()?.detectOllama(baseUrl)) ?? { available: false, models: [] };
}

export async function getSystemCapabilities(): Promise<AiSystemCapabilities | null> {
  return (await bridge()?.getSystemCapabilities?.()) ?? null;
}

export async function getTierAvailability(
  tierId: LatexDoAiTier,
): Promise<TierAvailability> {
  return (
    (await bridge()?.getTierAvailability?.(tierId)) ?? {
      state: "unsupported",
      reason: "Local AI requires the LatexDo desktop app.",
    }
  );
}

export async function importModel(): Promise<ImportedModelManifest | null> {
  return (await bridge()?.importModel?.()) ?? null;
}

export async function inspectLocalModel(
  fileName: string,
): Promise<ImportedModelManifest | null> {
  return (await bridge()?.inspectLocalModel?.(fileName)) ?? null;
}
