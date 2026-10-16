import type { CitationEntry } from "../../latex/latexIndex";
import { authorLastNames, titleTokens, type KnowledgeGraph } from "./knowledgeGraph";
import {
  defaultScholarlyRetryDelayMs,
  defaultScholarlyTimeoutMs,
  isAbortError,
  normalizeDoi,
  normalizeTitle,
  providerErrorLabel,
  providerOnCooldown,
  rememberProviderFailure,
  scholarlyFetcher,
  searchCrossref,
  searchOpenAlex,
} from "../scholarly/scholarlyClient";
import type {
  ScholarlyFetchOptions,
  ScholarlyPaper,
  ScholarlyProvider,
} from "../scholarly/scholarlyTypes";

export type { ScholarlyProvider };

export interface DiscoveredPaper {
  id: string;
  source: ScholarlyProvider;
  title: string;
  authors: string[];
  year: number | null;
  venue?: string;
  doi?: string;
  url?: string;
  pdfUrl?: string;
  citationCount?: number;
  score: number;
  reasons: string[];
  bibtexKey: string;
  bibtex: string;
}

export interface ScholarlyDiscoveryResult {
  papers: DiscoveredPaper[];
  queries: string[];
  providerErrors: string[];
  aiQueriesUsed: string[];
}

export interface ScholarlyDiscoveryOptions {
  signal?: AbortSignal;
  limit?: number;
  perProviderLimit?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  aiQueries?: string[];
  fetcher?: typeof fetch;
  currentYear?: number;
}

interface DiscoveryFingerprint {
  weightedTerms: Map<string, number>;
  topTerms: string[];
  authorNames: Set<string>;
  existingKeys: Set<string>;
  existingDois: Set<string>;
  existingTitles: Set<string>;
  currentYear: number;
}

const defaultDiscoveryLimit = 28;
const defaultPerProviderLimit = 10;
const discoveryCacheTtlMs = 10 * 60 * 1000;
const discoveryCache = new Map<
  string,
  { savedAt: number; result: ScholarlyDiscoveryResult }
>();

const bibtexTypeByProviderType: Record<string, string> = {
  article: "article",
  "journal-article": "article",
  preprint: "article",
  proceedings: "inproceedings",
  "proceedings-article": "inproceedings",
  "book-chapter": "incollection",
  book: "book",
  dissertation: "phdthesis",
  dataset: "misc",
  report: "techreport",
};

const queryStopTerms = new Set([
  "paper",
  "study",
  "studies",
  "result",
  "results",
  "proposed",
  "using",
  "towards",
  "toward",
  "based",
]);

function buildFingerprint(
  graph: KnowledgeGraph,
  entries: CitationEntry[],
  currentYear: number,
): DiscoveryFingerprint {
  const weightedTerms = new Map<string, number>();
  const authorNames = new Set<string>();
  const entriesByKey = new Map(entries.map((entry) => [entry.key, entry]));

  for (const entry of entries) {
    for (const author of authorLastNames(entry.author ?? entry.editor)) {
      authorNames.add(author);
    }
  }

  for (const node of graph.nodes) {
    const entry = entriesByKey.get(node.key);
    for (const author of authorLastNames(entry?.author ?? entry?.editor)) {
      authorNames.add(author);
    }
    const multiplier = 1 + (node.cited ? 1.5 : 0) + Math.min(node.degree, 8) * 0.25;
    for (const token of titleTokens(node.title)) {
      if (queryStopTerms.has(token)) continue;
      weightedTerms.set(token, (weightedTerms.get(token) ?? 0) + multiplier);
    }
  }

  const topTerms = [...weightedTerms.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([term]) => term)
    .slice(0, 14);

  return {
    weightedTerms,
    topTerms,
    authorNames,
    existingKeys: new Set(entries.map((entry) => entry.key.toLowerCase())),
    existingDois: new Set(
      entries.map((entry) => normalizeDoi(entry.doi)).filter(Boolean),
    ),
    existingTitles: new Set(
      entries
        .map((entry) => normalizeTitle(entry.title))
        .filter((title) => title.length >= 16),
    ),
    currentYear,
  };
}

function compactQuery(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function normalizeExternalQuery(value: string): string | null {
  const query = value.replace(/\s+/g, " ").trim().slice(0, 180);
  if (query.length < 8) return null;
  if (/^https?:/i.test(query)) return null;
  return query;
}

function mergeDiscoveryQueries(
  aiQueries: string[] | undefined,
  graphQueries: string[],
) {
  const merged: string[] = [];
  const seen = new Set<string>();
  const add = (query: string | null) => {
    if (!query) return;
    const key = query.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(query);
  };
  for (const query of aiQueries ?? []) add(normalizeExternalQuery(query));
  for (const query of graphQueries) add(query);
  return merged.slice(0, 5);
}

export function buildDiscoveryQueries(
  graph: KnowledgeGraph,
  entries: CitationEntry[],
  currentYear = new Date().getFullYear(),
): string[] {
  const fingerprint = buildFingerprint(graph, entries, currentYear);
  if (fingerprint.topTerms.length === 0) return [];

  const queries: string[] = [];
  const addQuery = (query: string) => {
    const normalized = query.toLowerCase();
    if (
      query.length >= 8 &&
      !queries.some((item) => item.toLowerCase() === normalized)
    ) {
      queries.push(query);
    }
  };

  addQuery(compactQuery(fingerprint.topTerms.slice(0, 7)));

  const anchorNodes = [...graph.nodes]
    .filter((node) => node.title)
    .sort((a, b) => {
      const citedDelta = Number(b.cited) - Number(a.cited);
      if (citedDelta !== 0) return citedDelta;
      return b.degree - a.degree;
    })
    .slice(0, 3);

  for (const node of anchorNodes) {
    const titleTerms = [...titleTokens(node.title)].filter(
      (token) => !queryStopTerms.has(token),
    );
    addQuery(
      compactQuery([...titleTerms.slice(0, 5), ...fingerprint.topTerms.slice(0, 2)]),
    );
  }

  return queries.slice(0, 4);
}

function scoreRawPaper(
  paper: ScholarlyPaper,
  fingerprint: DiscoveryFingerprint,
): { score: number; reasons: string[] } {
  const candidateTokens = titleTokens(paper.title);
  const matchedTerms: string[] = [];
  let weightedHits = 0;
  let topWeight = 0;

  for (const term of fingerprint.topTerms.slice(0, 10)) {
    topWeight += fingerprint.weightedTerms.get(term) ?? 0;
    if (candidateTokens.has(term)) {
      matchedTerms.push(term);
      weightedHits += fingerprint.weightedTerms.get(term) ?? 0;
    }
  }

  const topicScore = topWeight > 0 ? weightedHits / topWeight : 0;
  const candidateAuthorNames = new Set(
    paper.authors.flatMap((author) => authorLastNames(author)),
  );
  const sharedAuthors = [...candidateAuthorNames].filter((author) =>
    fingerprint.authorNames.has(author),
  );
  const authorScore = Math.min(1, sharedAuthors.length / 2);
  const citationScore = Math.min(
    1,
    Math.log10(Math.max(1, (paper.citationCount ?? 0) + 1)) / 4,
  );
  const recencyScore =
    paper.year && paper.year >= fingerprint.currentYear - 3
      ? 1
      : paper.year && paper.year >= fingerprint.currentYear - 8
        ? 0.55
        : 0;
  const providerScore = Math.min(0.06, (paper.providerScore ?? 0) / 1000);

  const score = Math.min(
    1,
    topicScore * 0.68 +
      authorScore * 0.16 +
      citationScore * 0.1 +
      recencyScore * 0.06 +
      providerScore,
  );

  const reasons: string[] = [];
  if (matchedTerms.length > 0) {
    reasons.push(`Matches graph terms: ${matchedTerms.slice(0, 5).join(", ")}`);
  }
  if (sharedAuthors.length > 0) {
    reasons.push(`Shares author: ${sharedAuthors.slice(0, 2).join(", ")}`);
  }
  if ((paper.citationCount ?? 0) >= 50) {
    reasons.push(`${paper.citationCount} citations`);
  }
  if (paper.year && paper.year >= fingerprint.currentYear - 3) {
    reasons.push(`Recent paper from ${paper.year}`);
  }
  if (paper.doi) {
    reasons.push("DOI metadata available");
  }

  return { score: Number(score.toFixed(3)), reasons };
}

function bibtexEscape(value: string): string {
  return (
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/[{}]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      // A bare "&" or "%" in a field breaks the compiled bibliography.
      .replace(/(?<!\\)([&%#_$])/g, "\\$1")
  );
}

function bibtexType(paper: ScholarlyPaper): string {
  return bibtexTypeByProviderType[(paper.sourceType ?? "").toLowerCase()] ?? "article";
}

function buildBibtexKey(paper: ScholarlyPaper, usedKeys: Set<string>): string {
  const firstAuthor = authorLastNames(paper.authors[0])?.[0] ?? "paper";
  const firstTitleToken = [...titleTokens(paper.title)]?.[0] ?? "work";
  const year = paper.year ? String(paper.year) : "nd";
  const base = `${firstAuthor}${year}${firstTitleToken}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  let key = base || `paper${year}`;
  let suffix = 2;
  while (usedKeys.has(key.toLowerCase())) {
    key = `${base}${suffix}`;
    suffix += 1;
  }
  usedKeys.add(key.toLowerCase());
  return key;
}

function buildBibtex(paper: ScholarlyPaper, key: string): string {
  const fields: Array<[string, string | undefined]> = [
    ["title", paper.title],
    ["author", paper.authors.length ? paper.authors.join(" and ") : undefined],
    ["year", paper.year ? String(paper.year) : undefined],
    [bibtexType(paper) === "inproceedings" ? "booktitle" : "journal", paper.venue],
    ["doi", normalizeDoi(paper.doi) || undefined],
    ["url", paper.url],
  ];
  const presentFields = fields
    .filter((field): field is [string, string] => Boolean(field[1]))
    .map(([name, value], index, all) => {
      const comma = index === all.length - 1 ? "" : ",";
      return `  ${name} = {${bibtexEscape(value)}}${comma}`;
    });

  return [`@${bibtexType(paper)}{${key},`, ...presentFields, "}"].join("\n");
}

/** A BibTeX entry for a paper found online, with a key not yet in `usedKeys`. */
export function bibtexForPaper(
  paper: ScholarlyPaper,
  usedKeys: Iterable<string>,
): { key: string; bibtex: string } {
  const used = new Set([...usedKeys].map((key) => key.toLowerCase()));
  const key = buildBibtexKey(paper, used);
  return { key, bibtex: buildBibtex(paper, key) };
}

function paperIdentity(paper: ScholarlyPaper): string {
  const doi = normalizeDoi(paper.doi);
  if (doi) return `doi:${doi}`;
  return `title:${normalizeTitle(paper.title)}:${paper.year ?? ""}`;
}

function materializePaper(
  paper: ScholarlyPaper,
  fingerprint: DiscoveryFingerprint,
  usedKeys: Set<string>,
): DiscoveredPaper | null {
  const doi = normalizeDoi(paper.doi);
  if (doi && fingerprint.existingDois.has(doi)) return null;

  const titleIdentity = normalizeTitle(paper.title);
  if (titleIdentity.length >= 16 && fingerprint.existingTitles.has(titleIdentity)) {
    return null;
  }

  const { score, reasons } = scoreRawPaper(paper, fingerprint);
  const hasGraphSignal = reasons.some(
    (reason) =>
      reason.startsWith("Matches graph terms:") || reason.startsWith("Shares author:"),
  );
  if (score < 0.09 || !hasGraphSignal) return null;

  const bibtexKey = buildBibtexKey(paper, usedKeys);
  return {
    id: paperIdentity(paper),
    source: paper.provider,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    venue: paper.venue,
    doi: doi || undefined,
    url: paper.url,
    pdfUrl: paper.pdfUrl,
    citationCount: paper.citationCount,
    score,
    reasons,
    bibtexKey,
    bibtex: buildBibtex(paper, bibtexKey),
  };
}

async function collectProviderPapers(
  provider: ScholarlyProvider,
  queries: string[],
  fetchOptions: ScholarlyFetchOptions,
  perProviderLimit: number,
): Promise<{ papers: ScholarlyPaper[]; errors: string[] }> {
  if (queries.length === 0 || providerOnCooldown(provider)) {
    return { papers: [], errors: [] };
  }

  const settled = await Promise.allSettled(
    queries.map((query) =>
      provider === "OpenAlex"
        ? searchOpenAlex(query, { ...fetchOptions, perProviderLimit })
        : searchCrossref(query, { ...fetchOptions, perProviderLimit }),
    ),
  );

  const papers: ScholarlyPaper[] = [];
  const errors: string[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      papers.push(...result.value);
    } else if (isAbortError(result.reason)) {
      throw result.reason;
    } else {
      rememberProviderFailure(provider, result.reason);
      errors.push(providerErrorLabel(provider, result.reason));
    }
  }

  return { papers, errors };
}

function materializeDiscoveredPapers(
  rawPapers: ScholarlyPaper[],
  fingerprint: DiscoveryFingerprint,
): DiscoveredPaper[] {
  const usedKeys = new Set(fingerprint.existingKeys);
  const seen = new Set<string>();
  const papers: DiscoveredPaper[] = [];
  for (const raw of rawPapers) {
    const identity = paperIdentity(raw);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const paper = materializePaper(raw, fingerprint, usedKeys);
    if (paper) papers.push(paper);
  }

  return papers.sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta !== 0) return scoreDelta;
    return (b.citationCount ?? 0) - (a.citationCount ?? 0);
  });
}

function discoveryCacheKey(
  fingerprint: DiscoveryFingerprint,
  queries: string[],
): string {
  return [
    queries.join("|"),
    [...fingerprint.existingDois].sort().join(","),
    [...fingerprint.existingTitles].sort().join(","),
  ].join("::");
}

export async function discoverRelatedPapers(
  graph: KnowledgeGraph,
  entries: CitationEntry[],
  options: ScholarlyDiscoveryOptions = {},
): Promise<ScholarlyDiscoveryResult> {
  const fetcher = scholarlyFetcher(options.fetcher);
  if (!fetcher) {
    throw new Error("Network fetch is unavailable in this runtime.");
  }

  const currentYear = options.currentYear ?? new Date().getFullYear();
  const fingerprint = buildFingerprint(graph, entries, currentYear);
  const graphQueries = buildDiscoveryQueries(graph, entries, currentYear);
  const queries = mergeDiscoveryQueries(options.aiQueries, graphQueries);
  const aiQueriesUsed = queries.filter((query) =>
    (options.aiQueries ?? []).some(
      (aiQuery) =>
        normalizeExternalQuery(aiQuery)?.toLowerCase() === query.toLowerCase(),
    ),
  );
  if (queries.length === 0) {
    return { papers: [], queries, providerErrors: [], aiQueriesUsed };
  }
  const cacheKey = discoveryCacheKey(fingerprint, queries);
  const cached = options.fetcher ? undefined : discoveryCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < discoveryCacheTtlMs) {
    return cached.result;
  }

  const fetchOptions: ScholarlyFetchOptions = {
    fetcher,
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? defaultScholarlyTimeoutMs,
    retryDelayMs: options.retryDelayMs ?? defaultScholarlyRetryDelayMs,
  };
  const perProviderLimit = options.perProviderLimit ?? defaultPerProviderLimit;
  const providerErrors: string[] = [];
  const openAlex = await collectProviderPapers(
    "OpenAlex",
    queries.slice(0, 3),
    fetchOptions,
    perProviderLimit,
  );
  if (options.signal?.aborted) {
    throw new DOMException("Discovery aborted", "AbortError");
  }
  providerErrors.push(...openAlex.errors);

  let rawPapers = openAlex.papers;
  let papers = materializeDiscoveredPapers(rawPapers, fingerprint);

  if (papers.length === 0) {
    const crossref = await collectProviderPapers(
      "Crossref",
      queries.slice(0, 1),
      fetchOptions,
      Math.min(5, perProviderLimit),
    );
    if (options.signal?.aborted) {
      throw new DOMException("Discovery aborted", "AbortError");
    }
    providerErrors.push(...crossref.errors);
    rawPapers = [...rawPapers, ...crossref.papers];
    papers = materializeDiscoveredPapers(rawPapers, fingerprint);
  }
  const result = {
    papers: papers.slice(0, options.limit ?? defaultDiscoveryLimit),
    queries,
    providerErrors,
    aiQueriesUsed,
  };
  if (!options.fetcher) {
    discoveryCache.set(cacheKey, { savedAt: Date.now(), result });
  }
  return result;
}

export function formatDiscoveredPaperAuthors(paper: DiscoveredPaper): string {
  if (paper.authors.length === 0) return "Unknown authors";
  if (paper.authors.length <= 3) return paper.authors.join(", ");
  return `${paper.authors.slice(0, 3).join(", ")} et al.`;
}
