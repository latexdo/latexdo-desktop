// Speech-to-text providers. This module turns an audio Blob into a literal
// transcript. It knows nothing about React, the editor, or the state machine.
//
// The app-level factory creates providers for either loopback speech endpoints
// or explicit OpenAI speech-to-text mode. Audio is never routed through the
// app's chat-completion pipeline.

import type { AiConfig } from "../ai/aiConfig";
import { loadCloudCredential } from "../ai/cloudCredentials";
import {
  voiceError,
  type TranscriptionProvider,
  type TranscriptionResult,
  type VoiceDictationError,
} from "./types";
import { defaultCloudTranscriptionModel, voiceSttCredentialId } from "./voiceSettings";
import { toWhisperWav } from "./wavEncoding";

type EnsureSpeechServerResult =
  | {
      ok: true;
      baseUrl: string;
      model: string;
      alreadyRunning: boolean;
      bundled: boolean;
    }
  | {
      ok: false;
      code: string;
      error: string;
    };

function speechBridge(): {
  ensureSpeechServer?(request: {
    baseUrl?: string;
    model?: string;
  }): Promise<EnsureSpeechServerResult>;
} | null {
  return (
    (
      globalThis as {
        aiApi?: {
          ensureSpeechServer?(request: {
            baseUrl?: string;
            model?: string;
          }): Promise<EnsureSpeechServerResult>;
        };
      }
    ).aiApi ?? null
  );
}

async function ensureLocalSpeechServer(baseUrl: string, model: string): Promise<void> {
  const result = await speechBridge()?.ensureSpeechServer?.({ baseUrl, model });
  if (!result || result.ok) return;
  throw new TranscriptionError("transcription-failed", result.error, result.code);
}

/** Error carrying a structured code; used by the state machine mapping. */
export class TranscriptionError extends Error {
  readonly code: MaybeTranscriptionErrorCode;
  constructor(code: MaybeTranscriptionErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "TranscriptionError";
    this.code = code;
    this.cause = cause;
  }
  toVoiceDictationError(): VoiceDictationError {
    return voiceError(this.code, this.message, this.cause);
  }
}

type MaybeTranscriptionErrorCode =
  | "transcription-failed"
  | "empty-recording"
  | "cancelled"
  | "unsupported"
  | "credential-unavailable";

export interface OpenAiTranscriptionProviderOptions {
  /** Base URL including the `/v1` suffix; empty = official OpenAI. */
  baseUrl?: string;
  /** Speech model. Defaults to a dedicated transcription model. */
  model?: string;
  /** Credential id resolved from the OS vault at request time. */
  credentialId: string;
  /**
   * Local speech servers (whisper.cpp, LM Studio, …) usually need no key.
   * When true, a missing vault key is fine and no Authorization header is
   * sent; the server's own access rules decide.
   */
  allowKeyless?: boolean;
  /** Max characters of provider error payload we retain in messages. */
  maxErrorChars?: number;
}

export const defaultTranscriptionModel = "whisper-1";
export const openAiTranscriptionBaseUrl = "https://api.openai.com/v1";
export const openAiVoiceCredentialId = "credential-openai-primary";

export function audioExtensionForType(mimeType: string | undefined): string {
  const type = mimeType ?? "";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  if (type.includes("wav")) return "wav";
  if (type.includes("mp3")) return "mp3";
  return "webm";
}

function sanitizeProviderError(text: string, maxChars: number): string {
  let cleaned = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isControl =
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f;
    if (!isControl) cleaned += text[i];
  }
  cleaned = cleaned.trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}…` : cleaned;
}

export class OpenAiTranscriptionProvider implements TranscriptionProvider {
  readonly id = "openai";

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly credentialId: string;
  private readonly allowKeyless: boolean;
  private readonly maxErrorChars: number;
  private readonly localEndpoint: boolean;

  constructor(options: OpenAiTranscriptionProviderOptions) {
    this.baseUrl = options.baseUrl?.trim() || "https://api.openai.com/v1";
    this.model = options.model?.trim() || defaultTranscriptionModel;
    this.credentialId = options.credentialId;
    this.allowKeyless = options.allowKeyless ?? false;
    this.maxErrorChars = options.maxErrorChars ?? 160;
    this.localEndpoint = isLoopbackBaseUrl(this.baseUrl);
  }

  async transcribe(request: {
    audio: Blob;
    language?: string;
    signal?: AbortSignal;
  }): Promise<TranscriptionResult> {
    if (this.localEndpoint) {
      await ensureLocalSpeechServer(this.baseUrl, this.model);
      if (isAbortError(null, request.signal)) {
        throw new TranscriptionError("cancelled", "Voice transcription cancelled.");
      }
    }

    // Bundled/keyless loopback speech does not need the OS credential vault.
    // Reading it here can prompt for Keychain access and fail after a denial.
    const apiKey =
      this.localEndpoint && this.allowKeyless
        ? ""
        : await loadCloudCredential(this.credentialId);
    if (!apiKey && !this.allowKeyless) {
      // Not a microphone problem: the key is missing, or the OS refused
      // access to the credential vault (e.g. Keychain "Deny").
      throw new TranscriptionError(
        "credential-unavailable",
        "LatexDo couldn't read your OpenAI API key. If your system asked for Keychain access, choose Allow; otherwise enter the key in the AI settings.",
      );
    }

    // Local whisper.cpp servers read WAV only; convert the browser's WebM/Opus.
    const audio = this.localEndpoint
      ? await toWhisperWav(request.audio).catch(() => request.audio)
      : request.audio;
    const form = new FormData();
    form.append("file", audio, `recording.${audioExtensionForType(audio.type)}`);
    form.append("model", this.model);
    form.append("response_format", "json");
    form.append("temperature", "0");
    if (request.language) form.append("language", request.language);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        body: form,
        signal: request.signal,
      });
    } catch (err) {
      if (isAbortError(err, request.signal)) {
        throw new TranscriptionError(
          "cancelled",
          "Voice transcription cancelled.",
          err,
        );
      }
      const message = this.localEndpoint
        ? [
            "LatexDo could not reach the bundled local speech service.",
            "Restart LatexDo and try again.",
          ].join(" ")
        : "Voice transcription failed. Your existing text was not changed.";
      throw new TranscriptionError("transcription-failed", message, err);
    }

    if (!response.ok) {
      throw new TranscriptionError(
        "transcription-failed",
        `Voice transcription failed (${response.status}). Your existing text was not changed.`,
        sanitizeProviderError(await safeText(response), this.maxErrorChars),
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (err) {
      throw new TranscriptionError(
        "transcription-failed",
        "Voice transcription failed. Your existing text was not changed.",
        err,
      );
    }

    const serverError = (data as { error?: unknown })?.error;
    if (typeof serverError === "string" && serverError.trim()) {
      throw new TranscriptionError(
        "transcription-failed",
        `The speech service could not transcribe the recording (${serverError.trim().slice(0, 120)}).`,
        data,
      );
    }
    const text =
      typeof (data as { text?: unknown })?.text === "string"
        ? ((data as { text: string }).text as string).trim()
        : "";
    if (!text) {
      throw new TranscriptionError("empty-recording", "No speech was detected.", data);
    }

    const language =
      typeof (data as { language?: unknown })?.language === "string"
        ? ((data as { language: string }).language as string)
        : undefined;
    return { text, language };
  }
}

function isLoopbackBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname;
    return (
      host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"
    );
  } catch {
    return false;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return (
    err instanceof DOMException && err.name === "AbortError" // DOMException may be undefined in odd runtimes
  );
}

/**
 * Build the transcription provider for voice dictation.
 *
 * Voice dictation uses an explicit speech-to-text route. The default local
 * route still refuses non-loopback URLs so audio stays local; OpenAI mode is
 * a separate opt-in provider that posts to the official transcription API.
 *
 * Audio is never routed through the chat-completion pipeline.
 */
export function createTranscriptionProvider(
  _config: AiConfig,
  options?: {
    mode?: "local" | "openai";
    model?: string;
    baseUrl?: string;
    credentialId?: string;
  },
): TranscriptionProvider | null {
  if (options?.mode === "openai") {
    return new OpenAiTranscriptionProvider({
      baseUrl: openAiTranscriptionBaseUrl,
      model: options.model || defaultCloudTranscriptionModel,
      credentialId: options.credentialId || openAiVoiceCredentialId,
      allowKeyless: false,
    });
  }

  const explicitBaseUrl = (options?.baseUrl ?? "").trim();
  if (explicitBaseUrl) {
    if (!isLoopbackBaseUrl(explicitBaseUrl)) return null;
    return new OpenAiTranscriptionProvider({
      baseUrl: explicitBaseUrl,
      model: options?.model,
      credentialId: (options?.credentialId ?? "").trim() || voiceSttCredentialId,
      allowKeyless: true,
    });
  }

  return null;
}
