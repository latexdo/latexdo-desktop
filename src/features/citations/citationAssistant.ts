import type { CitationEntry } from "../../latex/latexIndex";
import { normalizeDoi, normalizeTitle } from "../scholarly/scholarlyClient";
import type { ScholarlyPaper } from "../scholarly/scholarlyTypes";

const stopWords = new Set(
  (
    "about above after again against also among based because been before being " +
    "below between both could does doing during each from further have having here " +
    "into itself more most much must only other over same should show shows shown " +
    "some such than that their them then there these they this those through under " +
    "until very were what when where which while with within without would your " +
    "paper approach method methods results using used work works propose proposed " +
    "present presents section figure table study studies however therefore thus"
  ).split(" "),
);

function terms(text: string | undefined): string[] {
  if (!text) return [];
  return (
    (
      text
        // Drop LaTeX commands and their names, keep their arguments' words.
        .replace(/\\[a-zA-Z@]+\*?/g, " ")
        .toLowerCase()
        .match(/[a-z][a-z-]{3,}/g) ?? []
    )
      .map((word) =>
        word
          .replace(/-+$/, "")
          .replace(/(ies)$/, "y")
          .replace(/s$/, ""),
      )
      .filter((word) => word.length >= 4 && !stopWords.has(word))
  );
}

/** The content words of the sentence being written, for matching references. */
export function citationContextTerms(text: string): Set<string> {
  return new Set(terms(text));
}

export interface ContextFit {
  kind: "fits" | "weak" | null;
  shared: string[];
}

/**
 * Whether a reference's own words show up in the sentence it is cited in.
 * "weak" is only reported when the sentence says enough to judge.
 */
export function citationContextFit(
  entry: CitationEntry,
  contextTerms: ReadonlySet<string>,
): ContextFit {
  const entryTerms = new Set(
    terms([entry.title, entry.keywords, entry.abstract].join(" ")),
  );
  const shared = [...entryTerms].filter((term) => contextTerms.has(term)).slice(0, 4);
  if (shared.length >= 2 || (shared.length === 1 && entryTerms.size <= 4)) {
    return { kind: "fits", shared };
  }
  if (!shared.length && contextTerms.size >= 6 && entry.title) {
    return { kind: "weak", shared };
  }
  return { kind: null, shared };
}

const citeCommand =
  /\\(?:[a-zA-Z]*cite[a-zA-Z]*|bibentry)\*?(?:\[[^\]]*\]){0,2}\{([^}]*)\}/g;

/**
 * Keys this paper already cites, nearest to the caret first, after the keys
 * picked earlier in this session (newest first).
 */
export function recentCitationKeys(
  text: string,
  caretOffset: number,
  sessionKeys: readonly string[] = [],
  limit = 8,
): string[] {
  const distance = new Map<string, number>();
  for (const match of text.matchAll(citeCommand)) {
    const start = match.index ?? 0;
    // The citation being typed is not a "recent" one.
    if (caretOffset >= start && caretOffset <= start + match[0].length) continue;
    const gap = Math.abs(caretOffset - start);
    for (const raw of match[1].split(",")) {
      const key = raw.trim();
      if (key && gap < (distance.get(key) ?? Infinity)) distance.set(key, gap);
    }
  }
  const nearby = [...distance.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([key]) => key);
  return [...new Set([...sessionKeys, ...nearby])].slice(0, limit);
}

/**
 * The sentence the caret is in, without other citations: what a reference
 * placed here should be about.
 */
export function citationContextWindow(text: string, caretOffset: number, radius = 400) {
  const before = text.slice(Math.max(0, caretOffset - radius), caretOffset);
  const after = text.slice(caretOffset, caretOffset + radius);
  const boundaries = [...before.matchAll(/[.!?](?=\s)|\n\s*\n/g)];
  const last = boundaries[boundaries.length - 1];
  const start = last ? (last.index ?? 0) + last[0].length : 0;
  const end = /[.!?](?=\s|$)|\n\s*\n/.exec(after)?.index ?? after.length;
  return (before.slice(start) + after.slice(0, end))
    .replace(citeCommand, " ")
    .replace(/\\[a-zA-Z]*cite[a-zA-Z]*\*?(?:\[[^\]]*\])*\{[^}]*$/, "")
    .trim();
}

/** The library entry for a paper found online, if the project already has it. */
export function libraryEntryForPaper(
  paper: ScholarlyPaper,
  entries: readonly CitationEntry[],
): CitationEntry | undefined {
  const doi = normalizeDoi(paper.doi);
  const title = normalizeTitle(paper.title);
  return entries.find(
    (entry) =>
      (doi && normalizeDoi(entry.doi) === doi) ||
      (title.length > 12 && normalizeTitle(entry.title) === title),
  );
}

/** Interleaves results from several providers and drops duplicates. */
export function mergeOnlinePapers(
  lists: ScholarlyPaper[][],
  limit = 12,
): ScholarlyPaper[] {
  const seen = new Set<string>();
  const merged: ScholarlyPaper[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      const paper = list[index];
      if (!paper) continue;
      const identity = normalizeDoi(paper.doi) || normalizeTitle(paper.title);
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      merged.push(paper);
    }
  }
  return merged.slice(0, limit);
}

/** A short online query from the sentence when nothing has been typed. */
export function onlineQueryFor(
  query: string,
  contextTerms: ReadonlySet<string>,
): string {
  return query.trim() || [...contextTerms].slice(0, 6).join(" ");
}
