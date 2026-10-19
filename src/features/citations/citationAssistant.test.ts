import { describe, expect, it } from "vitest";
import type { CitationEntry } from "../../latex/latexIndex";
import type { ScholarlyPaper } from "../scholarly/scholarlyTypes";
import {
  citationContextFit,
  citationContextTerms,
  citationContextWindow,
  libraryEntryForPaper,
  mergeOnlinePapers,
  onlineQueryFor,
  recentCitationKeys,
} from "./citationAssistant";

const entry = (key: string, title: string, extra: Partial<CitationEntry> = {}) =>
  ({
    key,
    type: "article",
    title,
    sourceFile: "references.bib",
    ...extra,
  }) as CitationEntry;

const paper = (title: string, extra: Partial<ScholarlyPaper> = {}): ScholarlyPaper => ({
  provider: "Crossref",
  title,
  authors: ["Ada Lovelace"],
  year: 2020,
  ...extra,
});

describe("citation assistant", () => {
  const sentence =
    "Dense passage retrieval improves open-domain question answering over sparse retrieval baselines \\cite{";

  it("finds the content words of the sentence, without LaTeX commands", () => {
    const terms = citationContextTerms(sentence);
    expect(terms.has("retrieval")).toBe(true);
    expect(terms.has("passage")).toBe(true);
    expect(terms.has("cite")).toBe(false);
    expect(terms.has("over")).toBe(false);
  });

  it("says when a reference fits the sentence and when it may not", () => {
    const terms = citationContextTerms(sentence);
    expect(
      citationContextFit(
        entry("karpukhin2020", "Dense Passage Retrieval for Open-Domain QA"),
        terms,
      ),
    ).toMatchObject({
      kind: "fits",
      shared: expect.arrayContaining(["dense", "passage"]),
    });
    expect(
      citationContextFit(
        entry("he2016", "Deep Residual Learning for Image Recognition"),
        terms,
      ).kind,
    ).toBe("weak");
    // Too little context to judge.
    expect(
      citationContextFit(
        entry("he2016", "Deep Residual Learning"),
        citationContextTerms("See \\cite{"),
      ).kind,
    ).toBeNull();
  });

  it("lists recent citations: this session's picks first, then the nearest in the paper", () => {
    const text =
      "A \\cite{far2001}. Lots of text here. B \\citep[p.~3]{near2019, other2018}. C \\cite{";
    const caret = text.length;
    expect(recentCitationKeys(text, caret, ["picked2024"])).toEqual([
      "picked2024",
      "near2019",
      "other2018",
      "far2001",
    ]);
  });

  it("uses only the sentence being written, without other citations", () => {
    const text =
      "\\section{Introduction}\nTransformers \\cite{vaswani2017} changed the field. Dense retrieval \\cite{a} helps \\cite{";
    const window = citationContextWindow(text, text.length);
    expect(window).toBe("Dense retrieval   helps");
    expect(window).not.toContain("Introduction");
  });

  it("recognises an online paper that is already in the library", () => {
    const library = [
      entry("lewis2020", "Retrieval-Augmented Generation for Knowledge-Intensive NLP", {
        doi: "10.5555/abc",
      }),
    ];
    expect(
      libraryEntryForPaper(
        paper("Other", { doi: "https://doi.org/10.5555/ABC" }),
        library,
      )?.key,
    ).toBe("lewis2020");
    expect(
      libraryEntryForPaper(
        paper("Retrieval-augmented generation for knowledge-intensive NLP"),
        library,
      )?.key,
    ).toBe("lewis2020");
    expect(
      libraryEntryForPaper(paper("Something else entirely"), library),
    ).toBeUndefined();
  });

  it("interleaves providers and removes duplicates", () => {
    const merged = mergeOnlinePapers([
      [paper("A", { doi: "10.1/a" }), paper("B", { doi: "10.1/b" })],
      [
        paper("A again", { doi: "10.1/A", provider: "OpenAlex" }),
        paper("C", { provider: "OpenAlex" }),
      ],
    ]);
    expect(merged.map((p) => p.title)).toEqual(["A", "B", "C"]);
  });

  it("searches online with the sentence when nothing is typed", () => {
    expect(onlineQueryFor("", citationContextTerms(sentence))).toContain("retrieval");
    expect(onlineQueryFor("lewis rag", new Set(["x"]))).toBe("lewis rag");
  });
});

describe("online metadata", () => {
  it("decodes HTML entities in Crossref titles and venues", async () => {
    const { paperFromCrossref } = await import("../scholarly/scholarlyClient");
    const paper = paperFromCrossref({
      title: ["Span prompt &amp; retrieval"],
      "container-title": ["Journal of Intelligent &amp; Fuzzy Systems"],
      author: [{ given: "Chunxiao", family: "Fan" }],
      DOI: "10.3233/abc",
      published: { "date-parts": [[2023]] },
    });
    expect(paper?.title).toBe("Span prompt & retrieval");
    expect(paper?.venue).toBe("Journal of Intelligent & Fuzzy Systems");
  });
});

describe("generated BibTeX", () => {
  it("escapes characters that would break the compiled bibliography", async () => {
    const { bibtexForPaper } = await import("../graph/scholarlyDiscovery");
    const { key, bibtex } = bibtexForPaper(
      {
        provider: "Crossref",
        title: "Span prompt retrieval",
        authors: ["Chunxiao Fan"],
        year: 2023,
        venue: "Journal of Intelligent & Fuzzy Systems",
      },
      ["fan2023span"],
    );
    expect(key).toBe("fan2023span2");
    expect(bibtex).toContain("journal = {Journal of Intelligent \\& Fuzzy Systems}");
  });
});

describe("citation assistant edge cases", () => {
  it("treats a single shared term as a fit only for short references", () => {
    const context = citationContextTerms("transformer alignment");
    expect(citationContextFit(entry("a", "Transformer"), context)).toEqual({
      kind: "fits",
      shared: ["transformer"],
    });
    const long = entry("b", "Transformer kernels accelerate sparse matrix decoding");
    expect(citationContextFit(long, context).kind).toBeNull();
  });

  it("does not judge untitled references as weak", () => {
    const context = citationContextTerms(
      "graph neural networks predict protein folding energies accurately",
    );
    expect(citationContextFit(entry("c", ""), context).kind).toBeNull();
  });

  it("merges lists of different lengths without gaps", () => {
    const merged = mergeOnlinePapers([
      [paper("First long paper title"), paper("Second long paper title")],
      [paper("Third long paper title")],
    ]);
    expect(merged.map((p) => p.title)).toEqual([
      "First long paper title",
      "Third long paper title",
      "Second long paper title",
    ]);
  });
});

