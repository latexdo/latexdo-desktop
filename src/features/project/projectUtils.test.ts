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

describe("languageFor", () => {
  it("maps each known extension to its Monaco language", async () => {
    const { languageFor } = await import("./projectUtils");
    expect(languageFor("main.TEX")).toBe("latex");
    expect(languageFor("pkg.sty")).toBe("latex");
    expect(languageFor("fig.tikz")).toBe("latex");
    expect(languageFor("plot.asy")).toBe("asymptote");
    expect(languageFor("refs.bib")).toBe("bibtex");
    expect(languageFor("latexdo.json")).toBe("json");
    expect(languageFor("README.md")).toBe("markdown");
    expect(languageFor("notes.txt")).toBe("plaintext");
    expect(languageFor("Makefile")).toBe("plaintext");
  });
});

describe("path helpers", () => {
  it("formats durations under and over a second", async () => {
    const { formatDuration } = await import("./projectUtils");
    expect(formatDuration(250)).toBe("250 ms");
    expect(formatDuration(1500)).toBe("1.5 s");
  });

  it("creates paths in the root and in nested directories", async () => {
    const { createPathInDirectory } = await import("./projectUtils");
    expect(createPathInDirectory("", "a.tex")).toBe("a.tex");
    expect(createPathInDirectory("./", "a.tex")).toBe("a.tex");
    expect(createPathInDirectory("chapters\\", "a.tex")).toBe("chapters/a.tex");
  });

  it("falls back to a generic figure label and rejects extensionless images", async () => {
    const { latexFigureLabel, isImagePath } = await import("./projectUtils");
    expect(latexFigureLabel("figures/---.png")).toBe("image");
    expect(isImagePath("figures/plot")).toBe(false);
    expect(isImagePath("figures/plot.JPG")).toBe(true);
  });
});

describe("entry and offset helpers", () => {
  it("flattens nested entries and maps offsets to line/column", async () => {
    const { flattenEntries, lineColumnAtOffset } = await import("./projectUtils");
    const tree = [
      { name: "a", path: "a", type: "directory", children: [{ name: "b", path: "a/b", type: "file" }] },
      { name: "c", path: "c", type: "file" },
    ] as never;
    expect(flattenEntries(tree).map((e) => e.path)).toEqual(["a", "a/b", "c"]);
    expect(lineColumnAtOffset("ab\ncd", 4)).toEqual({ line: 2, column: 2 });
    expect(lineColumnAtOffset("ab", -5)).toEqual({ line: 1, column: 1 });
    expect(lineColumnAtOffset("ab", 99)).toEqual({ line: 1, column: 3 });
  });

  it("handles a path with no extension in languageFor", async () => {
    const { languageFor } = await import("./projectUtils");
    expect(languageFor("")).toBe("plaintext");
  });
});
