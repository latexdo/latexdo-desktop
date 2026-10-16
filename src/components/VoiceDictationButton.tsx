// VoiceDictationButton — a pure control layer over the voice state machine.
// It contains no business logic: it renders the right control for each status
// and forwards start/stop/cancel. It is reusable anywhere voice input is
// enabled later (AI composer, editor, prompts).

import React from "react";
import { AudioLines, Mic, Square, X } from "lucide-react";
import { voiceErrorMessage } from "../features/voice/voiceMessages";
import type {
  VoiceDictationError,
  VoiceDictationStatus,
} from "../features/voice/types";

export function formatVoiceDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// Recording state is never communicated through color alone: icon, text, and
// aria-labels all change together so the state is unmistakable (privacy req).
const processingLabel: Record<"processing" | "transcribing" | "cleaning", string> = {
  processing: "Preparing…",
  transcribing: "Transcribing…",
  cleaning: "Cleaning up…",
};

interface VoiceDictationButtonProps {
  status: VoiceDictationStatus;
  error?: VoiceDictationError | null;
  durationMs?: number;
  disabled?: boolean;
  onStart(): void;
  onStop(): void;
  onCancel(): void;
  onOpenSettings?(): void;
  hideError?: boolean;
}

export const VoiceDictationButton: React.FC<VoiceDictationButtonProps> = ({
  status,
  error,
  durationMs = 0,
  disabled = false,
  onStart,
  onStop,
  onCancel,
  onOpenSettings,
  hideError = false,
}) => {
  const idle = status === "idle" || status === "success";
  const startable = idle || status === "error";
  const message = voiceErrorMessage(error ?? null);

  if (status === "recording") {
    return (
      <span className="voice-control voice-recording" role="group">
        <span className="voice-live" aria-live="polite">
          <span className="voice-live-dot" aria-hidden="true" />
          <span className="voice-live-text">Recording</span>
          <span className="voice-live-time">{formatVoiceDuration(durationMs)}</span>
        </span>
        <button
          type="button"
          className="voice-button voice-stop voice-stop-transcribe"
          onClick={onStop}
          title="Stop and transcribe"
          aria-label="Stop voice dictation"
          disabled={disabled}
        >
          <Square size={14} />
          <span>Transcribe</span>
        </button>
        <button
          type="button"
          className="voice-button voice-cancel"
          onClick={onCancel}
          title="Cancel and discard recording"
          aria-label="Cancel voice dictation"
          disabled={disabled}
        >
          <X size={14} />
        </button>
      </span>
    );
  }

  const busy =
    status === "requesting-permission" ||
    status === "processing" ||
    status === "transcribing" ||
    status === "cleaning";

  if (busy) {
    return (
      <span className="voice-control voice-busy" role="status" aria-live="polite">
        <button
          type="button"
          className="voice-button"
          disabled
          aria-label={
            status === "requesting-permission"
              ? "Requesting microphone access"
              : processingLabel[status as "processing"]
          }
        >
          <AudioLines size={15} className="voice-spin" />
        </button>
        <button
          type="button"
          className="voice-button voice-cancel"
          onClick={onCancel}
          title="Cancel"
          aria-label="Cancel voice dictation"
          disabled={disabled}
        >
          <X size={14} />
        </button>
      </span>
    );
  }

  return (
    <span className="voice-control">
      <button
        type="button"
        className="voice-button voice-start"
        onClick={onStart}
        title={error ? "Try voice dictation again" : "Voice dictation"}
        aria-label="Start voice dictation"
        disabled={disabled || !startable}
      >
        <Mic size={15} />
      </button>
      {!hideError && message && (
        <span className="voice-error" role="alert">
          {message}
        </span>
      )}
      {!hideError && error?.code === "unsupported" && onOpenSettings && (
        <button
          type="button"
          className="voice-error-setup"
          onClick={onOpenSettings}
          aria-label="Configure speech-to-text"
        >
          Configure speech-to-text
        </button>
      )}
    </span>
  );
};
