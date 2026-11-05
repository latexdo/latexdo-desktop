// Renderer side of the cloud voices. Audio is requested through the preload
// bridge (main holds the API key), cached so replaying or seeking back is not
// billed twice, and played with an <audio> element so speed keeps the pitch.

import type { ReadAloudCloudStyle } from "./readAloudSettings";

export type CloudProvider = "openai" | "elevenlabs";

export interface CloudVoice {
  id: string;
  name: string;
  description: string;
}

interface Failure {
  ok: false;
  code: string;
  error: string;
}

interface SpeechBridge {
  synthesizeSpeech?(request: unknown): Promise<unknown>;
  listCloudVoices?(provider: string): Promise<unknown>;
  hasCredential?(credentialId: string): Promise<boolean>;
  setCredential?(credentialId: string, secret: string): Promise<{ ok: boolean }>;
  deleteCredential?(credentialId: string): Promise<{ ok: boolean }>;
}

export const cloudCredentialIds: Record<CloudProvider, string> = {
  openai: "credential-openai-primary",
  elevenlabs: "credential-elevenlabs-primary",
};

function bridge(): SpeechBridge | null {
  return (globalThis as { aiApi?: SpeechBridge }).aiApi ?? null;
}

export function cloudSpeechAvailable(): boolean {
  return typeof bridge()?.synthesizeSpeech === "function";
}

export class CloudSpeechError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CloudSpeechError";
  }
}

export async function cloudKeyConfigured(provider: CloudProvider): Promise<boolean> {
  try {
    return Boolean(await bridge()?.hasCredential?.(cloudCredentialIds[provider]));
  } catch {
    return false;
  }
}

export async function saveCloudKey(
  provider: CloudProvider,
  key: string,
): Promise<boolean> {
  try {
    const result = await bridge()?.setCredential?.(
      cloudCredentialIds[provider],
      key.trim(),
    );
    return Boolean(result?.ok);
  } catch {
    return false;
  }
}

export async function removeCloudKey(provider: CloudProvider): Promise<void> {
  try {
    await bridge()?.deleteCredential?.(cloudCredentialIds[provider]);
  } catch {
    // Best effort.
  }
}

export async function fetchCloudVoices(provider: CloudProvider): Promise<CloudVoice[]> {
  const result = (await bridge()?.listCloudVoices?.(provider)) as
    | { ok: true; voices: CloudVoice[] }
    | Failure
    | undefined;
  if (!result)
    throw new CloudSpeechError("unsupported", "Cloud voices need the desktop app.");
  if (!result.ok) throw new CloudSpeechError(result.code, result.error);
  return result.voices;
}

export interface CloudSpeechConfig {
  provider: CloudProvider;
  voice: string;
  model: string;
  style: ReadAloudCloudStyle;
}

export interface CloudSpeechContext {
  previousText?: string;
  nextText?: string;
}

const maxCachedClips = 80;

export class CloudSpeechPlayer {
  private cache = new Map<string, Promise<Blob>>();
  private audio: HTMLAudioElement | null = null;
  private url = "";
  private settle: (() => void) | null = null;
  /** Bumped by stop(), so audio still downloading is not played afterwards. */
  private generation = 0;

  private key(text: string, config: CloudSpeechConfig) {
    return [config.provider, config.model, config.voice, config.style, text].join(
      "\u0000",
    );
  }

  /** Audio for one piece of text; shared by prefetching and playback. */
  load(text: string, config: CloudSpeechConfig, context: CloudSpeechContext = {}) {
    const key = this.key(text, config);
    const cached = this.cache.get(key);
    if (cached) {
      // Refresh its place in the LRU order.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const request = (async () => {
      const synthesize = bridge()?.synthesizeSpeech;
      if (!synthesize) {
        throw new CloudSpeechError("unsupported", "Cloud voices need the desktop app.");
      }
      const result = (await synthesize({ ...config, text, ...context })) as
        | { ok: true; audio: Uint8Array; mimeType: string }
        | Failure;
      if (!result.ok) throw new CloudSpeechError(result.code, result.error);
      return new Blob([new Uint8Array(result.audio)], { type: result.mimeType });
    })();
    // A failed request is not kept, so trying again asks again.
    request.catch(() => this.cache.delete(key));
    this.cache.set(key, request);
    while (this.cache.size > maxCachedClips) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
    return request;
  }

  prefetch(text: string, config: CloudSpeechConfig, context?: CloudSpeechContext) {
    void this.load(text, config, context).catch(() => undefined);
  }

  /** Plays the audio; resolves when it ends or is stopped. */
  async speak(
    text: string,
    config: CloudSpeechConfig,
    rate: number,
    context?: CloudSpeechContext,
  ): Promise<void> {
    const generation = this.generation;
    const blob = await this.load(text, config, context);
    if (generation !== this.generation) return;
    this.settle?.();
    this.release();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.preservesPitch = true;
    audio.playbackRate = rate;
    this.audio = audio;
    this.url = url;
    await new Promise<void>((resolve, reject) => {
      this.settle = resolve;
      audio.onended = () => resolve();
      audio.onerror = () =>
        reject(new CloudSpeechError("playback", "The audio could not be played."));
      audio.play().catch((error: unknown) => {
        if ((error as { name?: string }).name === "AbortError") resolve();
        else reject(new CloudSpeechError("playback", "The audio could not be played."));
      });
    }).finally(() => {
      if (this.audio === audio) this.release();
    });
  }

  stop() {
    this.generation += 1;
    const settle = this.settle;
    this.release();
    settle?.();
  }

  private release() {
    this.settle = null;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio = null;
    }
    if (this.url) {
      URL.revokeObjectURL(this.url);
      this.url = "";
    }
  }
}
