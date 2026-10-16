import { describe, expect, it } from "vitest";
import type { CitationEntry } from "../../latex/latexIndex";
import {
  authorLastNames,
  buildKnowledgeGraph,
  defaultKnowledgeGraphParams,
  neighborsOf,
  normalizeKnowledgeGraphParams,
  titleTokens,
} from "./knowledgeGraph";

function entry(partial: Partial<CitationEntry> & { key: string }): CitationEntry {
  return {
    type: "article",
    sourceFile: "refs.bib",
    ...partial,
  };
}

describe("authorLastNames", () => {
  it("handles 'Last, First' and 'First Last' and multiple authors", () => {
    expect(authorLastNames("Vaswani, Ashish and Shazeer, Noam")).toEqual([
      "vaswani",
      "shazeer",
    ]);
    expect(authorLastNames("Yann LeCun and Yoshua Bengio")).toEqual([
      "lecun",
      "bengio",
    ]);
  });

  it("returns empty for missing authors", () => {
    expect(authorLastNames(undefined)).toEqual([]);
  });
});

describe("titleTokens", () => {
  it("drops stopwords and short tokens", () => {
    const tokens = titleTokens("Attention Is All You Need for Translation");
    expect(tokens.has("attention")).toBe(true);
    expect(tokens.has("translation")).toBe(true);
    expect(tokens.has("all")).toBe(false); // stopword
    expect(tokens.has("is")).toBe(false); // short + stopword
  });
});

describe("buildKnowledgeGraph", () => {
  it("links papers that share an author", () => {
    const graph = buildKnowledgeGraph([
      entry({
        key: "a",
        author: "Smith, Jane",
        year: "2020",
        title: "Quantum sensors",
      }),
      entry({
        key: "b",
        author: "Smith, Jane",
        year: "2021",
        title: "Optical lattices",
      }),
      entry({
        key: "c",
        author: "Doe, John",
        year: "2019",
        title: "Unrelated cooking",
      }),
    ]);

    const edge = graph.edges.find(
      (e) =>
        (e.source === "a" && e.target === "b") ||
        (e.source === "b" && e.target === "a"),
    );
    expect(edge).toBeDefined();
    expect(edge?.relations).toContain("shared-author");
    // c shares nothing, so it stays isolated.
    expect(graph.nodes.find((n) => n.key === "c")?.degree).toBe(0);
  });

  it("links papers with similar titles and records the relation", () => {
    const graph = buildKnowledgeGraph([
      entry({
        key: "t1",
        author: "A, A",
        title: "Deep reinforcement learning for robotics control",
      }),
      entry({
        key: "t2",
        author: "B, B",
        title: "Reinforcement learning robotics control policies",
      }),
    ]);
    const edge = graph.edges[0];
    expect(edge).toBeDefined();
    expect(edge.relations).toContain("title-similarity");
    expect(edge.weight).toBeGreaterThan(0);
  });

  it("marks cited entries and counts them", () => {
    const graph = buildKnowledgeGraph(
      [
        entry({ key: "used", author: "X, X", title: "Foo bar baz" }),
        entry({ key: "unused", author: "Y, Y", title: "Qux quux" }),
      ],
      ["used"],
    );
    expect(graph.nodes.find((n) => n.key === "used")?.cited).toBe(true);
    expect(graph.nodes.find((n) => n.key === "unused")?.cited).toBe(false);
    expect(graph.stats.citedCount).toBe(1);
  });

  it("collapses duplicate keys (first wins)", () => {
    const graph = buildKnowledgeGraph([
      entry({ key: "dup", title: "First" }),
      entry({ key: "dup", title: "Second" }),
    ]);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].title).toBe("First");
  });

  it("respects disabled relations", () => {
    const graph = buildKnowledgeGraph(
      [
        entry({ key: "a", author: "Smith, J", title: "Alpha" }),
        entry({ key: "b", author: "Smith, J", title: "Beta" }),
      ],
      [],
      {
        ...defaultKnowledgeGraphParams,
        relations: { ...defaultKnowledgeGraphParams.relations, "shared-author": false },
      },
    );
    expect(graph.edges).toHaveLength(0);
  });

  it("caps edges per node", () => {
    // One hub author on 10 papers; cap of 2 should limit the hub's degree.
    const entries = Array.from({ length: 10 }, (_, i) =>
      entry({
        key: `p${i}`,
        author: "Hub, H",
        year: "2020",
        title: `Paper ${i} topic`,
      }),
    );
    const graph = buildKnowledgeGraph(entries, [], {
      ...defaultKnowledgeGraphParams,
      maxEdgesPerNode: 2,
    });
    for (const node of graph.nodes) {
      expect(node.degree).toBeLessThanOrEqual(2);
    }
  });

  it("reports connected components", () => {
    const graph = buildKnowledgeGraph([
      entry({ key: "a", author: "Smith, J", title: "One" }),
      entry({ key: "b", author: "Smith, J", title: "Two" }),
      entry({ key: "c", author: "Alone, A", title: "Solo work" }),
    ]);
    // {a,b} connected, {c} isolated => 2 components.
    expect(graph.stats.componentCount).toBe(2);
  });

  it("normalizes params: fills defaults, clamps ranges, ignores junk", () => {
    expect(normalizeKnowledgeGraphParams(undefined)).toEqual(
      defaultKnowledgeGraphParams,
    );
    expect(normalizeKnowledgeGraphParams("nonsense")).toEqual(
      defaultKnowledgeGraphParams,
    );

    const normalized = normalizeKnowledgeGraphParams({
      relations: { "shared-author": false, "shared-venue": "yes" },
      weights: { "shared-author": 999, "title-similarity": -5 },
      titleSimilarityThreshold: 5,
      minEdgeWeight: -3,
      maxEdgesPerNode: 3.7,
    });
    expect(normalized.relations["shared-author"]).toBe(false);
    // invalid boolean falls back to default (true)
    expect(normalized.relations["shared-venue"]).toBe(true);
    expect(normalized.weights["shared-author"]).toBe(20); // clamped to max
    expect(normalized.weights["title-similarity"]).toBe(0); // clamped to min
    expect(normalized.titleSimilarityThreshold).toBe(1); // clamped
    expect(normalized.minEdgeWeight).toBe(0); // clamped
    expect(normalized.maxEdgesPerNode).toBe(4); // rounded
  });

  it("exposes neighbors sorted by weight", () => {
    const graph = buildKnowledgeGraph([
      entry({
        key: "hub",
        author: "Smith, J",
        journal: "Nature",
        year: "2020",
        title: "Core topic study",
      }),
      entry({
        key: "strong",
        author: "Smith, J",
        journal: "Nature",
        year: "2020",
        title: "Core topic study two",
      }),
      entry({
        key: "weak",
        author: "Other, O",
        year: "2020",
        title: "Different subject",
      }),
    ]);
    const neighbors = neighborsOf(graph, "hub");
    expect(neighbors.length).toBeGreaterThan(0);
    expect(neighbors[0].key).toBe("strong");
  });
});
