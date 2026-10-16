import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAiConfig, type AiConfig } from "../features/ai/aiConfig";
import type { AgentContext, EditProposal } from "../features/ai/aiTools";
import type { UiMessage } from "../features/ai/useAiAgent";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  voiceSettingsStorageKey,
} from "../features/voice/voiceSettings";

const agentMock = vi.hoisted(() => ({
  state: {
    messages: [] as UiMessage[],
    isRunning: false,
    status: "",
    send: vi.fn(),
    abort: vi.fn(),
    reset: vi.fn(),
    pendingApproval: null as EditProposal | null,
    resolveApproval: vi.fn(),
    proposeEdit: vi.fn(),
  },
}));

vi.mock("../features/ai/useAiAgent", () => ({
  useAiAgent: vi.fn(() => agentMock.state),
}));

const transcriptionFactory = vi.hoisted(() => ({
  createTranscriptionProvider: vi.fn(),
}));
const cleanupFactory = vi.hoisted(() => ({
  createTranscriptCleanup: vi.fn(),
}));

vi.mock("../features/voice/transcription", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../features/voice/transcription")>();
  return {
    ...actual,
    createTranscriptionProvider: transcriptionFactory.createTranscriptionProvider,
  };
});
vi.mock("../features/voice/transcriptCleanup", () => cleanupFactory);

import { AiSidebar } from "./AiSidebar";

const ctx = {
  projectName: () => "Paper",
  activeFilePath: () => "main.tex",
  listFiles: vi.fn().mockResolvedValue([]),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  documentText: () => "",
  selection: () => ({ text: "", hasSelection: false }),
  applyEdit: vi.fn().mockResolvedValue(undefined),
  compile: vi.fn(),
  runChecks: vi.fn(),
  insertCitation: vi.fn(),
  recommendCitations: vi.fn(),
  requestApproval: vi.fn(),
} satisfies AgentContext;

function cloudConfig(): AiConfig {
  return {
    ...defaultAiConfig,
    provider: "cloud",
    cloud: {
      ...defaultAiConfig.cloud,
      vendor: "openai",
      credentialConfigured: true,
    },
  };
}

class FakeMediaRecorder {
  static isTypeSupported = vi.fn((type: string) => type === "audio/webm;codecs=opus");
  static instances: FakeMediaRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((e: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  constructor(
    public stream: MediaStream,
    _options?: MediaRecorderOptions,
  ) {
    FakeMediaRecorder.instances.push(this);
  }

  start(_timeslice?: number): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    const data = new Blob([new Uint8Array(48)], { type: this.mimeType });
    this.ondataavailable?.({ data } as BlobEvent);
    this.onstop?.();
  }
}

function installCapture(rejectWith?: Error): void {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  FakeMediaRecorder.instances = [];
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(
        () =>
          new Promise<MediaStream>((resolve, reject) => {
            if (rejectWith) {
              reject(rejectWith);
              return;
            }
            resolve({
              getTracks: () => [{ stop: vi.fn() }],
            } as unknown as MediaStream);
          }),
      ),
    },
  });
}

function renderSidebar() {
  return render(
    <AiSidebar
      config={cloudConfig()}
      ctx={ctx}
      isDesktop={true}
      expanded={false}
      onToggleExpanded={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
}

function composer(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(/Ask the AI/i) as HTMLTextAreaElement;
}

function deferredProvider() {
  let settle = (_v: { text: string }) => {};
  const promise = new Promise<{ text: string }>((resolve) => {
    settle = resolve;
  });
  return {
    id: "test",
    transcribe: vi.fn(() => promise),
    settle: (text: string) => settle({ text }),
  };
}

async function startDictation() {
  fireEvent.click(screen.getByRole("button", { name: "Start voice dictation" }));
  await waitFor(() => expect(screen.getByText("Recording")).toBeVisible());
}

describe("AiSidebar voice dictation integration", () => {
  beforeEach(() => {
    agentMock.state.messages = [];
    agentMock.state.isRunning = false;
    agentMock.state.status = "";
    agentMock.state.send.mockReset();
    ctx.applyEdit.mockReset();
    ctx.applyEdit.mockResolvedValue(undefined);
    window.localStorage.clear();
    window.localStorage.setItem(
      voiceSettingsStorageKey,
      JSON.stringify({
        transcriptMode: "verbatim",
        maxDurationMs: 60_000,
        transcriptionModel: "test-transcribe",
      }),
    );
    cleanupFactory.createTranscriptCleanup.mockReturnValue({
      id: "cleanup",
      cleanup: vi.fn(),
    });
    installCapture();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  it("puts the transcript into the composer when recording stops", async () => {
    const provider = {
      id: "test",
      transcribe: vi.fn().mockResolvedValue({ text: "beautiful" }),
    };
    transcriptionFactory.createTranscriptionProvider.mockReturnValue(provider);
    renderSidebar();

    await startDictation();
    fireEvent.click(screen.getByRole("button", { name: "Stop voice dictation" }));

    await waitFor(() => expect(composer().value).toBe("beautiful"));
    expect(
      screen.queryByRole("button", { name: "Insert dictation into editor" }),
    ).not.toBeInTheDocument();
    expect(ctx.applyEdit).not.toHaveBeenCalled();
  });

  it("keeps existing composer text and sends the dictated prompt to chat", async () => {
    transcriptionFactory.createTranscriptionProvider.mockReturnValue({
      id: "test",
      transcribe: vi.fn().mockResolvedValue({ text: "beautiful" }),
    });
    renderSidebar();

    const ta = composer();
    fireEvent.change(ta, { target: { value: "Please summarize" } });
    ta.setSelectionRange(ta.value.length, ta.value.length);

    await startDictation();
    fireEvent.click(screen.getByRole("button", { name: "Stop voice dictation" }));

    await waitFor(() => expect(ta.value).toBe("Please summarize beautiful"));
    fireEvent.keyDown(ta, { key: "Enter" });

    expect(agentMock.state.send).toHaveBeenCalledWith("Please summarize beautiful");
    expect(ta.value).toBe("");
    expect(ctx.applyEdit).not.toHaveBeenCalled();
  });

  it("picks up the clean-up setting saved from Settings", async () => {
    const cleanup = {
      id: "cleanup",
      cleanup: vi.fn().mockResolvedValue("Beautiful."),
    };
    cleanupFactory.createTranscriptCleanup.mockReturnValue(cleanup);
    transcriptionFactory.createTranscriptionProvider.mockReturnValue({
      id: "test",
      transcribe: vi.fn().mockResolvedValue({ text: "beautiful" }),
    });
    renderSidebar();

    expect(screen.queryByRole("button", { name: "Voice settings" })).toBeNull();
    act(() => {
      saveVoiceSettings({ ...loadVoiceSettings(), transcriptMode: "clean" });
    });

    await startDictation();
    fireEvent.click(screen.getByRole("button", { name: "Stop voice dictation" }));

    await waitFor(() => expect(composer().value).toBe("Beautiful."));
    expect(cleanup.cleanup).toHaveBeenCalledWith("beautiful", expect.anything());
  });

  it("can transcribe the composer through explicit OpenAI speech mode", async () => {
    window.localStorage.setItem(
      voiceSettingsStorageKey,
      JSON.stringify({
        sttMode: "openai",
        transcriptMode: "verbatim",
        maxDurationMs: 60_000,
        transcriptionModel: "whisper-1",
        cloudTranscriptionModel: "gpt-transcribe",
      }),
    );
    transcriptionFactory.createTranscriptionProvider.mockReturnValue({
      id: "openai-speech",
      transcribe: vi.fn().mockResolvedValue({ text: "from cloud" }),
    });
    renderSidebar();

    expect(transcriptionFactory.createTranscriptionProvider).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mode: "openai",
        model: "gpt-transcribe",
      }),
    );

    await startDictation();
    fireEvent.click(screen.getByRole("button", { name: "Stop voice dictation" }));

    await waitFor(() => expect(composer().value).toBe("from cloud"));
  });

  it("leaves existing text untouched when microphone permission is denied", async () => {
    installCapture(new DOMException("denied", "NotAllowedError"));
    transcriptionFactory.createTranscriptionProvider.mockReturnValue({
      id: "test",
      transcribe: vi.fn(),
    });
    renderSidebar();

    const ta = composer();
    fireEvent.change(ta, { target: { value: "Keep this" } });

    fireEvent.click(screen.getByRole("button", { name: "Start voice dictation" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Start voice dictation" }),
      ).toHaveAttribute("title", "Try voice dictation again"),
    );
    expect(ta.value).toBe("Keep this");
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Microphone access was denied/i,
    );
  });

  it("shows transcription failures instead of silently leaving the composer empty", async () => {
    transcriptionFactory.createTranscriptionProvider.mockReturnValue({
      id: "test",
      transcribe: vi.fn().mockRejectedValue(new Error("speech server missing")),
    });
    renderSidebar();

    await startDictation();
    fireEvent.click(screen.getByRole("button", { name: "Stop voice dictation" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Voice transcription failed/i,
      ),
    );
    expect(composer().value).toBe("");
  });

  it("never inserts a stale transcript when the user cancels during transcription", async () => {
    const provider = deferredProvider();
    transcriptionFactory.createTranscriptionProvider.mockReturnValue(provider);
    renderSidebar();

    await startDictation();
    fireEvent.click(screen.getByRole("button", { name: "Stop voice dictation" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Transcribing…" })).toBeDisabled(),
    );

    // The provider is still in flight: the user bails out.
    fireEvent.click(screen.getByRole("button", { name: "Cancel voice dictation" }));

    await act(async () => {
      await Promise.resolve();
      provider.settle("should never appear");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(composer().value).toBe("");
  });

  it("offers to install local speech from the mic, then starts recording", async () => {
    const provider = {
      id: "test",
      transcribe: vi.fn().mockResolvedValue({ text: "x" }),
    };
    transcriptionFactory.createTranscriptionProvider.mockReturnValue(provider);
    let installed = false;
    let progress: ((p: unknown) => void) | null = null;
    vi.stubGlobal("aiApi", {
      getSpeechRuntimeStatus: vi.fn(async () => ({
        installed,
        downloadBytes: 149_180_165,
      })),
      subscribeSpeechInstall: vi.fn((cb: (p: unknown) => void) => {
        progress = cb;
        return () => {
          progress = null;
        };
      }),
      installSpeechRuntime: vi.fn(async () => {
        progress?.({
          stage: "downloading-model",
          receivedBytes: 74_000_000,
          totalBytes: 149_180_165,
          done: false,
          message: "Downloading speech model",
        });
        installed = true;
        return { ok: true };
      }),
    });
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Start voice dictation" }));
    const install = await screen.findByRole("button", {
      name: /Install local speech \(149 MB\)/,
    });
    expect(screen.queryByText("Recording")).not.toBeInTheDocument();

    fireEvent.click(install);
    await waitFor(() => expect(screen.getByText("Recording")).toBeVisible());
    expect(
      screen.queryByRole("button", { name: /Install local speech/ }),
    ).not.toBeInTheDocument();
  });

  it("switches dictation to OpenAI speech from the install prompt", async () => {
    vi.stubGlobal("aiApi", {
      getSpeechRuntimeStatus: vi.fn(async () => ({
        installed: false,
        downloadBytes: 1,
      })),
    });
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Start voice dictation" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use OpenAI instead" }));
    expect(
      JSON.parse(window.localStorage.getItem(voiceSettingsStorageKey)!),
    ).toMatchObject({ sttMode: "openai" });
  });
});
