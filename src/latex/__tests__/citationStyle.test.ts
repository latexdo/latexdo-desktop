import { describe, expect, it } from "vitest";
import {
  citationCommandsInText,
  formatCitation,
  resolveCitationStyle,
} from "../citationStyle";

describe("resolveCitationStyle", () => {
  it("prefers a nearby citation command", () => {
    const result = resolveCitationStyle({
      nearbyText: "Prior work \\parencite{a}.",
      usages: [{ key: "b", command: "citep", sourceFile: "main.tex", line: 10 }],
      activeFilePath: "main.tex",
    });

    expect(result.command).toBe("parencite");
    expect(result.source).toBe("nearby");
  });

  it("prefers active-file style over project-wide style", () => {
    const result = resolveCitationStyle({
      activeFilePath: "chapter.tex",
      usages: [
        { key: "a", command: "citep", sourceFile: "other.tex", line: 1 },
        { key: "b", command: "citep", sourceFile: "other.tex", line: 2 },
        { key: "c", command: "parencite", sourceFile: "chapter.tex", line: 3 },
      ],
    });

    expect(result.command).toBe("parencite");
    expect(result.source).toBe("active-file");
  });

  it("uses unsaved active-document citations before project-wide style", () => {
    const result = resolveCitationStyle({
      activeFilePath: "chapter.tex",
      activeDocumentText: "Current draft cites \\textcite{local}.",
      usages: [
        { key: "a", command: "citep", sourceFile: "other.tex", line: 1 },
        { key: "b", command: "citep", sourceFile: "other.tex", line: 2 },
      ],
    });

    expect(result.command).toBe("textcite");
    expect(result.source).toBe("active-file");
  });

  it("infers biblatex only when no actual usages exist", () => {
    const result = resolveCitationStyle({
      activeDocumentText: "\\usepackage{biblatex}\n\\addbibresource{refs.bib}",
      usages: [],
    });

    expect(result.command).toBe("parencite");
    expect(result.source).toBe("package");
  });

  it("falls back to cite", () => {
    expect(resolveCitationStyle({ usages: [] }).command).toBe("cite");
  });
});

describe("citationCommandsInText", () => {
  it("detects supported citation commands without converting them", () => {
    expect(
      citationCommandsInText(
        "\\cite{a} \\citep{b} \\citet{c} \\parencite{d} " +
          "\\textcite{e} \\autocite{f} \\footcite{g} \\supercite{h}",
      ),
    ).toEqual([
      "cite",
      "citep",
      "citet",
      "parencite",
      "textcite",
      "autocite",
      "footcite",
      "supercite",
    ]);
  });
});

describe("formatCitation", () => {
  it("formats unique keys using the resolved command", () => {
    expect(formatCitation("citep", ["smith2024", "smith2024", "jones2025"])).toBe(
      "\\citep{smith2024,jones2025}",
    );
  });
});
