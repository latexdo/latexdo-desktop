import { describe, expect, it } from "vitest";
import { authorSimilarity, tokenSimilarity } from "./scholarlyMatching";

describe("tokenSimilarity", () => {
  it("is the Jaccard index of the significant title tokens", () => {
    expect(tokenSimilarity("Graph neural networks", "Graph neural networks")).toBe(1);
    // {graph, neural, networks} vs {graph, transformers}: 1 shared of 4 distinct.
    expect(tokenSimilarity("Graph neural networks", "Graph transformers")).toBe(0.25);
  });

  it("is zero when either title has no significant tokens", () => {
    expect(tokenSimilarity(undefined, "Graph neural networks")).toBe(0);
    expect(tokenSimilarity("Graph neural networks", "")).toBe(0);
    expect(tokenSimilarity("a b", "Graph neural networks")).toBe(0);
  });
});

describe("authorSimilarity", () => {
  it("is the share of the entry's last names found among the candidates", () => {
    expect(
      authorSimilarity("Smith, John and Jane Doe", ["J. Smith", "Alice Brown"]),
    ).toBe(0.5);
    expect(
      authorSimilarity("Smith, John and Jane Doe", ["Jane Doe", "John Smith"]),
    ).toBe(1);
    expect(authorSimilarity("Smith, John", [])).toBe(0);
  });

  it("is zero when the entry has no usable author names", () => {
    expect(authorSimilarity(undefined, ["John Smith"])).toBe(0);
    expect(authorSimilarity("X", ["X"])).toBe(0);
  });
});
