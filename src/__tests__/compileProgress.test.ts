import { describe, expect, it } from "vitest";
import { estimateCompileProgress } from "../../electron/compiler";

const banner = "Latexmk: This is Latexmk, John Collins, 1 Jan 2024, version 4.84.";
const applyingPdfLatex = `${banner}
Latexmk: applying rule 'pdflatex'...`;
const engineStarted = `${applyingPdfLatex}
This is pdfTeX, Version 3.141592653-2.6-1.40.24 (TeX Live 2024) (preloaded format=pdflatex)
 restricted \\write18 enabled.
entering extended mode`;
const formatLoaded = `${engineStarted}
LaTeX2e <2023-11-01> patch level 1
L3 programming layer <2024-02-20>
(/usr/local/texlive/2024/texmf-dist/tex/latex/base/article.cls
Document Class: article 2023/11/01 v1.4o Standard LaTeX document class`;

function passOneOpen(pages: number[]): string {
  const markers = pages.map((page) => `[${page}]`).join("\n");
  return `${formatLoaded}
${markers}`;
}

function completedPass(pages: number[], outputName = "main.pdf"): string {
  const markers = pages.map((page) => `[${page}]`).join("\n");
  return `${markers}
Output written on ${outputName} (${pages.length} pages, 109765 bytes).
Transcript written on ${outputName.replace(".pdf", ".log")}.`;
}

function passN(n: number, pages: number[]): string {
  return `Latexmk: Run number ${n} of rule 'pdflatex'
This is pdfTeX, Version 3.141592653-2.6-1.40.24 (TeX Live 2024) (preloaded format=pdflatex)
entering extended mode
${completedPass(pages)}`;
}

function completedCompile(): string {
  return `${passOneOpen([1, 2, 3])}
${passN(2, [1, 2, 3])}
Latexmk: All targets are up-to-date.`;
}

describe("estimateCompileProgress", () => {
  it("reports 0 for an empty/streamed output", () => {
    expect(estimateCompileProgress("")).toBe(0);
    expect(estimateCompileProgress("\n  ")).toBe(0);
  });

  it("walks startup milestones as the toolchain warms up", () => {
    expect(estimateCompileProgress(banner)).toBe(4);
    expect(estimateCompileProgress(applyingPdfLatex)).toBeGreaterThanOrEqual(6);
    expect(estimateCompileProgress(engineStarted)).toBe(10);
    expect(estimateCompileProgress(formatLoaded)).toBe(10);
  });

  it("fills the first pass window as pages are typeset", () => {
    expect(estimateCompileProgress(passOneOpen([]))).toBeGreaterThanOrEqual(10);
    expect(estimateCompileProgress(passOneOpen([1]))).toBeGreaterThan(0);
    const one = estimateCompileProgress(passOneOpen([1]));
    const three = estimateCompileProgress(passOneOpen([1, 2, 3]));
    const ten = estimateCompileProgress(passOneOpen([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(three).toBeGreaterThanOrEqual(one);
    expect(three).toBeLessThanOrEqual(26);
    expect(ten).toBeGreaterThan(13);
  });

  it("finishes an engine pass when the output file is written", () => {
    const firstPassComplete = `${passOneOpen([1, 2, 3])}
${completedPass([1, 2, 3])}`;
    expect(estimateCompileProgress(firstPassComplete)).toBe(26);
  });

  it("opens each engine pass at its own window", () => {
    const runTwo = `${completedPass([1, 2, 3])}
Latexmk: Run number 2 of rule 'pdflatex'`;
    expect(estimateCompileProgress(runTwo)).toBeGreaterThanOrEqual(26);
    const runThree = `${completedPass([1, 2, 3])}
Latexmk: Run number 3 of rule 'pdflatex'`;
    expect(estimateCompileProgress(runThree)).toBeGreaterThan(40);
  });

  it("tracks latexmk reruns that only repeat applying rule lines", () => {
    const runTwo = `${passOneOpen([1, 2, 3])}
${completedPass([1, 2, 3])}
Latexmk: applying rule 'pdflatex'...
This is pdfTeX, Version 3.141592653-2.6-1.40.24 (TeX Live 2024) (preloaded format=pdflatex)
entering extended mode
[1]
[2]`;
    expect(estimateCompileProgress(runTwo)).toBeGreaterThan(26);
    expect(estimateCompileProgress(runTwo)).toBeLessThanOrEqual(42);

    const runTwoComplete = `${runTwo}
${completedPass([1, 2, 3])}`;
    expect(estimateCompileProgress(runTwoComplete)).toBe(42);
  });

  it("credits bibliography/index rules between engine passes", () => {
    const withBibtex = `${completedPass([1, 2, 3])}
Latexmk: Run number 1 of rule 'bibtex'
This is BibTeX, Version 0.99d
The top-level auxiliary file: main.aux`;
    const withBibtexProgress = estimateCompileProgress(withBibtex);
    expect(withBibtexProgress).toBeGreaterThanOrEqual(46);
    expect(withBibtexProgress).toBeLessThanOrEqual(74);

    const afterBibtexPass = `${withBibtex}
Latexmk: Run number 2 of rule 'pdflatex'`;
    expect(estimateCompileProgress(afterBibtexPass)).toBeGreaterThanOrEqual(
      withBibtexProgress,
    );
  });

  it("pins at 100 once all targets are up to date", () => {
    expect(estimateCompileProgress(completedCompile())).toBe(100);
  });

  it("stays monotonic across a realistic full stream", () => {
    const chunks = [
      "",
      banner,
      applyingPdfLatex,
      engineStarted,
      formatLoaded,
      passOneOpen([1, 2, 3]),
      `${completedPass([1, 2, 3])}
Latexmk: Run number 2 of rule 'pdflatex'`,
      `${completedPass([1, 2, 3])}
Latexmk: Run number 2 of rule 'pdflatex'
entering extended mode
[1]
[2]`,
      `${completedPass([1, 2, 3])}
Latexmk: Run number 3 of rule 'pdflatex'`,
      completedCompile(),
    ];

    let previous = -1;
    for (const chunk of chunks) {
      const progress = estimateCompileProgress(chunk);
      expect(progress).toBeGreaterThanOrEqual(previous);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(100);
      previous = progress;
    }
    expect(previous).toBe(100);
  });
});
