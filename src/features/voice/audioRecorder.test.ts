import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AudioCaptureError,
  AudioRecorder,
  defaultAudioConstraints,
  isAudioCaptureSupported,
  pickPreferredMimeType,
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
