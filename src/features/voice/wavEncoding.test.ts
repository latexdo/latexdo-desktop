import { describe, expect, it } from "vitest";
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
});
