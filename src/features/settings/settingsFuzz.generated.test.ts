import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultSettings,
  loadSettings,
  settingsStorageKey,
  type AppSettings,
  type ColorTheme,
} from "./settings";

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const colorThemes: ColorTheme[] = [
  "graphite",
  "midnight",
  "forest",
  "sepia",
  "studio",
  "paper",
];
const engines: AppSettings["defaultEngine"][] = ["pdflatex", "xelatex", "lualatex"];
const fontSizes = [11, 12, 13.5, 15, 18, 22];

const booleanKeys = (Object.keys(defaultSettings) as (keyof AppSettings)[]).filter(
  (key) => typeof defaultSettings[key] === "boolean",
);

/** Builds a fully valid settings object with randomized values. */
function randomizedSettings(seed: number): AppSettings {
  const random = mulberry32(seed * 1000003);
  const next: AppSettings = { ...defaultSettings };
  for (const key of booleanKeys) {
    (next as unknown as Record<string, unknown>)[key] = random() > 0.5;
  }
  next.colorTheme = colorThemes[Math.floor(random() * colorThemes.length)];
  next.defaultEngine = engines[Math.floor(random() * engines.length)];
  next.editorFontSize = fontSizes[Math.floor(random() * fontSizes.length)];
  return next;
}

const seeds = Array.from({ length: 300 }, (_, index) => ({ seed: index + 1 }));

describe("generated settings persistence fuzz", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it.each(seeds)("seed $seed: every field survives a round trip", ({ seed }) => {
    const settings = randomizedSettings(seed);
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings));

    const loaded = loadSettings();
    for (const key of Object.keys(defaultSettings) as (keyof AppSettings)[]) {
      expect(loaded[key], String(key)).toEqual(settings[key]);
    }
  });
});

const corruptionValues = [null, 123, "garbage", [], {}, true];

const corruptionCases = (Object.keys(defaultSettings) as (keyof AppSettings)[]).flatMap(
  (key) =>
    corruptionValues
      .filter((value) => typeof value !== typeof defaultSettings[key])
      // projectTreeIgnoredNames intentionally accepts strings as a
      // comma/newline separated list, so a string is not corruption for it.
      .filter(
        (value) => !(key === "projectTreeIgnoredNames" && typeof value === "string"),
      )
      .map((value) => ({
        name: `${String(key)} = ${JSON.stringify(value)}`,
        key,
        value,
      })),
);

describe("generated settings corruption recovery", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it.each(corruptionCases)("recovers default for $name", ({ key, value }) => {
    window.localStorage.setItem(
      settingsStorageKey,
      JSON.stringify({ ...defaultSettings, [key]: value }),
    );

    const loaded = loadSettings();
    expect(loaded[key]).toEqual(defaultSettings[key]);
  });
});
