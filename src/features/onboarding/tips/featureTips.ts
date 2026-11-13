/*
 * "Did you know?" tips: a gentle nudge toward a feature someone has not found
 * on their own. Tips are patient by design: none on the first day or before
 * some real use, at most one every few days, never for a feature already
 * used, and never twice in a row for the same one.
 */

import { loadDiscoveryStore } from "../core/DiscoveryStore";

export type FeatureTipAction = "open-ai-settings";

export interface FeatureTip {
  id: string;
  /** The discovery-store feature this tip is about. */
  featureId: string;
  emoji: string;
  title: string;
  body: string;
  /** A button that takes the person straight to the feature. */
  action?: { id: FeatureTipAction; label: string };
}

/** In the order they are offered. */
export const featureTips: readonly FeatureTip[] = [
  {
    id: "ai-choice",
    featureId: "ai.provider-choice",
    emoji: "✨",
    title: "Choose the AI that suits you",
    body: "LatexDo AI works out of the box, but you can switch to Claude, ChatGPT, Gemini, Mistral and more, or keep everything on your computer with Ollama or a local model.",
    action: { id: "open-ai-settings", label: "Choose my AI" },
  },
  {
    id: "pdf-source-jump",
    featureId: "pdf.source-jump",
    emoji: "🎯",
    title: "Jump from the PDF to your LaTeX",
    body: "Click any word in the PDF preview to land on its line in the source. Double-click in the editor to find a line in the PDF.",
  },
  {
    id: "pdf-reading-theme",
    featureId: "pdf.reading-theme",
    emoji: "🌙",
    title: "Easier on the eyes",
    body: "Read your PDF in sepia, dark or midnight with the theme button above the preview. Your exported PDF does not change.",
  },
  {
    id: "pdf-listen",
    featureId: "pdf.listen",
    emoji: "🎧",
    title: "Listen to your paper",
    body: "Press the headphones above the PDF to hear your paper read aloud. Awkward sentences are easier to catch by ear.",
  },
];

const dayMs = 24 * 60 * 60 * 1000;

/** When tips may start, and how far apart they are. */
export const tipPacing = Object.freeze({
  /** Nothing in the first day after LatexDo is first opened… */
  minAgeMs: dayMs,
  /** …nor before this much time actually spent in it. */
  minActiveMs: 20 * 60 * 1000,
  /** Days between two tips, whichever they are. */
  gapMs: 3 * dayMs,
  /** A tip put off with "Not now" may come back once, this much later. */
  retryMs: 14 * dayMs,
  maxShows: 2,
});

export interface TipRecord {
  shownCount: number;
  lastShownAt: number;
  /** Followed or acknowledged: never shown again. */
  done?: boolean;
}

export interface TipsState {
  firstSeenAt: number;
  activeMs: number;
  lastTipAt: number | null;
  tips: Record<string, TipRecord>;
}

export const tipsStorageKey = "latexdo.tips.v1";

export function loadTipsState(now = Date.now()): TipsState {
  try {
    const raw = JSON.parse(
      localStorage.getItem(tipsStorageKey) ?? "null",
    ) as Partial<TipsState> | null;
    if (raw && typeof raw === "object" && typeof raw.firstSeenAt === "number") {
      return {
        firstSeenAt: raw.firstSeenAt,
        activeMs: typeof raw.activeMs === "number" ? raw.activeMs : 0,
        lastTipAt: typeof raw.lastTipAt === "number" ? raw.lastTipAt : null,
        tips: raw.tips && typeof raw.tips === "object" ? raw.tips : {},
      };
    }
  } catch {
    // Storage may be unavailable; start fresh.
  }
  return { firstSeenAt: now, activeMs: 0, lastTipAt: null, tips: {} };
}

export function saveTipsState(state: TipsState): void {
  try {
    localStorage.setItem(tipsStorageKey, JSON.stringify(state));
  } catch {
    // Tips are a nicety; losing their progress is harmless.
  }
}

/** True once the person has used (not just been told about) the feature. */
export function featureUsed(featureId: string): boolean {
  const state = loadDiscoveryStore().features[featureId]?.state;
  return state === "tried" || state === "mastered";
}

/** The tip to offer now, or null when it is not the moment. */
export function nextTip(
  state: TipsState,
  now: number,
  used: (featureId: string) => boolean = featureUsed,
  tips: readonly FeatureTip[] = featureTips,
): FeatureTip | null {
  if (now - state.firstSeenAt < tipPacing.minAgeMs) return null;
  if (state.activeMs < tipPacing.minActiveMs) return null;
  if (state.lastTipAt !== null && now - state.lastTipAt < tipPacing.gapMs) return null;
  for (const tip of tips) {
    const record = state.tips[tip.id];
    if (record?.done || used(tip.featureId)) continue;
    if (record && record.shownCount >= tipPacing.maxShows) continue;
    if (record && now - record.lastShownAt < tipPacing.retryMs) continue;
    return tip;
  }
  return null;
}

/** The state after a tip is shown. */
export function recordTipShown(
  state: TipsState,
  tip: FeatureTip,
  now: number,
): TipsState {
  const previous = state.tips[tip.id];
  return {
    ...state,
    lastTipAt: now,
    tips: {
      ...state.tips,
      [tip.id]: { shownCount: (previous?.shownCount ?? 0) + 1, lastShownAt: now },
    },
  };
}

/** The state after a tip is followed or acknowledged. */
export function recordTipDone(state: TipsState, tip: FeatureTip): TipsState {
  const previous = state.tips[tip.id] ?? { shownCount: 1, lastShownAt: Date.now() };
  return { ...state, tips: { ...state.tips, [tip.id]: { ...previous, done: true } } };
}
