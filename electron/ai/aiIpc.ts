// Registers ai:* IPC handlers. Cloud generation runs in the renderer; only
// local (node-llama-cpp) and Ollama go through here, plus model management.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { BrowserWindow, dialog, type IpcMainInvokeEvent } from "electron";
import { ipcMain } from "../trustedIpc.js";
import { stat } from "node:fs/promises";
import { generateLocalStep, unloadLocalModel, type LocalEffort } from "./localLlm.js";
import { detectOllama, generateOllamaStep } from "./ollama.js";
import {
  deleteModelFile,
  downloadModelFile,
  listModelFiles,
  modelExists,
  modelPath,
} from "./models.js";
import {
  evaluateImportedModelCompatibility,
  findImportedModelManifest,
  importGgufModel,
  inspectInstalledGgufModel,
  readImportedModelManifests,
} from "./importedModels.js";
import {
  fastTierAvailability,
  fastTierRuntimeAvailability,
  findLatexDoAiTier,
  findLatexDoAiTierByRuntime,
  type LatexDoAiTier,
  type TierAvailability,
} from "./productTiers.js";
import { getAiSystemCapabilities } from "./systemCapabilities.js";
import {
  deleteCredential,
  getCredential,
  hasCredential,
  isCredentialStorageAvailable,
  setCredential,
} from "./secretStorage.js";
import { ensureBundledSpeechServer } from "../voiceStt.js";
import {
  installSpeechRuntime,
  isSpeechRuntimeInstalled,
  speechDownloadBytes,
} from "../speechRuntime.js";
import { findLatexmk, setBundledTexBinLocator } from "../compiler.js";
import {
  findBundledTexBinDirectory,
  installTexRuntime,
  texDownloadBytes,
} from "../texRuntime.js";

const credentialIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function parseCredentialId(channel: string, value: unknown): string {
  if (typeof value !== "string" || !credentialIdPattern.test(value)) {
    throw new Error(`Invalid credential identifier for ${channel}.`);
  }
  return value;
}

function registerCredentialIpc(): void {
  ipcMain.handle("ai:credentials-supported", async () => {
    return isCredentialStorageAvailable();
  });

  ipcMain.handle(
    "ai:credential-set",
    async (_event, rawId: unknown, rawSecret: unknown) => {
      const id = parseCredentialId("ai:credential-set", rawId);
      if (typeof rawSecret !== "string") {
        throw new Error("Invalid credential payload.");
      }
      await setCredential(id, rawSecret);
      return { ok: true };
    },
  );

  ipcMain.handle("ai:credential-get", async (_event, rawId: unknown) => {
    const id = parseCredentialId("ai:credential-get", rawId);
    // The secret is handed back only for the duration of an in-flight provider
    // request. Nothing about it is logged or persisted by main.
    return getCredential(id);
  });

  ipcMain.handle("ai:credential-has", async (_event, rawId: unknown) => {
    const id = parseCredentialId("ai:credential-has", rawId);
    return hasCredential(id);
  });

  ipcMain.handle("ai:credential-delete", async (_event, rawId: unknown) => {
    const id = parseCredentialId("ai:credential-delete", rawId);
    await deleteCredential(id);
    return { ok: true };
  });
}

interface GenerateRequest {
  requestId: string;
  provider: "local" | "ollama" | "cloud";
  messages: any[];
  tools: any[];
  options: {
    modelId?: string;
    fileName?: string;
    temperature?: number;
    maxTokens?: number;
    effort?: LocalEffort;
    ollamaBaseUrl?: string;
    ollamaModel?: string;
  };
}

const inFlight = new Map<string, AbortController>();
const activeDownloads = new Map<string, AbortController>();
let activeSpeechInstall: AbortController | null = null;
let activeTexInstall: AbortController | null = null;

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function tierAvailabilityMessage(
  tierName: string,
  availability: TierAvailability,
): string | null {
  if (availability.state === "available") return null;
  if (availability.state === "memory-pressure") {
    return `${tierName} is temporarily unavailable. It needs approximately ${formatGb(
      availability.requiredAvailableBytes,
    )} of available memory; currently available: ${formatGb(
      availability.availableBytes,
    )}. Close some applications and try again.`;
  }
  if (availability.state === "storage-pressure") {
    return `${tierName} cannot be downloaded yet. It needs approximately ${formatGb(
      availability.requiredAvailableStorageBytes,
    )} of free storage for the model download; currently available: ${formatGb(
      availability.availableStorageBytes,
    )}. Free up disk space and try again.`;
  }
  if (
    typeof availability.requiredSystemRamBytes === "number" &&
    typeof availability.detectedSystemRamBytes === "number"
  ) {
    return `${tierName} is not available on this computer. Required RAM: ${formatGb(
      availability.requiredSystemRamBytes,
    )}. Detected RAM: ${formatGb(availability.detectedSystemRamBytes)}.`;
  }
  return `${tierName} is not available on this computer. ${availability.reason}`;
}

async function localModelBlockReason(
  modelId: string | undefined,
  fileName: string,
): Promise<string | null> {
  const system = getAiSystemCapabilities();
  const tier = findLatexDoAiTierByRuntime(modelId, fileName);
  if (tier) {
    return tierAvailabilityMessage(
      tier.name,
      fastTierRuntimeAvailability(tier, system),
    );
  }

  const fullPath = modelPath(fileName);
  const info = await stat(fullPath).catch(() => null);
  const manifest = await findImportedModelManifest(fileName);
  const compatibility = info
    ? evaluateImportedModelCompatibility(info.size, system)
    : manifest?.compatibility;
  if (!compatibility) return null;
  if (compatibility.state === "unsupported") {
    return (
      compatibility.reason ??
      "This GGUF model is not compatible with the current local runtime."
    );
  }
  if (compatibility.state === "memory-pressure") {
    const required = compatibility.estimatedRamBytes;
    const available = compatibility.availableRamBytes ?? system.freeRamBytes;
    return required
      ? `This GGUF model is temporarily unavailable. Estimated memory: ${formatGb(
          required,
        )}. Currently available: ${formatGb(available)}.`
      : `This GGUF model is temporarily unavailable. Currently available: ${formatGb(
          available,
        )}.`;
  }
  return null;
}

export function registerAiIpc(): void {
  ipcMain.handle(
    "ai:generate-step",
    async (event: IpcMainInvokeEvent, req: GenerateRequest) => {
      const controller = new AbortController();
      inFlight.set(req.requestId, controller);
      const onToken = (text: string) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("ai:token", { requestId: req.requestId, text });
        }
      };
      const onActivity = (activity: "thinking") => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("ai:token", {
            requestId: req.requestId,
            text: "",
            activity,
          });
        }
      };
      try {
        if (req.provider === "ollama") {
          return await generateOllamaStep(
            req.options.ollamaBaseUrl ?? "http://127.0.0.1:11434",
            req.options.ollamaModel ?? "qwen2.5-coder:3b",
            req.messages,
            req.tools,
            onToken,
            controller.signal,
            { maxTokens: req.options.maxTokens, onActivity },
          );
        }
        if (req.provider === "local") {
          if (!req.options.fileName) {
            return { type: "error", content: "No local model selected." };
          }
          const blocked = await localModelBlockReason(
            req.options.modelId,
            req.options.fileName,
          );
          if (blocked) {
            return { type: "error", content: blocked };
          }
          return await generateLocalStep(
            req.messages,
            {
              fileName: req.options.fileName,
              temperature: req.options.temperature,
              maxTokens: req.options.maxTokens,
              effort: req.options.effort,
            },
            onToken,
            controller.signal,
            Array.isArray(req.tools) ? req.tools : [],
            onActivity,
          );
        }
        return {
          type: "error",
          content: "Cloud generation is handled in the renderer, not main.",
        };
      } finally {
        inFlight.delete(req.requestId);
      }
    },
  );

  ipcMain.handle("ai:abort", async (_event, requestId: string) => {
    inFlight.get(requestId)?.abort();
    inFlight.delete(requestId);
  });

  ipcMain.handle("ai:list-models", async () => {
    const files = await listModelFiles();
    const manifests = new Map(
      (await readImportedModelManifests()).map((manifest) => [
        manifest.fileName,
        manifest,
      ]),
    );
    return files.map((f) => ({
      id: f.fileName,
      fileName: f.fileName,
      downloaded: true,
      path: f.path,
      sizeBytes: f.sizeBytes,
      manifest: manifests.get(f.fileName),
    }));
  });

  ipcMain.handle(
    "ai:download-model",
    async (event: IpcMainInvokeEvent, rawTierId: unknown) => {
      if (typeof rawTierId !== "string" || rawTierId.trim() === "") {
        return { ok: false, error: "Invalid model id." };
      }
      const tierId = rawTierId.trim();
      // Official model downloads are locked to the trusted catalog: the renderer
      // only picks a tier id, and the main process resolves the URL, filename,
      // expected size, and optional SHA-256. Renderer-provided URLs and
      // filenames are never trusted.
      const tier = findLatexDoAiTier(tierId);
      if (!tier) {
        return { ok: false, error: "This model is not part of the LatexDo catalog." };
      }
      const { modelId, fileName, downloadUrl, expectedSizeRangeBytes, expectedSha256 } =
        tier.runtime;
      if (activeDownloads.has(tierId)) {
        return { ok: false, error: "This model is already downloading." };
      }
      if (await modelExists(fileName)) return { ok: true };
      const blocked = tierAvailabilityMessage(
        tier.name,
        fastTierAvailability(tier, getAiSystemCapabilities()),
      );
      if (blocked) return { ok: false, error: blocked };

      const controller = new AbortController();
      activeDownloads.set(tierId, controller);
      const sendProgress = (progress: {
        receivedBytes: number;
        totalBytes: number | null;
        done: boolean;
        error?: string;
        stage?: "downloading" | "verifying";
      }) => {
        if (event.sender.isDestroyed()) return;
        event.sender.send("ai:download-progress", { modelId, ...progress });
      };
      try {
        await downloadModelFile(
          downloadUrl,
          fileName,
          {
            signal: controller.signal,
            onProgress: (received, total) =>
              sendProgress({
                receivedBytes: received,
                totalBytes: total,
                done: false,
                stage: "downloading",
              }),
            onStage: (stage) =>
              sendProgress({
                receivedBytes: 0,
                totalBytes: null,
                done: false,
                stage,
              }),
          },
          { sizeRangeBytes: expectedSizeRangeBytes, expectedSha256 },
        );
        sendProgress({ receivedBytes: 0, totalBytes: null, done: true });
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendProgress({
          receivedBytes: 0,
          totalBytes: null,
          done: true,
          error: message,
        });
        return { ok: false, error: message };
      } finally {
        activeDownloads.delete(tierId);
      }
    },
  );

  ipcMain.handle("ai:cancel-download", async (_event, modelId: string) => {
    activeDownloads.get(modelId)?.abort();
    activeDownloads.delete(modelId);
  });

  ipcMain.handle("ai:delete-model", async (_event, fileName: string) => {
    // The loaded model keeps its file open; release it first.
    await unloadLocalModel();
    await deleteModelFile(fileName);
  });

  ipcMain.handle("ai:model-path", async (_event, fileName: string) => {
    return (await modelExists(fileName)) ? modelPath(fileName) : null;
  });

  ipcMain.handle("ai:detect-ollama", async (_event, baseUrl: string) => {
    return detectOllama(baseUrl);
  });

  ipcMain.handle("ai:ensure-speech-server", async (_event, request: unknown) => {
    const options =
      request && typeof request === "object" && !Array.isArray(request)
        ? (request as { baseUrl?: unknown; model?: unknown })
        : {};
    return ensureBundledSpeechServer({
      baseUrl: typeof options.baseUrl === "string" ? options.baseUrl : undefined,
      model: typeof options.model === "string" ? options.model : undefined,
    });
  });

  ipcMain.handle("ai:install-speech-runtime", async (event: IpcMainInvokeEvent) => {
    if (activeSpeechInstall) {
      return { ok: false, error: "Speech support is already installing." };
    }
    const controller = new AbortController();
    activeSpeechInstall = controller;
    try {
      await installSpeechRuntime({
        signal: controller.signal,
        onProgress: (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("ai:speech-install-progress", progress);
          }
        },
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!event.sender.isDestroyed()) {
        event.sender.send("ai:speech-install-progress", {
          stage: "ready",
          receivedBytes: 0,
          totalBytes: null,
          done: true,
          error: message,
          message,
        });
      }
      return { ok: false, error: message };
    } finally {
      activeSpeechInstall = null;
    }
  });

  ipcMain.handle("setup:speech-status", async () => ({
    installed: await isSpeechRuntimeInstalled(),
    downloadBytes: speechDownloadBytes(),
  }));

  setBundledTexBinLocator(findBundledTexBinDirectory);

  ipcMain.handle("setup:tex-status", async () => {
    const downloadBytes = texDownloadBytes();
    return {
      installed: Boolean(await findLatexmk()),
      supported: downloadBytes !== null,
      downloadBytes,
    };
  });

  ipcMain.handle("setup:install-tex", async (event: IpcMainInvokeEvent) => {
    if (activeTexInstall) {
      return { ok: false, error: "The PDF builder is already installing." };
    }
    const controller = new AbortController();
    activeTexInstall = controller;
    try {
      await installTexRuntime({
        signal: controller.signal,
        onProgress: (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("setup:tex-install-progress", progress);
          }
        },
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      activeTexInstall = null;
    }
  });

  ipcMain.handle("ai:system-capabilities", async () => {
    return getAiSystemCapabilities();
  });

  ipcMain.handle("ai:tier-availability", async (_event, tierId: LatexDoAiTier) => {
    const tier = findLatexDoAiTier(tierId);
    if (!tier) {
      return {
        state: "unsupported",
        reason: "Unknown LatexDo AI tier.",
      } satisfies TierAvailability;
    }
    return fastTierAvailability(tier, getAiSystemCapabilities());
  });

  ipcMain.handle("ai:inspect-local-model", async (_event, fileName: string) => {
    return inspectInstalledGgufModel(fileName);
  });

  ipcMain.handle("ai:import-model", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const dialogOptions = {
      title: "Import GGUF model",
      properties: ["openFile"],
      filters: [{ name: "GGUF models", extensions: ["gguf"] }],
    } satisfies Electron.OpenDialogOptions;
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) return null;
    return importGgufModel(result.filePaths[0]);
  });

  registerCredentialIpc();
}
