import { describe, it, expect } from "vitest";
import { citationHoverMarkdown, citationKeyAtPosition } from "../citationHover";
import type { CitationEntry } from "../latexIndex";

describe("citationKeyAtPosition", () => {
  it("finds the key at the cursor inside \\cite{...}", () => {
    const line = "... magic literals \\cite{Zait20a,Anqu22a}.";
    const offset = line.indexOf("Zait20a");
    const result = citationKeyAtPosition(line, offset);
    expect(result).toEqual({
      key: "Zait20a",
      start: offset,
      end: offset + "Zait20a".length,
    });
  });

  it("finds the second key when hovering it", () => {
    const line = "... magic literals \\cite{Zait20a,Anqu22a}.";
    const offset = line.indexOf("Anqu22a");
    const result = citationKeyAtPosition(line, offset);
    expect(result).toEqual({
      key: "Anqu22a",
      start: offset,
      end: offset + "Anqu22a".length,
    });
  });

  it.each([
    "cite",
    "citep",
    "citet",
    "citealp",
    "parencite",
    "textcite",
    "autocite",
    "footcite",
  ])("supports \\%s{...}", (command) => {
    const line = `\\${command}{Ref:2020}`;
    const offset = line.indexOf("Ref:2020");
    const result = citationKeyAtPosition(line, offset);
    expect(result).toEqual({
      key: "Ref:2020",
      start: offset,
      end: offset + "Ref:2020".length,
    });
  });

  it("handles optional arguments", () => {
    const line = "See \\citep[see][p. 5]{Doey99} for details.";
    const offset = line.indexOf("Doey99");
    const result = citationKeyAtPosition(line, offset);
    expect(result).toEqual({
      key: "Doey99",
      start: offset,
      end: offset + "Doey99".length,
    });
  });

  it("supports starred commands", () => {
    const line = "\\cite*{StarKey}";
    const offset = line.indexOf("StarKey");
    const result = citationKeyAtPosition(line, offset);
    expect(result).toEqual({ key: "StarKey", start: offset, end: offset + 7 });
  });

  it("returns null when the cursor is not over a citation key", () => {
    expect(citationKeyAtPosition("\\cite{Zait20a,Anqu22a}", 0)).toBeNull();
    expect(citationKeyAtPosition("\\cite{Zait20a}", "\\cite".length)).toBeNull();
    expect(citationKeyAtPosition("\\ref{sec:intro}", 5)).toBeNull();
    expect(citationKeyAtPosition("plain text, no citations here", 10)).toBeNull();
  });

  it("returns null just before a key (on the opening brace)", () => {
    const line = "\\cite{Zait20a,Anqu22a}";
    const offset = line.indexOf("Zait20a") - 1;
    expect(citationKeyAtPosition(line, offset)).toBeNull();
  });
});

describe("citationHoverMarkdown", () => {
  const entry: CitationEntry = {
    key: "Anqu22a",
    type: "article",
    author: "Nicolas Anquetil and Others",
    title: "What do developers consider magic literals?",
    journal: "Information and Software Technology",
    year: "2022",
    sourceFile: "references.bib",
  };

  it("formats a labeled bibliography card", () => {
    const markdown = citationHoverMarkdown(entry);
    expect(markdown).toContain("**Author:** Nicolas Anquetil and Others");
    expect(markdown).toContain(
      "**Title:** What do developers consider magic literals?",
    );
    expect(markdown).toContain("**Journal:** Information and Software Technology");
    expect(markdown).toContain("**Year:** 2022");
  });

  it("skips missing fields", () => {
    const markdown = citationHoverMarkdown({
      key: "Solo",
      type: "misc",
      author: "Jane Solo",
      year: "2021",
      sourceFile: "refs.bib",
    });
    expect(markdown).not.toContain("Journal");
    expect(markdown).not.toContain("Book");
    expect(markdown).not.toContain("Publisher");
    expect(markdown).toContain("**Author:** Jane Solo");
    expect(markdown).toContain("**Year:** 2021");
  });
});
