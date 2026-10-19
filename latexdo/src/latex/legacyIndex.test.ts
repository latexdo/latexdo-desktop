import { beforeEach, describe, expect, it, vi } from "vitest";

const toJSON = vi.fn();
// vitest.config.ts externalises the uninstalled "bibtex-parse-js"; Vite then
// requests it under its /@id/ prefix, so the mock must use that id.
vi.mock("/@id/bibtex-parse-js", () => ({ default: { toJSON } }));

const { parseBibFile } = await import("./parseBib");
const { buildLatexIndex } = await import("./buildLatexIndex");

describe("legacy parseBibFile", () => {
  beforeEach(() => toJSON.mockReset());

  it("maps parsed entries, cleans values and drops entries without keys", () => {
    toJSON.mockReturnValue([
      {
        citationKey: "knuth84",
        entryType: "book",
        entryTags: {
          title: "{The}  {\\TeX}book",
          author: " Donald   Knuth ",
          year: "1984",
          journal: 7,
          booktitle: "Proc",
          publisher: "AW",
          url: "https://x",
        },
      },
      { citationKey: "bare" },
      { entryType: "comment" },
    ]);

    const entries = parseBibFile("ignored", "refs.bib");
    expect(toJSON).toHaveBeenCalledWith("ignored");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      key: "knuth84",
      type: "book",
      title: "The \\TeXbook",
      author: "Donald Knuth",
      year: "1984",
      journal: undefined,
      booktitle: "Proc",
      publisher: "AW",
      url: "https://x",
      sourceFile: "refs.bib",
    });
    expect(JSON.parse(entries[0].raw!)).toMatchObject({ year: "1984" });
    expect(entries[1]).toMatchObject({
      key: "bare",
      type: "unknown",
      title: undefined,
      raw: undefined,
    });
  });
});

describe("legacy buildLatexIndex", () => {
  it("indexes .bib citations and .tex labels and ignores other files", () => {
    toJSON.mockReturnValue([{ citationKey: "a", entryType: "article", entryTags: {} }]);
    const index = buildLatexIndex([
      { path: "refs.bib", content: "@article{a,}" },
      {
        path: "main.tex",
        content: "\\begin{figure}\n\\caption{Cap}\n\\label{fig:one}\n\\end{figure}",
      },
      { path: "notes.txt", content: "\\label{fig:no}" },
    ]);
    expect(index.citations.map((c) => c.key)).toEqual(["a"]);
    expect(index.citations[0].sourceFile).toBe("refs.bib");
    expect(index.labels).toHaveLength(1);
    expect(index.labels[0]).toMatchObject({
      key: "fig:one",
      kind: "figure",
      sourceFile: "main.tex",
    });
  });
});
