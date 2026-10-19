import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiConfigStorageKey } from "../features/ai/aiConfig";
import { localModelCatalog } from "../features/ai/aiModels";
import { cloudProviders } from "../features/ai/cloudProviders";
import { latexDoAiTiers } from "../features/ai/product/latexDoAiTiers";
import type { AiSystemCapabilities, DownloadProgress } from "../features/ai/aiTypes";

const ai = vi.hoisted(() => ({
  detectOllama: vi.fn(),
  downloadModel: vi.fn(),
  getSystemCapabilities: vi.fn(),
  importModel: vi.fn(),
  listModels: vi.fn(),
  subscribeDownload: vi.fn(),
  generateStepCloud: vi.fn(),
  loadCloudCredential: vi.fn(),
  migrateLegacyCloudApiKey: vi.fn(),
  removeCloudCredential: vi.fn(),
  saveCloudCredential: vi.fn(),
}));

vi.mock("../collaboration/CollaborationContext", () => ({
  useCollaborationContext: () => ({ marker: "collaboration" }),
}));
vi.mock("../features/ai/aiClient", () => ({
  detectOllama: ai.detectOllama,
  downloadModel: ai.downloadModel,
  getSystemCapabilities: ai.getSystemCapabilities,
  importModel: ai.importModel,
  listModels: ai.listModels,
  subscribeDownload: ai.subscribeDownload,
}));
vi.mock("../features/ai/aiCloud", () => ({ generateStepCloud: ai.generateStepCloud }));
vi.mock("../features/ai/cloudCredentials", () => ({
  loadCloudCredential: ai.loadCloudCredential,
  migrateLegacyCloudApiKey: ai.migrateLegacyCloudApiKey,
  removeCloudCredential: ai.removeCloudCredential,
  saveCloudCredential: ai.saveCloudCredential,
}));

import { useAppWorkspaceState } from "./useAppWorkspaceState";

const capable: AiSystemCapabilities = {
  localAiAvailable: true,
  totalRamBytes: 1024 ** 4,
  freeRamBytes: 1024 ** 4,
  freeStorageBytes: 1024 ** 4,
} as AiSystemCapabilities;

let progressListener: ((progress: DownloadProgress) => void) | null = null;

function setDesktop(enabled: boolean) {
  if (enabled) (window as { aiApi?: unknown }).aiApi = {};
  else delete (window as { aiApi?: unknown }).aiApi;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  progressListener = null;
  ai.getSystemCapabilities.mockResolvedValue(capable);
  ai.listModels.mockResolvedValue([]);
  ai.migrateLegacyCloudApiKey.mockResolvedValue(null);
  ai.subscribeDownload.mockImplementation((cb: (p: DownloadProgress) => void) => {
    progressListener = cb;
    return () => {
      progressListener = null;
    };
  });
  setDesktop(true);
});
afterEach(() => {
  setDesktop(false);
  delete (window as { latexdo?: unknown }).latexdo;
  vi.restoreAllMocks();
});

async function renderState() {
  const hook = renderHook(() => useAppWorkspaceState());
  await waitFor(() => expect(hook.result.current.aiSystemCapabilitiesState).not.toBe("loading"));
  return hook;
}

describe("workspace basics", () => {
  it("logs status messages, accepts legal policies and exposes collaboration", async () => {
    const { result } = await renderState();
    expect(result.current.collaboration).toEqual({ marker: "collaboration" });
    expect(result.current.legalAcceptanceRequired).toBe(true);
    let blocked = false;
    act(() => {
      blocked = result.current.requireLegalAcceptance();
    });
    expect(blocked).toBe(true);
    expect(result.current.statusMessage).toMatch(/Accept the Terms/);
    act(() => result.current.setStatusMessage((current) => `${current}!`));
    expect(result.current.statusMessage).toMatch(/continue\.!$/);
    act(() => result.current.acceptLegalPolicies());
    expect(result.current.legalAcceptanceRequired).toBe(false);
    act(() => {
      blocked = result.current.requireLegalAcceptance();
    });
    expect(blocked).toBe(false);
  });

  it("migrates a legacy key and tolerates a failing migration", async () => {
    localStorage.setItem(aiConfigStorageKey, '{"legacy":true}');
    ai.migrateLegacyCloudApiKey.mockResolvedValueOnce('{"migrated":true}');
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const first = await renderState();
    await waitFor(() =>
      expect(setItem).toHaveBeenCalledWith(aiConfigStorageKey, '{"migrated":true}'),
    );
    first.unmount();
    ai.migrateLegacyCloudApiKey.mockRejectedValueOnce(new Error("vault"));
    await renderState();
    expect(ai.migrateLegacyCloudApiKey).toHaveBeenCalledTimes(2);
  });

  it("toggles AI access flags and opens AI settings", async () => {
    const { result } = await renderState();
    act(() => result.current.setAiAccess("currentFile" as never, false));
    expect((result.current.aiConfig.access as Record<string, boolean>).currentFile).toBe(false);
    act(() => result.current.openAiSettings());
    expect(result.current.settingsOpen).toBe(true);
    expect(result.current.settingsTab).toBe("ai");
  });

  it("closes tools whose features get disabled and leaves unavailable settings tabs", async () => {
    const { result } = await renderState();
    act(() => {
      result.current.setTableCanvasOpen(true);
      result.current.setNotationManagerOpen(true);
      result.current.setTikzConverterOpen(true);
      result.current.setCitationManagerOpen(true);
    });
    // The converter is a store extension that is not installed.
    expect(result.current.tikzConverterOpen).toBe(false);
    expect(result.current.citationManagerOpen).toBe(true);
    act(() =>
      result.current.setSettings((current) => ({
        ...current,
        tableGeneratorEnabled: false,
        notationManagerEnabled: false,
      })),
    );
    expect(result.current.tableCanvasOpen).toBe(false);
    expect(result.current.notationManagerOpen).toBe(false);
    act(() => result.current.setSettingsTab("tikz"));
    expect(result.current.settingsTab).toBe("editor");
    act(() => result.current.setSettingsTab("citation"));
    expect(result.current.settingsTab).toBe("citation");
  });
});

describe("installed tools", () => {
  it("offers the TikZ converter once its extension is installed and enabled", async () => {
    localStorage.setItem("latexdo.extensions.installed.v1", JSON.stringify(["latexdo.figure-to-tikz"]));
    const { result } = await renderState();
    expect(result.current.extensionToolInstallation.tikzConverter).toBe(true);
    act(() => result.current.setSettings((current) => ({ ...current, tikzConverterEnabled: true })));
    expect(result.current.extensionToolAvailability.tikzConverter).toBe(true);
    act(() => result.current.setTikzConverterOpen(true));
    expect(result.current.tikzConverterOpen).toBe(true);
    act(() => result.current.setSettingsTab("tikz"));
    expect(result.current.settingsTab).toBe("tikz");
  });
});

describe("external links", () => {
  it("prefers openExternalUrl, then openExternal, then the browser", async () => {
    const { result } = await renderState();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const openExternal = vi.fn().mockResolvedValue(undefined);
    (window as { latexdo?: unknown }).latexdo = { openExternalUrl, openExternal };
    act(() => result.current.openExternalLink("https://a.example"));
    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith("https://a.example"));
    expect(openExternal).not.toHaveBeenCalled();

    openExternalUrl.mockRejectedValueOnce(new Error("no"));
    act(() => result.current.openExternalLink("https://b.example"));
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith("https://b.example"));
    expect(open).not.toHaveBeenCalled();

    openExternalUrl.mockRejectedValueOnce(new Error("no"));
    openExternal.mockRejectedValueOnce(new Error("no"));
    act(() => result.current.openExternalLink("https://c.example"));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith("https://c.example", "_blank", "noopener,noreferrer"),
    );

    delete (window as { latexdo?: unknown }).latexdo;
    act(() => result.current.openExternalLink("https://d.example"));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
  });
});

describe("system capabilities and local models", () => {
  it("reports unavailable capabilities outside the desktop app", async () => {
    setDesktop(false);
    const { result } = await renderState();
    expect(result.current.aiIsDesktop).toBe(false);
    expect(result.current.aiSystemCapabilitiesState).toBe("unavailable");
    let value: unknown = "x";
    await act(async () => {
      value = await result.current.refreshAiSystemCapabilities();
    });
    expect(value).toBeNull();
    expect(ai.getSystemCapabilities).not.toHaveBeenCalled();
    await act(() => result.current.importLatexDoAiModel());
    expect(result.current.latexDoAiModelMessage).toMatch(/requires the desktop app/);
    await act(() => result.current.refreshOllamaModels());
    expect(result.current.ollamaModelFetchState).toBe("unavailable");
    expect(result.current.ollamaModelFetchMessage).toMatch(/desktop app/);
  });

  it("marks capabilities unavailable when the runtime returns none", async () => {
    ai.getSystemCapabilities.mockResolvedValue(null);
    const { result } = await renderState();
    expect(result.current.aiSystemCapabilitiesState).toBe("unavailable");
  });

  it("refuses tiers this machine cannot run or download", async () => {
    const tier = latexDoAiTiers[0];
    ai.getSystemCapabilities.mockResolvedValue({ ...capable, localAiAvailable: false });
    const { result } = await renderState();
    await act(() => result.current.downloadLatexDoAiModel(tier));
    expect(result.current.latexDoAiModelMessage).not.toBe("");
    expect(ai.downloadModel).not.toHaveBeenCalled();
  });

  it("refuses a tier without a download URL", async () => {
    ai.getSystemCapabilities.mockResolvedValue(null);
    const { result } = await renderState();
    const tier = { ...latexDoAiTiers[0], runtime: { ...latexDoAiTiers[0].runtime, downloadUrl: "" } };
    await act(() => result.current.downloadLatexDoAiModel(tier));
    expect(ai.getSystemCapabilities).toHaveBeenCalledTimes(2);
    expect(result.current.latexDoAiModelMessage).toBe(
      "This LatexDo AI tier cannot be downloaded.",
    );
  });

  it("downloads a tier with progress, verification and failures", async () => {
    const tier = latexDoAiTiers[0];
    const { result } = await renderState();
    let finish!: (value: { ok: boolean; error?: string }) => void;
    ai.downloadModel.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    let downloading!: Promise<void>;
    act(() => {
      downloading = result.current.downloadLatexDoAiModel(tier);
    });
    await waitFor(() => expect(progressListener).not.toBeNull());
    expect(result.current.latexDoAiDownload).toEqual({
      modelId: tier.runtime.modelId,
      receivedBytes: 0,
      totalBytes: null,
    });
    act(() => {
      progressListener!({ modelId: "other", receivedBytes: 1, totalBytes: 2 } as DownloadProgress);
      progressListener!({
        modelId: tier.runtime.modelId,
        receivedBytes: 5,
        totalBytes: 10,
      } as DownloadProgress);
    });
    expect(result.current.latexDoAiDownload?.receivedBytes).toBe(5);
    act(() =>
      progressListener!({
        modelId: tier.runtime.modelId,
        stage: "verifying",
      } as DownloadProgress),
    );
    expect(result.current.latexDoAiModelMessage).toBe("Verifying downloaded model…");
    act(() =>
      progressListener!({
        modelId: tier.runtime.modelId,
        receivedBytes: 5,
        totalBytes: 10,
        error: "disk",
      } as DownloadProgress),
    );
    expect(result.current.latexDoAiModelMessage).toBe("disk");
    await act(async () => {
      finish({ ok: false });
      await downloading;
    });
    expect(result.current.latexDoAiDownload).toBeNull();
    expect(result.current.latexDoAiModelMessage).toBe("Model download failed.");

    ai.downloadModel.mockResolvedValueOnce({ ok: false, error: "quota" });
    await act(() => result.current.downloadLatexDoAiModel(tier));
    expect(result.current.latexDoAiModelMessage).toBe("quota");

    ai.downloadModel.mockResolvedValueOnce({ ok: true });
    await act(() => result.current.downloadLatexDoAiModel(tier));
    expect(result.current.latexDoAiModelMessage).toBe(`${tier.name} is ready on this machine.`);
    expect(result.current.aiConfig).toMatchObject({
      provider: "local",
      modelId: tier.runtime.modelId,
    });
    expect(result.current.localAiProviderMode).toBe("latexdo-ai");
  });

  it("merges imported models from disk and tracks the selected model's download", async () => {
    const known = localModelCatalog[0];
    const { result } = await renderState();
    ai.listModels.mockResolvedValue([
      { fileName: known.fileName, downloaded: true, sizeBytes: 1 },
      { fileName: "custom-model.gguf", downloaded: true, sizeBytes: 2 },
      { fileName: "partial.gguf", downloaded: false, sizeBytes: 3 },
      { fileName: "notes.bin", downloaded: true, sizeBytes: 4 },
    ]);
    act(() =>
      result.current.setAiConfig((current) => ({
        ...current,
        provider: "local",
        modelId: known.id,
        modelDownloaded: false,
      })),
    );
    await act(async () => {
      result.current.setSettingsTab("ai");
      result.current.setSettingsOpen(true);
    });
    await waitFor(() => expect(result.current.aiConfig.modelDownloaded).toBe(true));
    expect([...result.current.downloadedLatexDoAiModelFiles].sort()).toEqual(
      [known.fileName, "custom-model.gguf"].sort(),
    );
    expect(result.current.customLatexDoAiModels.map((model) => model.fileName)).toContain(
      "custom-model.gguf",
    );
    // An unknown model or another provider leaves the config alone.
    act(() =>
      result.current.setAiConfig((current) => ({ ...current, modelId: "missing-model" })),
    );
    const calls = ai.listModels.mock.calls.length;
    act(() => result.current.setSettingsOpen(false));
    act(() => result.current.setSettingsOpen(true));
    await waitFor(() => expect(ai.listModels.mock.calls.length).toBeGreaterThan(calls));
    expect(result.current.aiConfig.modelId).toBe("missing-model");
  });

  it("imports GGUF models, handling cancel and errors", async () => {
    const { result } = await renderState();
    ai.importModel.mockResolvedValueOnce(null);
    await act(() => result.current.importLatexDoAiModel());
    expect(result.current.importingLatexDoAiModel).toBe(false);
    expect(result.current.latexDoAiModelMessage).toBe("");

    ai.importModel.mockResolvedValueOnce({ fileName: "mine.gguf", sizeBytes: 9 });
    await act(() => result.current.importLatexDoAiModel());
    expect(result.current.latexDoAiModelMessage).toMatch(/was imported as a GGUF model/);
    expect(result.current.localAiProviderMode).toBe("local-model");
    expect(result.current.aiConfig.selection).toMatchObject({
      mode: "custom",
      custom: { kind: "gguf" },
    });
    expect(result.current.customLatexDoAiModels.map((m) => m.fileName)).toContain("mine.gguf");

    ai.importModel.mockRejectedValueOnce(new Error("bad file"));
    await act(() => result.current.importLatexDoAiModel());
    expect(result.current.latexDoAiModelMessage).toBe("bad file");
    ai.importModel.mockRejectedValueOnce("odd");
    await act(() => result.current.importLatexDoAiModel());
    expect(result.current.latexDoAiModelMessage).toBe("odd");
  });

  it("remembers an imported model by file size and replaces a duplicate", async () => {
    const { result } = await renderState();
    act(() => {
      result.current.rememberImportedLatexDoAiModel({
        fileName: "dup.gguf",
        sizeBytes: 1,
        fileSizeBytes: 5,
      } as never);
    });
    act(() => {
      result.current.rememberImportedLatexDoAiModel({ fileName: "dup.gguf", sizeBytes: 7 } as never);
    });
    const dups = result.current.customLatexDoAiModels.filter((m) => m.fileName === "dup.gguf");
    expect(dups).toHaveLength(1);
    expect(dups[0].sizeBytes).toBe(7);
  });
});

describe("cloud providers", () => {
  it("selects a provider preset and ignores unknown ids", async () => {
    const { result } = await renderState();
    const before = result.current.aiConfig;
    act(() => result.current.selectCloudAiProvider("no-such-provider"));
    expect(result.current.aiConfig).toBe(before);
    const preset = cloudProviders[0];
    act(() => result.current.selectCloudAiProvider(preset.id));
    expect(result.current.aiConfig.provider).toBe("cloud");
    expect(result.current.aiConfig.cloud.providerId).toBe(preset.id);
    expect(result.current.aiConfig.selection).toMatchObject({
      mode: "custom",
      custom: { kind: "cloud", providerId: preset.id },
    });
    const noDefault = cloudProviders.find((provider) => !provider.defaultModel);
    if (noDefault) {
      act(() => result.current.selectCloudAiProvider(noDefault.id));
      expect(result.current.aiConfig.cloud.providerId).toBe(noDefault.id);
    }
  });

  it("patches the cloud config, syncing a cloud selection only", async () => {
    const { result } = await renderState();
    act(() =>
      result.current.setAiConfig((current) => ({
        ...current,
        selection: { mode: "latexdo", tier: latexDoAiTiers[0].id } as never,
      })),
    );
    act(() => result.current.patchCloudConfig({ model: "m1" }));
    expect(result.current.aiConfig.cloud.model).toBe("m1");
    expect(result.current.aiConfig.selection.mode).toBe("latexdo");
    act(() => result.current.selectCloudAiProvider(cloudProviders[0].id));
    act(() => result.current.patchCloudConfig({ model: "m2" }));
    expect(result.current.aiConfig.selection).toMatchObject({ custom: { model: "m2" } });
    act(() =>
      result.current.patchCloudConfig({ providerId: "p", baseUrl: "https://x", model: "m3" }),
    );
    expect(result.current.aiConfig.selection).toMatchObject({
      custom: { providerId: "p", baseUrl: "https://x", model: "m3" },
    });
    act(() => result.current.patchCloudConfig({ credentialConfigured: true }));
    expect(result.current.aiConfig.selection).toMatchObject({
      custom: { providerId: "p", baseUrl: "https://x", model: "m3" },
    });
  });

  it("tests the connection: missing key, errors and success", async () => {
    const { result } = await renderState();
    ai.loadCloudCredential.mockResolvedValueOnce(null);
    await act(() => result.current.testCloudConnection());
    expect(result.current.cloudConnectionState).toBe("error");
    expect(result.current.cloudConnectionMessage).toMatch(/No API key stored/);

    ai.loadCloudCredential.mockResolvedValue("key");
    ai.generateStepCloud.mockImplementationOnce(async (_request: unknown, onToken: () => void) => {
      onToken();
      return { type: "error", content: "401" };
    });
    await act(() => result.current.testCloudConnection());
    expect(result.current.cloudConnectionState).toBe("error");
    expect(result.current.cloudConnectionMessage).toBe("401");

    ai.generateStepCloud.mockResolvedValueOnce({ type: "text", content: "  ok  " });
    await act(() => result.current.testCloudConnection());
    expect(result.current.cloudConnectionState).toBe("ok");
    expect(result.current.cloudConnectionMessage).toBe("ok");
    ai.generateStepCloud.mockResolvedValueOnce({ type: "text", content: "   " });
    await act(() => result.current.testCloudConnection());
    expect(result.current.cloudConnectionMessage).toBe("Connected.");
  });

  it("saves and clears the settings key", async () => {
    const { result } = await renderState();
    await act(() => result.current.saveSettingsCloudKey());
    expect(ai.saveCloudCredential).not.toHaveBeenCalled();
    act(() => result.current.setSettingsCloudKey("  secret "));
    ai.saveCloudCredential.mockResolvedValueOnce(false);
    await act(() => result.current.saveSettingsCloudKey());
    expect(result.current.settingsCloudKeyError).toMatch(/unavailable/);
    expect(result.current.settingsCloudKey).toBe("  secret ");
    ai.saveCloudCredential.mockResolvedValueOnce(true);
    await act(() => result.current.saveSettingsCloudKey());
    expect(ai.saveCloudCredential).toHaveBeenLastCalledWith(expect.any(String), "secret");
    expect(result.current.settingsCloudKey).toBe("");
    expect(result.current.aiConfig.cloud.credentialConfigured).toBe(true);
    await act(() => result.current.clearSettingsCloudKey());
    expect(ai.removeCloudCredential).toHaveBeenCalled();
    expect(result.current.aiConfig.cloud.credentialConfigured).toBe(false);
  });
});

describe("Ollama", () => {
  it("loads models when the Ollama settings are open", async () => {
    const { result } = await renderState();
    ai.detectOllama.mockResolvedValueOnce({ available: false, models: [] });
    await act(() => result.current.refreshOllamaModels());
    expect(result.current.ollamaModelFetchState).toBe("unavailable");
    expect(result.current.ollamaModelFetchMessage).toMatch(/not reachable/);
    ai.detectOllama.mockResolvedValueOnce({ available: true, models: [] });
    await act(() => result.current.refreshOllamaModels());
    expect(result.current.ollamaModelFetchMessage).toBe("No installed Ollama models were returned.");
    ai.detectOllama.mockResolvedValueOnce({ available: true, models: ["a"] });
    await act(() => result.current.refreshOllamaModels());
    expect(result.current.ollamaModelFetchMessage).toBe("Found 1 installed model.");
    ai.detectOllama.mockResolvedValue({ available: true, models: ["a", "b"] });
    act(() => {
      result.current.setAiConfig((current) => ({ ...current, provider: "ollama" }));
      result.current.setSettingsTab("ai");
      result.current.setSettingsOpen(true);
    });
    await waitFor(() =>
      expect(result.current.ollamaModelFetchMessage).toBe("Found 2 installed models."),
    );
    expect(result.current.ollamaModels).toEqual(["a", "b"]);
  });
});

describe("AI chat tabs", () => {
  it("creates, closes and replaces the last chat", async () => {
    const { result } = await renderState();
    const firstId = result.current.aiChats[0].id;
    const click = (target: EventTarget) => {
      const event = {
        target,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLElement>;
      act(() => result.current.handleAiSidebarClickCapture(event));
      return event;
    };
    // Clicks elsewhere or on a non-element are ignored.
    const other = document.createElement("button");
    expect(click(other).preventDefault).not.toHaveBeenCalled();
    expect(click(window).preventDefault).not.toHaveBeenCalled();
    const newChat = document.createElement("button");
    newChat.title = "New chat";
    const icon = document.createElement("span");
    newChat.append(icon);
    expect(click(icon).preventDefault).toHaveBeenCalled();
    expect(result.current.aiChats).toHaveLength(2);
    const secondId = result.current.aiChats[1].id;
    expect(result.current.activeAiChatId).toBe(secondId);

    act(() => result.current.closeAiChat("missing"));
    expect(result.current.aiChats).toHaveLength(2);
    // Closing an inactive chat keeps the active one.
    act(() => result.current.closeAiChat(firstId));
    expect(result.current.activeAiChatId).toBe(secondId);
    // Closing the only chat replaces it.
    act(() => result.current.closeAiChat(secondId));
    expect(result.current.aiChats).toHaveLength(1);
    expect(result.current.aiChats[0].id).not.toBe(secondId);
    expect(result.current.activeAiChatId).toBe(result.current.aiChats[0].id);

    // Closing the active last chat of several selects its neighbour.
    click(icon);
    const [a, b] = result.current.aiChats;
    act(() => result.current.closeAiChat(b.id));
    expect(result.current.activeAiChatId).toBe(a.id);
    // An active id no longer in the list is persisted as the first chat.
    act(() => result.current.setActiveAiChatId("gone"));
    expect(result.current.activeAiChatId).toBe("gone");
  });
});
