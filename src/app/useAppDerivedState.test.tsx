import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { latexDoAiTiers } from "../features/ai/product/latexDoAiTiers";
import { toolTabIds } from "../features/workspace/toolTabs";
import { installCustomLatexDoAiModels } from "./appShared";
import type { AppCtx15 } from "./appContext";
import { useAppDerivedState } from "./useAppDerivedState";

const GB = 1024 ** 3;
const roomy = {
  totalRamBytes: 64 * GB,
  freeRamBytes: 32 * GB,
  totalStorageBytes: 1000 * GB,
  freeStorageBytes: 500 * GB,
  modelStoragePath: "/models",
  platform: "darwin",
  arch: "arm64",
  cpuCount: 8,
  localAiAvailable: true,
};
const plusTier = latexDoAiTiers.find((tier) => tier.id === "latexdo-ai-plus")!;

function aiConfig(overrides: Record<string, unknown> = {}) {
  return {
    provider: "local",
    selection: { mode: "latexdo", tier: "latexdo-ai-plus" },
    cloud: { providerId: "anthropic", baseUrl: "", model: "" },
    modelId: plusTier.runtime.modelId,
    modelDownloaded: false,
    ollamaModel: "",
    ...overrides,
  };
}

function context(overrides: Record<string, unknown> = {}) {
  const ctx = {
    activeDocument: null,
    activePath: "",
    activePathRef: { current: "" },
    extensionCatalog: { extensions: [{ id: "ext-1", name: "Spell" }] },
    extensionDetailsId: "ext-1",
    aiConfig: aiConfig(),
    aiIsDesktop: true,
    aiSystemCapabilities: roomy,
    aiSystemCapabilitiesState: "ready",
    aiWizardOpen: false,
    closeDocument: vi.fn(),
    closeGitDiffSession: vi.fn(),
    closeKnowledgeGraph: vi.fn(),
    closeWelcomePage: vi.fn(),
    currentBuildVersion: "1.0.0",
    customLatexDoAiModels: [],
    documents: [],
    downloadedLatexDoAiModelFiles: new Set<string>(),
    gitDiffSession: null,
    knowledgeGraphActive: false,
    toolTabActive: false,
    toolTabOpen: {},
    openToolTab: vi.fn(),
    closeToolTab: vi.fn(),
    knowledgeGraphOpen: false,
    latexDoAiDownload: null,
    legalAcceptanceRequired: false,
    localAiProviderMode: "latexdo-ai",
    ollamaModels: [],
    openKnowledgeGraph: vi.fn(),
    setActivePath: vi.fn(),
    setWelcomeOpen: vi.fn(),
    showWelcome: false,
    showWelcomePage: vi.fn(),
    updateAttemptStatus: null,
    updateInfo: null,
    updateProgress: null,
    updatingNow: false,
    welcomeOpen: false,
    ...overrides,
  };
  return ctx;
}

const derive = (overrides: Record<string, unknown> = {}) => {
  const ctx = context(overrides);
  const { result } = renderHook(() => useAppDerivedState(ctx as unknown as AppCtx15));
  return { ctx, state: result.current };
};

afterEach(() => {
  cleanup();
  installCustomLatexDoAiModels([]);
});

describe("update summaries", () => {
  it("describes an available build with commits and a manual-only install", () => {
    const { state } = derive({
      updateInfo: {
        updateAvailable: true,
        latestVersion: "2.0.0",
        currentCommit: "abcdef123456",
        latestCommit: "123456abcdef",
        automaticInstallAvailable: false,
      },
    });
    expect(state.updateBuildSummary).toBe(
      "Current build 1.0.0 (abcdef1). Available build 2.0.0 (123456a).",
    );
    expect(state.updateActionText).toBe("Open update");
  });

  it("prefers the progress version and reports install/up-to-date/unknown states", () => {
    expect(
      derive({
        updateInfo: { updateAvailable: true, latestVersion: null },
        updateProgress: { latestVersion: "3.0.0", status: "checking", percent: 150 },
      }).state,
    ).toMatchObject({
      updateBuildSummary: "Current build 1.0.0. Available build 3.0.0.",
      updateActionText: "Install update",
      updateProgressPercent: 100,
      updateProgressActive: false,
    });
    expect(
      derive({ updateInfo: { updateAvailable: false, latestVersion: "1.0.0" } }).state,
    ).toMatchObject({
      updateBuildSummary: "Current build 1.0.0. You are up to date.",
      updateActionText: "Update manually",
    });
    expect(
      derive({ updateInfo: { updateAvailable: false, error: "offline" } }).state
        .updateBuildSummary,
    ).toBe("Current build 1.0.0.");
    expect(
      derive({ currentBuildVersion: "Unknown", updateInfo: { updateAvailable: false } })
        .state.updateBuildSummary,
    ).toBe("Current build Unknown.");
    expect(derive().state).toMatchObject({
      updateBuildSummary: "Current build 1.0.0.",
      updateProgressLabel: null,
      updateProgressPercent: null,
      updateAttemptLabel: null,
      updateAttemptFailed: false,
      updateAttemptConfirmed: false,
    });
  });

  it.each([
    ["downloading", false, true],
    ["checking", true, true],
    ["done", true, false],
    ["confirmed", true, false],
    ["restart-required", true, false],
  ])("treats progress %s (updating=%s) as active=%s", (status, updatingNow, active) => {
    const { state } = derive({
      updatingNow,
      updateProgress: { status, percent: -5, message: "Working" },
    });
    expect(state.updateProgressActive).toBe(active);
    expect(state.updateProgressPercent).toBe(0);
    expect(state.updateProgressLabel).toBeTruthy();
  });

  it("labels failed and confirmed update attempts", () => {
    expect(
      derive({
        updateAttemptStatus: { status: "failed", currentVersion: "1.0.0", attempts: 0 },
      }).state,
    ).toMatchObject({ updateAttemptFailed: true, updateAttemptConfirmed: false });
    const confirmed = derive({ updateAttemptStatus: { status: "confirmed" } }).state;
    expect(confirmed.updateAttemptConfirmed).toBe(true);
    expect(confirmed.updateAttemptLabel).toContain("verified after restart");
  });
});

describe("local AI availability", () => {
  it("explains why local tiers cannot run", () => {
    const web = derive({ aiIsDesktop: false }).state;
    expect(web.localTierAvailability(plusTier).state).toBe("unsupported");
    expect(web.localTierRuntimeAvailability(plusTier)).toEqual({
      state: "unsupported",
      reason: "Local AI requires the LatexDo desktop app.",
    });
    const loading = derive({
      aiSystemCapabilities: null,
      aiSystemCapabilitiesState: "loading",
    }).state;
    expect(loading.localTierAvailability(plusTier)).toMatchObject({
      reason: "Checking this machine's memory and storage.",
    });
    expect(loading.localTierRuntimeAvailability(plusTier)).toMatchObject({
      reason: "Checking this machine's memory.",
    });
    const failed = derive({
      aiSystemCapabilities: null,
      aiSystemCapabilitiesState: "error",
    }).state;
    expect(failed.localTierAvailability(plusTier)).toMatchObject({
      reason: "LatexDo could not check this machine's memory and storage.",
    });
    expect(failed.localTierRuntimeAvailability(plusTier)).toMatchObject({
      reason: "LatexDo could not check this machine's memory.",
    });
  });

  it("uses runtime availability once the tier is downloaded", () => {
    const notDownloaded = derive().state;
    expect(notDownloaded.selectedLatexDoAiTier?.id).toBe("latexdo-ai-plus");
    expect(notDownloaded.selectedLatexDoAiTierDownloaded).toBe(false);
    expect(notDownloaded.activeAiModelAvailable).toBe(false);
    expect(notDownloaded.activeAiModelValue).toBe(plusTier.runtime.modelId);

    const downloaded = derive({
      aiSystemCapabilities: { ...roomy, freeStorageBytes: 0 },
      downloadedLatexDoAiModelFiles: new Set([plusTier.runtime.fileName]),
    }).state;
    // Storage no longer matters once the model is on disk.
    expect(downloaded.selectedLatexDoAiTierAvailability.state).toBe("available");
    expect(downloaded.activeAiModelAvailable).toBe(true);
    expect(downloaded.activeAiSelectionValue).not.toBe("customize");

    const viaConfig = derive({
      aiConfig: aiConfig({ modelDownloaded: true }),
    }).state;
    expect(viaConfig.selectedLatexDoAiTierDownloaded).toBe(true);
  });

  it("shows download progress for the selected tier", () => {
    const withTotal = derive({
      latexDoAiDownload: {
        modelId: plusTier.runtime.modelId,
        receivedBytes: 1024,
        totalBytes: 2048,
      },
    }).state;
    expect(withTotal.selectedLatexDoAiModelDownloading).toBe(true);
    expect(withTotal.selectedLatexDoAiDownloadLabel).toContain(" / ");
    const noTotal = derive({
      latexDoAiDownload: { modelId: plusTier.runtime.modelId, receivedBytes: 1024 },
    }).state;
    expect(noTotal.selectedLatexDoAiDownloadLabel).not.toContain(" / ");
    expect(
      derive({ latexDoAiDownload: { modelId: "other", receivedBytes: 1 } }).state
        .selectedLatexDoAiDownloadLabel,
    ).toBe("");
  });

  it("falls back to a tier inferred from the model id", () => {
    const unknownTier = derive({
      aiConfig: aiConfig({ selection: { mode: "latexdo", tier: "nope" } }),
    }).state;
    expect(unknownTier.selectedLatexDoAiTier?.id).toBe("latexdo-ai-plus");
    const unknownBoth = derive({
      aiConfig: aiConfig({
        selection: { mode: "latexdo", tier: "nope" },
        modelId: "unknown",
      }),
    }).state;
    expect(unknownBoth.selectedLatexDoAiTier).toBe(latexDoAiTiers[1]);
    const custom = derive({
      aiConfig: aiConfig({ selection: { mode: "custom" }, modelId: "unknown" }),
    }).state;
    expect(custom.selectedLatexDoAiTier).toBe(latexDoAiTiers[1]);
    expect(custom.activeAiSelectionValue).toBe("customize");
  });

  it("reports imported local models and their compatibility", () => {
    installCustomLatexDoAiModels([
      { id: "imported-gguf:a.gguf", name: "A", fileName: "a.gguf", sizeBytes: 10 },
      { id: "imported-gguf:b.gguf", name: "B", fileName: "b.gguf", sizeBytes: 10 },
    ]);
    const records = [
      {
        id: "imported-gguf:b.gguf",
        name: "B",
        fileName: "b.gguf",
        sizeBytes: 10,
        manifest: { compatibility: { state: "unsupported", checkedAt: "now" } },
      },
    ];
    const blocked = derive({
      localAiProviderMode: "local-model",
      customLatexDoAiModels: records,
      aiConfig: aiConfig({
        selection: { mode: "custom" },
        modelId: "imported-gguf:b.gguf",
        modelDownloaded: true,
      }),
    }).state;
    expect(blocked.activeCustomProviderValue).toBe("local-model");
    expect(blocked.selectedImportedLocalModel?.id).toBe("imported-gguf:b.gguf");
    expect(blocked.selectedImportedLocalModelDownloaded).toBe(true);
    expect(blocked.selectedImportedLocalModelCanRun).toBe(false);
    expect(blocked.activeAiModelAvailable).toBe(false);
    expect(blocked.activeAiModelValue).toBe("imported-gguf:b.gguf");

    for (const state of ["compatible", "unknown"]) {
      const ok = derive({
        localAiProviderMode: "local-model",
        customLatexDoAiModels: [
          { ...records[0], manifest: { compatibility: { state, checkedAt: "now" } } },
        ],
        downloadedLatexDoAiModelFiles: new Set(["b.gguf"]),
        aiConfig: aiConfig({ selection: { mode: "custom" }, modelId: "missing" }),
      }).state;
      // Unknown ids fall back to the first imported model.
      expect(ok.selectedImportedLocalModel?.id).toBe("imported-gguf:a.gguf");
      expect(ok.selectedImportedCompatibility).toBeNull();
    }
    const fallback = derive({
      localAiProviderMode: "local-model",
      downloadedLatexDoAiModelFiles: new Set(["a.gguf"]),
      aiConfig: aiConfig({ selection: { mode: "custom" }, modelId: "missing" }),
    }).state;
    expect(fallback.activeAiModelAvailable).toBe(true);
  });

  it("has no imported model when none are installed", () => {
    const state = derive({
      localAiProviderMode: "local-model",
      aiConfig: aiConfig({ selection: { mode: "custom" } }),
    }).state;
    expect(state.selectedImportedLocalModel).toBeNull();
    expect(state.selectedImportedLocalModelDownloaded).toBe(false);
    expect(state.activeAiModelValue).toBe("");
  });
});

describe("provider selection", () => {
  it("handles cloud providers including a custom base URL", () => {
    const cloud = derive({
      aiConfig: aiConfig({
        provider: "cloud",
        cloud: { providerId: "custom", baseUrl: "", model: "m" },
      }),
    }).state;
    expect(cloud.activeCustomProviderValue).toBe("cloud:custom");
    expect(cloud.showCloudBaseUrl).toBe(true);
    expect(cloud.activeAiModelValue).toBe("m");
    expect(cloud.activeAiModelAvailable).toBe(true);
    const unknown = derive({
      aiConfig: aiConfig({
        provider: "cloud",
        cloud: { providerId: "nope", baseUrl: "https://x", model: "" },
      }),
    }).state;
    expect(unknown.cloudModelOptions).toEqual([]);
    expect(unknown.showCloudBaseUrl).toBe(true);
    expect(unknown.activeAiModelAvailable).toBe(false);
    expect(derive().state.showCloudBaseUrl).toBe(false);
  });

  it("handles ollama and disabled AI", () => {
    const ollama = derive({
      ollamaModels: ["llama"],
      aiConfig: aiConfig({ provider: "ollama", ollamaModel: "llama" }),
    }).state;
    expect(ollama.activeCustomProviderValue).toBe("ollama");
    expect(ollama.activeAiModelValue).toBe("llama");
    expect(ollama.activeAiModelAvailable).toBe(true);
    expect(
      derive({ aiConfig: aiConfig({ provider: "ollama", ollamaModel: "" }) }).state
        .activeAiModelAvailable,
    ).toBe(false);
    const off = derive({ aiConfig: aiConfig({ provider: "off" }) }).state;
    expect(off.activeCustomProviderValue).toBe("off");
    expect(off.activeAiModelAvailable).toBe(false);
    expect(
      derive({ aiConfig: aiConfig({ selection: { mode: "custom" } }) }).state
        .activeCustomProviderValue,
    ).toBe("off");
  });

  it("gates on legal acceptance unless the wizard is open", () => {
    expect(
      derive({ legalAcceptanceRequired: true }).state.showLegalAcceptanceGate,
    ).toBe(true);
    expect(
      derive({ legalAcceptanceRequired: true, aiWizardOpen: true }).state
        .showLegalAcceptanceGate,
    ).toBe(false);
  });
});

describe("workspace tabs", () => {
  it("builds welcome, diff, document, graph and tool tabs with handlers", () => {
    const { ctx, state } = derive({
      welcomeOpen: true,
      gitDiffSession: {
        relativePath: "src/main.tex",
        originalLabel: "HEAD",
        modifiedLabel: "Working",
      },
      documents: [
        {
          path: "/p/main.tex",
          name: "main.tex",
          kind: "text",
          content: "a",
          savedContent: "b",
        },
        { path: "/p/fig.png", name: "fig.png", kind: "asset" },
      ],
      activePath: toolTabIds.tikzCanvas,
      toolTabActive: true,
      knowledgeGraphOpen: true,
      toolTabOpen: { tikzCanvas: true, extensionDetails: true },
    });
    expect(state.workspaceTabs.map((tab) => tab.label)).toEqual([
      "Welcome",
      "main.tex (HEAD) ↔ main.tex (Working)",
      "main.tex",
      "fig.png",
      "Knowledge Graph",
      expect.any(String),
      "Extension: Spell",
    ]);
    expect(state.activeWorkspaceTab).toBe(toolTabIds.tikzCanvas);
    const [, diff, doc, asset, , tool, ext] = state.workspaceTabs;
    expect(doc.dirty).toBe(true);
    expect(asset.dirty).toBe(false);
    diff.onSelect();
    expect(ctx.setWelcomeOpen).toHaveBeenCalledWith(false);
    expect(ctx.setActivePath).toHaveBeenCalledWith("");
    doc.onSelect();
    expect(ctx.setActivePath).toHaveBeenLastCalledWith("/p/main.tex");
    expect(ctx.activePathRef.current).toBe("/p/main.tex");
    doc.onClose?.();
    expect(ctx.closeDocument).toHaveBeenCalledWith("/p/main.tex");
    tool.onSelect();
    expect(ctx.openToolTab).toHaveBeenCalledWith(toolTabIds.tikzCanvas);
    ext.onClose?.();
    expect(ctx.closeToolTab).toHaveBeenCalledWith(toolTabIds.extensionDetails);
  });

  it("marks the diff tab active only when nothing else is shown", () => {
    const session = { relativePath: "a.tex", originalLabel: "A", modifiedLabel: "B" };
    expect(derive({ gitDiffSession: session }).state.activeWorkspaceTab).toBe(
      "workspace:diff",
    );
    for (const overrides of [
      { showWelcome: true },
      { activeDocument: {} },
      { knowledgeGraphActive: true },
      { toolTabActive: true },
    ]) {
      expect(
        derive({ gitDiffSession: session, ...overrides }).state.workspaceTabs[0].active,
      ).toBe(false);
    }
  });

  it("names an unknown extension tab and has no active tab by default", () => {
    const state = derive({
      extensionDetailsId: "missing",
      toolTabOpen: { extensionDetails: true },
    }).state;
    expect(state.workspaceTabs[0].label).toBe("Extension: ");
    expect(state.activeWorkspaceTab).toBe("");
  });
});
