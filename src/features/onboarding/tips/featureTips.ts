/*
 * "Did you know?" tips: a gentle nudge toward a feature someone has not found
 * on their own. Tips are patient by design: none on the first day or before
 * some real use, at most one every few days, never for a feature already
 * used, and never twice in a row for the same one.
 */

import { loadDiscoveryStore } from "../core/DiscoveryStore";

export type TipRequirement = "shared" | "tableGenerator" | "notationManager";

export interface FeatureTip {
  id: string;
  /**
   * The discovery-store feature this tip is about. Using it retires the tip:
   * "command.<menu command>", "sidebar.<view>", "tool.<tool tab>", or a
   * feature the app reports itself.
   */
  featureId: string;
  emoji: string;
  title: string;
  body: string;
  /** A button running a menu command that takes the person to the feature. */
  action?: { command: string; label: string };
  /**
   * Only offered when this is available: "shared" (a shared project) or a
   * built-in tool that can be switched off in Settings.
   */
  requires?: TipRequirement;
}

/** In the order they are offered (about one every few days). */
export const featureTips: readonly FeatureTip[] = [
  {
    id: "ai-choice",
    featureId: "ai.provider-choice",
    emoji: "✨",
    title: "Choose the AI that suits you",
    body: "LatexDo AI works out of the box, but you can switch to Claude, ChatGPT, Gemini, Mistral and more, or keep everything on your computer with Ollama or a local model.",
    action: { command: "tools.aiSettings", label: "Choose my AI" },
  },
  {
    id: "pdf-source-jump",
    featureId: "pdf.source-jump",
    emoji: "🎯",
    title: "Jump from the PDF to your LaTeX",
    body: "Click any word in the PDF preview to land on its line in the source. Double-click in the editor to find a line in the PDF.",
  },
  {
    id: "history",
    featureId: "sidebar.history",
    emoji: "🕰️",
    title: "See what your co-authors changed",
    body: "History shows who changed which file and when, with every added and removed line. Click a change to jump to it.",
    action: { command: "view.history", label: "Open History" },
    requires: "shared",
  },
  {
    id: "review-paper",
    featureId: "command.tools.reviewPaper",
    emoji: "🧐",
    title: "Get a reviewer's eye on your paper",
    body: "Review Paper with AI reads your manuscript like a referee and points out unclear claims, missing details and weak spots before you submit.",
    action: { command: "tools.reviewPaper", label: "Review my paper" },
  },
  {
    id: "discussion",
    featureId: "sidebar.discussion",
    emoji: "💬",
    title: "Talk to your co-authors right here",
    body: "The Discussion panel lets you message everyone or one person privately, @mention people and react to messages, without leaving your paper.",
    action: { command: "view.discussion", label: "Open Discussion" },
    requires: "shared",
  },
  {
    id: "citation-manager",
    featureId: "tool.citationManager",
    emoji: "📚",
    title: "All your references in one place",
    body: "The Citation Manager lets you search your references, insert citations and clear out unused entries without opening the .bib file.",
    action: { command: "view.tool.citationManager", label: "Open Citation Manager" },
  },
  {
    id: "pdf-reading-theme",
    featureId: "pdf.reading-theme",
    emoji: "🌙",
    title: "Easier on the eyes",
    body: "Read your PDF in sepia, dark or midnight with the theme button above the preview. Your exported PDF does not change.",
  },
  {
    id: "table-generator",
    featureId: "tool.tableGenerator",
    emoji: "🧮",
    title: "Tables without the syntax",
    body: "Fill in a table on a canvas and LatexDo writes the LaTeX for you, ready to insert.",
    action: { command: "view.tool.tableGenerator", label: "Make a table" },
    requires: "tableGenerator",
  },
  {
    id: "compare-pdf",
    featureId: "command.build.comparePdf",
    emoji: "🔍",
    title: "Spot what changed in the PDF",
    body: "Compare PDF Versions puts two versions of your paper side by side, or overlays them, so you can see what changed.",
    action: { command: "build.comparePdf", label: "Compare versions" },
  },
  {
    id: "pdf-listen",
    featureId: "pdf.listen",
    emoji: "🎧",
    title: "Listen to your paper",
    body: "Press the headphones above the PDF to hear your paper read aloud. Awkward sentences are easier to catch by ear.",
  },
  {
    id: "tikz-drawing",
    featureId: "tool.tikzCanvas",
    emoji: "✏️",
    title: "Draw a figure, get TikZ",
    body: "Sketch diagrams with the TikZ Drawing tool and insert them into your document as TikZ code.",
    action: { command: "view.tool.tikzCanvas", label: "Start drawing" },
  },
  {
    id: "proofread",
    featureId: "command.tools.proofread",
    emoji: "📝",
    title: "A second pair of eyes on your writing",
    body: "Check Writing Now looks for spelling, grammar and style slips across your document.",
    action: { command: "tools.proofread", label: "Check my writing" },
  },
  {
    id: "notation-manager",
    featureId: "tool.notationManager",
    emoji: "∑",
    title: "Keep your notation consistent",
    body: "The Notation Manager lists the symbols you use and flags ones that are never defined or easy to confuse with another.",
    action: { command: "view.tool.notationManager", label: "Open Notation Manager" },
    requires: "notationManager",
  },
  {
    id: "go-to-file",
    featureId: "command.go.file",
    emoji: "⚡",
    title: "Jump to any file in a keystroke",
    body: "Press ⌘P (Ctrl+P on Windows and Linux) and type a few letters of a file name to open it.",
  },
  {
    id: "focus-layout",
    featureId: "command.view.layout.focus",
    emoji: "🧘",
    title: "Just you and your text",
    body: "Focus Layout hides the sidebar and bottom panels, leaving just your text and the PDF. Switch back from the View menu.",
    action: { command: "view.layout.focus", label: "Try Focus Layout" },
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
  available: ReadonlySet<TipRequirement> = new Set(),
): FeatureTip | null {
  if (now - state.firstSeenAt < tipPacing.minAgeMs) return null;
  if (state.activeMs < tipPacing.minActiveMs) return null;
  if (state.lastTipAt !== null && now - state.lastTipAt < tipPacing.gapMs) return null;
  for (const tip of tips) {
    if (tip.requires && !available.has(tip.requires)) continue;
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
