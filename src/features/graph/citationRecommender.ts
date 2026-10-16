// Ranks bibliography entries against a passage of the user's prose so the AI or
// graph UI can choose sources. Formatting the actual LaTeX citation command is
// handled by the editor layer, because it depends on local document style.

import type { CitationEntry } from "../../latex/latexIndex";
import { titleTokens } from "./knowledgeGraph";

export interface CitationRecommendation {
  key: string;
  /** 0..1 relevance score. */
  score: number;
  reasons: string[];
  entry: CitationEntry;
  alreadyCited: boolean;
}

export interface RecommendOptions {
  /** Keys already cited in the surrounding text; recommended near-ties break toward uncited ones. */
  citedKeys?: Iterable<string>;
  /** Maximum number of recommendations to return. */
  limit?: number;
  /** Minimum score (0..1) to include. */
  minScore?: number;
}

const passageStopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "we",
  "were",
  "with",
  "which",
  "these",
  "those",
  "our",
  "their",
  "such",
  "can",
  "has",
  "have",
  "been",
  "also",
  "more",
  "than",
  "then",
  "they",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-preserving surname extraction, so author matches stay proper-noun precise. */
function rawLastNames(author: string | undefined): string[] {
  if (!author) return [];
  return author
    .split(/\s+and\s+/i)
    .map((name) => {
      const cleaned = name.replace(/[{}]/g, "").trim();
      const last = cleaned.includes(",")
        ? cleaned.split(",")[0].trim()
        : (cleaned.split(/\s+/).filter(Boolean).pop() ?? "");
      return last.replace(/[^A-Za-z-]/g, "");
    })
    .filter((name) => name.length >= 2);
}

function passageTokens(passage: string): Map<string, number> {
  const counts = new Map<string, number>();
  const tokens = passage
    .toLowerCase()
    .replace(/\\[a-z]+\s*(\[[^\]]*\])?(\{[^}]*\})?/gi, " ") // strip latex commands + args
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length >= 3 && !passageStopWords.has(token));
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function textTokens(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .toLowerCase()
      .replace(/\\[a-z]+\s*(\[[^\]]*\])?(\{[^}]*\})?/gi, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length >= 3 && !passageStopWords.has(token)),
  );
}

function entryQualityWeight(entry: CitationEntry): number {
  let quality = 0;
  if (entry.title) quality += 0.22;
  if (entry.author || entry.editor) quality += 0.22;
  if (entry.year) quality += 0.18;
  if (
    entry.journal ||
    entry.booktitle ||
    entry.publisher ||
    entry.school ||
    entry.institution ||
    entry.howpublished
  ) {
    quality += 0.16;
  }
  if (entry.doi || entry.url || entry.eprint) quality += 0.16;
  if (entry.abstract || entry.keywords) quality += 0.06;
  return 0.85 + 0.15 * Math.min(1, quality);
}

/**
 * Recommend citations for a passage. Higher score = stronger topical match with
 * the passage's vocabulary. Authors mentioned by surname in the passage are a
 * strong signal; title-term overlap is the main one.
 */
export function recommendCitations(
  passage: string,
  entries: CitationEntry[],
  options: RecommendOptions = {},
): CitationRecommendation[] {
  const limit = options.limit ?? 8;
  const minScore = options.minScore ?? 0.05;
  const citedSet = new Set(options.citedKeys ?? []);

  const tokens = passageTokens(passage);
  if (tokens.size === 0) return [];
  const passageTokenSet = new Set(tokens.keys());

  const seen = new Set<string>();
  const recommendations: CitationRecommendation[] = [];

  for (const entry of entries) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);

    const reasons: string[] = [];
    let score = 0;

    const scoreField = (
      label: string,
      value: string | undefined,
      weight: number,
      maxShown = 4,
    ) => {
      const fieldTokens = label === "Title" ? titleTokens(value) : textTokens(value);
      const matchedTerms: string[] = [];
      for (const token of fieldTokens) {
        if (passageTokenSet.has(token)) matchedTerms.push(token);
      }
      if (matchedTerms.length === 0 || fieldTokens.size === 0) return;

      const coverage = matchedTerms.length / fieldTokens.size;
      score += weight * (0.55 * coverage + 0.12 * Math.min(matchedTerms.length, 4));
      reasons.push(`${label} terms: ${matchedTerms.slice(0, maxShown).join(", ")}`);
    };

    scoreField("Title", entry.title, 1);
    scoreField("Abstract", entry.abstract, 0.45);
    scoreField("Keywords", entry.keywords, 0.7);
    scoreField("Note", entry.note, 0.2, 3);

    const venue =
      entry.journal ??
      entry.booktitle ??
      entry.publisher ??
      entry.school ??
      entry.institution ??
      entry.howpublished;
    if (venue) {
      const venueTokens = textTokens(venue);
      let venueHits = 0;
      for (const token of venueTokens) {
        if (passageTokenSet.has(token)) venueHits += 1;
      }
      if (venueHits > 0) {
        score += 0.15 * Math.min(venueHits, 2);
        reasons.push("Venue matches passage");
      }
    }

    // Author surname mentioned in the passage — a strong, precise signal.
    // Matched case-sensitively as a whole word against the raw passage so a
    // capitalized surname like "He" or "Li" hits without colliding with the
    // lowercase pronoun.
    const matchedAuthors = rawLastNames(entry.author).filter((last) =>
      new RegExp(`\\b${escapeRegExp(last)}\\b`).test(passage),
    );
    if (matchedAuthors.length > 0) {
      score += 0.4 * Math.min(matchedAuthors.length, 2);
      reasons.push(`Author mentioned: ${matchedAuthors.slice(0, 2).join(", ")}`);
    }

    if (score < minScore) continue;

    const alreadyCited = citedSet.has(entry.key);
    // Nudge uncited-but-relevant papers up: the point is to surface citations
    // the author hasn't added yet, without hiding ones they already used.
    const adjustedScore =
      (alreadyCited ? score * 0.85 : score) * entryQualityWeight(entry);

    recommendations.push({
      key: entry.key,
      score: Number(Math.min(1, adjustedScore).toFixed(3)),
      reasons,
      entry,
      alreadyCited,
    });
  }

  return recommendations.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Format a ranked list as plain text for the AI tool result / logs. */
export function formatRecommendations(
  recommendations: CitationRecommendation[],
): string {
  if (recommendations.length === 0) {
    return "No matching references found in the bibliography for this passage.";
  }
  return recommendations
    .map((rec, index) => {
      const title = rec.entry.title ?? "(untitled)";
      const cited = rec.alreadyCited ? " [already cited]" : "";
      const reasons = rec.reasons.length ? ` — ${rec.reasons.join("; ")}` : "";
      return `${index + 1}. key=${rec.key} (score ${rec.score})${cited}\n   ${title}${reasons}`;
    })
    .join("\n");
}
