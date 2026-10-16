// The composer while dictating: one bar with a live waveform, like the voice
// input of chat apps. ✕ discards, ■ stops and puts the transcript in the box to
// edit, ↑ transcribes and sends it straight away.

import React from "react";
import { ArrowUp, LoaderCircle, Square, X } from "lucide-react";
import type { VoiceDictationStatus } from "../features/voice/types";
import { voiceLevelHistory } from "../features/voice/useVoiceDictation";
import { formatVoiceDuration } from "./VoiceDictationButton";

/** Statuses during which the bar replaces the composer. */
export function isVoiceBarStatus(status: VoiceDictationStatus): boolean {
  return (
    status === "requesting-permission" ||
    status === "recording" ||
    status === "processing" ||
    status === "transcribing" ||
    status === "cleaning"
  );
}

const workingLabel: Partial<Record<VoiceDictationStatus, string>> = {
  "requesting-permission": "Waiting for the microphone…",
  processing: "Transcribing…",
  transcribing: "Transcribing…",
  cleaning: "Cleaning up…",
};

interface VoiceRecordingBarProps {
  status: VoiceDictationStatus;
  levels: number[];
  durationMs: number;
  /** False while the assistant is answering: the transcript can only be edited. */
  canSend: boolean;
  /** Which button ended the recording, to show the spinner on it. */
  pending: "stop" | "send" | null;
  onCancel(): void;
  onStop(): void;
  onSend(): void;
}

export function VoiceRecordingBar({
  status,
  levels,
  durationMs,
  canSend,
  pending,
  onCancel,
  onStop,
  onSend,
}: VoiceRecordingBarProps) {
  const recording = status === "recording";
  const working = workingLabel[status];
  // Oldest on the left; the bar fills from the right as you speak.
  const bars = React.useMemo(() => {
    const recent = levels.slice(-voiceLevelHistory);
    return [...Array(voiceLevelHistory - recent.length).fill(null), ...recent] as (
      | number
      | null
    )[];
  }, [levels]);

  return (
    <div className="voice-bar" role="group" aria-label="Voice dictation">
      <button
        type="button"
        className="voice-bar-button voice-bar-cancel"
        onClick={onCancel}
        title="Discard recording"
        aria-label="Cancel voice dictation"
      >
        <X size={17} />
      </button>

      <div className="voice-bar-middle">
        {working ? (
          <span className="voice-bar-working" role="status" aria-live="polite">
            <LoaderCircle size={14} className="spin" aria-hidden="true" />
            {working}
          </span>
        ) : (
          <span className="voice-bar-wave" aria-hidden="true">
            {bars.map((level, index) => (
              <i
                key={index}
                className={level === null ? "is-empty" : undefined}
                style={
                  level === null
                    ? undefined
                    : { height: `${Math.max(3, Math.round(level * 22))}px` }
                }
              />
            ))}
          </span>
        )}
        {recording ? (
          <span className="voice-bar-time" aria-live="off">
            <span className="visually-hidden">Recording, </span>
            {formatVoiceDuration(durationMs)}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        className="voice-bar-button voice-bar-stop"
        onClick={onStop}
        disabled={!recording}
        title="Stop and edit the text"
        aria-label="Stop voice dictation"
      >
        {pending === "stop" && !recording ? (
          <LoaderCircle size={15} className="spin" />
        ) : (
          <Square size={13} fill="currentColor" />
        )}
      </button>
      <button
        type="button"
        className="voice-bar-button voice-bar-send"
        onClick={onSend}
        disabled={!recording || !canSend}
        title={canSend ? "Transcribe and send" : "Wait for the answer to finish"}
        aria-label="Transcribe and send"
      >
        {pending === "send" && !recording ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <ArrowUp size={17} />
        )}
      </button>
    </div>
  );
}
