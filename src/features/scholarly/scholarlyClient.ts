import type {
  ScholarlyFetchOptions,
  ScholarlyPaper,
  ScholarlyProvider,
  ScholarlySearchOptions,
} from "./scholarlyTypes";

export const defaultScholarlyTimeoutMs = 9000;
export const defaultScholarlyRetryDelayMs = 300;
export const defaultProviderCooldownMs = 10 * 60 * 1000;

export class ScholarlyHttpError extends Error {
  retryable: boolean;
  status?: number;
  retryAfterMs?: number;

  constructor(
    message: string,
    retryable: boolean,
    status?: number,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ScholarlyHttpError";
    this.retryable = retryable;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

interface ScholarlyDesktopApi {
  fetchScholarlyJson?: (url: string) => Promise<unknown>;
}

const providerCooldownUntil = new Map<ScholarlyProvider, number>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDesktopFetchEnvelope(
  value: unknown,
): value is
  | { ok: true; json: unknown }
  | { ok: false; status?: number; retryAfterMs?: number; error?: string } {
  return isRecord(value) && typeof value.ok === "boolean";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return readString(value);
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    const text = readString(item);
    if (text) return text;
  }
  return undefined;
}

const htmlEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function cleanText(value: string): string {
  return (
    value
      .replace(/<[^>]+>/g, " ")
      // Crossref returns titles and venues HTML-escaped ("Fuzzy Systems &amp; …").
      .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, name: string) => {
        if (name[0] === "#") {
          const code =
            name[1].toLowerCase() === "x"
              ? Number.parseInt(name.slice(2), 16)
              : Number.parseInt(name.slice(1), 10);
          return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
        }
        return htmlEntities[name.toLowerCase()] ?? entity;
      })
      .replace(/[{}]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function normalizeDoi(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "")
    .trim();
}

export function doiToUrl(doi: string | undefined): string | undefined {
  const normalized = normalizeDoi(doi);
  return normalized ? `https://doi.org/${normalized}` : undefined;
}

export function normalizeTitle(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function abortError(): DOMException {
  return new DOMException("Scholarly metadata request aborted", "AbortError");
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function providerOnCooldown(provider: ScholarlyProvider): boolean {
  return (providerCooldownUntil.get(provider) ?? 0) > Date.now();
}

export function rememberProviderFailure(
  provider: ScholarlyProvider,
  error: unknown,
): void {
  if (!(error instanceof ScholarlyHttpError)) return;
  if (error.status === 429) {
    providerCooldownUntil.set(
      provider,
      Date.now() + (error.retryAfterMs ?? defaultProviderCooldownMs),
    );
  }
}

export function providerErrorLabel(
  provider: ScholarlyProvider,
  error: unknown,
): string {
  if (error instanceof Error) return `${provider}: ${error.message}`;
  return `${provider}: request failed`;
}

export function desktopScholarlyFetcher(): typeof fetch | undefined {
  const api =
    typeof window === "undefined"
      ? undefined
      : (window.latexdo as ScholarlyDesktopApi | undefined);
  if (typeof api?.fetchScholarlyJson !== "function") return undefined;

  return async (input, init) => {
    const signal = init?.signal;
    if (signal?.aborted) throw abortError();
    const request = api.fetchScholarlyJson?.(requestUrl(input));
    if (!request) throw new Error("Scholarly metadata API is unavailable.");

    const json = signal
      ? await new Promise<unknown>((resolve, reject) => {
          const onAbort = () => reject(abortError());
          signal.addEventListener("abort", onAbort, { once: true });
          request.then(resolve, reject).finally(() => {
            signal.removeEventListener("abort", onAbort);
          });
        })
      : await request;

    if (isDesktopFetchEnvelope(json)) {
      if (json.ok) {
        return new Response(JSON.stringify(json.json), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: json.error ?? "Request failed" }), {
        status: json.status ?? 502,
        headers: {
          "Content-Type": "application/json",
          ...(json.retryAfterMs
            ? { "x-latexdo-retry-after-ms": String(json.retryAfterMs) }
            : {}),
        },
      });
    }

    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

export function scholarlyFetcher(custom?: typeof fetch): typeof fetch | undefined {
  if (custom) return custom;
  return (
    desktopScholarlyFetcher() ??
    (typeof fetch === "function" ? fetch.bind(globalThis) : undefined)
  );
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise((resolve, reject) => {
    function cleanup() {
      signal?.removeEventListener("abort", onAbort);
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      cleanup();
      reject(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchJson(
  url: string,
  options: ScholarlyFetchOptions = {},
): Promise<unknown> {
  const fetcher = options.fetcher ?? scholarlyFetcher();
  if (!fetcher) throw new Error("Scholarly metadata fetch is unavailable.");

  const timeoutMs = options.timeoutMs ?? defaultScholarlyTimeoutMs;
  const retryDelayMs = options.retryDelayMs ?? defaultScholarlyRetryDelayMs;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetcher(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const retryAfterMs = Number(response.headers.get("x-latexdo-retry-after-ms"));
        throw new ScholarlyHttpError(
          `HTTP ${response.status} from ${new URL(url).hostname}`,
          response.status >= 500,
          response.status,
          Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : undefined,
        );
      }
      return await response.json();
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throw error;
      lastError = error;
      const retryable =
        error instanceof ScholarlyHttpError ? error.retryable : attempt === 0;
      if (!retryable || attempt === 1) break;
      await wait(retryDelayMs, options.signal);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Scholarly metadata request failed");
}

// ── OpenAlex ──────────────────────────────────────────────────────────────

function openAlexAuthors(work: Record<string, unknown>): string[] {
  const authorships = Array.isArray(work.authorships) ? work.authorships : [];
  return authorships
    .map((authorship) => {
      if (!isRecord(authorship) || !isRecord(authorship.author)) return undefined;
      return readString(authorship.author.display_name);
    })
    .filter((author): author is string => Boolean(author))
    .slice(0, 12);
}

function openAlexVenue(work: Record<string, unknown>): string | undefined {
  const primaryLocation = isRecord(work.primary_location)
    ? work.primary_location
    : undefined;
  const source =
    primaryLocation && isRecord(primaryLocation.source)
      ? primaryLocation.source
      : undefined;
  const bestOa = isRecord(work.best_oa_location) ? work.best_oa_location : undefined;
  const bestOaSource = bestOa && isRecord(bestOa.source) ? bestOa.source : undefined;
  const hostVenue = isRecord(work.host_venue) ? work.host_venue : undefined;
  return (
    readString(source?.display_name) ??
    readString(bestOaSource?.display_name) ??
    readString(hostVenue?.display_name)
  );
}

export function paperFromOpenAlex(work: unknown): ScholarlyPaper | null {
  if (!isRecord(work)) return null;
  if (work.is_retracted === true || work.is_paratext === true) return null;
  const title = cleanText(
    readString(work.display_name) ?? readString(work.title) ?? "",
  );
  if (!title) return null;

  const primaryLocation = isRecord(work.primary_location)
    ? work.primary_location
    : undefined;
  const bestOa = isRecord(work.best_oa_location) ? work.best_oa_location : undefined;
  const doi = normalizeDoi(readString(work.doi));
  const doiUrl = doiToUrl(doi);
  const landingUrl =
    doiUrl ??
    readString(primaryLocation?.landing_page_url) ??
    readString(bestOa?.landing_page_url) ??
    readString(work.id);
  const pdfUrl = readString(primaryLocation?.pdf_url) ?? readString(bestOa?.pdf_url);

  return {
    provider: "OpenAlex",
    sourceId: readString(work.id),
    title,
    authors: openAlexAuthors(work),
    year: readNumber(work.publication_year) ?? null,
    venue: openAlexVenue(work),
    doi: doi || undefined,
    url: landingUrl,
    pdfUrl,
    citationCount: readNumber(work.cited_by_count),
    providerScore: readNumber(work.relevance_score),
  };
}

async function openAlexWorks(
  params: Record<string, string>,
  options: ScholarlySearchOptions,
): Promise<ScholarlyPaper[]> {
  const url = new URL("https://api.openalex.org/works");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const json = await fetchJson(url.toString(), options);
  if (!isRecord(json) || !Array.isArray(json.results)) return [];
  return json.results
    .map(paperFromOpenAlex)
    .filter((paper): paper is ScholarlyPaper => Boolean(paper));
}

export function searchOpenAlex(
  query: string,
  options: ScholarlySearchOptions = {},
): Promise<ScholarlyPaper[]> {
  return openAlexWorks(
    {
      search: query,
      "per-page": String(options.perProviderLimit ?? 5),
    },
    options,
  );
}

export function lookupOpenAlexByDoi(
  doi: string,
  options: ScholarlySearchOptions = {},
): Promise<ScholarlyPaper[]> {
  return openAlexWorks(
    {
      filter: `doi:${normalizeDoi(doi)}`,
      "per-page": "5",
    },
    options,
  );
}

// ── Crossref ──────────────────────────────────────────────────────────────

function crossrefAuthors(item: Record<string, unknown>): string[] {
  const authors = Array.isArray(item.author) ? item.author : [];
  return authors
    .map((author) => {
      if (!isRecord(author)) return undefined;
      const given = readString(author.given);
      const family = readString(author.family);
      return [given ?? "", family ?? ""].join(" ").replace(/\s+/g, " ").trim();
    })
    .filter((author): author is string => Boolean(author))
    .slice(0, 12);
}

function crossrefYear(item: Record<string, unknown>): number | null {
  const issued = isRecord(item.issued) ? item.issued : undefined;
  const dateParts = Array.isArray(issued?.["date-parts"])
    ? issued?.["date-parts"]
    : undefined;
  const firstPart = Array.isArray(dateParts?.[0]) ? dateParts[0] : undefined;
  const year = readNumber(firstPart?.[0]);
  return year ?? null;
}

export function paperFromCrossref(item: unknown): ScholarlyPaper | null {
  if (!isRecord(item)) return null;
  const title = cleanText(firstString(item.title) ?? "");
  if (!title) return null;
  const doi = normalizeDoi(readString(item.DOI));
  const type = readString(item.type);
  const venue = cleanText(firstString(item["container-title"]) ?? "");
  return {
    provider: "Crossref",
    sourceId: doi || readString(item.URL),
    title,
    authors: crossrefAuthors(item),
    year: crossrefYear(item),
    venue: venue || undefined,
    doi: doi || undefined,
    url: doiToUrl(doi) ?? readString(item.URL),
    citationCount: readNumber(item["is-referenced-by-count"]),
    providerScore: readNumber(item.score),
    sourceType: type,
  };
}

async function crossrefWorks(
  params: Record<string, string>,
  options: ScholarlySearchOptions,
): Promise<ScholarlyPaper[]> {
  const url = new URL("https://api.crossref.org/works");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const json = await fetchJson(url.toString(), options);
  if (
    !isRecord(json) ||
    !isRecord(json.message) ||
    !Array.isArray(json.message.items)
  ) {
    return [];
  }
  return json.message.items
    .map(paperFromCrossref)
    .filter((paper): paper is ScholarlyPaper => Boolean(paper));
}

export function searchCrossref(
  query: string,
  options: ScholarlySearchOptions = {},
): Promise<ScholarlyPaper[]> {
  return crossrefWorks(
    {
      "query.bibliographic": query,
      rows: String(options.perProviderLimit ?? 5),
    },
    options,
  );
}

export function lookupCrossrefByDoi(
  doi: string,
  options: ScholarlySearchOptions = {},
): Promise<ScholarlyPaper[]> {
  return crossrefWorks(
    {
      filter: `doi:${normalizeDoi(doi)}`,
      rows: "5",
    },
    options,
  );
}
