import type { CitationEntry } from "./latexIndex";

export interface CitationCompletionUsageOptions {
  citedKeys?: Iterable<string>;
}

const citationSearchFields: Array<keyof CitationEntry> = [
  "key",
  "title",
  "author",
  "editor",
  "year",
  "journal",
  "booktitle",
  "publisher",
  "school",
  "institution",
  "doi",
  "url",
  "eprint",
  "archivePrefix",
  "howpublished",
  "abstract",
  "keywords",
  "note",
  "sourceFile",
];

export const citationCompletionTriggerCharacters = [
  "{",
  ",",
  " ",
  ":",
  "-",
  ".",
  "/",
  "_",
  ...letters("abcdefghijklmnopqrstuvwxyz"),
  ...letters("ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
  ...letters("0123456789"),
];

export function citationCompletionFilterText(
  entry: CitationEntry,
  currentQuery = "",
): string {
  const readable = uniqueCitationParts(
    citationSearchFields.map((field) => entry[field]),
  );
  const normalized = normalizeForCitationSearch(readable.join(" "));
  const compact = normalized.replace(/\s+/g, "");
  const acronyms = uniqueCitationParts(readable.map(citationAcronym));
  const queryTerms = citationMatchesQuery(entry, currentQuery)
    ? uniqueCitationParts([currentQuery, normalizeForCitationSearch(currentQuery)])
    : [];
  return [...readable, normalized, compact, ...acronyms, ...queryTerms]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function citationCompletionLabelDetail(
  entry: CitationEntry,
): string | undefined {
  return entry.title
    ? ` ${entry.title}`
    : citationPeople(entry)
      ? ` ${citationPeople(entry)}`
      : undefined;
}

export function citationCompletionUsageDescription(
  entry: CitationEntry,
  options: CitationCompletionUsageOptions = {},
): string | undefined {
  if (!options.citedKeys) {
    return undefined;
  }
  return citationAlreadyUsed(entry, options.citedKeys)
    ? "Already cited"
    : "Not cited yet";
}

export function citationCompletionDetail(
  entry: CitationEntry,
  options: CitationCompletionUsageOptions = {},
): string {
  return [
    citationCompletionUsageDescription(entry, options),
    entry.title,
    citationPeople(entry),
    entry.year,
    citationVenue(entry),
    entry.type ? entry.type.toUpperCase() : undefined,
  ]
    .filter(Boolean)
    .join(" - ");
}

export function citationCompletionInfo(
  entry: CitationEntry,
  options: CitationCompletionUsageOptions = {},
): string {
  return [
    citationCompletionUsageDescription(entry, options)
      ? `Usage: ${citationCompletionUsageDescription(entry, options)}`
      : undefined,
    entry.title ? `Title: ${entry.title}` : undefined,
    citationPeople(entry) ? `Author: ${citationPeople(entry)}` : undefined,
    entry.year ? `Year: ${entry.year}` : undefined,
    citationVenue(entry) ? `Venue: ${citationVenue(entry)}` : undefined,
    entry.doi ? `DOI: ${entry.doi}` : undefined,
    entry.eprint ? `Eprint: ${entry.eprint}` : undefined,
    entry.url ? `URL: ${entry.url}` : undefined,
    `Source: ${entry.sourceFile}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function citationCompletionMarkdown(
  entry: CitationEntry,
  options: CitationCompletionUsageOptions = {},
): string {
  const people = citationPeople(entry);
  const venue = citationVenue(entry);
  const doiLink = doiUrl(entry.doi);
  const safeUrl = safeHttpUrl(entry.url);
  const abstract = truncateField(entry.abstract, 640);
  const usage = citationCompletionUsageDescription(entry, options);
  const metadata = [
    usage ? `**Usage:** ${usage} in this article` : undefined,
    people ? `**Authors:** ${escapeMarkdownText(people)}` : undefined,
    entry.year ? `**Year:** ${escapeMarkdownText(entry.year)}` : undefined,
    venue ? `**Venue:** ${escapeMarkdownText(venue)}` : undefined,
    entry.type
      ? `**Type:** ${escapeMarkdownText(entry.type.toUpperCase())}`
      : undefined,
    doiLink && entry.doi
      ? `**DOI:** [${escapeMarkdownText(entry.doi)}](${doiLink})`
      : entry.doi
        ? `**DOI:** ${escapeMarkdownText(entry.doi)}`
        : undefined,
    entry.eprint ? `**Eprint:** ${escapeMarkdownText(entry.eprint)}` : undefined,
    safeUrl
      ? `**URL:** [${escapeMarkdownText(safeUrl)}](${safeUrl})`
      : entry.url?.trim()
        ? `**URL:** ${escapeMarkdownText(entry.url.trim())}`
        : undefined,
    `**Source:** \`${entry.sourceFile}\``,
  ].filter(Boolean);

  return [
    entry.title ? `### ${escapeMarkdownText(entry.title)}` : `### ${entry.key}`,
    metadata.join("\n\n"),
    abstract ? `**Abstract**\n\n${escapeMarkdownText(abstract)}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function rankedCitationCompletions(
  entries: CitationEntry[],
  query: string,
): CitationEntry[] {
  const scored: Array<{ entry: CitationEntry; score: number }> = [];
  for (const entry of entries) {
    if (citationMatchesQuery(entry, query)) {
      scored.push({ entry, score: citationCompletionScore(entry, query) });
    }
  }
  scored.sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta !== 0) return scoreDelta;
    return a.entry.key.localeCompare(b.entry.key);
  });
  return scored.map(({ entry }) => entry);
}

export function citationCompletionSortText(
  entry: CitationEntry,
  query: string,
): string {
  const rank = Math.max(0, 999 - citationCompletionScore(entry, query));
  return `${String(rank).padStart(3, "0")}-${entry.key.toLowerCase()}`;
}

export function citationMatchesQuery(entry: CitationEntry, query: string): boolean {
  const terms = normalizedTerms(query);
  if (terms.length === 0) return true;
  return terms.every((term) => citationTermMatches(entry, term));
}

function citationCompletionScore(entry: CitationEntry, query: string): number {
  const terms = normalizedTerms(query);
  const normalizedQuery = terms.join(" ");
  if (!normalizedQuery) return 0;

  const { key, title, author, venue, searchable } = citationSearchHaystacks(entry);

  if (key === normalizedQuery) return 100;
  if (key.startsWith(normalizedQuery)) return 95;
  if (key.includes(normalizedQuery)) return 90;
  if (title.startsWith(normalizedQuery)) return 85;
  if (title.includes(normalizedQuery)) return 80;
  if (author.includes(normalizedQuery)) return 70;
  if (venue.includes(normalizedQuery)) return 60;
  if (searchable.includes(normalizedQuery)) return 50;

  return 30 + terms.reduce((score, term) => score + citationTermScore(entry, term), 0);
}

function citationPeople(entry: CitationEntry): string | undefined {
  return entry.author ?? entry.editor;
}

function citationVenue(entry: CitationEntry): string | undefined {
  return (
    entry.journal ??
    entry.booktitle ??
    entry.publisher ??
    entry.school ??
    entry.institution
  );
}

function uniqueCitationParts(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const cleaned = value.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const key = normalizeForCitationSearch(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function citationAlreadyUsed(
  entry: CitationEntry,
  citedKeys: Iterable<string>,
): boolean {
  for (const key of citedKeys) {
    if (key === entry.key) {
      return true;
    }
  }
  return false;
}

function normalizedTerms(query: string): string[] {
  return normalizeForCitationSearch(query).split(" ").filter(Boolean);
}

function normalizeForCitationSearch(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\\[A-Za-z]+\*?/g, " ")
    .replace(/\\/g, " ")
    .replace(/[{}()[\]"'`,.;:!?/|+=_*^-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function letters(value: string): string[] {
  return value.split("");
}

interface CitationSearchHaystacks {
  key: string;
  title: string;
  author: string;
  venue: string;
  searchable: string;
  compact: string;
  acronyms: string[];
  words: string[];
}

// Entries are immutable parse results, so their normalized search text is
// computed once. This keeps filtering responsive for very large .bib files.
const citationSearchHaystackCache = new WeakMap<
  CitationEntry,
  CitationSearchHaystacks
>();

function citationSearchHaystacks(entry: CitationEntry): CitationSearchHaystacks {
  const cached = citationSearchHaystackCache.get(entry);
  if (cached) return cached;
  const haystacks = buildCitationSearchHaystacks(entry);
  citationSearchHaystackCache.set(entry, haystacks);
  return haystacks;
}

function buildCitationSearchHaystacks(entry: CitationEntry): CitationSearchHaystacks {
  const key = normalizeForCitationSearch(entry.key);
  const title = normalizeForCitationSearch(entry.title);
  const author = normalizeForCitationSearch(citationPeople(entry));
  const venue = normalizeForCitationSearch(citationVenue(entry));
  const searchable = normalizeForCitationSearch(citationCompletionFilterText(entry));
  const compact = searchable.replace(/\s+/g, "");
  const acronyms = uniqueCitationParts(
    uniqueCitationParts(citationSearchFields.map((field) => entry[field])).map(
      citationAcronym,
    ),
  ).map(normalizeForCitationSearch);
  const words = searchable.split(" ").filter(Boolean);

  return { key, title, author, venue, searchable, compact, acronyms, words };
}

function citationTermMatches(entry: CitationEntry, term: string): boolean {
  const haystacks = citationSearchHaystacks(entry);
  const compactTerm = term.replace(/\s+/g, "");

  return (
    haystacks.searchable.includes(term) ||
    haystacks.compact.includes(compactTerm) ||
    haystacks.words.some((word) => word.startsWith(term)) ||
    haystacks.acronyms.some((acronym) => acronym.includes(term)) ||
    haystacks.words.some((word) => fuzzyWordMatch(term, word))
  );
}

function citationTermScore(entry: CitationEntry, term: string): number {
  const haystacks = citationSearchHaystacks(entry);
  const compactTerm = term.replace(/\s+/g, "");

  if (haystacks.key === term) return 60;
  if (haystacks.key.startsWith(term)) return 54;
  if (haystacks.key.includes(term)) return 48;
  if (haystacks.title.includes(term)) return 42;
  if (haystacks.author.includes(term)) return 36;
  if (haystacks.venue.includes(term)) return 30;
  if (haystacks.words.some((word) => word.startsWith(term))) return 24;
  if (haystacks.acronyms.some((acronym) => acronym.includes(term))) return 18;
  if (haystacks.compact.includes(compactTerm)) return 12;
  if (haystacks.words.some((word) => fuzzyWordMatch(term, word))) return 6;
  return 0;
}

function citationAcronym(value: string | undefined): string {
  return normalizeForCitationSearch(value)
    .split(" ")
    .filter((word) => word.length > 2)
    .map((word) => word[0])
    .join("");
}

function fuzzyWordMatch(needle: string, word: string): boolean {
  return (
    needle.length >= 3 &&
    word.length >= needle.length &&
    needle.length >= word.length - 2 &&
    fuzzySubsequence(needle, word)
  );
}

function fuzzySubsequence(needle: string, haystack: string): boolean {
  let cursor = 0;
  for (const char of haystack) {
    if (char === needle[cursor]) {
      cursor += 1;
      if (cursor === needle.length) {
        return true;
      }
    }
  }
  return false;
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+.!|>])/g, "\\$1");
}

function truncateField(value: string | undefined, limit: number): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > limit
    ? `${normalized.slice(0, limit - 3)}...`
    : normalized;
}

function doiUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const doi = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim();
  if (!doi) return undefined;
  return `https://doi.org/${encodeURI(doi)}`;
}

function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
