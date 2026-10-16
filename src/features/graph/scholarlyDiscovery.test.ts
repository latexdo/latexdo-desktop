import { afterEach, describe, expect, it, vi } from "vitest";
import type { CitationEntry } from "../../latex/latexIndex";
import { buildKnowledgeGraph, defaultKnowledgeGraphParams } from "./knowledgeGraph";
import { buildDiscoveryQueries, discoverRelatedPapers } from "./scholarlyDiscovery";

function entry(partial: Partial<CitationEntry> & { key: string }): CitationEntry {
  return {
    type: "article",
    sourceFile: "refs.bib",
    ...partial,
  };
}

const library: CitationEntry[] = [
  entry({
    key: "smith2020",
    author: "Smith, Jane and Doe, John",
    title: "Graph neural networks for citation recommendation",
    journal: "Journal of Machine Learning Research",
    year: "2020",
    doi: "10.1000/local",
  }),
  entry({
    key: "smith2021",
    author: "Smith, Jane",
    title: "Citation recommendation with graph neural networks",
    journal: "Journal of Machine Learning Research",
    year: "2021",
  }),
];

function graphFixture() {
  return buildKnowledgeGraph(library, ["smith2020"], defaultKnowledgeGraphParams);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL | string): string {
  return input instanceof URL
    ? input.toString()
    : typeof Request !== "undefined" && input instanceof Request
      ? input.url
      : String(input);
}

function requestHostname(input: RequestInfo | URL | string): string {
  try {
    return new URL(requestUrl(input)).hostname;
  } catch {
    return "";
  }
}

describe("scholarly discovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds stable queries from the graph fingerprint", () => {
    const queries = buildDiscoveryQueries(graphFixture(), library, 2026);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0]).toMatch(/citation|graph|recommendation/);
  });

  it("discovers, ranks, deduplicates, and materializes BibTeX", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (requestHostname(input) === "api.openalex.org") {
        return jsonResponse({
          results: [
            {
              id: "https://openalex.org/WLOCAL",
              doi: "https://doi.org/10.1000/local",
              display_name: "Graph neural networks for citation recommendation",
              publication_year: 2020,
              cited_by_count: 500,
              authorships: [{ author: { display_name: "Jane Smith" } }],
              primary_location: {
                landing_page_url: "https://doi.org/10.1000/local",
                source: { display_name: "Journal of Machine Learning Research" },
              },
            },
            {
              id: "https://openalex.org/WNEW",
              doi: "https://doi.org/10.5555/new",
              display_name: "Graph transformers for citation discovery",
              publication_year: 2025,
              cited_by_count: 120,
              authorships: [
                { author: { display_name: "Jane Smith" } },
                { author: { display_name: "Kai Lee" } },
              ],
              primary_location: {
                landing_page_url: "https://doi.org/10.5555/new",
                pdf_url: "https://example.test/new.pdf",
                source: { display_name: "ACM Computing Surveys" },
              },
            },
            {
              id: "https://openalex.org/WOFFTOPIC",
              doi: "https://doi.org/10.7777/bread",
              display_name: "A history of sourdough bread",
              publication_year: 2026,
              cited_by_count: 10000,
              authorships: [{ author: { display_name: "Betty Baker" } }],
              primary_location: {
                landing_page_url: "https://doi.org/10.7777/bread",
                source: { display_name: "Food History Review" },
              },
            },
          ],
        });
      }

      return jsonResponse({
        message: {
          items: [
            {
              DOI: "10.5555/new",
              title: ["Graph transformers for citation discovery"],
              author: [{ given: "Jane", family: "Smith" }],
              issued: { "date-parts": [[2025]] },
              "container-title": ["ACM Computing Surveys"],
              "is-referenced-by-count": 118,
              URL: "https://doi.org/10.5555/new",
              type: "journal-article",
            },
            {
              DOI: "10.9999/other",
              title: ["Citation graphs for scholarly recommendation systems"],
              author: [{ given: "Sam", family: "Patel" }],
              issued: { "date-parts": [[2024]] },
              "container-title": ["Information Retrieval Journal"],
              "is-referenced-by-count": 30,
              URL: "https://doi.org/10.9999/other",
              type: "journal-article",
            },
          ],
        },
      });
    }) as unknown as typeof fetch;

    const result = await discoverRelatedPapers(graphFixture(), library, {
      fetcher,
      currentYear: 2026,
      retryDelayMs: 0,
      timeoutMs: 1000,
      perProviderLimit: 4,
    });

    expect(fetcher).toHaveBeenCalled();
    expect(result.providerErrors).toEqual([]);
    expect(result.papers.some((paper) => paper.doi === "10.1000/local")).toBe(false);
    expect(result.papers.some((paper) => paper.doi === "10.7777/bread")).toBe(false);
    expect(result.papers.map((paper) => paper.title)).toContain(
      "Graph transformers for citation discovery",
    );
    expect(result.papers[0]).toMatchObject({
      title: "Graph transformers for citation discovery",
      bibtexKey: "smith2025graph",
    });
    expect(result.papers[0].bibtex).toContain("@article{smith2025graph");
    expect(result.papers[0].bibtex).toContain("doi = {10.5555/new}");
  });

  it("keeps fallback provider results when one source fails", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (requestHostname(input) === "api.openalex.org") {
        return jsonResponse({ error: "temporary" }, 500);
      }

      return jsonResponse({
        message: {
          items: [
            {
              DOI: "10.9999/fallback",
              title: ["Citation graphs for scholarly recommendation systems"],
              author: [{ given: "Sam", family: "Patel" }],
              issued: { "date-parts": [[2024]] },
              "container-title": ["Information Retrieval Journal"],
              "is-referenced-by-count": 30,
              URL: "https://doi.org/10.9999/fallback",
              type: "journal-article",
            },
          ],
        },
      });
    }) as unknown as typeof fetch;

    const result = await discoverRelatedPapers(graphFixture(), library, {
      fetcher,
      currentYear: 2026,
      retryDelayMs: 0,
      timeoutMs: 1000,
      perProviderLimit: 2,
    });

    expect(result.providerErrors.some((error) => error.includes("OpenAlex"))).toBe(
      true,
    );
    expect(result.papers.map((paper) => paper.doi)).toContain("10.9999/fallback");
  });

  it("does not fan out Crossref fallback requests when Crossref throttles", async () => {
    const crossrefCalls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (requestHostname(input) === "api.openalex.org") {
        return jsonResponse({ results: [] });
      }
      crossrefCalls.push(url);
      return new Response(JSON.stringify({ message: "too many requests" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await discoverRelatedPapers(graphFixture(), library, {
      fetcher,
      currentYear: 2026,
      retryDelayMs: 0,
      timeoutMs: 1000,
      perProviderLimit: 2,
    });

    expect(crossrefCalls).toHaveLength(1);
    expect(result.papers).toEqual([]);
    expect(result.providerErrors.some((error) => error.includes("Crossref"))).toBe(
      true,
    );
  });

  it("uses the desktop scholarly bridge before renderer fetch", async () => {
    const rendererFetch = vi.fn(async () => {
      throw new Error("renderer fetch should not run");
    }) as unknown as typeof fetch;
    const desktopFetch = vi.fn(async (url: string) => {
      if (requestHostname(url) === "api.openalex.org") {
        return {
          results: [
            {
              id: "https://openalex.org/WBRIDGE",
              doi: "https://doi.org/10.4242/bridge",
              display_name: "Graph citation discovery with neural recommenders",
              publication_year: 2025,
              cited_by_count: 15,
              authorships: [{ author: { display_name: "Jane Smith" } }],
              primary_location: {
                landing_page_url: "https://publisher.example/bridge",
                source: { display_name: "Metadata Systems" },
              },
            },
          ],
        };
      }
      return { message: { items: [] } };
    });
    vi.stubGlobal("fetch", rendererFetch);
    vi.stubGlobal("latexdo", { fetchScholarlyJson: desktopFetch });

    const result = await discoverRelatedPapers(graphFixture(), library, {
      currentYear: 2026,
      retryDelayMs: 0,
      timeoutMs: 1000,
      perProviderLimit: 2,
    });

    expect(rendererFetch).not.toHaveBeenCalled();
    expect(desktopFetch).toHaveBeenCalled();
    expect(result.papers[0]).toMatchObject({
      doi: "10.4242/bridge",
      url: "https://doi.org/10.4242/bridge",
    });
  });
});
