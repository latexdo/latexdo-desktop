// Smart starters for the empty AI chat: up to three one-click requests ranked
// from what is happening right now (a failing build, a selection, an empty
// draft, open TODOs) and from what this person usually asks the assistant.
// Pure ranking plus a small localStorage usage log, so it is unit-testable.

import type { Diagnostic } from "../../types";

export type AiSuggestionKind =
  | "error"
  | "warning"
  | "selection"
  | "write"
  | "review"
  | "figure"
  | "sources";

export interface AiSuggestion {
  id: string;
  kind: AiSuggestionKind;
  /** Short action shown on the card; also the chat's display text. */
  label: string;
  /** Why it is offered now ("Undefined control sequence · main.tex:42"). */
  reason: string;
  /** Full instruction sent to the model. */
  prompt: string;
  /** True when past usage lifted it into the list. */
  fromHistory?: boolean;
}

export interface AiSuggestionUsageEntry {
  count: number;
  lastUsed: number;
}

export type AiSuggestionUsage = Record<string, AiSuggestionUsageEntry>;

export interface AiSuggestionSignals {
  hasProject: boolean;
  workspaceKind: "document" | "knowledge-graph" | "other" | null;
  activeFile: string | null;
  compiling: boolean;
  /** Last build of the project, or null before the first one. */
  compile: { ok: boolean; diagnostics: Diagnostic[] } | null;
  selectionText: string;
  documentText: string;
  usage: AiSuggestionUsage;
  now: number;
}

interface Candidate extends AiSuggestion {
  score: number;
  /**
   * Cards from one group are capped so one signal can't fill the list;
   * generic fallbacks are exempt so there are always cards to show.
   */
  group: string;
}

const dayMs = 24 * 60 * 60 * 1000;
const missingToolchainCodes = new Set([
  "missing-latex-toolchain",
  "missing-asymptote-toolchain",
]);

function baseName(path: string): string {
  const i = path.replace(/\\/g, "/").lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function location(d: Diagnostic): string {
  const file = d.file ? baseName(d.file) : "";
  if (!file) return "";
  return d.line > 0 ? `${file}:${d.line}` : file;
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function describeDiagnostics(list: Diagnostic[], max = 6): string {
  return list
    .slice(0, max)
    .map((d) => {
      const where = location(d);
      return `- ${where ? `${where}: ` : ""}${d.message}`;
    })
    .join("\n");
}

/** The document body, without the preamble and comments. */
function bodyOf(text: string): string {
  const begin = text.indexOf("\\begin{document}");
  const end = text.lastIndexOf("\\end{document}");
  const body =
    begin === -1 ? text : text.slice(begin + 16, end > begin ? end : undefined);
  return body.replace(/(^|[^\\])%.*$/gm, "$1");
}

function countTodos(text: string): number {
  return (text.match(/\\todo\b|\bTODO\b|\bFIXME\b|\bTBD\b|\bXXX\b/g) ?? []).length;
}

function looksLikeTikz(text: string): boolean {
  return /\\begin\{tikzpicture\}|\\draw\b|\\node\b/.test(text);
}

function looksLikeMath(text: string): boolean {
  return /\\begin\{(equation|align|gather|multline)\*?\}|\$\$|\\\[|\\frac|\\sum|\\int/.test(
    text,
  );
}

function compileCandidates(s: AiSuggestionSignals): Candidate[] {
  if (!s.compile || s.compiling) return [];
  const diagnostics = s.compile.diagnostics.filter(
    (d) => !d.source || d.source === "latex",
  );
  // A missing TeX install is a setup task the app already explains; the
  // assistant can't install it.
  if (diagnostics.some((d) => d.code && missingToolchainCodes.has(d.code))) return [];
  const out: Candidate[] = [];
  const errors = diagnostics.filter((d) => d.severity === "error" && !d.isCascade);
  const allErrors = diagnostics.filter((d) => d.severity === "error");
  if (allErrors.length || !s.compile.ok) {
    const primary =
      diagnostics.find((d) => d.isPrimary) ?? errors[0] ?? allErrors[0] ?? null;
    const shown = errors.length ? errors : allErrors;
    const where = primary ? location(primary) : "";
    const reason = primary
      ? `${truncate(primary.message, 60)}${where ? ` · ${where}` : ""}`
      : "The last build failed";
    const listing = shown.length
      ? `The last build reported these errors:\n${describeDiagnostics(shown)}\n\n`
      : "The last build failed.\n\n";
    out.push({
      id: "fix-compile",
      group: "compile",
      kind: "error",
      label:
        shown.length > 1
          ? `Fix the ${plural(shown.length, "compile error")}`
          : "Fix the compile error",
      reason,
      prompt: `${listing}Find the root cause of each error, fix it in the source with the smallest change that keeps the author's intent, then compile again to verify the build is clean. Briefly say what was wrong.`,
      score: 100,
    });
    out.push({
      id: "explain-compile",
      group: "compile",
      kind: "error",
      label: "Explain why the build fails",
      reason: shown.length
        ? `${plural(shown.length, "error")} in the last build`
        : "The last build failed",
      prompt: `${listing}Explain in plain words what each error means and what in the source causes it. Do not edit anything yet; suggest the fix for each one.`,
      score: 62,
    });
  }
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const unresolved = warnings.filter((d) =>
    /(citation|reference).*undefined|undefined (citation|reference)|there were undefined/i.test(
      d.message,
    ),
  );
  if (unresolved.length) {
    const cites = unresolved.filter((d) => /citation/i.test(d.message)).length;
    const noun =
      cites === unresolved.length
        ? "undefined citation"
        : cites === 0
          ? "undefined reference"
          : "undefined citation or reference";
    out.push({
      id: "fix-undefined-refs",
      group: "warnings",
      kind: "warning",
      label: `Resolve ${plural(unresolved.length, noun)}`,
      reason: truncate(unresolved[0].message, 70),
      prompt: `The last build reported undefined citations or references:\n${describeDiagnostics(unresolved, 10)}\n\nFor each one, check the bibliography and \\label names for a typo or a missing entry, fix the key, or tell me which entries are missing from the bibliography. Re-compile to confirm.`,
      score: 84,
    });
  }
  const boxes = warnings.filter((d) => /overfull \\hbox|overfull/i.test(d.message));
  if (boxes.length) {
    out.push({
      id: "fix-overfull",
      group: "warnings",
      kind: "warning",
      label: `Fix ${plural(boxes.length, "overfull line")}`,
      reason: `${truncate(boxes[0].message, 50)}${location(boxes[0]) ? ` · ${location(boxes[0])}` : ""}`,
      prompt: `The last build reported overfull boxes (text running into the margin):\n${describeDiagnostics(boxes, 8)}\n\nFix each one with minimal changes: rephrase, allow hyphenation, break long URLs or code, or resize the figure or table. Re-compile to verify.`,
      score: 44,
    });
  }
  return out;
}

function selectionCandidates(s: AiSuggestionSignals): Candidate[] {
  const text = s.selectionText.trim();
  if (text.length < 3) return [];
  const preview = `“${truncate(text, 48)}”`;
  const out: Candidate[] = [];
  if (looksLikeTikz(text)) {
    out.push({
      id: "improve-figure",
      group: "selection",
      kind: "figure",
      label: "Improve this figure",
      reason: "TikZ code selected",
      prompt:
        "Improve the selected TikZ figure: cleaner layout and spacing, consistent styles, readable labels. Keep it compiling and replace the selection.",
      score: 88,
    });
  } else if (looksLikeMath(text) && text.length < 600) {
    out.push({
      id: "explain-math",
      group: "selection",
      kind: "selection",
      label: "Explain this math",
      reason: preview,
      prompt:
        "Explain the selected mathematics step by step in plain words, and point out any notation or typesetting problem.",
      score: 80,
    });
  }
  out.push({
    id: "rewrite-selection",
    group: "selection",
    kind: "selection",
    label: "Rewrite the selection",
    reason: preview,
    prompt:
      "Rewrite the currently selected text to be clearer and more concise, preserving meaning, LaTeX validity, and the document's style.",
    score: 86,
  });
  const words = text.split(/\s+/).length;
  if (words >= 12 && !/\\cite\w*\{/.test(text) && !looksLikeTikz(text)) {
    out.push({
      id: "cite-selection",
      group: "selection",
      kind: "sources",
      label: "Find citations for this passage",
      reason: `${words} words without a \\cite`,
      prompt:
        "Recommend citations from the project bibliography for the currently selected passage and insert the best \\cite keys.",
      score: 64,
    });
  }
  return out;
}

function documentCandidates(s: AiSuggestionSignals): Candidate[] {
  if (s.workspaceKind === "knowledge-graph") {
    return [
      {
        id: "related-sources",
        group: "sources",
        kind: "sources",
        label: "Show sources related to my paper",
        reason: "Knowledge Graph open",
        prompt:
          "Filter the Knowledge Graph to the bibliography entries most related to my paper and explain briefly why each one is relevant.",
        score: 90,
      },
      {
        id: "uncited-sources",
        group: "sources",
        kind: "sources",
        label: "Which sources haven't I cited?",
        reason: "Knowledge Graph open",
        prompt:
          "Compare the bibliography with what the paper cites, and list the relevant entries I have not cited yet, with where they would fit.",
        score: 58,
      },
    ];
  }
  if (!s.activeFile || !/\.(tex|ltx|sty|cls|bib)$/i.test(s.activeFile)) return [];
  const file = baseName(s.activeFile);
  const out: Candidate[] = [];
  const isBib = /\.bib$/i.test(s.activeFile);
  if (isBib) {
    out.push({
      id: "tidy-bib",
      group: "document",
      kind: "review",
      label: "Clean up this bibliography",
      reason: file,
      prompt:
        "Check the open .bib file for duplicate keys, missing required fields, inconsistent capitalisation of titles, and malformed entries. Propose the fixes.",
      score: 50,
    });
    return out;
  }
  const body = bodyOf(s.documentText);
  const words = body
    .replace(/\\[a-zA-Z@]+\*?/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  const sections = (body.match(/\\(sub)*section\*?\{/g) ?? []).length;
  if (words < 120) {
    out.push({
      id: "draft-outline",
      group: "document",
      kind: "write",
      label: "Draft an outline for this paper",
      reason:
        words < 20 ? `${file} is still empty` : `${file} has ${words} words so far`,
      prompt:
        "Read the active document and propose a section outline for it (with one line on what each section should cover). Insert it as \\section skeletons with short TODO comments, keeping the preamble intact.",
      score: 74,
    });
  }
  const todos = countTodos(body);
  if (todos > 0) {
    out.push({
      id: "work-todos",
      group: "document",
      kind: "write",
      label: todos > 1 ? `Work through ${todos} TODOs` : "Resolve the TODO",
      reason: `${plural(todos, "marker")} in ${file}`,
      prompt:
        "Find every TODO, FIXME, TBD and \\todo marker in the active document. List them, then propose concrete text or fixes for each, one at a time.",
      score: 56,
    });
  }
  if (
    sections >= 2 &&
    words > 400 &&
    /\\documentclass/.test(s.documentText) &&
    !/\\begin\{abstract\}|\\abstract\{/.test(s.documentText)
  ) {
    out.push({
      id: "write-abstract",
      group: "document",
      kind: "write",
      label: "Write the abstract",
      reason: `No abstract yet in ${file}`,
      prompt:
        "Read the whole paper and draft an abstract of about 150–200 words (problem, approach, main result, significance). Insert it in an abstract environment after \\maketitle, or show it if there is no obvious place.",
      score: 48,
    });
  }
  if (words >= 120) {
    out.push({
      id: "proofread",
      group: "review",
      kind: "review",
      label: "Proofread this document",
      reason: `${words.toLocaleString("en")} words in ${file}`,
      prompt:
        "Proofread the active document for grammar, clarity, and LaTeX issues, and apply the fixes.",
      score: 34,
    });
    out.push({
      id: "summarize",
      group: "review",
      kind: "review",
      label: "Summarize this document",
      reason: sections ? `${plural(sections, "section")} in ${file}` : file,
      prompt:
        "Read the active document and summarize what it says, section by section.",
      score: 26,
    });
  }
  if (sections >= 3 && words > 1200) {
    out.push({
      id: "review-paper",
      group: "review",
      kind: "review",
      label: "Review my paper like a referee",
      reason: `${plural(sections, "section")}, ${words.toLocaleString("en")} words`,
      prompt:
        "Act as a careful peer reviewer. Read the whole paper and report the main strengths, weaknesses, unclear claims, missing related work and concrete suggestions, ordered by importance.",
      score: 30,
    });
  }
  return out;
}

function fallbackCandidates(s: AiSuggestionSignals): Candidate[] {
  return [
    {
      id: "make-figure",
      group: "fallback",
      kind: "figure",
      label: "Draw a TikZ figure",
      reason: "Describe it in words",
      prompt:
        "Help me draw a figure in TikZ. Ask me what it should show, then write the code.",
      score: 12,
    },
    {
      id: "make-table",
      group: "fallback",
      kind: "write",
      label: "Build a LaTeX table",
      reason: "From data or a description",
      prompt:
        "Help me build a well-formatted LaTeX table with booktabs. Ask me for the data or structure first.",
      score: 11,
    },
    s.hasProject
      ? {
          id: "outline-project",
          group: "fallback",
          kind: "review",
          label: "Outline the whole project",
          reason: "Get oriented",
          prompt:
            "List the project files, read the main .tex files, and give an outline of the whole project's structure and content.",
          score: 10,
        }
      : {
          id: "latex-help",
          group: "fallback",
          kind: "write",
          label: "Ask a LaTeX question",
          reason: "Packages, macros, layout",
          prompt:
            "I have a LaTeX question. Ask me what I'm trying to do, then explain the best way to do it with a short example.",
          score: 10,
        },
  ];
}

/** Boost from how often and how recently this person picked a request. */
function historyBoost(entry: AiSuggestionUsageEntry | undefined, now: number): number {
  if (!entry || entry.count <= 0) return 0;
  const frequency = Math.min(entry.count, 6) * 3;
  const age = now - entry.lastUsed;
  const recency = age < dayMs ? 8 : age < 7 * dayMs ? 4 : 0;
  return frequency + recency;
}

/**
 * Up to `limit` requests for the empty chat, most relevant first. Live
 * problems (a broken build) always outrank habits; habits break ties and
 * lift routine requests above generic filler.
 */
export function buildAiSuggestions(
  signals: AiSuggestionSignals,
  limit = 3,
): AiSuggestion[] {
  const candidates = [
    ...compileCandidates(signals),
    ...selectionCandidates(signals),
    ...documentCandidates(signals),
    ...fallbackCandidates(signals),
  ];
  const seen = new Set<string>();
  const ranked = candidates
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .map((c) => {
      const boost = historyBoost(signals.usage[c.id], signals.now);
      return { ...c, score: c.score + boost, fromHistory: boost >= 9 };
    })
    .sort((a, b) => b.score - a.score);
  const perGroup = new Map<string, number>();
  const picked: AiSuggestion[] = [];
  for (const c of ranked) {
    if (picked.length >= limit) break;
    const used = perGroup.get(c.group) ?? 0;
    if (used >= 2 && c.group !== "fallback") continue;
    perGroup.set(c.group, used + 1);
    const { score: _score, group: _group, ...suggestion } = c;
    picked.push(suggestion);
  }
  return picked;
}

// Typed requests count toward history too, so the starters learn what this
// person asks for even when they never click a card.
const typedPatterns: [RegExp, string][] = [
  [
    /^\\fix\b|\b(fix|solve|repair)\b.*\b(error|compil|build)|\bcompil\w* (error|fail)/i,
    "fix-compile",
  ],
  [/\b(why|explain)\b.*\b(error|compil|build|fail)/i, "explain-compile"],
  [/undefined (citation|reference)|\?\?/i, "fix-undefined-refs"],
  [/overfull|underfull|margin/i, "fix-overfull"],
  [
    /^\\rewrite\b|\b(rewrite|rephrase|reword|polish|shorten|concise)\b/i,
    "rewrite-selection",
  ],
  [
    /^\\cite\b|\b(cite|citation|reference)s?\b.*\b(find|suggest|add|recommend)|\b(find|suggest|add|recommend)\b.*\bcit/i,
    "cite-selection",
  ],
  [/\b(explain|derive)\b.*\b(equation|math|formula|proof)/i, "explain-math"],
  [/\btikz\b|\b(draw|diagram|figure|plot)\b/i, "make-figure"],
  [/\btable\b|\btabular\b/i, "make-table"],
  [/^\\proofread\b|\b(proofread|grammar|typos?|spelling)\b/i, "proofread"],
  [/^\\summarize\b|\b(summari[sz]e|summary|tl;?dr)\b/i, "summarize"],
  [/^\\outline\b|\boutline\b/i, "draft-outline"],
  [/^\\review\b|\b(review|referee|critique)\b/i, "review-paper"],
  [/\babstract\b/i, "write-abstract"],
  [/\b(todo|fixme)s?\b/i, "work-todos"],
  [/\bbib(tex|liography)?\b.*\b(clean|tidy|duplicate)/i, "tidy-bib"],
];

/** The starter a free-typed request corresponds to, if any. */
export function classifyTypedRequest(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const [pattern, id] of typedPatterns) {
    if (pattern.test(trimmed)) return id;
  }
  return null;
}

export const aiSuggestionUsageStorageKey = "latexdo.ai.suggestionUsage.v1";

export function loadAiSuggestionUsage(): AiSuggestionUsage {
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(aiSuggestionUsageStorageKey) ?? "null",
    ) as unknown;
    if (!raw || typeof raw !== "object") return {};
    const usage: AiSuggestionUsage = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      const entry = value as Partial<AiSuggestionUsageEntry>;
      if (typeof entry?.count === "number" && typeof entry.lastUsed === "number") {
        usage[id] = { count: entry.count, lastUsed: entry.lastUsed };
      }
    }
    return usage;
  } catch {
    return {};
  }
}

export function recordAiSuggestionUsage(
  id: string,
  now = Date.now(),
): AiSuggestionUsage {
  const usage = loadAiSuggestionUsage();
  const previous = usage[id];
  usage[id] = { count: (previous?.count ?? 0) + 1, lastUsed: now };
  try {
    window.localStorage.setItem(aiSuggestionUsageStorageKey, JSON.stringify(usage));
  } catch {
    // Ignore localStorage failures; suggestions still work without history.
  }
  return usage;
}
