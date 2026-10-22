import { describe, expect, it } from "vitest";
import {
  containsTikz,
  figureInsertionText,
  missingPreambleLines,
  preambleEditFor,
  prepareTikzSnippet,
  safeFigureOffset,
  tikzRequirements,
  withPreambleEdit,
} from "./tikzSnippet";

const article = [
  "\\documentclass[11pt]{article}",
  "\\usepackage{amsmath}",
  "",
  "\\begin{document}",
  "Hello.",
  "\\end{document}",
  "",
].join("\n");

describe("prepareTikzSnippet", () => {
  it("keeps only the body of a standalone document and collects its preamble", () => {
    const prepared = prepareTikzSnippet(
      [
        "```latex",
        "\\documentclass[border=10pt]{standalone}",
        "\\usepackage{tikz}",
        "\\usetikzlibrary{positioning,",
        "  arrows.meta}",
        "\\begin{document}",
        "\\begin{tikzpicture}",
        "  \\node (a) {A};",
        "\\end{tikzpicture}",
        "\\end{document}",
        "```",
      ].join("\n"),
    );
    expect(prepared.body).toBe(
      "\\begin{tikzpicture}\n  \\node (a) {A};\n\\end{tikzpicture}",
    );
    expect(prepared.preambleLines).toEqual([
      "\\usepackage{tikz}",
      "\\usetikzlibrary{positioning,\n  arrows.meta}",
    ]);
  });

  it("moves package lines out of a bare snippet", () => {
    const prepared = prepareTikzSnippet(
      "\\usepackage{pgfplots}\n\\begin{tikzpicture}\\end{tikzpicture}",
    );
    expect(prepared.body).toBe("\\begin{tikzpicture}\\end{tikzpicture}");
    expect(prepared.preambleLines).toEqual(["\\usepackage{pgfplots}"]);
  });
});

describe("tikzRequirements", () => {
  it("detects libraries from the drawing commands", () => {
    const requirements = tikzRequirements(
      [
        "\\begin{tikzpicture}[node distance=2cm, >=Stealth]",
        "  \\node[draw, diamond] (a) {A};",
        "  \\node[draw, right=of a] (b) {B};",
        "  \\node[state, accepting] (q) {q};",
        "  \\draw[->] (a) -- ($(a)!0.5!(b)$);",
        "  \\draw (0,0) ellipse (2 and 1);",
        "\\end{tikzpicture}",
      ].join("\n"),
    );
    expect(requirements.packages).toEqual(["tikz"]);
    expect(requirements.libraries).toEqual(
      expect.arrayContaining([
        "arrows.meta",
        "positioning",
        "calc",
        "shapes.geometric",
        "automata",
      ]),
    );
  });

  it("does not ask for shapes because of the ellipse path operation", () => {
    expect(
      tikzRequirements(
        "\\begin{tikzpicture}\\draw (0,0) ellipse (2 and 1);\\end{tikzpicture}",
      ).libraries,
    ).toEqual([]);
  });

  it("uses pgfplots instead of tikz for plots", () => {
    const requirements = tikzRequirements(
      "\\begin{tikzpicture}\\begin{polaraxis}\\addplot {x};\\end{polaraxis}\\end{tikzpicture}",
    );
    expect(requirements.packages).toEqual(["pgfplots"]);
    expect(requirements.pgfplotsLibraries).toEqual(["polar"]);
    expect(requirements.pgfplotsCompat).toBe(true);
  });

  it("ignores commented code", () => {
    expect(containsTikz("% \\begin{tikzpicture}")).toBe(false);
    expect(containsTikz("\\tikz \\draw (0,0) -- (1,1);")).toBe(true);
  });
});

describe("missingPreambleLines", () => {
  it("adds nothing the preamble already loads", () => {
    const requirements = tikzRequirements(
      "\\begin{tikzpicture}\\node[right=of a] {};\\end{tikzpicture}",
    );
    expect(
      missingPreambleLines(
        "\\usepackage{pgfplots}\n\\usetikzlibrary{positioning}",
        requirements,
      ),
    ).toEqual([]);
  });

  it("merges the libraries of the snippet and the drawing", () => {
    const requirements = tikzRequirements(
      "\\begin{tikzpicture}\\node[right=of a] {};\\end{tikzpicture}",
    );
    expect(
      missingPreambleLines("\\usetikzlibrary{calc}", requirements, [
        "\\usetikzlibrary{calc,fit}",
      ]),
    ).toEqual(["\\usepackage{tikz}", "\\usetikzlibrary{positioning,fit}"]);
  });

  it("keeps the options of a package the snippet declared", () => {
    expect(
      missingPreambleLines(
        "",
        tikzRequirements("\\begin{circuitikz}\\end{circuitikz}"),
        ["\\usepackage[european]{circuitikz}"],
      ),
    ).toEqual(["\\usepackage[european]{circuitikz}"]);
  });

  it("sets a pgfplots compat level that works on any installation", () => {
    expect(
      missingPreambleLines("", tikzRequirements("\\begin{axis}\\end{axis}")),
    ).toEqual(["\\usepackage{pgfplots}", "\\pgfplotsset{compat=newest}"]);
    expect(
      missingPreambleLines(
        "\\usepackage{pgfplots}\n\\pgfplotsset{compat=1.18}",
        tikzRequirements("\\begin{axis}\\end{axis}"),
      ),
    ).toEqual([]);
  });
});

describe("preambleEditFor", () => {
  it("adds lines after the last package", () => {
    const requirements = tikzRequirements("\\begin{tikzpicture}\\end{tikzpicture}");
    const edit = preambleEditFor(article, requirements);
    expect(withPreambleEdit(article, edit)).toContain(
      "\\usepackage{amsmath}\n\\usepackage{tikz}\n\n\\begin{document}",
    );
  });

  it("keeps hyperref last", () => {
    const document = [
      "\\documentclass{article}",
      "\\usepackage{geometry}",
      "\\usepackage{hyperref}",
      "\\usepackage{cleveref}",
      "\\begin{document}",
      "\\end{document}",
    ].join("\n");
    const edit = preambleEditFor(
      document,
      tikzRequirements("\\begin{tikzpicture}\\end{tikzpicture}"),
    );
    expect(withPreambleEdit(document, edit)).toContain(
      "\\usepackage{geometry}\n\\usepackage{tikz}\n\\usepackage{hyperref}",
    );
  });

  it("adds lines after the class when there are no packages", () => {
    const document = "\\documentclass{article}\n\\begin{document}\nx\n\\end{document}";
    const edit = preambleEditFor(
      document,
      tikzRequirements("\\begin{tikzpicture}\\end{tikzpicture}"),
    );
    expect(withPreambleEdit(document, edit)).toBe(
      "\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\nx\n\\end{document}",
    );
  });

  it("returns null for a file without its own preamble", () => {
    expect(
      preambleEditFor(
        "\\section{Intro}",
        tikzRequirements("\\begin{tikzpicture}\\end{tikzpicture}"),
      ),
    ).toBeNull();
  });
});

describe("safeFigureOffset", () => {
  it("moves a cursor in the preamble to the end of the body", () => {
    const offset = safeFigureOffset(article, 5);
    expect(article.slice(offset)).toMatch(/^\\end\{document\}/);
  });

  it("keeps a cursor inside the body", () => {
    const offset = article.indexOf("Hello.");
    expect(safeFigureOffset(article, offset)).toBe(offset);
  });

  it("puts the figure on lines of its own", () => {
    expect(figureInsertionText("ab", 1, "F")).toBe("\nF\n");
    expect(figureInsertionText("a\n\nb", 2, "F")).toBe("F");
  });
});

describe("tikzSnippet edge cases", () => {
  const none = {
    packages: [],
    libraries: [],
    pgfplotsLibraries: [],
    pgfplotsCompat: false,
  };

  it("keeps the rest of a standalone file that never ends its document", () => {
    const prepared = prepareTikzSnippet(
      "\\documentclass{standalone}\n\\usepackage{tikz}\n\\begin{document}\n\\tikz \\draw (0,0) -- (1,1);",
    );
    expect(prepared.body).toBe("\\tikz \\draw (0,0) -- (1,1);");
    expect(prepared.preambleLines).toEqual(["\\usepackage{tikz}"]);
  });

  it("does not join lines of a preamble command whose braces are balanced", () => {
    const prepared = prepareTikzSnippet(
      "\\usepackage[x]{pgfplots}\n\\usetikzlibrary{calc}\nbody",
    );
    expect(prepared.preambleLines).toEqual([
      "\\usepackage[x]{pgfplots}",
      "\\usetikzlibrary{calc}",
    ]);
    // An unclosed option list stops at the last line.
    expect(prepareTikzSnippet("\\pgfplotsset{compat=1.18,").preambleLines).toEqual([
      "\\pgfplotsset{compat=1.18,",
    ]);
  });

  it("detects tikz-cd, circuitikz and pgfplots libraries", () => {
    expect(tikzRequirements("\\begin{tikzcd} A \\end{tikzcd}").packages).toEqual([
      "tikz-cd",
    ]);
    expect(tikzRequirements("\\begin{circuitikz}\\end{circuitikz}").packages).toEqual([
      "circuitikz",
    ]);
    const plots = tikzRequirements(
      "\\begin{groupplot}\\addplot fill between [of=a and b];\\end{groupplot}\\begin{polaraxis}\\end{polaraxis}",
    );
    expect(plots.packages).toEqual(["pgfplots"]);
    expect(plots.pgfplotsLibraries).toEqual(["polar", "groupplots", "fillbetween"]);
    expect(plots.pgfplotsCompat).toBe(true);
  });

  it("adds pgfplots libraries and compat that the preamble lacks", () => {
    const requirements = tikzRequirements(
      "\\begin{axis}\\addplot fill between [of=a and b];\\end{axis}",
    );
    expect(
      missingPreambleLines(
        "\\documentclass{article}\n\\usepackage{pgfplots}\n\\usepgfplotslibrary{ , polar}",
        requirements,
        ["\\usepgfplotslibrary{polar,dateplot}"],
      ),
    ).toEqual([
      "\\usepgfplotslibrary{fillbetween,dateplot}",
      "\\pgfplotsset{compat=newest}",
    ]);
    expect(
      missingPreambleLines(
        "\\usepackage{pgfplots}\n\\usepgfplotslibrary{fillbetween}\n\\pgfplotsset{compat=1.18}",
        requirements,
      ),
    ).toEqual([]);
  });

  it("splits multi-package snippet lines and skips xcolor once tikz is loaded", () => {
    expect(
      missingPreambleLines("\\usepackage{tikz}", none, [
        "\\usepackage{xcolor,amsmath}",
        "\\usepackage[dvipsnames]{xcolor}",
      ]),
    ).toEqual(["\\usepackage{amsmath}"]);
    expect(
      missingPreambleLines("", none, ["\\usepackage[dvipsnames]{xcolor}"]),
    ).toEqual(["\\usepackage[dvipsnames]{xcolor}"]);
  });

  it("returns no edit for a document without a usable class or with nothing missing", () => {
    expect(
      preambleEditFor("\\documentclass{article", { ...none, packages: ["tikz"] }),
    ).toBeNull();
    expect(
      preambleEditFor(
        "\\documentclass{art\\}icle}\n\\begin{document}\\end{document}",
        none,
      ),
    ).toEqual({ offset: "\\documentclass{art\\}icle}".length, text: "", lines: [] });
    expect(withPreambleEdit("doc", null)).toBe("doc");
    expect(withPreambleEdit("doc", { offset: 0, text: "", lines: [] })).toBe("doc");
  });

  it("reads nested braces in the class and brace-less loader lines", () => {
    const doc = "\\documentclass{a{b}c}";
    expect(preambleEditFor(doc, none)).toEqual({
      offset: doc.length,
      text: "",
      lines: [],
    });
    expect(prepareTikzSnippet("\\usetikzlibrary\nbody").preambleLines).toEqual([
      "\\usetikzlibrary",
    ]);
  });

  it("appends after the class when there is no body or loader line", () => {
    const doc = "\\documentclass{article}";
    const edit = preambleEditFor(doc, { ...none, packages: ["tikz"] });
    expect(edit).toEqual({
      offset: doc.length,
      text: "\n\\usepackage{tikz}",
      lines: ["\\usepackage{tikz}"],
    });
    expect(withPreambleEdit(doc, edit)).toBe(
      "\\documentclass{article}\n\\usepackage{tikz}",
    );
  });

  it("skips commented loader lines and loaders before the class", () => {
    const doc = [
      "\\RequirePackage{fix-cm}",
      "\\documentclass{article}",
      "\\usepackage{amsmath}",
      "% \\usepackage{hyperref}",
      "\\begin{document}",
      "\\end{document}",
    ].join("\n");
    const edit = preambleEditFor(doc, { ...none, packages: ["tikz"] })!;
    expect(withPreambleEdit(doc, edit)).toContain(
      "\\usepackage{amsmath}\n\\usepackage{tikz}\n% \\usepackage{hyperref}",
    );
  });

  it("keeps figures inside the body", () => {
    expect(safeFigureOffset("plain text", 50)).toBe(10);
    expect(safeFigureOffset("plain text", -3)).toBe(0);
    const open = "\\begin{document}\nbody";
    expect(safeFigureOffset(open, 2)).toBe(open.length);
    expect(safeFigureOffset(open, open.length)).toBe(open.length);
  });
});
