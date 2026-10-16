import { describe, expect, it } from "vitest";
import type { CitationEntry } from "../../latex/latexIndex";
import { formatRecommendations, recommendCitations } from "./citationRecommender";

function entry(partial: Partial<CitationEntry> & { key: string }): CitationEntry {
  return { type: "article", sourceFile: "refs.bib", ...partial };
}

const library: CitationEntry[] = [
  entry({
    key: "vaswani2017",
    author: "Vaswani, Ashish",
    title: "Attention is all you need",
    journal: "NeurIPS",
    year: "2017",
  }),
  entry({
    key: "he2016",
    author: "He, Kaiming",
    title: "Deep residual learning for image recognition",
    booktitle: "CVPR",
    year: "2016",
  }),
  entry({
    key: "cooking",
    author: "Baker, Betty",
    title: "A history of sourdough bread",
    year: "1990",
  }),
  entry({
    key: "lazyCompletion2026",
    author: "Researcher, Riley",
    title: "Editor Assistance",
    abstract:
      "A lazy and heuristic driven architecture for code completion in live programming environments.",
    keywords: "code completion, heuristics, live programming",
    year: "2026",
  }),
];

describe("recommendCitations", () => {
  it("ranks on-topic references above irrelevant ones", () => {
    const recs = recommendCitations(
      "We use a transformer with self-attention for our translation task.",
      library,
    );
    expect(recs[0]?.key).toBe("vaswani2017");
    expect(recs.some((r) => r.key === "cooking")).toBe(false);
  });

  it("boosts references whose author surname appears in the passage", () => {
    const recs = recommendCitations(
      "Following He and residual connections, we stack deep layers for image recognition.",
      library,
    );
    expect(recs[0]?.key).toBe("he2016");
    expect(recs[0]?.reasons.some((r) => r.includes("Author"))).toBe(true);
  });

  it("returns nothing for a passage with no vocabulary overlap", () => {
    const recs = recommendCitations("qwxz zzz", library);
    expect(recs).toEqual([]);
  });

  it("flags already-cited references and slightly de-prioritizes them", () => {
    const recs = recommendCitations(
      "Attention is all you need for translation with transformers.",
      library,
      { citedKeys: ["vaswani2017"] },
    );
    const vaswani = recs.find((r) => r.key === "vaswani2017");
    expect(vaswani?.alreadyCited).toBe(true);
  });

  it("respects the limit option", () => {
    const recs = recommendCitations(
      "deep learning attention residual image recognition translation",
      library,
      { limit: 1 },
    );
    expect(recs).toHaveLength(1);
  });

  it("matches abstract and keyword metadata for broader candidate recall", () => {
    const recs = recommendCitations(
      "The completion architecture uses lazy heuristics for live code suggestions.",
      library,
    );
    expect(recs[0]?.key).toBe("lazyCompletion2026");
    expect(recs[0]?.reasons.join(" ")).toContain("Abstract terms");
  });
});

describe("formatRecommendations", () => {
  it("renders source keys without choosing citation syntax", () => {
    const recs = recommendCitations("attention transformer translation", library);
    const text = formatRecommendations(recs);
    expect(text).toContain("key=vaswani2017");
    expect(text).not.toContain("\\cite{");
  });

  it("handles the empty case", () => {
    expect(formatRecommendations([])).toContain("No matching references");
  });
});
