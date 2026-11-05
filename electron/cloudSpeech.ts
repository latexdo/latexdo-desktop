// Cloud text-to-speech for "Listen to paper". Requests run in main so API keys
// never reach the renderer and the page's CSP stays closed to third parties.
// Keys come from the OS credential vault (secretStorage) for each request.

import { net } from "electron";
import { ipcMain } from "./trustedIpc.js";
import { getCredential } from "./ai/secretStorage.js";

export type CloudSpeechProvider = "openai" | "elevenlabs";
export type CloudSpeechStyle = "narrator" | "lecture" | "neutral";

export interface CloudSpeechRequest {
  provider: CloudSpeechProvider;
  text: string;
  voice: string;
  model: string;
  style?: CloudSpeechStyle;
  /** Neighbouring sentences, so ElevenLabs keeps the intonation flowing. */
  previousText?: string;
  nextText?: string;
}

export type CloudSpeechResult =
  | { ok: true; audio: Uint8Array; mimeType: string }
  | { ok: false; code: CloudSpeechErrorCode; error: string };

export type CloudSpeechErrorCode =
  | "invalid-request"
  | "missing-key"
  | "auth"
  | "quota"
  | "network"
  | "provider";

export interface CloudVoice {
  id: string;
  name: string;
  description: string;
}

export type CloudVoicesResult =
  | { ok: true; voices: CloudVoice[] }
  | { ok: false; code: CloudSpeechErrorCode; error: string };

export const cloudSpeechCredentialIds: Record<CloudSpeechProvider, string> = {
  // Shared with the OpenAI provider in AI settings and cloud dictation.
  openai: "credential-openai-primary",
  elevenlabs: "credential-elevenlabs-primary",
};

const providerNames: Record<CloudSpeechProvider, string> = {
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
};

export const maxCloudSpeechChars = 4000;
const maxContextChars = 600;
const idPattern = /^[A-Za-z0-9._-]{1,64}$/;

/** Delivery notes for OpenAI's steerable voices. */
const styleInstructions: Record<CloudSpeechStyle, string> = {
  narrator:
    "Read like a professional audiobook narrator: warm, calm and clear. Pause naturally at commas and full stops, and give section headings a slight emphasis.",
  lecture:
    "Read like an engaging university lecturer explaining a research paper: confident, articulate, with gentle emphasis on key terms and clear pauses between ideas.",
  neutral:
    "Read clearly and evenly at a steady pace, with natural pauses at punctuation.",
};

interface Deps {
  fetch: typeof fetch;
  getCredential: (id: string) => Promise<string | null>;
}

const defaultDeps: Deps = {
  // Electron's network stack honours the system proxy settings.
  fetch: (input, init) =>
    net.fetch(input instanceof URL ? input.toString() : input, init),
  getCredential,
};

function fail(code: CloudSpeechErrorCode, error: string) {
  return { ok: false as const, code, error };
}

function isProvider(value: unknown): value is CloudSpeechProvider {
  return value === "openai" || value === "elevenlabs";
}

function context(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(-maxContextChars)
    : undefined;
}

export function parseCloudSpeechRequest(raw: unknown): CloudSpeechRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (!isProvider(value.provider)) return null;
  if (typeof value.text !== "string") return null;
  const text = value.text.trim();
  if (!text || text.length > maxCloudSpeechChars) return null;
  if (typeof value.voice !== "string" || !idPattern.test(value.voice)) return null;
  if (typeof value.model !== "string" || !idPattern.test(value.model)) return null;
  const style =
    value.style === "narrator" || value.style === "lecture" || value.style === "neutral"
      ? value.style
      : "narrator";
  return {
    provider: value.provider,
    text,
    voice: value.voice,
    model: value.model,
    style,
    previousText: context(value.previousText),
    nextText:
      typeof value.nextText === "string"
        ? value.nextText.trim().slice(0, maxContextChars) || undefined
        : undefined,
  };
}

async function providerError(
  provider: CloudSpeechProvider,
  response: Response,
): Promise<{ ok: false; code: CloudSpeechErrorCode; error: string }> {
  const name = providerNames[provider];
  let detail = "";
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown } | string;
      detail?: { message?: unknown } | string;
    };
    const message =
      typeof body.error === "string"
        ? body.error
        : typeof body.error?.message === "string"
          ? body.error.message
          : typeof body.detail === "string"
            ? body.detail
            : typeof body.detail?.message === "string"
              ? body.detail.message
              : "";
    detail = [...message]
      .map((char) =>
        char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f ? " " : char,
      )
      .join("")
      .trim()
      .slice(0, 160);
  } catch {
    // No readable body; the status says enough.
  }
  if (response.status === 401 || response.status === 403) {
    return fail("auth", `${name} rejected the API key. Check it in Listening options.`);
  }
  if (response.status === 429) {
    return fail(
      "quota",
      `${name} says the rate limit or quota was reached.${detail ? ` ${detail}` : ""}`,
    );
  }
  return fail(
    "provider",
    `${name} could not read this sentence (${response.status}).${detail ? ` ${detail}` : ""}`,
  );
}

export async function synthesizeCloudSpeech(
  raw: unknown,
  deps: Deps = defaultDeps,
): Promise<CloudSpeechResult> {
  const request = parseCloudSpeechRequest(raw);
  if (!request) return fail("invalid-request", "That text cannot be sent for speech.");
  const name = providerNames[request.provider];
  const key = await deps.getCredential(cloudSpeechCredentialIds[request.provider]);
  if (!key)
    return fail("missing-key", `Add your ${name} API key in Listening options.`);

  let response: Response;
  try {
    if (request.provider === "openai") {
      response = await deps.fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: request.model,
          voice: request.voice,
          input: request.text,
          response_format: "mp3",
          // Only the steerable models accept delivery instructions.
          ...(request.model.startsWith("gpt-")
            ? { instructions: styleInstructions[request.style ?? "narrator"] }
            : {}),
        }),
      });
    } else {
      response = await deps.fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(request.voice)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": key,
            "content-type": "application/json",
            accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text: request.text,
            model_id: request.model,
            ...(request.model === "eleven_v3"
              ? {}
              : {
                  previous_text: request.previousText,
                  next_text: request.nextText,
                }),
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
        },
      );
    }
  } catch {
    return fail("network", `Could not reach ${name}. Check your internet connection.`);
  }
  if (!response.ok) return providerError(request.provider, response);
  const audio = new Uint8Array(await response.arrayBuffer());
  if (!audio.byteLength) return fail("provider", `${name} returned no audio.`);
  return {
    ok: true,
    audio,
    mimeType: response.headers.get("content-type") || "audio/mpeg",
  };
}

export async function listCloudVoices(
  provider: unknown,
  deps: Deps = defaultDeps,
): Promise<CloudVoicesResult> {
  if (provider !== "elevenlabs")
    return fail("invalid-request", "Unknown voice provider.");
  const key = await deps.getCredential(cloudSpeechCredentialIds.elevenlabs);
  if (!key)
    return fail("missing-key", "Add your ElevenLabs API key in Listening options.");
  let response: Response;
  try {
    response = await deps.fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": key, accept: "application/json" },
    });
  } catch {
    return fail(
      "network",
      "Could not reach ElevenLabs. Check your internet connection.",
    );
  }
  if (!response.ok) return providerError("elevenlabs", response);
  const body = (await response.json().catch(() => ({}))) as {
    voices?: Array<{
      voice_id?: unknown;
      name?: unknown;
      labels?: Record<string, unknown>;
    }>;
  };
  const voices = (body.voices ?? []).flatMap((voice): CloudVoice[] => {
    if (typeof voice.voice_id !== "string" || !idPattern.test(voice.voice_id))
      return [];
    const labels = voice.labels ?? {};
    const description = ["accent", "gender", "use_case", "description", "descriptive"]
      .map((label) => labels[label])
      .filter(
        (value): value is string => typeof value === "string" && Boolean(value.trim()),
      )
      .slice(0, 3)
      .join(" · ");
    return [
      {
        id: voice.voice_id,
        name: typeof voice.name === "string" ? voice.name.slice(0, 80) : voice.voice_id,
        description,
      },
    ];
  });
  return { ok: true, voices };
}

export function registerCloudSpeechIpc(deps: Deps = defaultDeps): void {
  ipcMain.handle("tts:synthesize", (_event, request: unknown) =>
    synthesizeCloudSpeech(request, deps),
  );
  ipcMain.handle("tts:voices", (_event, provider: unknown) =>
    listCloudVoices(provider, deps),
  );
}
