import { describe, expect, it, vi } from "vitest";
import { readPaperSources, relatedBibliography } from "./graphWorkspace";
import type { CitationEntry } from "../../latex/latexIndex";

describe("Paper-aware graph filtering", () => {
  it("keeps explicit citations and topic matches, excluding unrelated entries", () => {
    const entries: CitationEntry[] = [
      {
        key: "topic",
        type: "article",
        sourceFile: "refs.bib",
        title: "Graph neural networks for citation recommendation",
      },
      { key: "cited", type: "article", sourceFile: "refs.bib", title: "Foundations" },
      {
        key: "other",
        type: "article",
        sourceFile: "refs.bib",
        title: "Marine biology of coral reefs",
      },
    ];
    const result = relatedBibliography(
      "We study graph neural networks for citation recommendation. \\cite{cited}",
      entries,
    );
    expect(result.map((item) => item.key).sort()).toEqual(["cited", "topic"]);
    expect(result.find((item) => item.key === "cited")?.reasons).toContain(
      "Cited in this paper",
    );
    expect(relatedBibliography("", entries)).toEqual([]);
  });

  it("reads nested sources once, ignores commented includes, and preserves reader content", async () => {
    const sources: Record<string, string> = {
      "main.tex": "Latest unsaved abstract. \\input{sections/intro}\n% \\input{unused}",
      "sections/intro.tex": "Introduction \\input{details} \\input{main}",
      "sections/details.tex": "Details and \\cite{realKey}",
    };
    const read = vi.fn(async (path: string) => {
      if (!(path in sources)) throw new Error("Missing source");
      return sources[path];
    });
    const paper = await readPaperSources("main.tex", read);
    expect(paper).toContain("Latest unsaved abstract");
    expect(paper).toContain("Details and \\cite{realKey}");
    expect(read.mock.calls.filter(([path]) => path === "main.tex")).toHaveLength(1);
    expect(read).not.toHaveBeenCalledWith("unused.tex");
  });
});
