import { describe, expect, it } from "vitest";
import {
  defaultReadAloudSettings,
  normalizeReadAloudSettings,
  pauseBefore,
  speechParts,
} from "./readAloudSettings";
import { cloudConfig, remapPosition } from "./useReadAloud";
import {
  pickVoice,
  rankVoices,
  voiceDisplayName,
  voiceQuality,
  type VoiceLike,
} from "./voices";
import type { PaperSentence } from "./paperText";

const voice = (name: string, lang = "en-US", localService = true): VoiceLike => ({
  name,
  lang,
  voiceURI: `uri:${name}`,
  localService,
});

describe("voices", () => {
  const voices = [
    voice("Zarvox"),
    voice("Samantha"),
    voice("Thomas", "fr-FR"),
    voice("Ava (Premium)"),
    voice("Daniel (Enhanced)", "en-GB"),
    voice("Google US English", "en-US", false),
  ];

  it("ranks the paper's language and the best quality first, hiding novelty voices", () => {
    expect(rankVoices(voices, "en-US").map((v) => v.name)).toEqual([
      "Ava (Premium)",
      "Google US English",
      "Samantha",
      "Daniel (Enhanced)",
      "Thomas",
    ]);
  });

  it("keeps a saved voice and falls back to the best one", () => {
    expect(pickVoice(voices, "uri:Samantha")?.name).toBe("Samantha");
    expect(pickVoice(voices, "uri:gone")?.name).toBe("Ava (Premium)");
    expect(pickVoice([], "")).toBeNull();
  });

  it("names voices cleanly", () => {
    expect(voiceQuality(voice("Ava (Premium)"))).toBe("premium");
    expect(
      voiceQuality(voice("Microsoft Aria Online (Natural) - English (United States)")),
    ).toBe("natural");
    expect(voiceDisplayName(voice("Ava (Premium)"))).toBe("Ava");
    expect(
      voiceDisplayName(
        voice("Microsoft Aria Online (Natural) - English (United States)"),
      ),
    ).toBe("Aria");
  });
});

describe("settings", () => {
  it("normalizes unknown or out-of-range values", () => {
    expect(normalizeReadAloudSettings(null)).toEqual(defaultReadAloudSettings);
    expect(
      normalizeReadAloudSettings({
        rate: 9,
        pitch: 3,
        pauseStyle: "loud",
        skipCitations: false,
      }),
    ).toEqual({ ...defaultReadAloudSettings, skipCitations: false });
    expect(
      normalizeReadAloudSettings({ rate: 1.25, pauseStyle: "deliberate" }),
    ).toMatchObject({
      rate: 1.25,
      pauseStyle: "deliberate",
    });
  });
});

describe("pauses", () => {
  const text = { kind: "text", paragraphStart: false };
  const paragraph = { kind: "text", paragraphStart: true };
  const heading = { kind: "heading", paragraphStart: true };

  it("waits longer before paragraphs and sections", () => {
    const sentence = pauseBefore(text, text, "natural");
    const para = pauseBefore(paragraph, text, "natural");
    const section = pauseBefore(heading, text, "natural");
    expect(sentence).toBeLessThan(para);
    expect(para).toBeLessThan(section);
    expect(pauseBefore(text, text, "relaxed")).toBeGreaterThan(sentence);
    expect(pauseBefore(undefined, text, "natural")).toBe(0);
  });

  it("stops at every clause in study mode only", () => {
    const sentence =
      "First we train the model, then we test it on held-out data; finally we report.";
    expect(speechParts(sentence, "natural")).toEqual([sentence]);
    expect(speechParts(sentence, "deliberate")).toEqual([
      "First we train the model,",
      "then we test it on held-out data;",
      "finally we report.",
    ]);
  });

  it("splits very long sentences so engines do not cut out", () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    const parts = speechParts(long, "natural");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(" ")).toBe(long);
  });
});

describe("remapPosition", () => {
  const s = (page: number, text: string) =>
    ({
      page,
      text,
      spoken: text,
      kind: "text",
      paragraphStart: false,
      rects: [],
    }) as PaperSentence;

  it("finds the same sentence after a recompile", () => {
    const next = [s(1, "A."), s(1, "B."), s(2, "C.")];
    expect(remapPosition(s(1, "B."), next)).toBe(1);
    expect(remapPosition(s(2, "Changed."), next)).toBe(2);
    expect(remapPosition(undefined, next)).toBe(0);
  });
});

describe("cloud voices", () => {
  it("keeps cloud choices valid", () => {
    expect(
      normalizeReadAloudSettings({
        engine: "openai",
        openaiVoice: "sage",
        openaiModel: "made-up",
        elevenLabsVoice: "../x",
      }),
    ).toMatchObject({
      engine: "openai",
      openaiVoice: "sage",
      openaiModel: "gpt-4o-mini-tts",
      elevenLabsVoice: "",
    });
  });

  it("chooses the request for each voice source", () => {
    const base = defaultReadAloudSettings;
    expect(cloudConfig(base)).toBeNull();
    expect(
      cloudConfig({ ...base, engine: "openai", openaiVoice: "sage" }),
    ).toMatchObject({
      provider: "openai",
      voice: "sage",
      model: "gpt-4o-mini-tts",
    });
    // tts-1 has no "sage": fall back to a voice it knows.
    expect(
      cloudConfig({
        ...base,
        engine: "openai",
        openaiVoice: "sage",
        openaiModel: "tts-1",
      })?.voice,
    ).toBe("alloy");
    expect(cloudConfig({ ...base, engine: "elevenlabs" })).toBeNull();
    expect(
      cloudConfig({ ...base, engine: "elevenlabs", elevenLabsVoice: "v1" }),
    ).toMatchObject({ provider: "elevenlabs", voice: "v1" });
  });
});
