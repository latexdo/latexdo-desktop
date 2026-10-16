import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type {
  VoiceDictationController,
  VoiceDictationError,
  VoiceDictationStatus,
} from "./types";
import { useVoiceDictation } from "./useVoiceDictation";

type HookResult = { current: VoiceDictationController };

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

function fakeStream(track: { stop: ReturnType<typeof vi.fn> }): MediaStream {
  return { getTracks: () => [track] } as unknown as MediaStream;
}

function installCapture(rejectWith?: Error): {
  track: { stop: ReturnType<typeof vi.fn> };
} {
  const track = { stop: vi.fn() };
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  FakeMediaRecorder.instances = [];
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(
        () =>
          new Promise<MediaStream>((resolve, reject) => {
            if (rejectWith) reject(rejectWith);
            else resolve(fakeStream(track));
          }),
      ),
    },
  });
  return { track };
}

function deferredTranscriber() {
  let settle = (_v: { text: string }) => {};
  const promise = new Promise<{ text: string }>((resolve) => {
    settle = resolve;
  });
  const transcribe = vi.fn(() => promise);
  return {
    id: "test-deferred",
    transcribe,
    settle: (text: string) => settle({ text }),
  };
}

function immediateProvider(text = "hello world") {
  const transcribe = vi.fn(async () => ({ text }));
  return { id: "test-immediate", transcribe };
}

interface Hooks {
  statuses: VoiceDictationStatus[];
  onTranscript: Mock<(text: string) => void>;
  onError: Mock<(error: VoiceDictationError) => void>;
}

function mount(overrides: Partial<Parameters<typeof useVoiceDictation>[0]> = {}): {
  result: HookResult;
  hooks: Hooks;
} {
  const hooks: Hooks = {
    statuses: [],
    onTranscript: vi.fn<(text: string) => void>(),
    onError: vi.fn<(error: VoiceDictationError) => void>(),
  };
  const opts: Parameters<typeof useVoiceDictation>[0] = {
    transcriptMode: "verbatim",
    transcriptionProvider: immediateProvider(),
    onTranscript: hooks.onTranscript,
    onError: hooks.onError,
    onStatusChange: (s) => hooks.statuses.push(s),
  };
  const mounted = renderHook(() => useVoiceDictation({ ...opts, ...overrides }));
  return { result: mounted.result as HookResult, hooks };
}

async function startRecording(result: HookResult) {
  await act(async () => {
    await result.current.start();
  });
}

async function stopRecording(result: HookResult) {
  await act(async () => {
    await result.current.stop();
  });
}

describe("useVoiceDictation", () => {
  let track: { stop: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.restoreAllMocks();
    track = installCapture().track;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  });

  it("captures a fresh request id per dictation run", async () => {
    const { result } = mount();
    await startRecording(result);
    expect(result.current.status).toBe("recording");
    await stopRecording(result);
    expect(result.current.status).toBe("idle");
    expect(track.stop).toHaveBeenCalled();
  });

  it("walks the valid record → transcribe → success → idle transitions", async () => {
    const provider = immediateProvider("hello world");
    const { result, hooks } = mount({ transcriptionProvider: provider });

    await startRecording(result);
    expect(result.current.status).toBe("recording");
    expect(hooks.statuses).toContain("requesting-permission");
    expect(hooks.statuses).toContain("recording");

    await stopRecording(result);

    expect(provider.transcribe).toHaveBeenCalledTimes(1);
    expect(hooks.onTranscript).toHaveBeenCalledWith("hello world");
    expect(result.current.status).toBe("idle");
    expect(hooks.statuses).toEqual([
      "requesting-permission",
      "recording",
      "processing",
      "transcribing",
      "success",
      "idle",
    ]);
    // The microphone must always be released after recording.
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("reports permission denial as a structured error without touching text", async () => {
    track = installCapture(new DOMException("denied", "NotAllowedError")).track;
    const { result, hooks } = mount();

    await startRecording(result);

    expect(result.current.status).toBe("error");
    expect(result.current.error?.code).toBe("permission-denied");
    expect(hooks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "permission-denied" }),
    );
    expect(hooks.onTranscript).not.toHaveBeenCalled();
  });

  it("falls over cleanly when no transcription provider is available", async () => {
    const { result } = mount({ transcriptionProvider: null });
    await startRecording(result);
    expect(result.current.status).toBe("error");
    expect(result.current.error?.code).toBe("unsupported");
  });

  it("maps an empty recording to empty-recording", async () => {
    // Make the recorder produce no chunks: MediaRecorder that never emits data.
    const EmptyMediaRecorder = class extends FakeMediaRecorder {
      override stop(): void {
        this.state = "inactive";
        this.onstop?.();
      }
    };
    vi.stubGlobal("MediaRecorder", EmptyMediaRecorder);
    FakeMediaRecorder.instances = [];
    const { result, hooks } = mount();

    await startRecording(result);
    await stopRecording(result);

    expect(result.current.status).toBe("error");
    expect(result.current.error?.code).toBe("empty-recording");
    expect(hooks.onTranscript).not.toHaveBeenCalled();
  });

  it("cancel during recording discards everything and returns to idle", async () => {
    const { result, hooks } = mount();
    await startRecording(result);

    act(() => result.current.cancel());

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(track.stop).toHaveBeenCalled(); // mic released
    expect(hooks.onTranscript).not.toHaveBeenCalled();
  });

  describe("cancellation during transcription (race conditions)", () => {
    it("NEVER inserts a transcript when the user cancels while transcription is in flight", async () => {
      const provider = deferredTranscriber();
      const { result, hooks } = mount({ transcriptionProvider: provider });

      await startRecording(result);

      // Don't await stop(): transcription stays in flight until the provider
      // responds, and this test deliberately cancels before that happens.
      act(() => {
        void result.current.stop();
      });
      await flushAsync();
      expect(result.current.status).toBe("transcribing");

      act(() => result.current.cancel());
      expect(result.current.status).toBe("idle");

      // Provider eventually responds AFTER cancel…
      await act(async () => {
        provider.settle("stale transcript");
      });
      await flushAsync();

      // …but nothing is inserted.
      expect(hooks.onTranscript).not.toHaveBeenCalled();
      expect(result.current.status).toBe("idle");
    });

    it("discards a cancelled result even when the provider wins the race", async () => {
      const provider = deferredTranscriber();
      const { result, hooks } = mount({ transcriptionProvider: provider });

      await startRecording(result);
      act(() => {
        void result.current.stop();
      });
      await flushAsync();
      expect(result.current.status).toBe("transcribing");

      act(() => result.current.cancel());

      act(() => {
        provider.settle("late");
      });
      await flushAsync();

      expect(hooks.onTranscript).not.toHaveBeenCalled();
      expect(result.current.status).toBe("idle");
    });
  });

  it("runs cleanup when clean mode is enabled and falls back to raw transcript on cleanup failure", async () => {
    track = installCapture().track;
    const provider = immediateProvider("so the result is basically the same");
    const cleanup = {
      id: "test",
      cleanup: vi.fn().mockRejectedValueOnce(new Error("model down")),
    };
    const { result, hooks } = mount({
      transcriptMode: "clean",
      transcriptionProvider: provider,
      cleanup,
    });

    await startRecording(result);
    await stopRecording(result);

    expect(cleanup.cleanup).toHaveBeenCalledTimes(1);
    expect(hooks.statuses).toContain("cleaning");
    // Cleanup failure must not fail dictation: raw transcript is inserted.
    expect(hooks.onTranscript).toHaveBeenCalledWith(
      "so the result is basically the same",
    );
    expect(result.current.status).toBe("idle");
  });

  it("skips cleanup in verbatim mode", async () => {
    track = installCapture().track;
    const provider = immediateProvider("raw words");
    const cleanup = { id: "test", cleanup: vi.fn() };
    const { result, hooks } = mount({
      transcriptMode: "verbatim",
      transcriptionProvider: provider,
      cleanup,
    });

    await startRecording(result);
    await stopRecording(result);

    expect(cleanup.cleanup).not.toHaveBeenCalled();
    expect(hooks.onTranscript).toHaveBeenCalledWith("raw words");
  });
});

function flushMicrotasks(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const flushAsync = flushMicrotasks;
