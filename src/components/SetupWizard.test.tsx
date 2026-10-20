import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAiConfig, type AiConfig } from "../features/ai/aiConfig";
import type {
  AiSystemCapabilities,
  DownloadProgress,
  SpeechInstallProgress,
} from "../features/ai/aiTypes";
import { legalPrivacyUrl, legalTermsUrl } from "../features/settings/settings";
import { SetupWizard } from "./SetupWizard";

const aiClientMock = vi.hoisted(() => ({
  detectOllama: vi.fn(),
  importModel: vi.fn(),
  downloadModel: vi.fn(),
  installSpeechRuntime: vi.fn(),
  subscribeDownload: vi.fn(),
  subscribeSpeechInstall: vi.fn(),
  getSpeechRuntimeStatus: vi.fn(),
  getTexRuntimeStatus: vi.fn(),
  installTexRuntime: vi.fn(),
  subscribeTexInstall: vi.fn(),
}));

vi.mock("../features/ai/aiClient", () => ({
  detectOllama: aiClientMock.detectOllama,
  importModel: aiClientMock.importModel,
  downloadModel: aiClientMock.downloadModel,
  installSpeechRuntime: aiClientMock.installSpeechRuntime,
  subscribeDownload: aiClientMock.subscribeDownload,
  subscribeSpeechInstall: aiClientMock.subscribeSpeechInstall,
  getSpeechRuntimeStatus: aiClientMock.getSpeechRuntimeStatus,
  getTexRuntimeStatus: aiClientMock.getTexRuntimeStatus,
  installTexRuntime: aiClientMock.installTexRuntime,
  subscribeTexInstall: aiClientMock.subscribeTexInstall,
}));

type AiConfigOverrides = Omit<Partial<AiConfig>, "cloud" | "profile"> & {
  cloud?: Partial<AiConfig["cloud"]>;
  profile?: Partial<AiConfig["profile"]>;
};

const GB = 1024 ** 3;
const highRamCapabilities: AiSystemCapabilities = {
  totalRamBytes: 32 * GB,
  freeRamBytes: 16 * GB,
  totalStorageBytes: 256 * GB,
  freeStorageBytes: 128 * GB,
  modelStoragePath: "/Users/ada/Library/Application Support/LatexDo/models",
  platform: "darwin",
  arch: "arm64",
  cpuCount: 10,
  localAiAvailable: true,
};
const lowStorageCapabilities: AiSystemCapabilities = {
  ...highRamCapabilities,
  freeStorageBytes: 1 * GB,
};

function makeConfig(overrides: AiConfigOverrides = {}): AiConfig {
  return {
    ...defaultAiConfig,
    ...overrides,
    cloud: {
      ...defaultAiConfig.cloud,
      ...overrides.cloud,
    },
    profile: {
      ...defaultAiConfig.profile,
      ...overrides.profile,
    },
  };
}

function continueSetup() {
  fireEvent.click(screen.getByRole("button", { name: /Continue|Set up workspace/i }));
}

function advanceToModelStep() {
  continueSetup();
  continueSetup();
}

function startSelectedInstall() {
  fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));
}

async function completeReadyStep() {
  expect(await screen.findByText("LatexDo is ready")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Start writing/i }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function openMoreOptions() {
  const toggle = screen.queryByRole("button", { name: "More options" });
  if (toggle?.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
}

function modelChoiceButton(name: string): HTMLButtonElement {
  openMoreOptions();
  return screen.getByRole("radio", {
    name: new RegExp(`^Choose ${escapeRegExp(name)}$`, "i"),
  }) as HTMLButtonElement;
}

describe("SetupWizard", () => {
  function customSetup(isDesktop = true, onImportedModel = vi.fn()) {
    render(<SetupWizard initialConfig={makeConfig()} isDesktop={isDesktop} legalAccepted onApplyTheme={vi.fn()} onComplete={vi.fn()} onImportedModel={onImportedModel} systemCapabilities={highRamCapabilities} />);
    advanceToModelStep();
    openMoreOptions();
    fireEvent.click(screen.getByRole("radio", { name: "Choose Ollama or a model file" }));
  }

  it("refreshes Ollama models and reports unreachable and empty servers", async () => {
    aiClientMock.detectOllama.mockResolvedValueOnce({ available: false, models: [] }).mockResolvedValueOnce({ available: true, models: [] }).mockResolvedValueOnce({ available: true, models: ["qwen:4b"] });
    customSetup();
    fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "http://localhost:11435" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
    expect(await screen.findByText("Ollama is not reachable at this base URL.")).toBeVisible();
    expect(aiClientMock.detectOllama).toHaveBeenLastCalledWith("http://localhost:11435");
    fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
    expect(await screen.findByText("No models found.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
    expect(await screen.findByText("Found 1 model(s).")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "qwen:4b" } });
    expect(screen.getByLabelText("Model")).toHaveValue("qwen:4b");
  });

  it("imports a local GGUF, preserves selection when switching providers, and handles cancellation and errors", async () => {
    const manifest = { fileName: "my_model.gguf", compatibility: { state: "compatible" } };
    const onImportedModel = vi.fn();
    aiClientMock.importModel.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("Invalid model")).mockResolvedValueOnce(manifest);
    customSetup(true, onImportedModel);
    fireEvent.click(screen.getByRole("button", { name: "Model file (.gguf)" }));
    fireEvent.click(screen.getByRole("button", { name: "Import .gguf" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Import .gguf" })).toBeEnabled());
    expect(onImportedModel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import .gguf" }));
    expect(await screen.findByText("Invalid model")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Import .gguf" }));
    await waitFor(() => expect(onImportedModel).toHaveBeenCalledWith(manifest));
    expect(screen.getByText("my model")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Ollama" }));
    fireEvent.click(screen.getByRole("button", { name: "Model file (.gguf)" }));
    expect(screen.getByText("my model")).toBeVisible();
  });

  beforeEach(() => {
    aiClientMock.downloadModel.mockReset();
    aiClientMock.installSpeechRuntime.mockReset();
    aiClientMock.subscribeDownload.mockReset();
    aiClientMock.subscribeSpeechInstall.mockReset();
    aiClientMock.subscribeDownload.mockReturnValue(vi.fn());
    aiClientMock.subscribeSpeechInstall.mockReturnValue(vi.fn());
    aiClientMock.downloadModel.mockResolvedValue({ ok: true });
    aiClientMock.installSpeechRuntime.mockResolvedValue({ ok: true });
    aiClientMock.getSpeechRuntimeStatus.mockReset();
    aiClientMock.getTexRuntimeStatus.mockReset();
    aiClientMock.installTexRuntime.mockReset();
    aiClientMock.subscribeTexInstall.mockReset();
    aiClientMock.getSpeechRuntimeStatus.mockResolvedValue({
      installed: false,
      downloadBytes: 100,
    });
    aiClientMock.getTexRuntimeStatus.mockResolvedValue({
      installed: true,
      supported: true,
      downloadBytes: 200,
    });
    aiClientMock.installTexRuntime.mockResolvedValue({ ok: true });
    aiClientMock.subscribeTexInstall.mockReturnValue(vi.fn());
  });

  it("starts with a LatexDo intro and accepts legal policies before profile setup", () => {
    const onAcceptLegal = vi.fn();
    const onOpenExternal = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig()}
        isDesktop
        legalAccepted={false}
        onAcceptLegal={onAcceptLegal}
        onOpenExternal={onOpenExternal}
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: /set up your latexdo workspace/i }),
    ).toBeVisible();
    expect(screen.getByText("LatexDo Setup")).toBeVisible();
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /skip setup/i })).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: /terms of use/i }));
    expect(onOpenExternal).toHaveBeenCalledWith(legalTermsUrl);
    fireEvent.click(screen.getByRole("link", { name: /privacy policy/i }));
    expect(onOpenExternal).toHaveBeenCalledWith(legalPrivacyUrl);

    fireEvent.click(screen.getByLabelText("Accept Terms of Use and Privacy Policy"));
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    expect(onAcceptLegal).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Make LatexDo yours")).toBeVisible();
  });

  it("allows the legal checkbox to be unchecked and rechecked", () => {
    render(
      <SetupWizard
        initialConfig={makeConfig()}
        isDesktop
        legalAccepted
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    const checkbox = screen.getByLabelText("Accept Terms of Use and Privacy Policy");
    const continueButton = screen.getByRole("button", {
      name: /^continue$/i,
    });

    expect(checkbox).toBeChecked();
    expect(checkbox).not.toBeDisabled();
    expect(continueButton).toBeEnabled();

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(continueButton).toBeDisabled();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(continueButton).toBeEnabled();
  });

  it("shows setup progress as four stages that are not controls", () => {
    render(
      <SetupWizard
        initialConfig={makeConfig()}
        isDesktop
        legalAccepted
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    const progress = screen.getByRole("list", { name: "Setup progress" });
    expect(
      within(progress)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["1Welcome", "2Make it yours", "3Assistant", "4Finish"]);
    expect(within(progress).queryByRole("button")).toBeNull();
    expect(within(progress).getByText("Welcome").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );

    continueSetup();
    expect(within(progress).getByText("Make it yours").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
  });

  it("collects name and theme on a single screen, without a workspace layout", () => {
    render(
      <SetupWizard
        initialConfig={makeConfig()}
        isDesktop
        legalAccepted
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    continueSetup();
    expect(screen.getByLabelText("First name")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Balanced/i })).toBeNull();
    expect(screen.queryByText("Workspace")).toBeNull();
    expect(screen.getByRole("radio", { name: "Forest Light" })).toBeVisible();

    continueSetup();
    expect(screen.getByText("Do you want an AI assistant?")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Back/i }));
    expect(screen.getByText("Make LatexDo yours")).toBeVisible();
  });

  it("walks through onboarding and completes with a cloud provider", async () => {
    const onApplyTheme = vi.fn();
    const onComplete = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "cloud",
          cloud: { credentialConfigured: true },
        })}
        isDesktop={false}
        onApplyTheme={onApplyTheme}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByText("Set up your LatexDo workspace")).toBeVisible();
    continueSetup();

    fireEvent.change(screen.getByLabelText("First name"), {
      target: { value: "Ada" },
    });

    // The same picker as Settings: every theme in light and dark, white first chosen.
    const themes = screen.getByRole("radiogroup", { name: "Application theme" });
    expect(within(themes).getAllByRole("radio")).toHaveLength(8);
    expect(within(themes).getByRole("radio", { name: "Graphite Light" })).toBeChecked();
    fireEvent.click(within(themes).getByRole("radio", { name: "Forest Dark" }));
    expect(onApplyTheme).toHaveBeenCalledWith("forest", "dark");
    continueSetup();

    expect(screen.getByText(/Needs the LatexDo desktop app/i)).toBeVisible();
    startSelectedInstall();
    await completeReadyStep();

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        setupComplete: true,
        userName: "Ada",
        provider: "cloud",
        modelDownloaded: false,
      }),
    );
  });

  it("stays anonymous when the name is left empty", async () => {
    const onComplete = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig({ userName: "Ada" })}
        isDesktop
        onApplyTheme={vi.fn()}
        onComplete={onComplete}
      />,
    );

    continueSetup();
    fireEvent.change(screen.getByDisplayValue("Ada"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Skip setup/i }));
    await completeReadyStep();

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          userName: "",
          profile: expect.objectContaining({
            mode: "anonymous",
            displayName: "",
            includeInContext: false,
          }),
        }),
      ),
    );
  });

  it("saves only a simple local profile from onboarding", async () => {
    const onComplete = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig()}
        isDesktop
        onApplyTheme={vi.fn()}
        onComplete={onComplete}
      />,
    );

    continueSetup();
    expect(screen.queryByRole("button", { name: /^Overleaf$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Zotero$/i })).toBeNull();

    fireEvent.change(screen.getByLabelText("First name"), {
      target: { value: "Ada" },
    });
    fireEvent.change(screen.getByLabelText("Last name"), {
      target: { value: "Lovelace" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Skip setup/i }));
    await completeReadyStep();

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          userName: "Ada Lovelace",
          profile: expect.objectContaining({
            displayName: "Ada Lovelace",
            externalProviders: [],
          }),
        }),
      ),
    );
  });

  it("downloads the selected local model during the install step", async () => {
    let progressHandler: ((progress: DownloadProgress) => void) | null = null;
    const unsubscribe = vi.fn();
    aiClientMock.subscribeDownload.mockImplementation((handler) => {
      progressHandler = handler;
      return unsubscribe;
    });
    aiClientMock.downloadModel.mockImplementation(async (_tierId: string) => {
      progressHandler?.({
        modelId: "qwen2.5-coder-3b",
        receivedBytes: 1024,
        totalBytes: 2048,
        done: false,
      });
      progressHandler?.({
        modelId: "qwen2.5-coder-3b",
        receivedBytes: 2048,
        totalBytes: 2048,
        done: true,
      });
      return { ok: true };
    });
    const onComplete = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "local",
          modelDownloaded: false,
        })}
        isDesktop
        systemCapabilities={highRamCapabilities}
        systemCapabilitiesState="ready"
        onApplyTheme={vi.fn()}
        onComplete={onComplete}
      />,
    );
    advanceToModelStep();

    expect(screen.queryByRole("button", { name: /Download model/i })).toBeNull();
    expect(screen.getByText(/Installs LatexDo AI Plus/)).toBeVisible();
    startSelectedInstall();

    expect(await screen.findByText("LatexDo is ready")).toBeVisible();
    expect(aiClientMock.downloadModel).toHaveBeenCalledWith("latexdo-ai-plus");
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Start writing/i }));
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          setupComplete: true,
          provider: "local",
          modelDownloaded: true,
        }),
      ),
    );
  });

  it("surfaces local model download errors on the install step", async () => {
    aiClientMock.downloadModel.mockResolvedValue({
      ok: false,
      error: "Download failed",
    });
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "local",
          modelDownloaded: false,
        })}
        isDesktop
        systemCapabilities={highRamCapabilities}
        systemCapabilitiesState="ready"
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    advanceToModelStep();

    startSelectedInstall();

    expect(await screen.findByText("Installing your selected setup")).toBeVisible();
    expect(await screen.findByText("Download failed")).toBeVisible();
    expect(screen.getByRole("button", { name: /Retry install/i })).toBeVisible();
  });

  it("shows a resource scanner while local AI capabilities are loading", () => {
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "local",
          modelDownloaded: false,
        })}
        isDesktop
        systemCapabilities={null}
        systemCapabilitiesState="loading"
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    advanceToModelStep();

    expect(
      screen.getByRole("status", { name: /detecting machine resources/i }),
    ).toBeVisible();
    expect(screen.getByText("Detecting this machine")).toBeVisible();
  });

  it("disables local AI tiers that do not fit the current machine", () => {
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "local",
          modelDownloaded: false,
        })}
        isDesktop
        systemCapabilities={{
          ...highRamCapabilities,
          totalRamBytes: 8 * GB,
          freeRamBytes: 3.5 * GB,
        }}
        systemCapabilitiesState="ready"
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    advanceToModelStep();

    expect(modelChoiceButton("LatexDo AI")).not.toBeDisabled();
    expect(modelChoiceButton("LatexDo AI Plus")).toBeDisabled();
    expect(modelChoiceButton("LatexDo Pro Max")).toBeDisabled();
  });

  it("blocks local model install when storage is too low", () => {
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "local",
          modelDownloaded: false,
        })}
        isDesktop
        systemCapabilities={lowStorageCapabilities}
        systemCapabilitiesState="ready"
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    advanceToModelStep();

    openMoreOptions();
    expect(screen.getAllByText(/Not enough disk space: needs/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByRole("button", { name: /Download model/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^Continue$/i })).toBeDisabled();
  });

  it("allows an installed local model to finish setup even when storage is low", async () => {
    const onComplete = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "local",
          modelDownloaded: true,
        })}
        isDesktop
        systemCapabilities={lowStorageCapabilities}
        systemCapabilitiesState="ready"
        onApplyTheme={vi.fn()}
        onComplete={onComplete}
      />,
    );
    advanceToModelStep();

    expect(screen.getByText(/is already installed/)).toBeVisible();
    startSelectedInstall();
    await completeReadyStep();
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "local",
          modelDownloaded: true,
        }),
      ),
    );
    expect(aiClientMock.downloadModel).not.toHaveBeenCalled();
  });

  it("can skip setup before choosing a model", async () => {
    const onComplete = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig({ provider: "off" })}
        isDesktop
        onApplyTheme={vi.fn()}
        onComplete={onComplete}
      />,
    );

    continueSetup();
    fireEvent.click(screen.getByRole("button", { name: /Skip setup/i }));
    await completeReadyStep();
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          setupComplete: true,
          provider: "off",
        }),
      ),
    );
  });

  it("skips setup in the browser build without trying to download a local model", async () => {
    const onComplete = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig({ provider: "local" })}
        isDesktop={false}
        onApplyTheme={vi.fn()}
        onComplete={onComplete}
      />,
    );

    continueSetup();
    fireEvent.click(screen.getByRole("button", { name: /Skip setup/i }));
    await completeReadyStep();

    expect(aiClientMock.downloadModel).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ setupComplete: true, provider: "off" }),
    );
  });

  it("can install dependencies from the AI model step without enabling AI", async () => {
    const onComplete = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "local",
          modelDownloaded: false,
        })}
        isDesktop
        systemCapabilities={highRamCapabilities}
        systemCapabilitiesState="ready"
        onApplyTheme={vi.fn()}
        onComplete={onComplete}
      />,
    );
    advanceToModelStep();

    fireEvent.click(screen.getByRole("radio", { name: "Choose no assistant" }));
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));
    await completeReadyStep();
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          setupComplete: true,
          provider: "off",
          selection: { mode: "off" },
          modelDownloaded: false,
        }),
      ),
    );
  });

  it("installs local speech support with progress before completing desktop setup", async () => {
    let speechHandler: ((progress: SpeechInstallProgress) => void) | null = null;
    let resolveInstall!: (result: { ok: boolean; error?: string }) => void;
    const unsubscribe = vi.fn();
    aiClientMock.subscribeSpeechInstall.mockImplementation((handler) => {
      speechHandler = handler;
      return unsubscribe;
    });
    aiClientMock.installSpeechRuntime.mockImplementation(
      () =>
        new Promise<{ ok: boolean; error?: string }>((resolve) => {
          resolveInstall = resolve;
        }),
    );
    const onComplete = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig({ provider: "off" })}
        isDesktop
        onApplyTheme={vi.fn()}
        onComplete={onComplete}
      />,
    );
    advanceToModelStep();

    startSelectedInstall();

    expect(screen.getByText("Installing your selected setup")).toBeVisible();
    const speechRow = screen
      .getByText("Local speech-to-text")
      .closest(".ai-wizard-install-row");
    expect(
      screen.queryByRole("button", { name: /Start writing/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Local speech-to-text")).toBeVisible();
    expect(screen.getByText("PDF builder (TeX)")).toBeVisible();
    expect(onComplete).not.toHaveBeenCalled();
    await waitFor(() => expect(speechHandler).not.toBeNull());

    act(() => {
      speechHandler?.({
        stage: "downloading-model",
        receivedBytes: 50,
        totalBytes: 100,
        done: false,
        message: "Downloading speech model",
      });
    });

    expect(screen.getByText("Downloading speech model")).toBeVisible();
    expect(screen.getByText("50 B / 100 B")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Setup progress" })).toHaveAttribute(
      "aria-valuenow",
      "50",
    );

    act(() => {
      resolveInstall({ ok: true });
    });
    expect(await screen.findByText("LatexDo is ready")).toBeVisible();
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Start writing/i }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Local speech-to-text").closest(".ai-wizard-install-row"),
    ).toBe(speechRow);
    expect(within(speechRow as HTMLElement).getByText("Ready")).toBeVisible();
    expect(screen.getByText(/Welcome to LatexDo!/)).toBeVisible();
  });

  it("installs the PDF builder itself when this computer has no TeX", async () => {
    aiClientMock.getSpeechRuntimeStatus.mockResolvedValue({
      installed: true,
      downloadBytes: 100,
    });
    aiClientMock.getTexRuntimeStatus.mockResolvedValue({
      installed: false,
      supported: true,
      downloadBytes: 200,
    });
    render(
      <SetupWizard
        initialConfig={makeConfig({ provider: "off" })}
        isDesktop
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    advanceToModelStep();
    startSelectedInstall();

    expect(await screen.findByText("LatexDo is ready")).toBeVisible();
    expect(aiClientMock.installTexRuntime).toHaveBeenCalledTimes(1);
    expect(screen.getByText("PDF builder is ready.")).toBeVisible();
  });

  it("does not download the PDF builder when TeX is already installed", async () => {
    render(
      <SetupWizard
        initialConfig={makeConfig({ provider: "off" })}
        isDesktop
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    advanceToModelStep();
    startSelectedInstall();

    expect(await screen.findByText("LatexDo is ready")).toBeVisible();
    expect(aiClientMock.installTexRuntime).not.toHaveBeenCalled();
    expect(screen.getByText("Already installed on this computer.")).toBeVisible();
  });

  it("shows the privacy message and a model capability comparison", () => {
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "local",
          modelDownloaded: false,
        })}
        isDesktop
        systemCapabilities={highRamCapabilities}
        systemCapabilitiesState="ready"
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    advanceToModelStep();

    expect(screen.getByText(/nothing is uploaded/i)).toBeVisible();
    expect(
      screen.queryByRole("table", {
        name: /what each latexdo model can do/i,
      }),
    ).not.toBeInTheDocument();
    expect(modelChoiceButton("LatexDo AI Plus")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getAllByText("Recommended")[0]).toBeVisible();
    fireEvent.click(screen.getByText(/Compare what each LatexDo model can do/i));
    expect(
      screen.getByRole("table", {
        name: /what each latexdo model can do/i,
      }),
    ).toBeVisible();
    expect(screen.getAllByText("Inline completion").length).toBeGreaterThan(0);
    expect(screen.getByText("Workspace reasoning")).toBeVisible();
    expect(
      screen.getAllByLabelText("LatexDo Pro Max: included").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("LatexDo AI: not included").length).toBeGreaterThan(
      0,
    );
  });

  it("explains how to unlock tiers that do not fit the machine", () => {
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "local",
          modelDownloaded: false,
        })}
        isDesktop
        systemCapabilities={{
          ...highRamCapabilities,
          totalRamBytes: 8 * GB,
          freeRamBytes: 3.5 * GB,
        }}
        systemCapabilitiesState="ready"
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    advanceToModelStep();

    openMoreOptions();
    expect(
      screen.getAllByText(/Not enough free memory \(RAM\) right now/i)[0],
    ).toBeVisible();
    expect(screen.getAllByText(/Close other apps to free memory/i)[0]).toBeVisible();

    fireEvent.click(modelChoiceButton("LatexDo AI"));
    expect(
      screen.getAllByText(/Not enough free memory|pick a lighter tier/i).length,
    ).toBeGreaterThan(0);
  });

  it("checks memory again while a model is being chosen, and unlocks it once it fits", () => {
    vi.useFakeTimers();
    try {
      const lowMemory = {
        ...highRamCapabilities,
        totalRamBytes: 8 * GB,
        freeRamBytes: 3.5 * GB,
      };
      const onRefresh = vi.fn().mockResolvedValue(null);
      const props = {
        initialConfig: makeConfig({ provider: "local", modelDownloaded: false }),
        isDesktop: true,
        systemCapabilitiesState: "ready" as const,
        onRefreshSystemCapabilities: onRefresh,
        onApplyTheme: vi.fn(),
        onComplete: vi.fn(),
      };
      const { rerender } = render(
        <SetupWizard {...props} systemCapabilities={lowMemory} />,
      );
      expect(onRefresh).not.toHaveBeenCalled();
      advanceToModelStep();
      openMoreOptions();
      const warnings = () => screen.queryAllByText(/Not enough free memory \(RAM\)/i);
      expect(warnings().length).toBeGreaterThan(0);

      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(onRefresh).toHaveBeenCalledTimes(1);
      fireEvent.focus(window);
      expect(onRefresh).toHaveBeenCalledTimes(2);

      // The person closed other apps: the next check finds enough memory.
      rerender(<SetupWizard {...props} systemCapabilities={highRamCapabilities} />);
      expect(warnings()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows provider settings only for the chosen kind of assistant", () => {
    render(
      <SetupWizard
        initialConfig={makeConfig({ provider: "local", modelDownloaded: false })}
        isDesktop
        systemCapabilities={highRamCapabilities}
        systemCapabilitiesState="ready"
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    advanceToModelStep();
    expect(screen.queryByText("API key")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Choose an AI provider" }));
    expect(screen.getByText("API key")).toBeVisible();
    openMoreOptions();
    fireEvent.click(
      screen.getByRole("radio", { name: "Choose Ollama or a model file" }),
    );
    expect(screen.getByRole("button", { name: "Ollama" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByText("API key")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Choose no assistant" }));
    expect(screen.getByRole("radio", { name: "Choose no assistant" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
