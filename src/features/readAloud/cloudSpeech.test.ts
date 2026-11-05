import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CloudSpeechPlayer,
  cloudSpeechAvailable,
  cloudKeyConfigured,
  saveCloudKey,
  removeCloudKey,
  fetchCloudVoices,
  type CloudSpeechConfig,
} from "./cloudSpeech";

const config: CloudSpeechConfig = {
  provider: "openai",
  voice: "coral",
  model: "gpt-4o-mini-tts",
  style: "narrator",
};
const response = { ok: true, audio: new Uint8Array([1, 2]), mimeType: "audio/mpeg" };
const synthesizeSpeech = vi.fn();
const clips: FakeAudio[] = [];
class FakeAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  preservesPitch = false;
  playbackRate = 1;
  pause = vi.fn();
  removeAttribute = vi.fn();
  play = vi.fn().mockResolvedValue(undefined);
  constructor(readonly src: string) {
    clips.push(this);
  }
}
beforeEach(() => {
  synthesizeSpeech.mockReset().mockResolvedValue(response);
  clips.length = 0;
  vi.stubGlobal("aiApi", { synthesizeSpeech });
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => "blob:speech"),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("cloud voice bridge", () => {
  it("handles unavailable and failing credential storage", async () => {
    vi.stubGlobal("aiApi", undefined);
    expect(cloudSpeechAvailable()).toBe(false);
    expect(await cloudKeyConfigured("openai")).toBe(false);
    expect(await saveCloudKey("openai", "key")).toBe(false);
    await removeCloudKey("openai");
    await expect(fetchCloudVoices("elevenlabs")).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(new CloudSpeechPlayer().load("Text", config)).rejects.toMatchObject({
      code: "unsupported",
    });
    const fail = vi.fn().mockRejectedValue(new Error("vault locked"));
    vi.stubGlobal("aiApi", {
      hasCredential: fail,
      setCredential: fail,
      deleteCredential: fail,
    });
    expect(await cloudKeyConfigured("openai")).toBe(false);
    expect(await saveCloudKey("openai", "key")).toBe(false);
    await expect(removeCloudKey("openai")).resolves.toBeUndefined();
  });
  it("uses provider credential IDs and returns voice lists and errors", async () => {
    const setCredential = vi.fn().mockResolvedValue({ ok: true });
    const deleteCredential = vi.fn();
    const listCloudVoices = vi.fn().mockResolvedValue({
      ok: true,
      voices: [{ id: "v1", name: "Reader", description: "" }],
    });
    vi.stubGlobal("aiApi", {
      synthesizeSpeech,
      hasCredential: vi.fn().mockResolvedValue(true),
      setCredential,
      deleteCredential,
      listCloudVoices,
    });
    expect(cloudSpeechAvailable()).toBe(true);
    expect(await cloudKeyConfigured("elevenlabs")).toBe(true);
    expect(await saveCloudKey("elevenlabs", " key ")).toBe(true);
    expect(setCredential).toHaveBeenCalledWith("credential-elevenlabs-primary", "key");
    await removeCloudKey("openai");
    expect(deleteCredential).toHaveBeenCalledWith("credential-openai-primary");
    expect(await fetchCloudVoices("elevenlabs")).toHaveLength(1);
    listCloudVoices.mockResolvedValue({ ok: false, code: "auth", error: "Rejected" });
    await expect(fetchCloudVoices("elevenlabs")).rejects.toMatchObject({
      code: "auth",
      message: "Rejected",
    });
  });
});

describe("cloud audio lifecycle", () => {
  it("shares prefetched clips, retries failures, and evicts least recently used clips", async () => {
    const player = new CloudSpeechPlayer();
    player.prefetch("First", config, { nextText: "Next" });
    const first = await player.load("First", config);
    expect(first.type).toBe("audio/mpeg");
    expect(first.size).toBe(2);
    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(synthesizeSpeech).toHaveBeenCalledWith({
      ...config,
      text: "First",
      nextText: "Next",
    });
    for (let i = 0; i < 79; i++) await player.load(`Clip ${i}`, config);
    await player.load("First", config);
    await player.load("Overflow", config);
    await player.load("First", config);
    expect(synthesizeSpeech).toHaveBeenCalledTimes(81);
    await player.load("Clip 0", config);
    expect(synthesizeSpeech).toHaveBeenCalledTimes(82);
    synthesizeSpeech.mockResolvedValueOnce({
      ok: false,
      code: "quota",
      error: "Quota",
    });
    await expect(player.load("Retry", config)).rejects.toMatchObject({ code: "quota" });
    await expect(player.load("Retry", config)).resolves.toBeInstanceOf(Blob);
    await player.load("First", { ...config, voice: "nova" });
    expect(synthesizeSpeech).toHaveBeenCalledTimes(85);
  });
  it("sets speed and pitch preservation, then releases ended or stopped clips", async () => {
    const player = new CloudSpeechPlayer();
    const speaking = player.speak("First", config, 1.5);
    await vi.waitFor(() => expect(clips).toHaveLength(1));
    expect(clips[0].playbackRate).toBe(1.5);
    expect(clips[0].preservesPitch).toBe(true);
    clips[0].onended?.();
    await speaking;
    expect(clips[0].pause).toHaveBeenCalled();
    expect(clips[0].removeAttribute).toHaveBeenCalledWith("src");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:speech");
    const stopped = player.speak("Second", config, 1);
    await vi.waitFor(() => expect(clips).toHaveLength(2));
    player.stop();
    await stopped;
    expect(clips[1].onended).toBeNull();
  });
  it("does not play downloads completed after stop", async () => {
    let resolve!: (value: typeof response) => void;
    const pending = {
      promise: new Promise<typeof response>((done) => {
        resolve = done;
      }),
      resolve: (value: typeof response) => resolve(value),
    };
    synthesizeSpeech.mockReturnValue(pending.promise);
    const player = new CloudSpeechPlayer();
    const speaking = player.speak("Late", config, 1);
    player.stop();
    pending.resolve(response);
    await speaking;
    expect(clips).toHaveLength(0);
  });
  it("settles replaced playback and reports audio errors", async () => {
    const player = new CloudSpeechPlayer();
    const first = player.speak("First", config, 1);
    await vi.waitFor(() => expect(clips).toHaveLength(1));
    const next = player.speak("Next", config, 1);
    const rejected = expect(next).rejects.toMatchObject({ code: "playback" });
    await vi.waitFor(() => expect(clips).toHaveLength(2));
    await first;
    clips[1].onerror?.();
    await rejected;
    expect(clips[1].pause).toHaveBeenCalled();
  });
  it.each(["AbortError", "NotAllowedError"])(
    "handles play rejection: %s",
    async (name) => {
      vi.stubGlobal(
        "Audio",
        class extends FakeAudio {
          play = vi.fn().mockRejectedValue({ name });
        },
      );
      const speaking = new CloudSpeechPlayer().speak("Text", config, 1);
      if (name === "AbortError") await expect(speaking).resolves.toBeUndefined();
      else await expect(speaking).rejects.toMatchObject({ code: "playback" });
    },
  );
});
