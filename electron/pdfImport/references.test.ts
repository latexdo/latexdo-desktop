import { describe, expect, it } from "vitest";
import type { Reference } from "./bibliography.js";
import type { LabelMaps } from "./blocks.js";
import {
  rewriteAuthorYearCitations,
  rewriteCrossReferences,
  rewriteNumericCitations,
  rewriteReferences,
  type RewriteStats,
} from "./references.js";

const freshStats = (): RewriteStats => ({
  citations: 0,
  crossReferences: 0,
  unresolvedCitations: 0,
  authorYear: false,
});

function reference(partial: Partial<Reference> & { key: string }): Reference {
  return {
    marker: null,
    entryType: "article",
    fields: {},
    authorSurnames: [],
    year: null,
    raw: "",
    parsed: true,
    ...partial,
  };
}

const emptyLabels = (): LabelMaps => ({
  sections: new Map(),
  figures: new Map(),
  tables: new Map(),
  equations: new Map(),
});

describe("rewriteNumericCitations", () => {
  const byMarker = new Map([
    ["1", "a"],
    ["2", "b"],
    ["3", "c"],
    ["5", "e"],
  ]);

  it("returns the text unchanged when there are no markers", () => {
    const stats = freshStats();
    expect(rewriteNumericCitations("see [1]", new Map(), stats)).toBe("see [1]");
    expect(stats.citations).toBe(0);
  });

  it("merges bracket ranges and keeps malformed or backward groups", () => {
    const stats = freshStats();
    expect(rewriteNumericCitations("[1]--[3]", byMarker, stats)).toBe("\\cite{a,b,c}");
    expect(rewriteNumericCitations("[1 2]", byMarker, stats)).toBe("[1 2]");
    expect(rewriteNumericCitations("[1]--[2 3]", byMarker, stats)).toBe("[1]--[2 3]");
    expect(rewriteNumericCitations("[5]--[3]", byMarker, stats)).toBe("[5]--[3]");
    expect(rewriteNumericCitations("[3-1]", byMarker, stats)).toBe("[3-1]");
    expect(rewriteNumericCitations("[1-50]", byMarker, stats)).toBe("[1-50]");
    expect(rewriteNumericCitations("[1–3, 5]", byMarker, stats)).toBe(
      "\\cite{a,b,c,e}",
    );
    expect(stats.citations).toBe(2);
  });

  it("counts citations whose numbers are not in the reference list", () => {
    const stats = freshStats();
    expect(rewriteNumericCitations("[1, 9]", byMarker, stats)).toBe("[1, 9]");
    expect(stats.unresolvedCitations).toBe(1);
  });

  it("leaves maths and existing commands alone", () => {
    const stats = freshStats();
    expect(rewriteNumericCitations("$x[1]$ \\cite{z} [2]", byMarker, stats)).toBe(
      "$x[1]$ \\cite{z} \\cite{b}",
    );
  });
});

describe("rewriteAuthorYearCitations", () => {
  const references = [
    reference({ key: "smith20", authorSurnames: ["Smith"], year: "2020" }),
    reference({ key: "doe19", authorSurnames: ["Doe"], year: "2019" }),
    reference({ key: "noyear", authorSurnames: ["Nobody"] }),
  ];

  it("returns the text unchanged when no reference has a year", () => {
    const stats = freshStats();
    const text = "Nobody (2020)";
    expect(rewriteAuthorYearCitations(text, [references[2]], stats)).toBe(text);
  });

  it("rewrites parenthetical and textual citations", () => {
    const stats = freshStats();
    expect(
      rewriteAuthorYearCitations(
        "as shown (Smith et al., 2020; Doe, 2019) and by Smith (2020).",
        references,
        stats,
      ),
    ).toBe("as shown \\citep{smith20,doe19} and by \\citet{smith20}.");
    expect(stats.citations).toBe(2);
  });

  it("skips empty name parts and leaves unknown citations as text", () => {
    const stats = freshStats();
    expect(rewriteAuthorYearCitations("(, Smith 2020)", references, stats)).toBe(
      "\\citep{smith20}",
    );
    expect(rewriteAuthorYearCitations("(see; 2020)", references, stats)).toBe(
      "(see; 2020)",
    );
    expect(rewriteAuthorYearCitations("(Brown, 2020)", references, stats)).toBe(
      "(Brown, 2020)",
    );
    expect(rewriteAuthorYearCitations("Brown (2020)", references, stats)).toBe(
      "Brown (2020)",
    );
  });
});

describe("rewriteCrossReferences", () => {
  it("rewrites lists, keeping numbers without labels as text", () => {
    const labels = emptyLabels();
    labels.figures.set("1", "fig:a");
    labels.equations.set("2", "eq:b");
    const stats = freshStats();
    expect(rewriteCrossReferences("Figures 1 and 4", labels, stats)).toBe(
      "Figures~\\ref{fig:a} and 4",
    );
    expect(rewriteCrossReferences("Equations (2) and (7)", labels, stats)).toBe(
      "Equations~\\eqref{eq:b} and (7)",
    );
    expect(rewriteCrossReferences("see Fig. 1.", labels, stats)).toBe(
      "see Fig.~\\ref{fig:a}.",
    );
    expect(stats.crossReferences).toBe(3);
  });

  it("does not rewrite unknown numbers or unbalanced equation brackets", () => {
    const labels = emptyLabels();
    labels.equations.set("2", "eq:b");
    const stats = freshStats();
    expect(rewriteCrossReferences("Equation (2 holds", labels, stats)).toBe(
      "Equation (2 holds",
    );
    expect(rewriteCrossReferences("Equation 9", labels, stats)).toBe("Equation 9");
    expect(stats.crossReferences).toBe(0);
  });
});

describe("rewriteReferences", () => {
  it("uses numeric markers when present", () => {
    const result = rewriteReferences("[1]", emptyLabels(), [
      reference({ key: "a", marker: "1" }),
      reference({ key: "b" }),
    ]);
    expect(result.latex).toBe("\\cite{a}");
    expect(result.stats.authorYear).toBe(false);
  });

  it("falls back to author-year matching and does nothing without references", () => {
    const authorYear = rewriteReferences("Doe (2019)", emptyLabels(), [
      reference({ key: "doe19", authorSurnames: ["Doe"], year: "2019" }),
    ]);
    expect(authorYear).toEqual({
      latex: "\\citet{doe19}",
      stats: {
        citations: 1,
        crossReferences: 0,
        unresolvedCitations: 0,
        authorYear: true,
      },
    });
    expect(rewriteReferences("[1]", emptyLabels(), []).latex).toBe("[1]");
  });
});
