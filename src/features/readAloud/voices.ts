// Picks voices that sound good for reading a paper: high-quality system voices
// first, novelty voices hidden, the paper's language before the others.

export interface VoiceLike {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default?: boolean;
}

export type VoiceQuality = "premium" | "enhanced" | "natural" | "standard";

/** macOS character voices — fun, but not for reading a paper. */
const noveltyVoices = new Set(
  [
    "Albert",
    "Bad News",
    "Bahh",
    "Bells",
    "Boing",
    "Bubbles",
    "Cellos",
    "Deranged",
    "Good News",
    "Hysterical",
    "Jester",
    "Organ",
    "Pipe Organ",
    "Superstar",
    "Trinoids",
    "Whisper",
    "Wobble",
    "Zarvox",
    "Fred",
    "Junior",
    "Ralph",
    "Kathy",
    "Princess",
    "Bruce",
    "Agnes",
    "Vicki",
    "Victoria",
    "Grandma",
    "Grandpa",
    "Rocko",
    "Shelley",
    "Flo",
    "Eddy",
    "Reed",
    "Sandy",
  ].map((name) => name.toLowerCase()),
);

function baseName(name: string): string {
  return (
    name
      // "Microsoft Aria Online (Natural) - English (United States)"
      .replace(/\s+-\s+.*$/, "")
      .replace(/\s*\((?:premium|enhanced)\)\s*/gi, " ")
      .replace(
        /\s*\((?:[^)]*\b(?:english|united states|united kingdom|australia|ireland|india|canada|south africa)\b[^)]*)\)\s*/gi,
        " ",
      )
      .replace(/^(?:microsoft|google)\s+/i, "")
      .replace(/\s+online\s*\(natural\)/i, "")
      .trim()
  );
}

export function isNoveltyVoice(voice: VoiceLike): boolean {
  return noveltyVoices.has(baseName(voice.name).toLowerCase());
}

export function voiceQuality(voice: VoiceLike): VoiceQuality {
  const name = voice.name.toLowerCase();
  if (name.includes("premium")) return "premium";
  if (name.includes("enhanced")) return "enhanced";
  if (/\b(natural|neural|siri|online)\b/.test(name) || name.startsWith("google ")) {
    return "natural";
  }
  return "standard";
}

const qualityRank: Record<VoiceQuality, number> = {
  premium: 3,
  enhanced: 2,
  natural: 2,
  standard: 0,
};

export const voiceQualityLabel: Record<VoiceQuality, string> = {
  premium: "Premium",
  enhanced: "Enhanced",
  natural: "Natural",
  standard: "Standard",
};

function languageScore(voiceLang: string, preferred: string): number {
  const voice = voiceLang.toLowerCase().replace("_", "-");
  const wanted = preferred.toLowerCase().replace("_", "-");
  if (voice === wanted) return 2;
  if (voice.split("-")[0] === wanted.split("-")[0]) return 1;
  return 0;
}

/** Voices worth offering, best first. */
export function rankVoices<T extends VoiceLike>(
  voices: T[],
  preferredLang = "en-US",
): T[] {
  return voices
    .filter((voice) => !isNoveltyVoice(voice))
    .map((voice, order) => ({ voice, order }))
    .sort((a, b) => {
      const language =
        languageScore(b.voice.lang, preferredLang) -
        languageScore(a.voice.lang, preferredLang);
      if (language) return language;
      const quality =
        qualityRank[voiceQuality(b.voice)] - qualityRank[voiceQuality(a.voice)];
      if (quality) return quality;
      // Offline voices keep reading without a network.
      if (a.voice.localService !== b.voice.localService)
        return a.voice.localService ? -1 : 1;
      return a.order - b.order;
    })
    .map(({ voice }) => voice);
}

/** The saved voice when it is still installed, otherwise the best one. */
export function pickVoice<T extends VoiceLike>(
  voices: T[],
  voiceURI: string,
  preferredLang = "en-US",
): T | null {
  return (
    voices.find((voice) => voice.voiceURI === voiceURI) ??
    rankVoices(voices, preferredLang)[0] ??
    null
  );
}

export function voiceDisplayName(voice: VoiceLike): string {
  return baseName(voice.name) || voice.name;
}

const regionNames: Record<string, string> = {
  "en-us": "US",
  "en-gb": "UK",
  "en-au": "Australia",
  "en-ie": "Ireland",
  "en-in": "India",
  "en-ca": "Canada",
  "en-za": "South Africa",
  "en-nz": "New Zealand",
  "en-sc": "Scotland",
};

export function voiceRegion(voice: VoiceLike): string {
  const lang = voice.lang.toLowerCase().replace("_", "-");
  if (regionNames[lang]) return regionNames[lang];
  try {
    const display = new Intl.DisplayNames(["en"], { type: "language" });
    return display.of(voice.lang) ?? voice.lang;
  } catch {
    return voice.lang;
  }
}
