// useVoiceDictation — owns the dictation state machine and coordinates the
// other modules (audioRecorder → transcription provider → optional cleanup →
// insert). Callers never touch MediaRecorder, Blobs, providers, credentials,
// or AbortController.
//
// Cancellation follows the app's existing AI pattern: a single active
// request-id is compared before every mutation, and an AbortController aborts
// the in-flight provider request. A cancelled (or stale/raced) result can
// NEVER mutate the editor.

import React from "react";
import {
  AudioRecorder,
  toVoiceDictationError,
  type AudioRecorderLike,
} from "./audioRecorder";
import { TranscriptionError } from "./transcription";
import {
  voiceError,
  type VoiceDictationError,
  type VoiceDictationStatus,
  type UseVoiceDictationOptions,
} from "./types";

function newVoiceRequestId(): string {
  return `voice_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function isCancelledLike(err: unknown): boolean {
  if (err instanceof TranscriptionError && err.code === "cancelled") return true;
  if (
    typeof DOMException !== "undefined" &&
    err instanceof DOMException &&
    err.name === "AbortError"
  ) {
    return true;
  }
  return false;
}

export function useVoiceDictation(options: UseVoiceDictationOptions): {
  status: VoiceDictationStatus;
  error: VoiceDictationError | null;
  durationMs: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  cancel(): void;
  reset(): void;
} {
  const [status, setStatus] = React.useState<VoiceDictationStatus>("idle");
  const [error, setError] = React.useState<VoiceDictationError | null>(null);
  const [durationMs, setDurationMs] = React.useState(0);

  const optionsRef = React.useRef(options);
  optionsRef.current = options;

  const statusRef = React.useRef<VoiceDictationStatus>("idle");
  const recorderRef = React.useRef<AudioRecorderLike | null>(null);
  const activeRequestIdRef = React.useRef<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = React.useRef(0);

  const updateStatus = React.useCallback((next: VoiceDictationStatus) => {
    const prev = statusRef.current;
    statusRef.current = next;
    setStatus(next);
    if (next !== prev) optionsRef.current.onStatusChange?.(next);
  }, []);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fail = React.useCallback(
    (nextError: VoiceDictationError) => {
      activeRequestIdRef.current = null;
      abortRef.current?.abort();
      abortRef.current = null;
      recorderRef.current = null;
      setError(nextError);
      updateStatus("error");
      optionsRef.current.onError?.(nextError);
    },
    [updateStatus],
  );

  const reset = React.useCallback(() => {
    clearTimer();
    activeRequestIdRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    recorderRef.current = null;
    setError(null);
    setDurationMs(0);
    updateStatus("idle");
  }, [clearTimer, updateStatus]);

  // -------------------------------------------------------------------------
  // pipeline: blob → transcript → optional cleanup → onTranscript
  // -------------------------------------------------------------------------

  const transcribePipeline = React.useCallback(
    async (blob: Blob, requestId: string) => {
      const o = optionsRef.current;
      const provider = o.transcriptionProvider ?? null;
      if (!provider) {
        fail(
          voiceError(
            "unsupported",
            "Bundled local speech is not available in this build. Reinstall LatexDo with speech support.",
          ),
        );
        return;
      }

      const controller = abortRef.current;
      updateStatus("transcribing");

      let transcribed: { text: string };
      try {
        transcribed = await provider.transcribe({
          audio: blob,
          language: o.language,
          signal: controller?.signal,
        });
        if (activeRequestIdRef.current !== requestId) return;
      } catch (transcribeErr) {
        if (
          activeRequestIdRef.current !== requestId ||
          isCancelledLike(transcribeErr)
        ) {
          return;
        }
        if (transcribeErr instanceof TranscriptionError) {
          fail(transcribeErr.toVoiceDictationError());
          return;
        }
        fail(
          voiceError(
            "transcription-failed",
            "Voice transcription failed. Your existing text was not changed.",
            transcribeErr,
          ),
        );
        return;
      }

      let finalText = transcribed.text;
      if (o.transcriptMode === "clean" && o.cleanup) {
        updateStatus("cleaning");
        try {
          finalText = await o.cleanup.cleanup(transcribed.text, controller?.signal);
        } catch {
          // Cleanup failure must NEVER fail dictation (§37): use raw transcript.
          finalText = transcribed.text;
        }
        if (activeRequestIdRef.current !== requestId) return;
      }

      if (!finalText.trim()) {
        fail(voiceError("empty-recording", "No speech was detected."));
        return;
      }

      activeRequestIdRef.current = null;
      abortRef.current = null;
      updateStatus("success");
      try {
        o.onTranscript(finalText);
      } finally {
        updateStatus("idle");
      }
    },
    [fail, updateStatus],
  );

  const stop = React.useCallback(async () => {
    if (statusRef.current !== "recording") return;
    clearTimer();
    updateStatus("processing");

    const requestId = activeRequestIdRef.current;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder || !requestId) {
      fail(
        voiceError(
          "recording-failed",
          "Voice recording failed. Your existing text was not changed.",
        ),
      );
      return;
    }

    let blob: Blob | null;
    try {
      blob = await recorder.stop();
    } catch (stopErr) {
      if (activeRequestIdRef.current === requestId) {
        fail(toVoiceDictationError(stopErr, "recording-failed"));
      }
      return;
    }
    if (!blob || blob.size === 0) {
      if (activeRequestIdRef.current === requestId) {
        fail(voiceError("empty-recording", "No speech was detected."));
      }
      return;
    }

    await transcribePipeline(blob, requestId);
  }, [clearTimer, fail, transcribePipeline, updateStatus]);

  // A stable ref to `stop` so the recorder's duration-limit callback can call
  // it without introducing a useCallback dependency cycle.
  const stopRef = React.useRef(stop);
  stopRef.current = stop;

  const start = React.useCallback(async () => {
    const o = optionsRef.current;
    if (statusRef.current !== "idle" && statusRef.current !== "error") return;

    setError(null);
    const requestId = newVoiceRequestId();
    activeRequestIdRef.current = requestId;
    abortRef.current = new AbortController();

    updateStatus("requesting-permission");
    clearTimer();
    startedAtRef.current = Date.now();
    setDurationMs(0);

    const recorder = new AudioRecorder({
      maxDurationMs: o.maxDurationMs,
      onDurationLimit: () => {
        // At the cap the recorder stops itself; carry on and transcribe
        // normally, same as a manual stop.
        void stopRef.current();
      },
    });
    recorderRef.current = recorder;

    try {
      await recorder.start();
      if (activeRequestIdRef.current !== requestId) return;

      // Microphone access first: even without a speech engine we request
      // permission so the OS prompt always appears on a laptop with a mic.
      if (!o.transcriptionProvider) {
        recorder.cancel();
        recorderRef.current = null;
        activeRequestIdRef.current = null;
        abortRef.current = null;
        fail(
          voiceError(
            "unsupported",
            "Bundled local speech is not available in this build. Reinstall LatexDo with speech support.",
          ),
        );
        return;
      }

      updateStatus("recording");
      timerRef.current = setInterval(() => {
        setDurationMs(Date.now() - startedAtRef.current);
      }, 250);
    } catch (captureErr) {
      recorderRef.current = null;
      if (activeRequestIdRef.current !== requestId || isCancelledLike(captureErr)) {
        return; // user cancelled during the permission prompt
      }
      fail(toVoiceDictationError(captureErr, "recording-failed"));
    }
  }, [fail, updateStatus, clearTimer]);

  const cancel = React.useCallback(() => {
    const s = statusRef.current;
    if (s === "idle" || s === "error") return;

    activeRequestIdRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    clearTimer();
    setDurationMs(0);
    setError(null);

    if (s === "recording" || s === "requesting-permission") {
      recorderRef.current?.cancel();
      recorderRef.current = null;
    }
    updateStatus("idle");
  }, [clearTimer, updateStatus]);

  // Release the microphone and abort any in-flight request on unmount.
  React.useEffect(() => {
    return () => {
      clearTimer();
      activeRequestIdRef.current = null;
      abortRef.current?.abort();
      abortRef.current = null;
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, [clearTimer]);

  return { status, error, durationMs, start, stop, cancel, reset };
}
