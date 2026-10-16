import { describe, expect, it } from "vitest";
import {
  analyzeCitationLibrary,
  citationKeysInText,
  createBibtexStub,
  extractCitationUsages,
} from "../citationAnalysis";

describe("citation analysis", () => {
  it("extracts multi-key citations with optional arguments", () => {
    const usages = extractCitationUsages(
      "Intro.\nPrior work \\cite[see][p. 4]{knuth84, smith20}.",
      "main.tex",
    );

    expect(usages).toEqual([
      { key: "knuth84", command: "cite", sourceFile: "main.tex", line: 2 },
      { key: "smith20", command: "cite", sourceFile: "main.tex", line: 2 },
    ]);
  });

  it("extracts cited keys from inline passage text", () => {
    expect(
      citationKeysInText(
        "Local claim \\citep{smith20, knuth84}. Later \\cite{smith20}.",
      ),
    ).toEqual(["smith20", "knuth84"]);
  });

  it("builds project-level citation health from tex and bib files", () => {
    const analysis = analyzeCitationLibrary(
      [
        {
          path: "main.tex",
          content:
            "We build on \\citep{knuth84,missingKey}. " +
            "A modern baseline is \\textcite{smith20}.",
        },
        {
          path: "refs.bib",
          content: `
@article{knuth84,
  title = {The TeXbook},
  author = {Donald Knuth},
  year = {1984},
  journal = {Computers and Typesetting},
  doi = {10.1000/texbook}
}
@inproceedings{smith20,
  title = {Neural Typesetting},
  author = {Jane Smith},
  year = {2020},
  booktitle = {Conference on Documents},
  doi = {10.2000/docs}
}
@inproceedings{smith20dup,
  title = {Neural Typesetting},
  author = {J. Smith},
  year = {2020},
  booktitle = {Conference on Documents},
  doi = {10.2000/docs}
}
@article{unusedOld,
  title = {Old Unused Work},
  author = {A. Author},
  year = {2010},
  journal = {Archive},
  abstract = {Historical background for typesetting systems},
  keywords = {typesetting, history}
}
@misc{metadataDebt,
  year = {2024}
}
`,
        },
      ],
      2026,
    );

    expect(analysis.entries).toHaveLength(5);
    expect(analysis.entries.find((entry) => entry.key === "unusedOld")).toMatchObject({
      abstract: "Historical background for typesetting systems",
      keywords: "typesetting, history",
    });
    expect(analysis.citedKeys).toEqual(["knuth84", "missingKey", "smith20"]);
    expect(analysis.usedKeys).toEqual(["knuth84", "smith20"]);
    expect(analysis.missingKeys).toEqual(["missingKey"]);
    expect(analysis.unusedKeys).toEqual(["metadataDebt", "smith20dup", "unusedOld"]);
    expect(analysis.duplicateGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "doi", value: "10.2000/docs" }),
        expect.objectContaining({ reason: "title" }),
      ]),
    );
    expect(analysis.staleEntries.map((entry) => entry.key)).toContain("unusedOld");
    expect(analysis.qualityIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "metadataDebt", message: "Missing title" }),
        expect.objectContaining({
          key: "metadataDebt",
          message: "Missing author or editor",
        }),
      ]),
    );
  });

  it("creates BibTeX stubs for missing keys", () => {
    expect(createBibtexStub("newKey")).toContain("@article{newKey,");
    expect(createBibtexStub("newKey")).toContain("doi = {}");
  });
});
