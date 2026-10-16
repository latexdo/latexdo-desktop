import { describe, expect, it } from "vitest";
import {
  citationCompletionDetail,
  citationCompletionFilterText,
  citationCompletionMarkdown,
  citationCompletionTriggerCharacters,
  citationCompletionUsageDescription,
  rankedCitationCompletions,
} from "../citationCompletion";
import type { CitationEntry } from "../latexIndex";

const entries: CitationEntry[] = [
  {
    key: "borning1981thinglab",
    type: "article",
    title: "The Programming Language Aspects of ThingLab",
    author: "Alan Borning",
    year: "1981",
    journal: "ACM Transactions on Programming Languages and Systems",
    doi: "10.1145/357146.357150",
    sourceFile: "refs.bib",
  },
  {
    key: "compArchitecture",
    type: "inproceedings",
    title: "A Lazy and Heuristic-Driven Code-Completion Architecture",
    author: "Omar Example and Jane Researcher",
    year: "2026",
    booktitle: "International Conference on Software Language Engineering",
    sourceFile: "references.bib",
  },
];

describe("citationCompletion", () => {
  it("matches citation completions by title words, not only by key", () => {
    const ranked = rankedCitationCompletions(entries, "lazy heuristic architecture");

    expect(ranked.map((entry) => entry.key)).toEqual(["compArchitecture"]);
  });

  it("searches entries from multiple Bib files as one citation library", () => {
    expect(
      rankedCitationCompletions(entries, "programming").map(
        (entry) => `${entry.key}@${entry.sourceFile}`,
      ),
    ).toEqual(["borning1981thinglab@refs.bib"]);
    expect(
      rankedCitationCompletions(entries, "software language").map(
        (entry) => `${entry.key}@${entry.sourceFile}`,
      ),
    ).toEqual(["compArchitecture@references.bib"]);
  });

  it("matches citation completions from a single remembered word or fuzzy fragment", () => {
    expect(
      rankedCitationCompletions(entries, "thinglab").map((entry) => entry.key),
    ).toEqual(["borning1981thinglab"]);
    expect(
      rankedCitationCompletions(entries, "lzy arch").map((entry) => entry.key),
    ).toEqual(["compArchitecture"]);
  });

  it("matches citation completions by author, year, venue, and DOI", () => {
    expect(
      rankedCitationCompletions(entries, "borning").map((entry) => entry.key),
    ).toEqual(["borning1981thinglab"]);
    expect(
      rankedCitationCompletions(entries, "2026 researcher").map((entry) => entry.key),
    ).toEqual(["compArchitecture"]);
    expect(
      rankedCitationCompletions(entries, "software language engineering").map(
        (entry) => entry.key,
      ),
    ).toEqual(["compArchitecture"]);
    expect(
      rankedCitationCompletions(entries, "357150").map((entry) => entry.key),
    ).toEqual(["borning1981thinglab"]);
  });

  it("builds visible citation metadata while keeping the insert text as the key", () => {
    const entry = entries[1]!;

    expect(citationCompletionFilterText(entry)).toContain(
      "A Lazy and Heuristic-Driven Code-Completion Architecture",
    );
    expect(citationCompletionFilterText(entry)).toContain(
      "lazy and heuristic driven code completion architecture",
    );
    expect(citationCompletionFilterText(entry)).toContain(
      "lazyandheuristicdrivencodecompletionarchitecture",
    );
    expect(citationCompletionDetail(entry)).toContain(
      "A Lazy and Heuristic-Driven Code-Completion Architecture",
    );
  });

  it("keeps fuzzy metadata matches visible to the editor suggestion filter", () => {
    expect(citationCompletionFilterText(entries[1]!, "lzy arch")).toContain("lzy arch");
    expect(citationCompletionFilterText(entries[0]!, "lzy arch")).not.toContain(
      "lzy arch",
    );
  });

  it("shows whether a citation is already used in the article", () => {
    const citedKeys = new Set(["compArchitecture"]);

    expect(citationCompletionUsageDescription(entries[1]!, { citedKeys })).toBe(
      "Already cited",
    );
    expect(citationCompletionUsageDescription(entries[0]!, { citedKeys })).toBe(
      "Not cited yet",
    );
    expect(citationCompletionDetail(entries[1]!, { citedKeys })).toContain(
      "Already cited",
    );
  });

  it("builds rich trusted-presenter markdown for citation details", () => {
    const markdown = citationCompletionMarkdown(
      {
        ...entries[0]!,
        abstract:
          "ThingLab introduced constraint-oriented programming ideas for interactive systems.",
        url: "dl.acm.org/doi/10.1145/357146.357150",
      },
      { citedKeys: new Set(["borning1981thinglab"]) },
    );

    expect(markdown).toContain("### The Programming Language Aspects of ThingLab");
    expect(markdown).toContain("**Usage:** Already cited in this article");
    expect(markdown).toContain("**Authors:** Alan Borning");
    expect(markdown).toContain(
      "**DOI:** [10\\.1145/357146\\.357150](https://doi.org/10.1145/357146.357150)",
    );
    expect(markdown).toContain(
      "**URL:** [https://dl\\.acm\\.org/doi/10\\.1145/357146\\.357150](https://dl.acm.org/doi/10.1145/357146.357150)",
    );
    expect(markdown).toContain("**Abstract**");
    expect(markdown).toContain("**Source:** `refs.bib`");
  });

  it("exports citation trigger characters for normal title typing", () => {
    expect(citationCompletionTriggerCharacters).toEqual(
      expect.arrayContaining(["l", "H", "2", " ", "-", ".", "/", "_"]),
    );
  });
});
