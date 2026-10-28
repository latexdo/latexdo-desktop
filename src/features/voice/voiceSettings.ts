// Voice dictation settings.
//
// Mirrors the aiConfig.ts store pattern: its own localStorage key, explicit
// normalization, no side effects. Kept tiny and separate so the fuzz-tested
// AppSettings/aiConfig round-trips are never destabilized by a new feature.

import type { TranscriptMode } from "./types";

export type VoiceSttMode = "local" | "openai";

export interface VoiceSettings {
  /** "clean" enables the optional punctuation/capitalization pass. */
  transcriptMode: TranscriptMode;
  /** Where recorded audio is transcribed. Local remains the privacy-first default. */
  sttMode: VoiceSttMode;
  /** Speech model used by the local transcription server. */
  transcriptionModel: string;
  /** Speech model used by OpenAI cloud transcription. */
  cloudTranscriptionModel: string;
  /**
   * Local OpenAI-compatible speech-to-text endpoint, e.g. a local whisper
   * server at http://localhost:8080/v1. Voice dictation defaults to local
   * speech-to-text and does not use the chat provider for audio.
   */
  sttBaseUrl: string;
}

export const voiceSettingsStorageKey = "latexdo.voice.config.v1";
/** Safety cap for a single dictation (spec §38): it stops and transcribes. */
export const defaultMaxVoiceDurationMs = 180_000;
export const defaultLocalTranscriptionBaseUrl = "http://localhost:8080/v1";
export const defaultCloudTranscriptionModel = "gpt-transcribe";

/** Internal credential id retained for local endpoints that opt into auth. */
export const voiceSttCredentialId = "credential-voice-stt-primary";

export const defaultVoiceSettings: VoiceSettings = {
  transcriptMode: "clean",
  sttMode: "local",
  transcriptionModel: "whisper-1",
  cloudTranscriptionModel: defaultCloudTranscriptionModel,
  sttBaseUrl: defaultLocalTranscriptionBaseUrl,
};

const legacyCloudTranscriptionModel = "gpt-4o-mini-transcribe";

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isLoopbackBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function localBaseUrl(value: unknown): string {
  const baseUrl = str(value, defaultVoiceSettings.sttBaseUrl);
  return isLoopbackBaseUrl(baseUrl) ? baseUrl : defaultVoiceSettings.sttBaseUrl;
}

function transcriptionModel(value: unknown): string {
  const model = str(value, defaultVoiceSettings.transcriptionModel);
  return model === legacyCloudTranscriptionModel
    ? defaultVoiceSettings.transcriptionModel
    : model;
}

function isTranscriptMode(value: unknown): value is TranscriptMode {
  return value === "verbatim" || value === "clean";
}

function isVoiceSttMode(value: unknown): value is VoiceSttMode {
  return value === "local" || value === "openai";
}

export function normalizeVoiceSettings(raw: unknown): VoiceSettings {
  const saved = (raw ?? {}) as Partial<VoiceSettings>;
  return {
    transcriptMode: isTranscriptMode(saved.transcriptMode)
      ? saved.transcriptMode
      : defaultVoiceSettings.transcriptMode,
    sttMode: isVoiceSttMode(saved.sttMode)
      ? saved.sttMode
      : defaultVoiceSettings.sttMode,
    transcriptionModel: transcriptionModel(saved.transcriptionModel),
    cloudTranscriptionModel: str(
      saved.cloudTranscriptionModel,
      defaultVoiceSettings.cloudTranscriptionModel,
    ),
    sttBaseUrl: localBaseUrl(saved.sttBaseUrl),
  };
}

export function loadVoiceSettings(): VoiceSettings {
  try {
    return normalizeVoiceSettings(
      JSON.parse(window.localStorage.getItem(voiceSettingsStorageKey) ?? "{}"),
    );
  } catch {
    return defaultVoiceSettings;
  }
}

/** Fired on window after a save so every open view picks up the change. */
export const voiceSettingsChangedEvent = "latexdo:voice-settings-changed";

export function saveVoiceSettings(settings: VoiceSettings): void {
  window.localStorage.setItem(
    voiceSettingsStorageKey,
    JSON.stringify(normalizeVoiceSettings(settings)),
  );
  window.dispatchEvent(new Event(voiceSettingsChangedEvent));
}
