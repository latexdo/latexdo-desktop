import type { CitationEntry } from "../../latex/latexIndex";
import { citationHoverMarkdown } from "../../latex/citationHover";
import { authorLastNames } from "../graph/knowledgeGraph";
import {
  isAbortError,
  normalizeDoi,
  normalizeTitle,
  providerErrorLabel,
  rememberProviderFailure,
  lookupCrossrefByDoi,
  lookupOpenAlexByDoi,
  searchCrossref,
  searchOpenAlex,
} from "../scholarly/scholarlyClient";
import { authorSimilarity, tokenSimilarity } from "../scholarly/scholarlyMatching";
import type {
  ScholarlyPaper,
  ScholarlyProvider,
  ScholarlySearchOptions,
} from "../scholarly/scholarlyTypes";

export type CitationVerificationStatus =
  | "verified"
  | "probable"
  | "mismatch"
  | "unverified"
  | "error";

export interface VerifiedPaper {
  provider: ScholarlyProvider;
  title: string;
  authors: string[];
  year: number | null;
  venue?: string;
  url?: string;
  doi?: string;
  citationCount?: number;
  score: number;
}

export interface CitationVerificationChecks {
  doi: "matched" | "conflict" | "absent" | "unavailable";
  title: number;
  author: number;
  year: "matched" | "close" | "unmatched" | "unknown";
}

export interface CitationVerification {
  status: CitationVerificationStatus;
  entry: CitationEntry;
  matches: VerifiedPaper[];
  checks: CitationVerificationChecks;
  providers: ScholarlyProvider[];
  error?: string;
  verifiedAt: number;
}

const verifiedThreshold = 0.85;
const probableThreshold = 0.65;
const verificationConcurrency = 3;
const verificationTtlMs = 7 * 24 * 60 * 60 * 1000;
const verificationErrorTtlMs = 10 * 60 * 1000;

const verificationCache = new Map<string, CitationVerification>();
const verificationInFlight = new Map<string, Promise<CitationVerification>>();

function entryYear(entry: CitationEntry): number | null {
  const match = entry.year?.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function fieldAuthor(entry: CitationEntry): string | undefined {
  return entry.author ?? entry.editor;
}

function uniqueProviders(providers: ScholarlyProvider[]): ScholarlyProvider[] {
  return [...new Set(providers)];
}

function verificationCacheKey(entry: CitationEntry): string {
  return [
    entry.key,
    normalizeDoi(entry.doi),
    normalizeTitle(entry.title),
    entryYear(entry) ?? "",
  ].join("|");
}

function verificationFingerprint(paper: ScholarlyPaper): string {
  const doi = normalizeDoi(paper.doi);
  if (doi) return `doi:${doi}`;
  return `title:${normalizeTitle(paper.title)}:${paper.year ?? ""}`;
}

function scoredPaper(paper: ScholarlyPaper, score: number): VerifiedPaper {
  return {
    provider: paper.provider,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    venue: paper.venue,
    url: paper.url,
    doi: paper.doi,
    citationCount: paper.citationCount,
    score: Number(score.toFixed(3)),
  };
}

function yearScore(candidateYear: number | null, expectedYear: number | null): number {
  if (candidateYear === null || expectedYear === null) return 0.5;
  if (candidateYear === expectedYear) return 1;
  if (Math.abs(candidateYear - expectedYear) <= 1) return 0.5;
  return 0;
}

function yearState(
  candidateYear: number | null,
  expectedYear: number | null,
): CitationVerificationChecks["year"] {
  if (candidateYear === null || expectedYear === null) return "unknown";
  if (candidateYear === expectedYear) return "matched";
  if (Math.abs(candidateYear - expectedYear) <= 1) return "close";
  return "unmatched";
}

function scoreCandidate(
  entry: CitationEntry,
  candidate: ScholarlyPaper,
): {
  score: number;
  base: number;
  doiState: CitationVerificationChecks["doi"];
  title: number;
  author: number;
  year: CitationVerificationChecks["year"];
} {
  const entryDoi = normalizeDoi(entry.doi) || undefined;
  const candidateDoi = normalizeDoi(candidate.doi) || undefined;
  const title = tokenSimilarity(candidate.title, entry.title);
  const author = authorSimilarity(fieldAuthor(entry), candidate.authors);
  const year = yearState(candidate.year, entryYear(entry));
  const base =
    title * 0.55 + author * 0.25 + yearScore(candidate.year, entryYear(entry)) * 0.2;

  if (entryDoi && candidateDoi && candidateDoi === entryDoi) {
    return { score: 1, base: 1, doiState: "matched", title, author, year };
  }
  if (entryDoi && candidateDoi) {
    return {
      score: base - 0.5,
      base,
      doiState: "conflict",
      title,
      author,
      year,
    };
  }
  if (entryDoi) {
    return { score: base - 0.15, base, doiState: "unavailable", title, author, year };
  }
  return { score: base, base, doiState: "absent", title, author, year };
}

function verificationQuery(entry: CitationEntry): string | null {
  const lastNames = authorLastNames(fieldAuthor(entry)).slice(0, 2).join(" ");
  const year = entryYear(entry);
  const title = entry.title ? entry.title.slice(0, 140) : "";
  const query = [title, lastNames, year ? String(year) : ""]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 200);
  return query.length >= 8 ? query : null;
}

function collectUnique(...lists: Array<ScholarlyPaper[]>): ScholarlyPaper[] {
  const seen = new Set<string>();
  const papers: ScholarlyPaper[] = [];
  for (const list of lists) {
    for (const paper of list) {
      const identity = verificationFingerprint(paper);
      if (seen.has(identity)) continue;
      seen.add(identity);
      papers.push(paper);
    }
  }
  return papers;
}

async function lookupByDoi(
  doi: string,
  options: ScholarlySearchOptions,
): Promise<{
  papers: ScholarlyPaper[];
  errors: string[];
  providers: ScholarlyProvider[];
}> {
  const providers: ScholarlyProvider[] = [];
  const errors: string[] = [];
  const settled = await Promise.allSettled([
    lookupCrossrefByDoi(doi, options),
    lookupOpenAlexByDoi(doi, options),
  ]);
  const results: ScholarlyPaper[][] = [];
  const settledProviders: ScholarlyProvider[] = ["Crossref", "OpenAlex"];
  settled.forEach((result, index) => {
    const provider = settledProviders[index];
    providers.push(provider);
    if (result.status === "fulfilled") {
      results.push(result.value);
    } else if (isAbortError(result.reason)) {
      // rethrow handled by caller via options.signal check below
      throw result.reason;
    } else {
      rememberProviderFailure(provider, result.reason);
      errors.push(providerErrorLabel(provider, result.reason));
    }
  });
  return { papers: collectUnique(...results), errors, providers };
}

function buildUnverifiable(
  entry: CitationEntry,
  providers: ScholarlyProvider[],
): CitationVerification {
  return {
    status: "unverified",
    entry,
    matches: [],
    checks: {
      doi: normalizeDoi(entry.doi) ? "unavailable" : "absent",
      title: 0,
      author: 0,
      year: "unknown",
    },
    providers: uniqueProviders(providers),
    verifiedAt: Date.now(),
  };
}

export async function verifyCitation(
  entry: CitationEntry,
  options: ScholarlySearchOptions = {},
): Promise<CitationVerification> {
  const providers: ScholarlyProvider[] = [];
  if (!entry.title || !fieldAuthor(entry)) {
    return buildUnverifiable(entry, providers);
  }

  const entryDoi = normalizeDoi(entry.doi) || undefined;
  let doiState: CitationVerificationChecks["doi"] = entryDoi ? "unavailable" : "absent";
  let doiErrors: string[] = [];

  if (entryDoi) {
    try {
      const lookup = await lookupByDoi(entryDoi, options);
      providers.push(...lookup.providers);
      doiErrors = lookup.errors;
      const doiPapers = lookup.papers.filter(
        (paper) => normalizeDoi(paper.doi) === entryDoi,
      );
      if (doiPapers.length > 0) {
        const top = doiPapers[0];
        const scored = scoreCandidate(entry, top);
        return {
          status: "verified",
          entry,
          matches: [scoredPaper(top, top.doi ? 1 : scored.base)],
          checks: {
            doi: "matched",
            title: scored.title,
            author: scored.author,
            year: scored.year,
          },
          providers: uniqueProviders(providers),
          verifiedAt: Date.now(),
        };
      }
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) throw error;
    }
  }

  const query = verificationQuery(entry);
  if (!query) {
    return buildUnverifiable(entry, providers);
  }

  let candidates: ScholarlyPaper[] = [];
  const metadataErrors: string[] = [];
  try {
    const settled = await Promise.allSettled([
      searchCrossref(query, {
        ...options,
        perProviderLimit: options.perProviderLimit ?? 5,
      }),
      searchOpenAlex(query, {
        ...options,
        perProviderLimit: options.perProviderLimit ?? 5,
      }),
    ]);
    const providerKeys: ScholarlyProvider[] = ["Crossref", "OpenAlex"];
    const results: ScholarlyPaper[][] = [];
    settled.forEach((result, index) => {
      const provider = providerKeys[index];
      providers.push(provider);
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else if (isAbortError(result.reason)) {
        throw result.reason;
      } else {
        rememberProviderFailure(provider, result.reason);
        metadataErrors.push(providerErrorLabel(provider, result.reason));
      }
    });
    candidates = collectUnique(...results);
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) throw error;
    metadataErrors.push(error instanceof Error ? error.message : String(error));
  }

  const allErrors = [...doiErrors, ...metadataErrors];
  if (candidates.length === 0) {
    if (allErrors.length > 0) {
      return {
        status: "error",
        entry,
        matches: [],
        checks: { doi: doiState, title: 0, author: 0, year: "unknown" },
        providers: uniqueProviders(providers),
        error: allErrors[0],
        verifiedAt: Date.now(),
      };
    }
    return buildUnverifiable(entry, providers);
  }

  const scored = candidates
    .map((candidate) => ({
      candidate,
      ...scoreCandidate(entry, candidate),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  doiState = best.doiState;
  let status: CitationVerificationStatus;
  if (best.score >= 1) {
    status = "verified";
  } else if (best.doiState === "conflict" && best.base >= verifiedThreshold) {
    status = "mismatch";
  } else if (best.score >= verifiedThreshold) {
    status = "verified";
  } else if (best.score >= probableThreshold) {
    status = "probable";
  } else {
    status = "unverified";
  }

  const matches = scored
    .slice(0, 3)
    .map(({ candidate, score }) => scoredPaper(candidate, score));

  return {
    status,
    entry,
    matches,
    checks: {
      doi: doiState,
      title: best.title,
      author: best.author,
      year: best.year,
    },
    providers: uniqueProviders(providers),
    verifiedAt: Date.now(),
  };
}

function cachedWithinTtl(verification: CitationVerification, now: number): boolean {
  const ttl =
    verification.status === "error" ? verificationErrorTtlMs : verificationTtlMs;
  return now - verification.verifiedAt < ttl;
}

export function peekCachedVerification(
  entry: CitationEntry,
): CitationVerification | undefined {
  const key = verificationCacheKey(entry);
  const cached = verificationCache.get(key);
  if (!cached) return undefined;
  if (!cachedWithinTtl(cached, Date.now())) {
    verificationCache.delete(key);
    return undefined;
  }
  return cached;
}

export function verifyCitationCached(
  entry: CitationEntry,
  options: ScholarlySearchOptions = {},
): Promise<CitationVerification> {
  const key = verificationCacheKey(entry);
  const existing = verificationInFlight.get(key);
  if (existing) return existing;

  const cached = verificationCache.get(key);
  if (cached && cachedWithinTtl(cached, Date.now())) {
    return Promise.resolve(cached);
  }

  const promise = verifyCitation(entry, options)
    .then((verification) => {
      verificationCache.set(key, verification);
      return verification;
    })
    .catch((error) => {
      if (isAbortError(error) || options.signal?.aborted) throw error;
      const verification: CitationVerification = {
        status: "error",
        entry,
        matches: [],
        checks: {
          doi: normalizeDoi(entry.doi) ? "unavailable" : "absent",
          title: 0,
          author: 0,
          year: "unknown",
        },
        providers: [],
        error: error instanceof Error ? error.message : String(error),
        verifiedAt: Date.now(),
      };
      verificationCache.set(key, verification);
      return verification;
    })
    .finally(() => {
      verificationInFlight.delete(key);
    });
  verificationInFlight.set(key, promise);
  return promise;
}

export async function verifyCitations(
  entries: CitationEntry[],
  options: ScholarlySearchOptions = {},
): Promise<Map<string, CitationVerification>> {
  const results = new Map<string, CitationVerification>();
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(verificationConcurrency, Math.max(entries.length, 1)) },
    async () => {
      while (nextIndex < entries.length) {
        const entry = entries[nextIndex];
        nextIndex += 1;
        const verification = await verifyCitationCached(entry, options);
        results.set(entry.key, verification);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export function citationVerificationMarkdown(
  entry: CitationEntry,
  verification?: CitationVerification,
): string {
  const body = citationHoverMarkdown(entry);
  if (!verification) {
    return ["⏳", body].filter(Boolean).join("\n\n");
  }

  const topMatch = verification.matches[0];
  let statusLine: string;
  switch (verification.status) {
    case "verified":
      statusLine = "✅";
      break;
    case "probable":
      statusLine = `☑️ ${Math.round((topMatch?.score ?? 0) * 100)}%`;
      break;
    case "mismatch":
      statusLine = "⚠️ DOI";
      break;
    case "unverified":
      statusLine = "❔";
      break;
    case "error":
      statusLine = verification.error ? `⚠️ ${verification.error}` : "⚠️";
      break;
  }

  const checksLine = [
    verification.checks.title > 0
      ? `title ${Math.round(verification.checks.title * 100)}%`
      : undefined,
    verification.checks.author > 0
      ? `author ${Math.round(verification.checks.author * 100)}%`
      : undefined,
    verification.checks.year !== "unknown"
      ? `year ${verification.checks.year}`
      : undefined,
    verification.checks.doi !== "absent" ? `doi ${verification.checks.doi}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  const matchTitle = topMatch?.title.replace(/[*_`[\]]/g, "");
  const matchLink =
    topMatch && topMatch.url ? `[${matchTitle}](${topMatch.url})` : matchTitle;
  const matchBlock =
    topMatch && matchLink
      ? [
          `**Match:** ${matchLink}`,
          [
            topMatch.authors.slice(0, 3).join(", ")
              ? topMatch.authors.slice(0, 3).join(", ")
              : undefined,
            topMatch.venue,
            topMatch.year ? String(topMatch.year) : undefined,
          ]
            .filter(Boolean)
            .join(" · "),
        ]
      : undefined;

  const footer =
    verification.providers.length > 0
      ? `_via ${verification.providers.join(" and ")}_`
      : undefined;

  return [statusLine, checksLine, body, matchBlock, footer]
    .filter(Boolean)
    .join("\n\n");
}

export const __test = {
  verifiedThreshold,
  probableThreshold,
  verificationConcurrency,
  verificationTtlMs,
  verificationErrorTtlMs,
  verificationCache,
  verificationInFlight,
};
