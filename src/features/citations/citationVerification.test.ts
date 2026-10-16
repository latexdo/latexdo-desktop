import { afterEach, describe, expect, it, vi } from "vitest";
import type { CitationEntry } from "../../latex/latexIndex";
import {
  __test,
  citationVerificationMarkdown,
  peekCachedVerification,
  verifyCitation,
  verifyCitationCached,
  verifyCitations,
} from "./citationVerification";

const { verificationCache, verificationInFlight } = __test;

function entry(partial: Partial<CitationEntry> & { key: string }): CitationEntry {
  return {
    type: "article",
    sourceFile: "refs.bib",
    ...partial,
  };
}

const smithEntry = entry({
  key: "smith2020",
  author: "Smith, Jane and Doe, John",
  title: "Graph neural networks for citation recommendation",
  journal: "Journal of Machine Learning Research",
  year: "2020",
  doi: "10.1000/local",
});

const breadEntry = entry({
  key: "bread2026",
  author: "Baker, Betty",
  title: "A history of sourdough bread",
  year: "2026",
});

function smithCrossrefItem(doi = "10.1000/local") {
  return {
    DOI: doi,
    title: ["Graph neural networks for citation recommendation"],
    author: [{ given: "Jane", family: "Smith" }],
    issued: { "date-parts": [[2020]] },
    "container-title": ["Journal of Machine Learning Research"],
    "is-referenced-by-count": 500,
    URL: `https://doi.org/${doi}`,
    type: "journal-article",
  };
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

function requestApi(input: RequestInfo | URL | string): string {
  try {
    const url = new URL(requestUrl(input));
    return url.pathname + url.search;
  } catch {
    return "";
  }
}

function isCrossref(input: RequestInfo | URL | string): boolean {
  return requestHostname(input) === "api.crossref.org";
}

function buildCrossref(items: unknown[]) {
  return (api: string): unknown => {
    if (api.includes("filter=doi:")) {
      const doi = decodeURIComponent(api.split("filter=doi:")[1]?.split("&")[0] ?? "");
      return {
        message: {
          items: items.filter(
            (item) => (item as { DOI: string }).DOI.toLowerCase() === doi.toLowerCase(),
          ),
        },
      };
    }
    return { message: { items } };
  };
}

function buildOpenAlex(results: unknown[]) {
  return (): unknown => ({ results });
}

describe("citation verification", () => {
  afterEach(() => {
    verificationCache.clear();
    verificationInFlight.clear();
    vi.restoreAllMocks();
  });

  it("marks an entry verified when its DOI resolves exactly", async () => {
    const crossrefHandler = buildCrossref([smithCrossrefItem()]);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const api = requestApi(input);
      return jsonResponse(
        isCrossref(input) ? crossrefHandler(api) : buildOpenAlex([])(),
      );
    }) as unknown as typeof fetch;

    const result = await verifyCitation(smithEntry, { fetcher });

    expect(result.status).toBe("verified");
    expect(result.checks.doi).toBe("matched");
    expect(result.matches[0]).toMatchObject({
      provider: "Crossref",
      doi: "10.1000/local",
      score: 1,
    });
    expect(result.providers.sort()).toEqual(["Crossref", "OpenAlex"]);
  });

  it("verifies by metadata match when the entry has no DOI", async () => {
    const noDoiEntry = entry({
      key: "smithNoDoi",
      author: "Smith, Jane",
      title: "Graph neural networks for citation recommendation",
      year: "2020",
    });
    const crossrefHandler = buildCrossref([smithCrossrefItem()]);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const api = requestApi(input);
      return jsonResponse(
        isCrossref(input) ? crossrefHandler(api) : buildOpenAlex([])(),
      );
    }) as unknown as typeof fetch;

    const result = await verifyCitation(noDoiEntry, { fetcher });

    expect(result.status).toBe("verified");
    expect(result.checks.doi).toBe("absent");
    expect(result.checks.title).toBeGreaterThan(0.9);
    expect(result.checks.author).toBe(1);
    expect(result.checks.year).toBe("matched");
    expect(result.matches[0].score).toBeGreaterThanOrEqual(0.85);
  });

  it("flags a DOI conflict as a mismatch", async () => {
    const crossrefHandler = buildCrossref([smithCrossrefItem("10.9999/other")]);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const api = requestApi(input);
      return jsonResponse(
        isCrossref(input) ? crossrefHandler(api) : buildOpenAlex([])(),
      );
    }) as unknown as typeof fetch;

    const result = await verifyCitation(smithEntry, { fetcher });

    expect(result.status).toBe("mismatch");
    expect(result.checks.doi).toBe("conflict");
    expect(result.matches[0]).toMatchObject({
      doi: "10.9999/other",
      provider: "Crossref",
    });
    expect(result.matches[0].score).toBeLessThan(0.85);
  });

  it("reports unverified when no candidate agrees with the entry", async () => {
    const crossrefHandler = buildCrossref([
      {
        DOI: "10.7777/pizza",
        title: ["A history of pizza dough"],
        author: [{ given: "Carl", family: "Chef" }],
        issued: { "date-parts": [[2000]] },
        "container-title": ["Baking Quarterly"],
        URL: "https://doi.org/10.7777/pizza",
        type: "journal-article",
      },
    ]);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const api = requestApi(input);
      return jsonResponse(
        isCrossref(input) ? crossrefHandler(api) : buildOpenAlex([])(),
      );
    }) as unknown as typeof fetch;

    const result = await verifyCitation(breadEntry, { fetcher });

    expect(result.status).toBe("unverified");
    expect(result.checks.doi).toBe("absent");
  });

  it("returns an error status when all providers fail without throwing", async () => {
    const fetcher = vi.fn(async () => {
      return jsonResponse({ error: "temporary failure" }, 503);
    }) as unknown as typeof fetch;

    const result = await verifyCitation(smithEntry, {
      fetcher,
      retryDelayMs: 0,
      timeoutMs: 1000,
    });

    expect(result.status).toBe("error");
    expect(result.error).toMatch(/Crossref|OpenAlex/);
  });

  it("caches results and deduplicates in-flight verification", async () => {
    const crossrefHandler = buildCrossref([smithCrossrefItem()]);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const api = requestApi(input);
      return jsonResponse(
        isCrossref(input) ? crossrefHandler(api) : buildOpenAlex([])(),
      );
    }) as unknown as typeof fetch;

    const first = await verifyCitationCached(smithEntry, { fetcher });
    const second = await verifyCitationCached(smithEntry, { fetcher });
    const peeked = peekCachedVerification(smithEntry);

    expect(first.status).toBe("verified");
    expect(second).toBe(first);
    expect(peeked).toBe(first);
  });

  it("shares a single in-flight promise for concurrent calls", async () => {
    const crossrefHandler = buildCrossref([smithCrossrefItem()]);
    let resolveGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const writeCount = { value: 0 };

    const fetcher = (async (input: RequestInfo | URL) => {
      writeCount.value += 1;
      await gate;
      const api = requestApi(input);
      return jsonResponse(
        isCrossref(input) ? crossrefHandler(api) : buildOpenAlex([])(),
      );
    }) as unknown as typeof fetch;

    const first = verifyCitationCached(smithEntry, { fetcher });
    const second = verifyCitationCached(smithEntry, { fetcher });
    const fetchesBeforeGate = writeCount.value;
    resolveGate?.();
    const [a, b] = await Promise.all([first, second]);

    expect(a).toBe(b);
    expect(a.status).toBe("verified");
    expect(fetchesBeforeGate).toBe(2);
    expect(writeCount.value).toBe(2);
  });

  it("runs batch verification with bounded concurrency", async () => {
    const entries = Array.from({ length: 4 }, (_, index) =>
      entry({
        key: `entry${index}`,
        author: "Smith, Jane",
        title: "Graph neural networks for citation recommendation",
        year: "2020",
        doi: `10.1000/${index}`,
      }),
    );
    const crossrefItems = entries.map((item, index) =>
      smithCrossrefItem(`10.1000/${index}`),
    );
    const crossrefHandler = buildCrossref(crossrefItems);
    let active = 0;
    let maxActive = 0;
    const fetcher = (async (input: RequestInfo | URL) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const api = requestApi(input);
      try {
        return jsonResponse(
          isCrossref(input) ? crossrefHandler(api) : buildOpenAlex([])(),
        );
      } finally {
        active -= 1;
      }
    }) as unknown as typeof fetch;

    const results = await verifyCitations(entries, { fetcher, retryDelayMs: 0 });

    expect(results.size).toBe(4);
    for (const verification of results.values()) {
      expect(verification.status).toBe("verified");
    }
    expect(maxActive).toBeLessThanOrEqual(__test.verificationConcurrency * 2);
  });

  it("renders markdown without a cached verification and with each status", () => {
    expect(citationVerificationMarkdown(smithEntry)).toContain("⏳");
    expect(citationVerificationMarkdown(smithEntry)).toContain("**Author:**");

    expect(
      citationVerificationMarkdown(smithEntry, {
        status: "verified",
        entry: smithEntry,
        matches: [
          {
            provider: "Crossref",
            title: "Graph neural networks for citation recommendation",
            authors: ["Jane Smith"],
            year: 2020,
            venue: "Journal of Machine Learning Research",
            url: "https://doi.org/10.1000/local",
            score: 1,
          },
        ],
        checks: { doi: "matched", title: 1, author: 1, year: "matched" },
        providers: ["Crossref", "OpenAlex"],
        verifiedAt: Date.now(),
      }),
    ).toContain("✅");
    expect(
      citationVerificationMarkdown(smithEntry, {
        status: "verified",
        entry: smithEntry,
        matches: [
          {
            provider: "Crossref",
            title: "Graph neural networks for citation recommendation",
            authors: ["Jane Smith"],
            year: 2020,
            venue: "Journal of Machine Learning Research",
            url: "https://doi.org/10.1000/local",
            score: 1,
          },
        ],
        checks: { doi: "matched", title: 1, author: 1, year: "matched" },
        providers: ["Crossref"],
        verifiedAt: Date.now(),
      }),
    ).toContain(
      "[Graph neural networks for citation recommendation](https://doi.org/10.1000/local)",
    );
    const markdownWithoutUrl = citationVerificationMarkdown(smithEntry, {
      status: "verified",
      entry: smithEntry,
      matches: [
        {
          provider: "Crossref",
          title: "Graph neural networks for citation recommendation",
          authors: ["Jane Smith"],
          year: 2020,
          venue: "Journal of Machine Learning Research",
          score: 1,
        },
      ],
      checks: { doi: "matched", title: 1, author: 1, year: "matched" },
      providers: ["Crossref"],
      verifiedAt: Date.now(),
    });
    expect(markdownWithoutUrl).toContain(
      "**Match:** Graph neural networks for citation recommendation",
    );
    expect(markdownWithoutUrl).not.toContain("]()");
    expect(
      citationVerificationMarkdown(smithEntry, {
        status: "unverified",
        entry: smithEntry,
        matches: [],
        checks: { doi: "absent", title: 0, author: 0, year: "unknown" },
        providers: ["Crossref"],
        verifiedAt: Date.now(),
      }),
    ).toContain("❔");
    expect(
      citationVerificationMarkdown(smithEntry, {
        status: "error",
        entry: smithEntry,
        matches: [],
        checks: { doi: "unavailable", title: 0, author: 0, year: "unknown" },
        providers: [],
        error: "Crossref: HTTP 503",
        verifiedAt: Date.now(),
      }),
    ).toContain("⚠️ Crossref: HTTP 503");
  });
});
