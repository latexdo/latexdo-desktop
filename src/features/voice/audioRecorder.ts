// Microphone capture. This module owns the platform media APIs and nothing
// else: permission, start/stop/cancel, chunk aggregation, Blob creation, and
// MediaStream cleanup. It knows nothing about AI or transcription.

import { voiceError, type VoiceDictationError, type VoiceErrorCode } from "./types";

export type AudioRecorderState = "idle" | "recording" | "stopped";

export interface AudioRecorderOptions {
  /** Optional hard cap; the recorder stops itself at this duration (ms). */
  maxDurationMs?: number;
  /** Called when the recorder auto-stops because the duration cap was reached. */
  onDurationLimit?(): void;
}

export interface AudioRecorderLike {
  readonly state: AudioRecorderState;
  /** Requests microphone permission and starts capturing. Never called twice. */
  start(): Promise<void>;
  /** Stops capture and resolves with the recorded audio Blob (null if empty). */
  stop(): Promise<Blob | null>;
  /** Discards everything and releases the microphone immediately. */
  cancel(): void;
}

/** Error carrying a structured VoiceErrorCode for the state machine. */
export class AudioCaptureError extends Error {
  readonly code: VoiceErrorCode;
  constructor(code: VoiceErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "AudioCaptureError";
    this.code = code;
    this.cause = cause;
  }
  toVoiceDictationError(): VoiceDictationError {
    return voiceError(this.code, this.message, this.cause);
  }
}

/** True only when the platform exposes both capture and encoding. */
export function isAudioCaptureSupported(): boolean {
  return Boolean(
    typeof navigator !== "undefined" &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined",
  );
}

/** Preferred constraints are preferences, not hard requirements. */
export function defaultAudioConstraints(): MediaTrackConstraints {
  return { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
}

/** Pick the first MIME type the platform can actually encode. */
export function pickPreferredMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/wav",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function mapGetUserMediaError(err: unknown): AudioCaptureError {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return new AudioCaptureError(
      "permission-denied",
      "Microphone access was denied. Enable microphone permission for LatexDo and try again.",
      err,
    );
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return new AudioCaptureError(
      "device-not-found",
      "No microphone was detected.",
      err,
    );
  }
  if (
    name === "NotReadableError" ||
    name === "TrackStartError" ||
    name === "OverconstrainedError"
  ) {
    return new AudioCaptureError(
      "device-unavailable",
      "LatexDo couldn't access the microphone. Another application may be using it.",
      err,
    );
  }
  if (name === "SecurityError") {
    return new AudioCaptureError(
      "permission-denied",
      "Microphone access was denied. Enable microphone permission for LatexDo and try again.",
      err,
    );
  }
  return new AudioCaptureError(
    "recording-failed",
    "Voice recording failed. Your existing text was not changed.",
    err,
  );
}

function blobTypeFor(mimeType: string | undefined): string {
  return mimeType && mimeType.trim() ? mimeType : "audio/webm";
}

export class AudioRecorder implements AudioRecorderLike {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private recorderState: AudioRecorderState = "idle";
  private cancelled = false;
  private durationLimitReached = false;
  private startedAt = 0;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private stopResolve: ((blob: Blob | null) => void) | null = null;
  private stopReject: ((error: unknown) => void) | null = null;
  private stopPromise: Promise<Blob | null> | null = null;
  /** Final captured Blob, cached so a stop after auto-limit never re-reports empty. */
  private resultBlob: Blob | null = null;

  private readonly maxDurationMs?: number;
  private readonly onDurationLimit?: () => void;

  constructor(options: AudioRecorderOptions = {}) {
    this.maxDurationMs = options.maxDurationMs;
    this.onDurationLimit = options.onDurationLimit;
  }

  get state(): AudioRecorderState {
    return this.recorderState;
  }

  async start(): Promise<void> {
    if (this.recorderState !== "idle") return;
    if (!isAudioCaptureSupported()) {
      throw new AudioCaptureError(
        "unsupported",
        "Voice input isn't available in this environment.",
      );
    }

    const stream = await navigator.mediaDevices
      .getUserMedia({ audio: defaultAudioConstraints(), video: false })
      .catch((err: unknown) => {
        throw mapGetUserMediaError(err);
      });

    // Cancel can race with an in-flight permission prompt.
    if (this.cancelled) {
      stopAllTracks(stream);
      throw new AudioCaptureError("cancelled", "Voice dictation cancelled.", null);
    }

    this.stream = stream;
    this.chunks = [];
    const mimeType = pickPreferredMimeType();
    const mimeSupported =
      mimeType !== undefined &&
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(mimeType);
    const recorder = mimeSupported
      ? new MediaRecorder(stream, { mimeType: mimeType as string })
      : new MediaRecorder(stream);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onstop = () => {
      this.limitTimerCleanup();
      const blob =
        this.chunks.length > 0
          ? new Blob(this.chunks, { type: blobTypeFor(recorder.mimeType) })
          : null;
      this.resultBlob = blob;
      this.releaseStream();
      this.stopResolve?.(blob);
    };
    recorder.onerror = () => {
      this.limitTimerCleanup();
      this.releaseStream();
      this.stopReject?.(
        new AudioCaptureError(
          "recording-failed",
          "Voice recording failed. Your existing text was not changed.",
        ),
      );
    };

    this.recorder = recorder;
    this.recorderState = "recording";
    this.startedAt = Date.now();
    recorder.start(250);

    // Duration cap. Uses a coarse check so a hard limit is never exceeded.
    const maxDurationMs = this.maxDurationMs;
    if (maxDurationMs && maxDurationMs > 0) {
      this.limitTimer = setInterval(() => {
        if (this.recorderState !== "recording") return;
        if (Date.now() - this.startedAt < maxDurationMs) return;
        this.durationLimitReached = true;
        if (this.recorder?.state === "recording") {
          this.recorder.stop();
        }
        this.onDurationLimit?.();
      }, 500);
    }
  }

  async stop(): Promise<Blob | null> {
    if (!this.recorder && !this.resultBlob) return null;
    if (this.stopPromise) return this.stopPromise;
    // Recording may already have ended (e.g. auto-stopped at the duration
    // cap): return the cached result rather than reporting "empty".
    if (this.recorderState === "stopped") return this.resultBlob ?? null;
    if (this.recorderState !== "recording") return null;

    this.stopPromise = new Promise<Blob | null>((resolve, reject) => {
      this.stopResolve = resolve;
      this.stopReject = reject;
    });

    if (this.recorder && this.recorder.state === "recording") {
      this.recorder.stop();
    }
    return this.stopPromise;
  }

  cancel(): void {
    this.cancelled = true;
    this.limitTimerCleanup();
    if (this.recorder && this.recorderState === "recording") {
      if (this.recorder.state === "recording") this.recorder.stop();
    } else {
      // Permission prompt in flight or stop already resolved: release the
      // stream if there is one.
      this.releaseStream();
    }
  }

  get durationLimitReachedFlag(): boolean {
    return this.durationLimitReached;
  }

  private limitTimerCleanup(): void {
    if (this.limitTimer) {
      clearInterval(this.limitTimer);
      this.limitTimer = null;
    }
  }

  private releaseStream(): void {
    this.recorderState = "stopped";
    if (this.stream) {
      stopAllTracks(this.stream);
      this.stream = null;
    }
  }
}

export function stopAllTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Best effort.
    }
  }
}

/** Convert any thrown error from the capture pipeline to a structured error. */
export function toVoiceDictationError(
  err: unknown,
  fallback: VoiceErrorCode = "recording-failed",
): VoiceDictationError {
  if (err instanceof AudioCaptureError) return err.toVoiceDictationError();
  return voiceError(
    fallback,
    "Voice recording failed. Your existing text was not changed.",
    err,
  );
}
