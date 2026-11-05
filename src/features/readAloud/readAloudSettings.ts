// Listening preferences for "Listen to paper". Mirrors voiceSettings.ts: its
// own localStorage key, normalized on every load, broadcast on save.
import { defaultPaperTextOptions, type PaperTextOptions } from "./paperText";

export type ReadAloudPauseStyle = "natural" | "relaxed" | "deliberate";
export type ReadAloudStart = "page" | "beginning";

export interface ReadAloudSettings extends PaperTextOptions {
  /** Empty: the best installed voice. */
  voiceURI: string;
  rate: number;
  pitch: number;
  pauseStyle: ReadAloudPauseStyle;
  startFrom: ReadAloudStart;
  followAlong: boolean;
}

export const readAloudSettingsStorageKey = "latexdo.readAloud.config.v1";
export const readAloudSettingsChangedEvent = "latexdo:read-aloud-settings-changed";

export const readAloudRates = [0.75, 0.85, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
export const minReadAloudPitch = 0.8;
export const maxReadAloudPitch = 1.2;

export const readAloudPauseStyles: Array<{
  id: ReadAloudPauseStyle;
  label: string;
  description: string;
}> = [
  {
    id: "natural",
    label: "Natural",
    description: "Pauses like a narrator — at commas, sentences and paragraphs.",
  },
  {
    id: "relaxed",
    label: "Relaxed",
    description: "Longer breaths between sentences and sections.",
  },
  {
    id: "deliberate",
    label: "Study",
    description:
      "A clear stop at every comma and clause — best for dense math or a new topic.",
  },
];

export const defaultReadAloudSettings: ReadAloudSettings = {
  ...defaultPaperTextOptions,
  voiceURI: "",
  rate: 1,
  pitch: 1,
  pauseStyle: "natural",
  startFrom: "page",
  followAlong: true,
};

const bool = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

export function normalizeReadAloudSettings(raw: unknown): ReadAloudSettings {
  const saved = (raw && typeof raw === "object" ? raw : {}) as Partial<
    Record<keyof ReadAloudSettings, unknown>
  >;
  const d = defaultReadAloudSettings;
  return {
    voiceURI: typeof saved.voiceURI === "string" ? saved.voiceURI : d.voiceURI,
    rate: readAloudRates.includes(saved.rate as (typeof readAloudRates)[number])
      ? (saved.rate as number)
      : d.rate,
    pitch:
      typeof saved.pitch === "number" &&
      saved.pitch >= minReadAloudPitch &&
      saved.pitch <= maxReadAloudPitch
        ? saved.pitch
        : d.pitch,
    pauseStyle: readAloudPauseStyles.some((style) => style.id === saved.pauseStyle)
      ? (saved.pauseStyle as ReadAloudPauseStyle)
      : d.pauseStyle,
    startFrom:
      saved.startFrom === "page" || saved.startFrom === "beginning"
        ? saved.startFrom
        : d.startFrom,
    followAlong: bool(saved.followAlong, d.followAlong),
    skipCitations: bool(saved.skipCitations, d.skipCitations),
    skipReferences: bool(saved.skipReferences, d.skipReferences),
    skipEquations: bool(saved.skipEquations, d.skipEquations),
    expandAbbreviations: bool(saved.expandAbbreviations, d.expandAbbreviations),
  };
}

export function loadReadAloudSettings(): ReadAloudSettings {
  try {
    return normalizeReadAloudSettings(
      JSON.parse(window.localStorage.getItem(readAloudSettingsStorageKey) ?? "{}"),
    );
  } catch {
    return defaultReadAloudSettings;
  }
}

export function saveReadAloudSettings(settings: ReadAloudSettings): void {
  try {
    window.localStorage.setItem(readAloudSettingsStorageKey, JSON.stringify(settings));
  } catch {
    // Preferences are a convenience; reading still works without storage.
  }
  window.dispatchEvent(new Event(readAloudSettingsChangedEvent));
}

/** Silence (ms, at normal speed) before the next sentence starts. */
export function pauseBefore(
  next: { kind: string; paragraphStart: boolean } | undefined,
  previous: { kind: string } | undefined,
  style: ReadAloudPauseStyle,
): number {
  const table = {
    natural: { sentence: 140, paragraph: 520, heading: 750 },
    relaxed: { sentence: 380, paragraph: 850, heading: 1100 },
    deliberate: { sentence: 520, paragraph: 1000, heading: 1250 },
  }[style];
  if (!next) return 0;
  if (next.kind === "heading" || previous?.kind === "heading") return table.heading;
  if (next.paragraphStart) return table.paragraph;
  return table.sentence;
}

/** Silence (ms) between the clauses of one sentence. */
export const clausePause = 230;

const maxUtterance = 260;

/**
 * The pieces a sentence is spoken in. "Study" stops at every comma and clause;
 * otherwise long sentences are cut at clause boundaries only, because some
 * speech engines go silent partway through very long utterances.
 */
export function speechParts(spoken: string, style: ReadAloudPauseStyle): string[] {
  const clauses = spoken.split(/(?<=[,;:])\s+(?=\S)/);
  const parts: string[] = [];
  for (const clause of clauses) {
    const last = parts[parts.length - 1];
    const tooShort =
      clause.split(/\s+/).length < 3 || (last ?? "").split(/\s+/).length < 3;
    if (last !== undefined && (style !== "deliberate" || tooShort)) {
      if (style === "deliberate" || (last + " " + clause).length <= maxUtterance) {
        parts[parts.length - 1] = `${last} ${clause}`;
        continue;
      }
    }
    parts.push(clause);
  }
  // A single clause can still be too long; cut it at word boundaries.
  return parts.flatMap((part) => {
    if (part.length <= maxUtterance * 1.5) return [part];
    const words = part.split(/\s+/);
    const pieces: string[] = [];
    let piece = "";
    for (const word of words) {
      if (piece && (piece + " " + word).length > maxUtterance) {
        pieces.push(piece);
        piece = word;
      } else {
        piece = piece ? `${piece} ${word}` : word;
      }
    }
    if (piece) pieces.push(piece);
    return pieces;
  });
}
