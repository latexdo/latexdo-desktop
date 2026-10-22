import { describe, expect, it } from "vitest";
import {
  citationCompletionDetail,
  citationCompletionFilterText,
  citationCompletionInfo,
  citationCompletionLabelDetail,
  citationCompletionMarkdown,
  citationCompletionSortText,
  citationMatchesQuery,
  rankedCitationCompletions,
} from "../citationCompletion";
import type { CitationEntry } from "../latexIndex";

const smith: CitationEntry = {
  key: "smith2020",
  type: "article",
  title: "Deep Learning Methods",
  author: "Jane Doe",
  journal: "Nature Reviews",
  doi: "10.1/xyz",
  keywords: "Graph",
  sourceFile: "refs.bib",
};

const score = (query: string, entry: CitationEntry = smith) =>
  999 - Number(citationCompletionSortText(entry, query).split("-")[0]);

describe("citation URL whitespace regressions", () => {
  it.each([undefined, "", " \t\n "])("omits an empty URL %j", (url) => {
    expect(citationCompletionMarkdown({ ...smith, url })).not.toContain("**URL:**");
  });

  it("trims and escapes an invalid URL without turning it into a link", () => {
    const markdown = citationCompletionMarkdown({
      ...smith,
      url: " \t http://[bad \n",
    });
    expect(markdown).toContain("**URL:** http://\\[bad\n\n**Source:**");
    expect(markdown).not.toContain("](http://[bad)");
  });

  it("keeps valid padded URLs clickable", () => {
    expect(
      citationCompletionMarkdown({ ...smith, url: " \nhttps://example.org/paper\t" }),
    ).toContain("**URL:** [https://example\\.org/paper](https://example.org/paper)");
  });
});

describe("citation completion scoring", () => {
  it("ranks whole-query matches from key down to any field", () => {
    expect(citationCompletionSortText(smith, "smith2020")).toBe("899-smith2020");
    expect(score("smith")).toBe(95);
    expect(score("2020")).toBe(90);
    expect(score("deep")).toBe(85);
    expect(score("learning")).toBe(80);
    expect(score("jane")).toBe(70);
    expect(score("nature")).toBe(60);
    expect(score("xyz")).toBe(50);
    expect(score("")).toBe(0);
  });

  it("adds per-term scores when the whole query matches nowhere", () => {
    expect(score("smith2020 qqq")).toBe(30 + 60);
    expect(score("smith qqq")).toBe(30 + 54);
    expect(score("2020 qqq")).toBe(30 + 48);
    expect(score("learning qqq")).toBe(30 + 42);
    expect(score("jane qqq")).toBe(30 + 36);
    expect(score("nature qqq")).toBe(30 + 30);
    expect(score("grap qqq")).toBe(30 + 24);
    expect(score("lm qqq")).toBe(30 + 18);
    expect(score("learningmethods qqq")).toBe(30 + 12);
    expect(score("lerning qqq")).toBe(30 + 6);
  });

  it("matches fuzzy and compact terms and breaks ties by key", () => {
    expect(citationMatchesQuery(smith, "lerning")).toBe(true);
    expect(citationMatchesQuery(smith, "deeplearning")).toBe(true);
    expect(citationMatchesQuery(smith, "zzzz")).toBe(false);
    const a = { ...smith, key: "b-entry" };
    const b = { ...smith, key: "a-entry" };
    expect(rankedCitationCompletions([a, b], "deep").map((e) => e.key)).toEqual([
      "a-entry",
      "b-entry",
    ]);
    const untitled = { type: "article", key: "deepnote", sourceFile: "r.bib" };
    expect(
      rankedCitationCompletions([smith, untitled], "deep").map((e) => e.key),
    ).toEqual(["deepnote", "smith2020"]);
  });
});

describe("citation completion text", () => {
  it("labels with the title, then the people, then nothing", () => {
    expect(citationCompletionLabelDetail(smith)).toBe(" Deep Learning Methods");
    expect(
      citationCompletionLabelDetail({
        type: "",
        key: "k",
        editor: "Ed",
        sourceFile: "r",
      }),
    ).toBe(" Ed");
    expect(
      citationCompletionLabelDetail({ type: "", key: "k", sourceFile: "r" }),
    ).toBeUndefined();
  });

  it("builds info and detail lines from whatever fields exist", () => {
    expect(
      citationCompletionInfo(
        { ...smith, year: "2020", eprint: "2001.1", url: "https://x.org" },
        { citedKeys: ["smith2020"] },
      ).split("\n"),
    ).toEqual([
      "Usage: Already cited",
      "Title: Deep Learning Methods",
      "Author: Jane Doe",
      "Year: 2020",
      "Venue: Nature Reviews",
      "DOI: 10.1/xyz",
      "Eprint: 2001.1",
      "URL: https://x.org",
      "Source: refs.bib",
    ]);
    expect(citationCompletionInfo({ type: "", key: "k", sourceFile: "r.bib" })).toBe(
      "Source: r.bib",
    );
    expect(
      citationCompletionDetail(
        { type: "", key: "k", school: "MIT", sourceFile: "r" },
        { citedKeys: [] },
      ),
    ).toBe("Not cited yet - MIT");
  });

  it("renders markdown with safe links and plain fallbacks", () => {
    const md = citationCompletionMarkdown(
      {
        type: "",
        key: "k",
        doi: "https://doi.org/",
        url: "http://[bad",
        eprint: "1234",
        abstract: "   ",
        institution: "Lab",
        sourceFile: "r.bib",
      },
      { citedKeys: new Set(["k"]) },
    );
    expect(md.startsWith("### k")).toBe(true);
    expect(md).toContain("**Usage:** Already cited in this article");
    expect(md).toContain("**DOI:** https://doi\\.org/");
    expect(md).toContain("**URL:** http://\\[bad");
    expect(md).toContain("**Eprint:** 1234");
    expect(md).toContain("**Venue:** Lab");
    expect(md).not.toContain("**Abstract**");
    expect(md).not.toContain("**Type:**");

    const linked = citationCompletionMarkdown({
      type: "",
      key: "k",
      title: "T",
      url: "example.com/paper",
      publisher: "P",
      abstract: "word ".repeat(200),
      sourceFile: "r.bib",
    });
    expect(linked).toContain(
      "**URL:** [https://example\\.com/paper](https://example.com/paper)",
    );
    expect(linked).toContain("**Abstract**\n\nword word");
    expect(linked.endsWith(" wo\\.\\.\\.")).toBe(true);
    expect(citationCompletionMarkdown({ type: "", key: "k", sourceFile: "r" })).toBe(
      "### k\n\n**Source:** `r`",
    );
    expect(
      citationCompletionMarkdown({ type: "", key: "k", url: "  ", sourceFile: "r" }),
    ).not.toContain("**URL:**");
  });

  it("skips blank and duplicate fields in the filter text", () => {
    const text = citationCompletionFilterText({
      type: "",
      key: "k",
      title: "  ",
      author: "Same",
      editor: "same",
      sourceFile: "r",
    });
    // The editor repeats the author, so only one readable copy is kept.
    expect(text.match(/Same/g)?.length).toBe(1);
    expect(text).not.toMatch(/\s{2,}/);
  });
});
