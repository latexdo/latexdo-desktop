// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTikzDocument,
  compileTikzPreview,
  defaultTikzLibraries,
  explainTikzError,
  tikzErrorsFromResult,
  userLineFor,
} from "./tikzPreview.js";
import type { CompileResult, Diagnostic } from "./types.js";

function diagnostic(
  line: number,
  message: string,
  extra: Partial<Diagnostic> = {},
): Diagnostic {
  return { file: "figure.tex", line, column: 1, severity: "error", message, ...extra };
}

describe("buildTikzDocument", () => {
  it("wraps bare drawing commands in a standalone tikzpicture", () => {
    const document = buildTikzDocument("\\draw (0,0) -- (1,1);\n\\node at (0,0) {A};");
    expect(document.fullDocument).toBe(false);
    expect(document.source).toContain("\\documentclass[border=8pt]{standalone}");
    expect(document.source).toContain(
      `\\usetikzlibrary{${defaultTikzLibraries.join(",")}}`,
    );
    const lines = document.source.split("\n");
    const drawLine = lines.indexOf("\\draw (0,0) -- (1,1);") + 1;
    expect(lines[drawLine - 2]).toBe("\\begin{tikzpicture}");
    expect(document.lineMap[drawLine - 1]).toBe(1);
    expect(document.lineMap[drawLine]).toBe(2);
    expect(document.source).not.toContain("pgfplots");
  });

  it("keeps an existing tikzpicture and moves preamble commands up", () => {
    const code = [
      "\\usetikzlibrary{automata}",
      "\\tikzset{",
      "  box/.style={draw}",
      "}",
      "\\begin{tikzpicture}",
      "\\node[box] {x};",
      "\\end{tikzpicture}",
    ].join("\n");
    const document = buildTikzDocument(code);
    const lines = document.source.split("\n");
    expect(lines.filter((line) => line === "\\begin{tikzpicture}")).toHaveLength(1);
    expect(lines.indexOf("\\tikzset{")).toBeLessThan(
      lines.indexOf("\\begin{document}"),
    );
    expect(lines.indexOf("}")).toBeLessThan(lines.indexOf("\\begin{document}"));
    expect(document.lineMap[lines.indexOf("\\node[box] {x};")]).toBe(6);
    expect(document.lineMap[lines.indexOf("  box/.style={draw}")]).toBe(3);
  });

  it("loads pgfplots for plots unless the code does", () => {
    expect(
      buildTikzDocument("\\begin{axis}\n\\addplot {x};\n\\end{axis}").source,
    ).toContain("\\usepackage{pgfplots}");
    const own = buildTikzDocument(
      "\\usepackage{pgfplots}\n\\begin{axis}\\addplot {x};\\end{axis}",
    ).source;
    expect(own.match(/\\usepackage\{pgfplots\}/g)).toHaveLength(1);
  });

  it("uses a full document as it is", () => {
    const code = "\\documentclass{article}\r\n\\begin{document}x\\end{document}";
    const document = buildTikzDocument(code);
    expect(document.fullDocument).toBe(true);
    expect(document.source).toBe(
      "\\documentclass{article}\n\\begin{document}x\\end{document}",
    );
    expect(document.lineMap).toEqual([1, 2]);
  });
});

describe("userLineFor", () => {
  it("maps generated lines back to the closest line of the user's code", () => {
    const document = buildTikzDocument("\\draw (0,0) -- (1,1)\n\\draw (1,1) -- (2,0);");
    const lines = document.source.split("\n");
    expect(userLineFor(document, lines.indexOf("\\draw (1,1) -- (2,0);") + 1)).toBe(2);
    // The closing \end{tikzpicture} points at the last line of the drawing.
    expect(userLineFor(document, lines.indexOf("\\end{tikzpicture}") + 1)).toBe(2);
    expect(userLineFor(document, 1)).toBeNull();
    expect(userLineFor(document, 0)).toBeNull();
    expect(userLineFor(document, 999)).toBe(2);
  });
});

describe("explainTikzError", () => {
  it.each([
    [
      "I do not know the key '/tikz/above=of' and I am going to ignore it",
      "positioning",
    ],
    ["I do not know the key '/tikz/state' and I am going", "automata"],
    ["I do not know the key '/tikz/fancyy' and I am going", "Check its spelling"],
    ["I do not know the shape named `star'", "shapes.geometric"],
    ["Giving up on this path. Did you forget a semicolon?", "does not end with “;”"],
    ["Cannot parse this coordinate", "malformed"],
    ["No shape named `A' is known", "Nothing is named “A”"],
    ["File `missing.sty' not found", "missing.sty is not installed"],
    ["Missing $ inserted", "math mode"],
    ["Extra }, or forgotten \\endgroup", "braces"],
    ["Package pgfkeys Error: Choice 'x' unknown", "option in [ ]"],
    ["Dimension too large", "too large"],
    ["Emergency stop", "first error"],
  ])("explains %s", (message, expected) => {
    expect(explainTikzError(message)).toContain(expected);
  });

  it("names the undefined command when the log shows it", () => {
    expect(explainTikzError("Undefined control sequence", "l.3 \\foo")).toContain(
      "\\foo",
    );
    expect(explainTikzError("Undefined control sequence")).toContain(
      "does not know a command",
    );
    expect(explainTikzError("Something unusual")).toBeUndefined();
  });
});

describe("tikzErrorsFromResult", () => {
  const code = "\\draw (0,0) -- (1,1)\n\\draw (1,1) -- (2,0);";
  const document = buildTikzDocument(code);
  const drawLine = document.source.split("\n").indexOf("\\draw (1,1) -- (2,0);") + 1;

  it("reports errors on the user's lines with hints, once each", () => {
    const errors = tikzErrorsFromResult(document, code, {
      output: "",
      diagnostics: [
        diagnostic(
          drawLine,
          "! Package tikz Error: Giving up on this path. Did you forget a semicolon?.",
        ),
        diagnostic(
          drawLine,
          "! Package tikz Error: Giving up on this path. Did you forget a semicolon?.",
        ),
        diagnostic(drawLine, "==> Fatal error occurred, no output PDF file produced!"),
        diagnostic(drawLine, "Overfull box", { severity: "warning" }),
        diagnostic(3, "Something odd", {
          file: "tikz.code.tex",
          suggestion: "Try again.",
        }),
      ],
    });
    expect(errors).toEqual([
      {
        line: 2,
        message:
          "Package tikz Error: Giving up on this path. Did you forget a semicolon?.",
        hint: expect.stringContaining("semicolon"),
        sourceLine: "\\draw (1,1) -- (2,0);",
      },
      {
        line: null,
        message: "Something odd",
        hint: "Try again.",
        sourceLine: undefined,
      },
    ]);
  });

  it("keeps a stop notice when it is the only message", () => {
    const errors = tikzErrorsFromResult(document, code, {
      output: "",
      diagnostics: [
        diagnostic(drawLine, "==> Fatal error occurred, no output PDF file produced!"),
      ],
    });
    expect(errors).toHaveLength(1);
  });

  it("falls back to the first message in the log", () => {
    expect(
      tikzErrorsFromResult(document, code, {
        output: "noise\n! LaTeX Error: File `pgfplots.sty' not found.\nmore",
        diagnostics: [],
      })[0],
    ).toMatchObject({
      line: null,
      message: "LaTeX Error: File `pgfplots.sty' not found.",
    });
    expect(
      tikzErrorsFromResult(document, code, {
        output: "",
        diagnostics: [],
        error: "latexmk was not found.",
      })[0].message,
    ).toBe("latexmk was not found.");
    expect(
      tikzErrorsFromResult(document, code, { output: "", diagnostics: [] })[0].message,
    ).toBe("LaTeX could not build the figure.");
  });
});

describe("compileTikzPreview", () => {
  let scratchRoot: string;
  beforeEach(async () => {
    scratchRoot = await mkdtemp(path.join(os.tmpdir(), "latexdo-tikz-test-"));
  });
  afterEach(async () => {
    await rm(scratchRoot, { recursive: true, force: true });
  });

  it("compiles the snippet in its own scratch folder and returns the PDF", async () => {
    const compile = vi.fn(
      async (request: { projectPath: string; rootFile: string }) => {
        const source = await readFile(
          path.join(request.projectPath, request.rootFile),
          "utf8",
        );
        expect(source).toContain("\\draw (0,0) circle (1);");
        const pdfPath = path.join(request.projectPath, "out.pdf");
        await mkdir(path.dirname(pdfPath), { recursive: true });
        await writeFile(pdfPath, "%PDF figure");
        return {
          ok: true,
          pdfPath,
          durationMs: 42,
          output: "done",
          diagnostics: [],
        } as CompileResult;
      },
    );
    const result = await compileTikzPreview({
      code: "\\draw (0,0) circle (1);",
      engine: "pdflatex",
      scratchRoot,
      compile,
    });
    expect(result).toMatchObject({
      ok: true,
      errors: [],
      durationMs: 42,
      output: "done",
    });
    expect(Buffer.from(result.pdf!).toString()).toBe("%PDF figure");
    expect(compile.mock.calls[0][0]).toMatchObject({
      rootFile: "figure.tex",
      engine: "pdflatex",
    });
    // The scratch folder is removed after the build.
    expect(existsSync(compile.mock.calls[0][0].projectPath)).toBe(false);
  });

  it("returns mapped errors when LaTeX fails or the PDF is missing", async () => {
    const failed = await compileTikzPreview({
      code: "\\draw (0,0) -- (1,1)",
      engine: "xelatex",
      scratchRoot,
      compile: async () => ({
        ok: false,
        durationMs: 5,
        output: "log",
        diagnostics: [
          diagnostic(
            buildTikzDocument("\\draw (0,0) -- (1,1)").source.split("\n").length - 3,
            "! Undefined control sequence.",
          ),
        ],
      }),
    });
    expect(failed.ok).toBe(false);
    expect(failed.errors[0]).toMatchObject({
      line: 1,
      message: "Undefined control sequence.",
    });
    expect(failed.source).toContain("\\begin{tikzpicture}");

    const missing = await compileTikzPreview({
      code: "\\draw (0,0);",
      engine: "pdflatex",
      scratchRoot,
      compile: async () => ({
        ok: true,
        pdfPath: path.join(scratchRoot, "nope.pdf"),
        durationMs: 1,
        output: "",
        diagnostics: [],
      }),
    });
    expect(missing.ok).toBe(false);
  });
});
