import { describe, expect, it } from "vitest";
import {
  citationCommandsInText,
  commandCounts,
  commandFromPackages,
  formatCitation,
  resolveCitationStyle,
} from "../citationStyle";

describe("resolveCitationStyle", () => {
  it("falls back to the selection, then the project, then plain cite", () => {
    expect(
      resolveCitationStyle({ selectedText: "as shown by \\textcite{a}" }),
    ).toMatchObject({ command: "textcite", source: "selection" });
    expect(
      resolveCitationStyle({
        activeFilePath: "intro.tex",
        usages: [{ key: "b", command: "citep", sourceFile: "other.tex", line: 1 }],
      }),
    ).toMatchObject({ command: "citep", source: "project" });
    expect(resolveCitationStyle({})).toEqual({
      command: "cite",
      source: "fallback",
      confidence: 0.4,
    });
  });

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

describe("citation command helpers", () => {
  it("counts only supported commands, folding starred variants", () => {
    const counts = commandCounts([
      { command: "citep*" },
      { command: "citep" },
      { command: "nocite" },
      { command: undefined },
    ] as { command?: string }[] as never);
    expect([...counts]).toEqual([["citep", 2]]);
  });

  it("infers the command from the bibliography package", () => {
    expect(commandFromPackages("\\usepackage[round]{natbib}")).toBe("citep");
    expect(commandFromPackages("\\usepackage{amsmath, biblatex}")).toBe("parencite");
    expect(commandFromPackages("\\addbibresource{refs.bib}")).toBe("parencite");
    expect(commandFromPackages("\\usepackage{amsmath}")).toBeNull();
  });
});
