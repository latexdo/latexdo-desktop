import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CitationEntry } from "../../latex/latexIndex";
import type { ScholarlyPaper } from "../scholarly/scholarlyTypes";
import type { GraphNode, KnowledgeGraph } from "./knowledgeGraph";

const client = vi.hoisted(() => ({
  searchOpenAlex: vi.fn(),
  searchCrossref: vi.fn(),
  providerOnCooldown: vi.fn(() => false),
  scholarlyFetcher: vi.fn((fetcher?: typeof fetch) => fetcher ?? (vi.fn() as never)),
}));

vi.mock("../scholarly/scholarlyClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scholarly/scholarlyClient")>()),
  ...client,
}));

import { ScholarlyHttpError } from "../scholarly/scholarlyClient";
import {
  bibtexForPaper,
  buildDiscoveryQueries,
  discoverRelatedPapers,
  formatDiscoveredPaperAuthors,
  type DiscoveredPaper,
} from "./scholarlyDiscovery";

function node(partial: Partial<GraphNode> & { key: string }): GraphNode {
  return {
    label: partial.key,
    authors: [],
    year: null,
    type: "article",
    cited: false,
    degree: 0,
    ...partial,
  };
}

function graph(nodes: GraphNode[]): KnowledgeGraph {
  return {
    nodes,
    edges: [],
    params: {} as KnowledgeGraph["params"],
    stats: { nodeCount: nodes.length, edgeCount: 0, citedCount: 0, componentCount: 0 },
  };
}

function entry(partial: Partial<CitationEntry> & { key: string }): CitationEntry {
  return { type: "article", sourceFile: "refs.bib", ...partial };
}

function paper(partial: Partial<ScholarlyPaper>): ScholarlyPaper {
  return { provider: "OpenAlex", title: "", authors: [], year: null, ...partial };
}

const entries = [
  entry({
    key: "ed2020",
    editor: "Editor, Eve",
    title: "Quantum annealing schedules for optimisation",
    doi: "10.1/existing",
  }),
];
const quantumGraph = graph([
  node({
    key: "ed2020",
    title: "Quantum annealing schedules for optimisation paper study",
    cited: true,
    degree: 3,
  }),
  node({ key: "other", title: "Quantum annealing hardware noise" }),
  node({ key: "untitled" }),
]);

const fetcher = vi.fn() as unknown as typeof fetch;
const options = { fetcher, currentYear: 2026, retryDelayMs: 0, timeoutMs: 10 };

beforeEach(() => {
  vi.clearAllMocks();
  client.providerOnCooldown.mockReturnValue(false);
  client.searchOpenAlex.mockResolvedValue([]);
  client.searchCrossref.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("formatDiscoveredPaperAuthors", () => {
  const base = { authors: [] } as unknown as DiscoveredPaper;
  it("handles none, a few and many authors", () => {
    expect(formatDiscoveredPaperAuthors(base)).toBe("Unknown authors");
    expect(formatDiscoveredPaperAuthors({ ...base, authors: ["A", "B"] })).toBe("A, B");
    expect(formatDiscoveredPaperAuthors({ ...base, authors: ["A", "B", "C", "D"] })).toBe(
      "A, B, C et al.",
    );
  });
});

describe("bibtexForPaper", () => {
  it("falls back to placeholder key parts and skips missing fields", () => {
    const result = bibtexForPaper(paper({ title: "" }), []);
    expect(result.key).toBe("paperndwork");
    expect(result.bibtex).toBe("@article{paperndwork,\n}");
  });

  it("suffixes taken keys and uses booktitle for proceedings", () => {
    const result = bibtexForPaper(
      paper({
        title: "Neural parsing & tagging",
        authors: ["Ada Lovelace"],
        year: 2024,
        venue: "Proc. 50% Conference",
        sourceType: "proceedings-article",
        doi: "https://doi.org/10.1/X",
        url: "https://example.test",
      }),
      ["LOVELACE2024NEURAL", "lovelace2024neural2"],
    );
    expect(result.key).toBe("lovelace2024neural3");
    expect(result.bibtex).toContain("@inproceedings{lovelace2024neural3,");
    expect(result.bibtex).toContain("booktitle = {Proc. 50\\% Conference},");
    expect(result.bibtex).toContain("title = {Neural parsing \\& tagging},");
    expect(result.bibtex).toContain("doi = {10.1/x},");
    expect(result.bibtex).toMatch(/url = \{https:\/\/example.test\}\n\}$/);
  });

  it("uses article for unknown provider types", () => {
    expect(bibtexForPaper(paper({ title: "Thing", sourceType: "poster" }), []).bibtex).toMatch(
      /^@article/,
    );
  });
});

describe("buildDiscoveryQueries", () => {
  it("returns no queries without title terms", () => {
    expect(buildDiscoveryQueries(graph([node({ key: "a" })]), [], 2026)).toEqual([]);
  });

  it("drops stop terms like 'paper' and 'study'", () => {
    const queries = buildDiscoveryQueries(quantumGraph, entries, 2026);
    expect(queries[0]).toContain("quantum");
    expect(queries.join(" ")).not.toMatch(/\bpaper\b|\bstudy\b/);
  });
});

describe("discoverRelatedPapers", () => {
  it("fails without a network fetcher", async () => {
    client.scholarlyFetcher.mockReturnValueOnce(null as never);
    await expect(discoverRelatedPapers(quantumGraph, entries)).rejects.toThrow(
      "Network fetch is unavailable",
    );
  });

  it("returns early when there is nothing to search for", async () => {
    const result = await discoverRelatedPapers(graph([]), [], {
      ...options,
      aiQueries: ["short", "https://example.test/long-url"],
    });
    expect(result).toEqual({ papers: [], queries: [], providerErrors: [], aiQueriesUsed: [] });
    expect(client.searchOpenAlex).not.toHaveBeenCalled();
  });

  it("puts usable AI queries first, deduplicated", async () => {
    const result = await discoverRelatedPapers(quantumGraph, entries, {
      ...options,
      aiQueries: ["  quantum   error correction ", "Quantum error correction", "tiny"],
    });
    expect(result.queries[0]).toBe("quantum error correction");
    expect(result.aiQueriesUsed).toEqual(["quantum error correction"]);
  });

  it("filters existing papers, scores, ranks and deduplicates", async () => {
    client.searchOpenAlex.mockResolvedValue([
      paper({ title: "Quantum annealing schedules for optimisation", year: 2020 }),
      paper({ title: "Quantum annealing noise", doi: "10.1/existing" }),
      paper({
        title: "Quantum annealing in practice",
        authors: ["Eve Editor"],
        year: 2024,
        citationCount: 80,
        providerScore: 30,
        doi: "10.1/new",
      }),
      paper({ title: "Quantum annealing in practice", doi: "10.1/new" }),
      paper({ title: "Annealing quantum hardware", year: 2020, citationCount: 3 }),
      paper({ title: "Annealing quantum hardware", year: 2020, citationCount: 3 }),
      paper({ title: "Hardware annealing quantum", year: 2010, citationCount: 9 }),
      paper({ title: "Unrelated baking", year: 2025, citationCount: 9999 }),
    ]);
    const result = await discoverRelatedPapers(quantumGraph, entries, options);
    const titles = result.papers.map((p) => p.title);
    expect(titles[0]).toBe("Quantum annealing in practice");
    expect(titles).not.toContain("Unrelated baking");
    expect(titles).not.toContain("Quantum annealing noise");
    expect(titles).not.toContain("Quantum annealing schedules for optimisation");
    expect(titles.filter((t) => t === "Annealing quantum hardware")).toHaveLength(1);
    expect(result.papers[0].reasons).toEqual(
      expect.arrayContaining([
        "Shares author: editor",
        "80 citations",
        "Recent paper from 2024",
        "DOI metadata available",
      ]),
    );
    expect(result.papers[0].id).toBe("doi:10.1/new");
    const hardware = result.papers.find((p) => p.title === "Annealing quantum hardware")!;
    expect(hardware.id).toMatch(/^title:.*:2020$/);
    // Equal scores fall back to the citation count.
    const old = result.papers.find((p) => p.title === "Hardware annealing quantum")!;
    expect(result.papers.indexOf(hardware)).toBeLessThan(result.papers.indexOf(old));
    expect(client.searchCrossref).not.toHaveBeenCalled();
  });

  it("breaks score ties by citation count", async () => {
    client.searchOpenAlex.mockResolvedValue([
      paper({ title: "Quantum annealing", citationCount: undefined, doi: "10.2/a" }),
      paper({ title: "Annealing quantum", citationCount: undefined, doi: "10.2/b" }),
      paper({ title: "Quantum annealing!", citationCount: 0, doi: "10.2/c" }),
    ]);
    const result = await discoverRelatedPapers(quantumGraph, entries, {
      ...options,
      limit: 2,
    });
    expect(result.papers).toHaveLength(2);
  });

  it("falls back to Crossref, skipping providers on cooldown", async () => {
    client.providerOnCooldown.mockImplementation((provider) => provider === "OpenAlex");
    client.searchCrossref.mockResolvedValue([
      paper({ provider: "Crossref", title: "Quantum annealing review", doi: "10.3/x" }),
    ]);
    const result = await discoverRelatedPapers(quantumGraph, entries, options);
    expect(client.searchOpenAlex).not.toHaveBeenCalled();
    expect(client.searchCrossref).toHaveBeenCalledTimes(1);
    expect(result.papers.map((p) => p.source)).toEqual(["Crossref"]);
  });

  it("reports provider failures and rethrows aborts", async () => {
    client.searchOpenAlex.mockRejectedValue(new ScholarlyHttpError("unavailable", true, 503));
    client.searchCrossref.mockRejectedValue(new Error("offline"));
    const result = await discoverRelatedPapers(quantumGraph, entries, options);
    expect(result.providerErrors.length).toBeGreaterThan(1);
    expect(result.providerErrors.some((e) => e.includes("Crossref"))).toBe(true);

    client.searchOpenAlex.mockRejectedValue(new DOMException("stop", "AbortError"));
    await expect(discoverRelatedPapers(quantumGraph, entries, options)).rejects.toThrow(
      "stop",
    );
  });

  it("stops after either provider when the signal was aborted", async () => {
    const controller = new AbortController();
    client.searchOpenAlex.mockImplementation(async () => {
      controller.abort();
      return [];
    });
    await expect(
      discoverRelatedPapers(quantumGraph, entries, { ...options, signal: controller.signal }),
    ).rejects.toThrow("Discovery aborted");

    const second = new AbortController();
    client.searchOpenAlex.mockResolvedValue([]);
    client.searchCrossref.mockImplementation(async () => {
      second.abort();
      return [];
    });
    await expect(
      discoverRelatedPapers(quantumGraph, entries, { ...options, signal: second.signal }),
    ).rejects.toThrow("Discovery aborted");
  });

  it("caches results for the shared fetcher for ten minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    client.searchOpenAlex.mockResolvedValue([
      paper({ title: "Quantum annealing cached", doi: "10.4/c" }),
    ]);
    const opts = { currentYear: 2026, retryDelayMs: 0 };
    const first = await discoverRelatedPapers(quantumGraph, entries, opts);
    const second = await discoverRelatedPapers(quantumGraph, entries, opts);
    expect(second).toBe(first);
    vi.setSystemTime(new Date("2026-01-01T00:11:00Z"));
    const third = await discoverRelatedPapers(quantumGraph, entries, opts);
    expect(third).not.toBe(first);
    expect(third.papers).toEqual(first.papers);
  });

  it("uses default year and retry settings and title identities without a year", async () => {
    client.searchOpenAlex.mockResolvedValue([paper({ title: "Quantum annealing undated" })]);
    const result = await discoverRelatedPapers(
      graph([
        node({ key: "a", title: "Quantum annealing", degree: 1 }),
        node({ key: "b", title: "Annealing quantum chips", degree: 4 }),
      ]),
      [],
      { fetcher },
    );
    expect(result.papers[0].id).toBe("title:quantum annealing undated:");
    expect(client.searchOpenAlex.mock.calls[0][1]).toMatchObject({
      retryDelayMs: expect.any(Number),
      timeoutMs: expect.any(Number),
    });
  });
});
