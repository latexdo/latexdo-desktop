// The bundled whisper.cpp server reads WAV, not the WebM/Opus a browser
// records, so local recordings are converted here: decoded with Web Audio,
// resampled to 16 kHz mono (what Whisper expects) and written as 16-bit PCM.

const whisperSampleRate = 16_000;

/** A 16-bit PCM mono WAV file for these samples. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

/** The recording as 16 kHz mono WAV; WAV input and non-browser runtimes pass through. */
export async function toWhisperWav(audio: Blob): Promise<Blob> {
  if (/wav/i.test(audio.type)) return audio;
  const AudioContextClass =
    globalThis.AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass || typeof OfflineAudioContext === "undefined") return audio;

  const context = new AudioContextClass();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await audio.arrayBuffer());
  } finally {
    void context.close();
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * whisperSampleRate));
  // One output channel: Web Audio mixes stereo down on the way.
  const offline = new OfflineAudioContext(1, frames, whisperSampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return new Blob([encodeWavPcm16(rendered.getChannelData(0), whisperSampleRate)], {
    type: "audio/wav",
  });
}
