import { describe, expect, it } from "vitest";
import {
  documentEnvironments,
  documentMacros,
  getLatexArgumentContext,
  macroSnippet,
  openEnvironmentAt,
  projectFileArgument,
  projectFileMatchesKind,
} from "./argumentCompletion";

const at = (line: string) => getLatexArgumentContext(line, line.length + 1);

describe("getLatexArgumentContext", () => {
  it("recognises the argument being typed", () => {
    expect(at("\\begin{fig")).toMatchObject({
      kind: "environment",
      currentText: "fig",
      rangeStartColumn: 8,
    });
    expect(at("  \\end{")).toMatchObject({ kind: "endEnvironment", currentText: "" });
    expect(at("\\usepackage[utf8]{inputenc, amsm")).toMatchObject({
      kind: "package",
      currentText: "amsm",
    });
    expect(at("\\includegraphics[width=\\linewidth]{figures/pl")).toMatchObject({
      kind: "graphicsFile",
      currentText: "figures/pl",
    });
    expect(at("\\documentclass{art")?.kind).toBe("documentClass");
    expect(at("\\input{chap")?.kind).toBe("texFile");
  });

  it("leaves other commands alone", () => {
    expect(at("\\textbf{bold")).toBeNull();
    expect(at("plain text")).toBeNull();
  });

  it("keeps what follows the caret so a block can be closed", () => {
    const line = "\\begin{}";
    expect(getLatexArgumentContext(line, 8)?.rest).toBe("}");
  });
});

describe("environments", () => {
  const text =
    "\\newtheorem{conjecture}{Conjecture}\\begin{document}\\begin{itemize}\\item a\\end{itemize}\\begin{conjecture} x";

  it("finds the environment \\end{ should close", () => {
    expect(openEnvironmentAt(text, text.length)).toBe("conjecture");
    expect(openEnvironmentAt("\\begin{a}\\begin{b}\\end{b}", 26)).toBe("a");
    expect(openEnvironmentAt("no environments", 5)).toBeNull();
  });

  it("collects environments the project defines or uses", () => {
    expect(documentEnvironments([text])).toEqual(
      expect.arrayContaining(["conjecture", "document", "itemize"]),
    );
  });
});

describe("macros", () => {
  it("finds the project's own commands with their argument counts", () => {
    const macros = documentMacros([
      "\\newcommand{\\R}{\\mathbb{R}}\n\\newcommand\\norm[1]{\\lVert #1 \\rVert}\n" +
        "\\DeclareMathOperator{\\argmax}{arg\\,max}\n\\def\\eps{\\varepsilon}\n\\newcommand{\\@internal}{}",
    ]);
    expect(macros).toEqual(
      expect.arrayContaining([
        { name: "R", argumentCount: 0 },
        { name: "norm", argumentCount: 1 },
        { name: "argmax", argumentCount: 0 },
        { name: "eps", argumentCount: 0 },
      ]),
    );
    expect(macros.some((macro) => macro.name.includes("@"))).toBe(false);
    expect(macroSnippet("norm", 1)).toBe("norm{$1}$0");
    expect(macroSnippet("R", 0)).toBe("R");
  });
});

describe("project files", () => {
  it("writes paths the way each command expects them", () => {
    expect(projectFileArgument("texFile", "chapters/intro.tex")).toBe("chapters/intro");
    expect(projectFileArgument("bibFile", "refs.bib")).toBe("refs");
    expect(projectFileArgument("graphicsFile", "figures/plot.pdf")).toBe(
      "figures/plot.pdf",
    );
    expect(projectFileMatchesKind("graphicsFile", "figures/plot.PNG")).toBe(true);
    expect(projectFileMatchesKind("texFile", "figures/plot.png")).toBe(false);
  });
});

describe("projectFileMatchesKind by kind", () => {
  it("matches bibliography files only for bibliography arguments", () => {
    expect(projectFileMatchesKind("bibFile", "refs/main.BIB")).toBe(true);
    expect(projectFileMatchesKind("bibFile", "main.tex")).toBe(false);
  });

  it("matches nothing for argument kinds that are not files", () => {
    expect(projectFileMatchesKind("package", "amsmath.sty")).toBe(false);
  });
});

describe("openEnvironmentAt with stray ends", () => {
  it("ignores an \\end that closes nothing", () => {
    const text = "\\begin{proof}\\end{figure}";
    expect(openEnvironmentAt(text, text.length)).toBe("proof");
  });
});
