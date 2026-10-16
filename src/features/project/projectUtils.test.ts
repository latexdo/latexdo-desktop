import { describe, expect, it } from "vitest";
describe("latexReferenceForProjectFile (#228)", () => {
  it("writes the LaTeX that points at a dropped project file", async () => {
    const { latexReferenceForProjectFile } = await import("./projectUtils");
    expect(latexReferenceForProjectFile("chapters/intro.tex")).toBe(
      "\\input{chapters/intro}",
    );
    expect(latexReferenceForProjectFile("refs/library.bib")).toBe(
      "\\bibliography{refs/library}",
    );
    expect(latexReferenceForProjectFile("styles/mymacros.sty")).toBe(
      "\\usepackage{mymacros}",
    );
    expect(latexReferenceForProjectFile("figures/plot.png")).toContain(
      "\\includegraphics[width=0.8\\textwidth]{figures/plot.png}",
    );
    expect(latexReferenceForProjectFile("data/results.csv")).toBeNull();
  });
});
