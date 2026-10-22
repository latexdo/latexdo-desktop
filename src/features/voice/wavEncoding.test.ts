import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeWavPcm16, toWhisperWav } from "./wavEncoding";

describe("encodeWavPcm16", () => {
  it("writes a 16 kHz mono 16-bit PCM WAV header and clamps samples", () => {
    const wav = new DataView(encodeWavPcm16(new Float32Array([0, 1, -1, 2]), 16_000));
    const text = (offset: number) =>
      String.fromCharCode(...[0, 1, 2, 3].map((i) => wav.getUint8(offset + i)));
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(wav.getUint16(22, true)).toBe(1);
    expect(wav.getUint32(24, true)).toBe(16_000);
    expect(wav.getUint16(34, true)).toBe(16);
    expect(wav.getUint32(40, true)).toBe(8);
    expect(wav.getInt16(46, true)).toBe(0x7fff);
    expect(wav.getInt16(48, true)).toBe(-0x8000);
    expect(wav.getInt16(50, true)).toBe(0x7fff);
  });

  it("passes WAV recordings through untouched", async () => {
    const wav = new Blob(["x"], { type: "audio/wav" });
    expect(await toWhisperWav(wav)).toBe(wav);
  });

  describe("with Web Audio", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function stubWebAudio(
      options: { decodeError?: Error; audioContextKey?: string } = {},
    ) {
      const close = vi.fn(async () => undefined);
      const decoded = { duration: 0.5 };
      const decodeAudioData = vi.fn(async () => {
        if (options.decodeError) throw options.decodeError;
        return decoded;
      });
      class FakeAudioContext {
        decodeAudioData = decodeAudioData;
        close = close;
      }
      const source = { buffer: null as unknown, connect: vi.fn(), start: vi.fn() };
      const offlineArgs: unknown[][] = [];
      class FakeOfflineAudioContext {
        destination = { kind: "destination" };
        constructor(...args: unknown[]) {
          offlineArgs.push(args);
        }
        createBufferSource() {
          return source;
        }
        async startRendering() {
          return { getChannelData: () => new Float32Array([0.5, -0.5]) };
        }
      }
      vi.stubGlobal("AudioContext", undefined);
      vi.stubGlobal(options.audioContextKey ?? "AudioContext", FakeAudioContext);
      vi.stubGlobal("OfflineAudioContext", FakeOfflineAudioContext);
      return { close, decodeAudioData, decoded, source, offlineArgs };
    }

    it("decodes, resamples to 16 kHz mono and re-encodes as WAV", async () => {
      const audio = stubWebAudio();
      const result = await toWhisperWav(new Blob(["opus"], { type: "audio/webm" }));
      expect(result.type).toBe("audio/wav");
      expect(audio.offlineArgs).toEqual([[1, 8000, 16_000]]);
      expect(audio.source.buffer).toBe(audio.decoded);
      expect(audio.source.connect).toHaveBeenCalledWith({ kind: "destination" });
      expect(audio.source.start).toHaveBeenCalled();
      expect(audio.close).toHaveBeenCalled();
      const view = new DataView(await result.arrayBuffer());
      expect(view.getUint32(40, true)).toBe(4);
      expect(view.getInt16(44, true)).toBe(Math.trunc(0.5 * 0x7fff));
      expect(view.getInt16(46, true)).toBe(-0x4000);
    });

    it("falls back to the webkit-prefixed AudioContext", async () => {
      const audio = stubWebAudio({ audioContextKey: "webkitAudioContext" });
      const result = await toWhisperWav(new Blob(["opus"], { type: "audio/webm" }));
      expect(result.type).toBe("audio/wav");
      expect(audio.decodeAudioData).toHaveBeenCalled();
    });

    it("closes the context even when decoding fails", async () => {
      const audio = stubWebAudio({ decodeError: new Error("bad audio") });
      await expect(
        toWhisperWav(new Blob(["opus"], { type: "audio/webm" })),
      ).rejects.toThrow("bad audio");
      expect(audio.close).toHaveBeenCalled();
    });

    it("passes the recording through without OfflineAudioContext", async () => {
      stubWebAudio();
      vi.stubGlobal("OfflineAudioContext", undefined);
      const webm = new Blob(["opus"], { type: "audio/webm" });
      expect(await toWhisperWav(webm)).toBe(webm);
    });
  });
});
