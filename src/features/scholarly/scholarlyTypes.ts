export type ScholarlyProvider = "OpenAlex" | "Crossref";

export interface ScholarlyPaper {
  provider: ScholarlyProvider;
  title: string;
  authors: string[];
  year: number | null;
  venue?: string;
  doi?: string;
  url?: string;
  pdfUrl?: string;
  citationCount?: number;
  providerScore?: number;
  sourceId?: string;
  sourceType?: string;
}

export interface ScholarlyFetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retryDelayMs?: number;
  fetcher?: typeof fetch;
}

export interface ScholarlySearchOptions extends ScholarlyFetchOptions {
  perProviderLimit?: number;
}
