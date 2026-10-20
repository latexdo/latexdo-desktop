import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptionError } from "./transcription";
import type { TranscriptionProvider, UseVoiceDictationOptions } from "./types";
import { useVoiceDictation, voiceLevelHistory } from "./useVoiceDictation";

// A controllable recorder so each step of the state machine can be raced.
const recorder = vi.hoisted(() => ({
  instances: [] as Array<{
    options: { onLevel: (l: number) => void; onDurationLimit: () => void };
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  }>,
  start: null as null | (() => Promise<void>),
  stop: null as null | (() => Promise<Blob | null>),
}));

vi.mock("./audioRecorder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./audioRecorder")>();
  class AudioRecorder {
    start = vi.fn(() => (recorder.start ? recorder.start() : Promise.resolve()));
    stop = vi.fn(() =>
      recorder.stop ? recorder.stop() : Promise.resolve(new Blob(["audio"], { type: "audio/webm" })),
    );
    cancel = vi.fn();
    constructor(public options: (typeof recorder.instances)[number]["options"]) {
      recorder.instances.push(this);
    }
  }
  return { ...actual, AudioRecorder };
});

function provider(
  transcribe: TranscriptionProvider["transcribe"] = async () => ({ text: "hello" }),
): TranscriptionProvider {
  return { id: "fake", transcribe: vi.fn(transcribe) };
}

function mount(overrides: Partial<UseVoiceDictationOptions> = {}) {
  const callbacks = {
    onTranscript: vi.fn(),
    onError: vi.fn(),
    onStatusChange: vi.fn(),
  };
  let options: UseVoiceDictationOptions = {
    transcriptMode: "verbatim",
    transcriptionProvider: provider(),
    ...callbacks,
    ...overrides,
  };
  const hook = renderHook(() => useVoiceDictation(options));
  return {
    ...hook,
    ...callbacks,
    setOptions(patch: Partial<UseVoiceDictationOptions>) {
      options = { ...options, ...patch };
      hook.rerender();
    },
  };
}

beforeEach(() => {
  recorder.instances = [];
  recorder.start = null;
  recorder.stop = null;
});

describe("useVoiceDictation state machine edges", () => {
  it("records levels, ticks the timer and ignores stray start/stop/cancel calls", async () => {
    vi.useFakeTimers();
    try {
      const view = mount();
      await act(() => view.result.current.stop());
      act(() => view.result.current.cancel());
      expect(view.onStatusChange).not.toHaveBeenCalled();

      await act(() => view.result.current.start());
      expect(view.result.current.status).toBe("recording");
      await act(() => view.result.current.start());
      expect(recorder.instances).toHaveLength(1);

      const { onLevel } = recorder.instances[0].options;
      act(() => {
        for (let i = 0; i < voiceLevelHistory + 5; i += 1) onLevel(i / 100);
      });
      expect(view.result.current.levels).toHaveLength(voiceLevelHistory);
      expect(view.result.current.levels.at(-1)).toBeCloseTo((voiceLevelHistory + 4) / 100);

      act(() => vi.advanceTimersByTime(1000));
      expect(view.result.current.durationMs).toBeGreaterThanOrEqual(1000);

      act(() => view.result.current.cancel());
      expect(recorder.instances[0].cancel).toHaveBeenCalled();
      // Late levels from a cancelled run are dropped.
      act(() => onLevel(0.5));
      expect(view.result.current.levels).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("transcribes when the recorder hits its duration limit", async () => {
    const view = mount();
    await act(() => view.result.current.start());
    await act(async () => {
      recorder.instances[0].options.onDurationLimit();
    });
    await vi.waitFor(() => expect(view.onTranscript).toHaveBeenCalledWith("hello"));
  });

  it("reset clears an error back to idle", async () => {
    const view = mount({ transcriptionProvider: undefined });
    await act(() => view.result.current.start());
    expect(view.result.current.status).toBe("error");
    expect(view.result.current.error?.code).toBe("unsupported");
    act(() => view.result.current.reset());
    expect(view.result.current.status).toBe("idle");
    expect(view.result.current.error).toBeNull();
  });

  it("fails as unsupported when the provider disappears before transcription", async () => {
    const view = mount();
    await act(() => view.result.current.start());
    view.setOptions({ transcriptionProvider: undefined });
    await act(() => view.result.current.stop());
    expect(view.result.current.error?.code).toBe("unsupported");
  });

  it("maps provider errors and ignores provider cancellations", async () => {
    const coded = mount({
      transcriptionProvider: provider(async () => {
        throw new TranscriptionError("credential-unavailable", "no key");
      }),
    });
    await act(() => coded.result.current.start());
    await act(() => coded.result.current.stop());
    expect(coded.result.current.error).toMatchObject({
      code: "credential-unavailable",
      message: "no key",
    });

    const generic = mount({
      transcriptionProvider: provider(async () => {
        throw new Error("socket");
      }),
    });
    await act(() => generic.result.current.start());
    await act(() => generic.result.current.stop());
    expect(generic.result.current.error).toMatchObject({ code: "transcription-failed" });

    for (const error of [
      new TranscriptionError("cancelled", "stop"),
      new DOMException("aborted", "AbortError"),
    ]) {
      const cancelled = mount({
        transcriptionProvider: provider(async () => {
          throw error;
        }),
      });
      await act(() => cancelled.result.current.start());
      await act(() => cancelled.result.current.stop());
      expect(cancelled.onError).not.toHaveBeenCalled();
      expect(cancelled.result.current.status).toBe("transcribing");
    }
  });

  it("drops cleanup results after cancel and rejects empty cleaned text", async () => {
    let finishCleanup!: (text: string) => void;
    const late = mount({
      transcriptMode: "clean",
      cleanup: {
        id: "test",
        cleanup: () =>
          new Promise<string>((resolve) => {
            finishCleanup = resolve;
          }),
      },
    });
    await act(() => late.result.current.start());
    let stopping!: Promise<void>;
    act(() => {
      stopping = late.result.current.stop();
    });
    await vi.waitFor(() => expect(late.result.current.status).toBe("cleaning"));
    act(() => late.result.current.cancel());
    await act(async () => {
      finishCleanup("Cleaned.");
      await stopping;
    });
    expect(late.onTranscript).not.toHaveBeenCalled();
    expect(late.result.current.status).toBe("idle");

    const empty = mount({ transcriptMode: "clean", cleanup: { id: "test", cleanup: async () => "   " } });
    await act(() => empty.result.current.start());
    await act(() => empty.result.current.stop());
    expect(empty.result.current.error?.code).toBe("empty-recording");
  });

  it("reports recorder stop failures unless the run was cancelled", async () => {
    recorder.stop = () => Promise.reject(new Error("encoder"));
    const view = mount();
    await act(() => view.result.current.start());
    await act(() => view.result.current.stop());
    expect(view.result.current.error?.code).toBe("recording-failed");

    let rejectStop!: (e: Error) => void;
    recorder.stop = () =>
      new Promise((_resolve, reject) => {
        rejectStop = reject;
      });
    const raced = mount();
    await act(() => raced.result.current.start());
    let stopping!: Promise<void>;
    act(() => {
      stopping = raced.result.current.stop();
    });
    act(() => raced.result.current.cancel());
    await act(async () => {
      rejectStop(new Error("late"));
      await stopping;
    });
    expect(raced.onError).not.toHaveBeenCalled();
  });

  it("ignores a microphone grant that arrives after cancel, and permission aborts", async () => {
    let grant!: () => void;
    recorder.start = () =>
      new Promise<void>((resolve) => {
        grant = resolve;
      });
    const view = mount();
    let starting!: Promise<void>;
    act(() => {
      starting = view.result.current.start();
    });
    expect(view.result.current.status).toBe("requesting-permission");
    act(() => view.result.current.cancel());
    expect(recorder.instances[0].cancel).toHaveBeenCalled();
    await act(async () => {
      grant();
      await starting;
    });
    expect(view.result.current.status).toBe("idle");

    recorder.start = () => Promise.reject(new DOMException("aborted", "AbortError"));
    const aborted = mount();
    await act(() => aborted.result.current.start());
    expect(aborted.onError).not.toHaveBeenCalled();

    recorder.start = () => Promise.reject(new Error("no mic"));
    const failed = mount();
    await act(() => failed.result.current.start());
    expect(failed.result.current.error?.code).toBeTruthy();
    expect(failed.onError).toHaveBeenCalled();
  });
});
