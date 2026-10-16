// Voice dictation types.
//
// Voice is an INPUT METHOD (like the keyboard), not another AI agent tool.
// Speech-to-text and the optional AI cleanup pass are deliberately separate
// operations: STT determines WHAT the user said; cleanup only touches
// punctuation/capitalization and must never rewrite wording or meaning.

/** Single explicit dictation state. Never several unrelated booleans. */
export type VoiceDictationStatus =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "processing"
  | "transcribing"
  | "cleaning"
  | "success"
  | "error";

export type VoiceErrorCode =
  | "permission-denied"
  | "credential-unavailable"
  | "device-not-found"
  | "device-unavailable"
  | "recording-failed"
  | "empty-recording"
  | "transcription-failed"
  | "cleanup-failed"
  | "unsupported"
  | "cancelled";

export interface VoiceDictationError {
  code: VoiceErrorCode;
  message: string;
  cause?: unknown;
}

export function voiceError(
  code: VoiceErrorCode,
  message: string,
  cause?: unknown,
): VoiceDictationError {
  return { code, message, cause };
}

/** Whether cleanup (punctuation/capitalization only) runs after STT. */
export type TranscriptMode = "verbatim" | "clean";

// ---------------------------------------------------------------------------
// Transcription provider abstraction
// ---------------------------------------------------------------------------

export interface TranscriptionRequest {
  audio: Blob;
  language?: string;
  signal?: AbortSignal;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationMs?: number;
}

export interface TranscriptionProvider {
  readonly id: string;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

// ---------------------------------------------------------------------------
// Optional cleanup abstraction
// ---------------------------------------------------------------------------

export interface TranscriptCleanup {
  readonly id: string;
  cleanup(transcript: string, signal?: AbortSignal): Promise<string>;
}

// ---------------------------------------------------------------------------
// Hook API / controller
// ---------------------------------------------------------------------------

export interface UseVoiceDictationOptions {
  language?: string;
  transcriptMode?: TranscriptMode;
  maxDurationMs?: number;
  /** Null/undefined means transcription is unavailable in this environment. */
  transcriptionProvider?: TranscriptionProvider | null;
  /** Optional conservative cleanup; null disables it. */
  cleanup?: TranscriptCleanup | null;
  onTranscript(text: string): void;
  onError?(error: VoiceDictationError): void;
  onStatusChange?(status: VoiceDictationStatus): void;
}

export interface VoiceDictationController {
  status: VoiceDictationStatus;
  error: VoiceDictationError | null;
  durationMs: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  cancel(): void;
  reset(): void;
}
