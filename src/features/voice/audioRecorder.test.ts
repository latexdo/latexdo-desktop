import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AudioCaptureError,
  AudioRecorder,
  defaultAudioConstraints,
  isAudioCaptureSupported,
  pickPreferredMimeType,
  stopAllTracks,
  toVoiceDictationError,
} from "./audioRecorder";

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  kind: string;
}

function makeFakeStream(track: FakeTrack): MediaStream {
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
}

function installGetUserMedia(stream: MediaStream | Error): void {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(
        (constraints: MediaStreamConstraints) =>
          new Promise<MediaStream>((resolve, reject) => {
            if (
              stream instanceof Error ||
              typeof (stream as MediaStream)?.getTracks !== "function"
            ) {
              reject(stream);
            } else {
              void constraints;
              resolve(stream);
            }
          }),
      ),
    },
  });
}

function getLastGetUserMedia(): (
  constraints: MediaStreamConstraints,
) => Promise<MediaStream> {
  return (
    navigator.mediaDevices as unknown as {
      getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
    }
  ).getUserMedia;
}

class FakeMediaRecorder {
  static isTypeSupported = vi.fn<(type: string) => boolean>(
    (type: string) => type === "audio/webm;codecs=opus",
  );
  static instances: FakeMediaRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  options?: MediaRecorderOptions;
  startTimeslice?: number;
  ondataavailable: ((e: { data: Blob; size: number }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  constructor(
    public stream: MediaStream,
    options?: MediaRecorderOptions,
  ) {
    this.options = options;
    FakeMediaRecorder.instances.push(this);
  }

  start(timeslice?: number): void {
    this.state = "recording";
    this.startTimeslice = timeslice;
  }

  stop(): void {
    this.state = "inactive";
    this.emitChunk(8);
    this.onstop?.();
  }

  emitChunk(size: number): void {
    const data = new Blob([new Uint8Array(size)], { type: this.mimeType });
    this.ondataavailable?.({ data, size });
  }
}

function installMediaRecorder(useFallback = false): typeof FakeMediaRecorder {
  const Ctor = useFallback
    ? class extends FakeMediaRecorder {
        static override isTypeSupported = vi.fn<(type: string) => boolean>(() => false);
      }
    : FakeMediaRecorder;
  vi.stubGlobal("MediaRecorder", Ctor);
  return Ctor;
}

describe("audioRecorder", () => {
  beforeEach(() => {
    vi.useRealTimers();
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.isTypeSupported = vi.fn(
      (type: string) => type === "audio/webm;codecs=opus",
    );
    installMediaRecorder();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  });

  describe("capability detection", () => {
    it("detects supported capture environments", () => {
      installGetUserMedia(makeFakeStream({ stop: vi.fn(), kind: "audio" }));
      expect(isAudioCaptureSupported()).toBe(true);
    });

    it("reports unsupported when MediaRecorder is missing", () => {
      installGetUserMedia(makeFakeStream({ stop: vi.fn(), kind: "audio" }));
      vi.unstubAllGlobals();
      expect(typeof (globalThis as { MediaRecorder?: unknown }).MediaRecorder).toBe(
        "undefined",
      );
      expect(isAudioCaptureSupported()).toBe(false);
    });

    it("picks the first supported MIME type in preference order", () => {
      const Ctor = class extends FakeMediaRecorder {
        static override isTypeSupported = vi.fn<(type: string) => boolean>(
          (type: string) => type === "audio/webm",
        );
      };
      vi.stubGlobal("MediaRecorder", Ctor);
      expect(pickPreferredMimeType()).toBe("audio/webm");
    });

    it("returns undefined when nothing is supported (runtime fallback)", () => {
      const Ctor = class extends FakeMediaRecorder {
        static override isTypeSupported = vi.fn<(type: string) => boolean>(() => false);
      };
      vi.stubGlobal("MediaRecorder", Ctor);
      expect(pickPreferredMimeType()).toBeUndefined();
    });

    it("uses conservative audio constraints favouring speech clarity", () => {
      expect(defaultAudioConstraints()).toEqual({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
    });
  });

  describe("permission and device mapping", () => {
    it("maps permission denial to a structured error", async () => {
      installGetUserMedia(new DOMException("denied", "NotAllowedError"));
      const recorder = new AudioRecorder();
      await expect(recorder.start()).rejects.toBeInstanceOf(AudioCaptureError);
      await expect(recorder.start()).rejects.toMatchObject({
        code: "permission-denied",
      });
    });

    it("maps missing devices to device-not-found", async () => {
      installGetUserMedia(new DOMException("none", "NotFoundError"));
      const recorder = new AudioRecorder();
      await expect(recorder.start()).rejects.toMatchObject({
        code: "device-not-found",
      });
    });

    it("maps unreadable devices to device-unavailable", async () => {
      installGetUserMedia(new DOMException("in use", "NotReadableError"));
      const recorder = new AudioRecorder();
      await expect(recorder.start()).rejects.toMatchObject({
        code: "device-unavailable",
      });
    });

    it("only requests the microphone after an explicit start()", async () => {
      const track: FakeTrack = { stop: vi.fn(), kind: "audio" };
      installGetUserMedia(makeFakeStream(track));
      const recorder = new AudioRecorder();
      expect(getLastGetUserMedia()).not.toHaveBeenCalled();
      await recorder.start();
      expect(getLastGetUserMedia()).toHaveBeenCalledTimes(1);
    });
  });

  describe("capture lifecycle", () => {
    async function capture() {
      const track: FakeTrack = { stop: vi.fn(), kind: "audio" };
      installGetUserMedia(makeFakeStream(track));
      const recorder = new AudioRecorder();
      await recorder.start();
      return { recorder, track };
    }

    it("records chunks and produces a Blob of the recorded data", async () => {
      const { recorder, track } = await capture();
      expect(recorder.state).toBe("recording");
      const rec = FakeMediaRecorder.instances[0];
      rec.emitChunk(10);
      rec.emitChunk(12);

      const blob = await recorder.stop();

      expect(blob).not.toBeNull();
      expect(blob?.size).toBeGreaterThan(0);
      expect(blob?.type).toBe("audio/webm;codecs=opus");
      expect(recorder.state).toBe("stopped");
      expect(track.stop).toHaveBeenCalledTimes(1);
    });

    it("starts with a timeslice so chunks arrive during long recordings", async () => {
      await capture();
      expect(FakeMediaRecorder.instances[0].startTimeslice).toBe(250);
    });

    it("releases microphone tracks on cancel and discards nothing into a real blob", async () => {
      const { recorder, track } = await capture();
      FakeMediaRecorder.instances[0].emitChunk(5);
      recorder.cancel();
      expect(recorder.state).toBe("stopped");
      expect(track.stop).toHaveBeenCalledTimes(1);
    });

    it("fallback path constructs MediaRecorder without a forced MIME type", async () => {
      installMediaRecorder(true);
      const { recorder } = await capture();
      expect(recorder.state).toBe("recording");
      expect(FakeMediaRecorder.instances[0].options?.mimeType).toBeUndefined();
    });

    it("auto-stops at the duration cap and still returns the recording", async () => {
      vi.useFakeTimers();
      const track: FakeTrack = { stop: vi.fn(), kind: "audio" };
      installGetUserMedia(makeFakeStream(track));
      const onDurationLimit = vi.fn();
      const recorder = new AudioRecorder({
        maxDurationMs: 100,
        onDurationLimit,
      });
      await recorder.start();
      expect(recorder.state).toBe("recording");

      vi.advanceTimersByTime(700);

      expect(onDurationLimit).toHaveBeenCalledTimes(1);
      expect(recorder.state).toBe("stopped");
      const blob = await recorder.stop();
      expect(blob).not.toBeNull();
      expect(track.stop).toHaveBeenCalled();
    });
  });
});

describe("audioRecorder edge cases", () => {
  let track: FakeTrack;

  beforeEach(() => {
    vi.useRealTimers();
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.isTypeSupported = vi.fn(
      (type: string) => type === "audio/webm;codecs=opus",
    );
    installMediaRecorder();
    track = { stop: vi.fn(), kind: "audio" };
    installGetUserMedia(makeFakeStream(track));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  });

  it("converts errors into voice dictation errors", () => {
    const cause = new Error("x");
    expect(
      toVoiceDictationError(new AudioCaptureError("cancelled", "stop", cause)),
    ).toEqual({ code: "cancelled", message: "stop", cause });
    expect(toVoiceDictationError("weird")).toEqual({
      code: "recording-failed",
      message: "Voice recording failed. Your existing text was not changed.",
      cause: "weird",
    });
    expect(toVoiceDictationError(null, "unsupported").code).toBe("unsupported");
  });

  it("has no preferred MIME type without MediaRecorder or isTypeSupported", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(pickPreferredMimeType()).toBeUndefined();
    vi.stubGlobal("MediaRecorder", class {});
    expect(pickPreferredMimeType()).toBeUndefined();
  });

  it.each([
    ["TrackStartError", "device-unavailable"],
    ["OverconstrainedError", "device-unavailable"],
    ["SecurityError", "permission-denied"],
    ["PermissionDeniedError", "permission-denied"],
    ["DevicesNotFoundError", "device-not-found"],
    ["Whatever", "recording-failed"],
  ])("maps %s to %s", async (name, code) => {
    installGetUserMedia(new DOMException("x", name));
    await expect(new AudioRecorder().start()).rejects.toMatchObject({ code });
  });

  it("maps a nameless rejection to recording-failed", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(null) },
    });
    await expect(new AudioRecorder().start()).rejects.toMatchObject({
      code: "recording-failed",
    });
  });

  it("refuses to start where capture is unsupported and ignores a second start", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    await expect(new AudioRecorder().start()).rejects.toMatchObject({
      code: "unsupported",
    });
    installMediaRecorder();
    const recorder = new AudioRecorder();
    await recorder.start();
    await recorder.start();
    expect(getLastGetUserMedia()).toHaveBeenCalledTimes(1);
  });

  it("releases the stream when cancelled during the permission prompt", async () => {
    const recorder = new AudioRecorder();
    const starting = recorder.start();
    recorder.cancel();
    await expect(starting).rejects.toMatchObject({ code: "cancelled" });
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("returns null when nothing was recorded or stop is called before start", async () => {
    const recorder = new AudioRecorder();
    expect(await recorder.stop()).toBeNull();
    await recorder.start();
    const rec = FakeMediaRecorder.instances[0];
    rec.mimeType = " ";
    rec.stop = function () {
      this.state = "inactive";
      this.emitChunk(0);
      this.onstop?.();
    };
    expect(await recorder.stop()).toBeNull();
    expect(await recorder.stop()).toBeNull();
  });

  it("falls back to audio/webm for blobs without a MIME type and shares one stop", async () => {
    const recorder = new AudioRecorder();
    await recorder.start();
    const rec = FakeMediaRecorder.instances[0];
    rec.mimeType = "";
    rec.stop = function () {
      this.state = "inactive";
    };
    const first = recorder.stop();
    const second = recorder.stop();
    rec.emitChunk(4);
    rec.onstop?.();
    const [a, b] = await Promise.all([first, second]);
    expect(b).toBe(a);
    expect(a?.type).toBe("audio/webm");
  });

  it("rejects the pending stop when the recorder errors", async () => {
    const recorder = new AudioRecorder();
    await recorder.start();
    const rec = FakeMediaRecorder.instances[0];
    rec.stop = () => undefined;
    const stopping = recorder.stop();
    rec.onerror?.(new Event("error"));
    await expect(stopping).rejects.toMatchObject({ code: "recording-failed" });
    expect(track.stop).toHaveBeenCalled();
    expect(recorder.state).toBe("stopped");
  });

  it("an error with no pending stop just releases the microphone", async () => {
    const recorder = new AudioRecorder({ maxDurationMs: 1000 });
    await recorder.start();
    FakeMediaRecorder.instances[0].onerror?.(new Event("error"));
    expect(recorder.state).toBe("stopped");
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(await recorder.stop()).toBeNull();
  });

  it("checks the duration cap without stopping early or twice", async () => {
    vi.useFakeTimers();
    const onDurationLimit = vi.fn();
    const recorder = new AudioRecorder({ maxDurationMs: 1200, onDurationLimit });
    await recorder.start();
    vi.advanceTimersByTime(1000);
    expect(onDurationLimit).not.toHaveBeenCalled();
    expect(recorder.durationLimitReachedFlag).toBe(false);
    const rec = FakeMediaRecorder.instances[0];
    rec.state = "inactive";
    vi.advanceTimersByTime(500);
    expect(onDurationLimit).toHaveBeenCalledTimes(1);
    expect(recorder.durationLimitReachedFlag).toBe(true);
    expect(recorder.state).toBe("recording");
    recorder.cancel();
    expect(recorder.state).toBe("recording");
  });

  it("skips the timer check after recording stopped and cancel releases a finished stream", async () => {
    vi.useFakeTimers();
    const recorder = new AudioRecorder({ maxDurationMs: 100 });
    await recorder.start();
    const rec = FakeMediaRecorder.instances[0];
    // Stop without the onstop handler clearing the cap timer.
    rec.onstop = null;
    rec.stop();
    (recorder as unknown as { recorderState: string }).recorderState = "stopped";
    vi.advanceTimersByTime(1000);
    expect(recorder.durationLimitReachedFlag).toBe(false);
    recorder.cancel();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("works without a duration cap callback", async () => {
    vi.useFakeTimers();
    const recorder = new AudioRecorder({ maxDurationMs: 10 });
    await recorder.start();
    vi.advanceTimersByTime(500);
    expect(recorder.durationLimitReachedFlag).toBe(true);
  });

  it("reports microphone levels and closes the audio context", async () => {
    vi.useFakeTimers();
    const close = vi.fn(() => Promise.reject(new Error("closed")));
    const connect = vi.fn();
    class FakeAudioContext {
      createAnalyser() {
        return {
          fftSize: 0,
          getByteTimeDomainData(samples: Uint8Array) {
            samples.fill(0);
          },
        };
      }
      createMediaStreamSource() {
        return { connect };
      }
      close = close;
    }
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const onLevel = vi.fn();
    const recorder = new AudioRecorder({ onLevel });
    await recorder.start();
    vi.advanceTimersByTime(70);
    expect(connect).toHaveBeenCalled();
    expect(onLevel).toHaveBeenCalledWith(1);
    await recorder.stop();
    expect(close).toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onLevel).toHaveBeenCalledTimes(1);
  });

  it("records without a meter when AudioContext is missing or fails", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const onLevel = vi.fn();
    const first = new AudioRecorder({ onLevel });
    await first.start();
    expect(first.state).toBe("recording");
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("no audio");
        }
      },
    );
    const second = new AudioRecorder({ onLevel });
    await second.start();
    expect(await second.stop()).not.toBeNull();
    expect(onLevel).not.toHaveBeenCalled();
  });

  it("stopAllTracks tolerates null streams and failing tracks", () => {
    expect(() => stopAllTracks(null)).not.toThrow();
    const good = { stop: vi.fn() };
    const stream = {
      getTracks: () => [
        {
          stop: () => {
            throw new Error("x");
          },
        },
        good,
      ],
    } as unknown as MediaStream;
    stopAllTracks(stream);
    expect(good.stop).toHaveBeenCalled();
  });
});
