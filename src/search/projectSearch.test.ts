import { describe, expect, it } from "vitest";
import {
  defaultProjectSearchOptions,
  formatProjectSearchResults,
  isProjectSearchablePath,
  searchProjectFiles,
  type ProjectSearchFile,
} from "./projectSearch";

const files: ProjectSearchFile[] = [
  {
    path: "main.tex",
    content: "\\section{Intro}\nAlpha beta alpha.\nMethod uses \\cite{smith20}.",
  },
  {
    path: "chapters/method.tex",
    content: "The Alpha method is precise.\nalphabet soup is not a whole word.",
  },
  {
    path: "references.bib",
    content: "@article{smith20,\n  title={Alpha Paper}\n}",
  },
  {
    path: "figures/plot.png",
    content: "Alpha should not be searched in binary-like files.",
  },
  {
    path: "node_modules/pkg/index.ts",
    content: "Alpha should not be searched in ignored folders.",
  },
];

describe("project search", () => {
  it("finds literal matches case-insensitively with line and column positions", () => {
    const result = searchProjectFiles(files, {
      ...defaultProjectSearchOptions,
      query: "alpha",
    });

    expect(result.error).toBeUndefined();
    expect(result.totalMatches).toBe(5);
    expect(result.files.map((file) => file.path)).toEqual([
      "main.tex",
      "chapters/method.tex",
      "references.bib",
    ]);
    expect(result.files[0].matches[0]).toEqual(
      expect.objectContaining({
        path: "main.tex",
        line: 2,
        column: 1,
        matchText: "Alpha",
        before: ["\\section{Intro}"],
        after: ["Method uses \\cite{smith20}."],
      }),
    );
  });

  it("respects case-sensitive and whole-word options", () => {
    const caseSensitive = searchProjectFiles(files, {
      ...defaultProjectSearchOptions,
      query: "Alpha",
      matchCase: true,
    });
    const wholeWord = searchProjectFiles(files, {
      ...defaultProjectSearchOptions,
      query: "alpha",
      wholeWord: true,
    });

    expect(caseSensitive.totalMatches).toBe(3);
    expect(wholeWord.totalMatches).toBe(4);
    expect(
      wholeWord.files
        .flatMap((file) => file.matches)
        .some((match) => match.lineText.includes("alphabet")),
    ).toBe(false);
  });

  it("supports regular expressions and reports invalid regex errors", () => {
    const result = searchProjectFiles(files, {
      ...defaultProjectSearchOptions,
      query: "Alpha\\s+\\w+",
      useRegex: true,
    });
    const invalid = searchProjectFiles(files, {
      ...defaultProjectSearchOptions,
      query: "(",
      useRegex: true,
    });

    expect(result.totalMatches).toBe(3);
    expect(result.files[0].matches[0].matchText).toBe("Alpha beta");
    expect(invalid.error).toMatch(/Invalid regular expression/);
  });

  it("filters with include and exclude globs", () => {
    const result = searchProjectFiles(files, {
      ...defaultProjectSearchOptions,
      query: "alpha",
      include: "chapters/**/*.tex references.bib",
      exclude: "references.*",
    });

    expect(result.files.map((file) => file.path)).toEqual(["chapters/method.tex"]);
    expect(result.skippedFiles).toBe(4);
  });

  it("caps runaway result sets", () => {
    const result = searchProjectFiles(files, {
      ...defaultProjectSearchOptions,
      query: "alpha",
      maxResults: 2,
    });

    expect(result.totalMatches).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it("formats results for clipboard export", () => {
    const result = searchProjectFiles(files, {
      ...defaultProjectSearchOptions,
      query: "cite",
    });

    expect(formatProjectSearchResults(result)).toBe(
      "main.tex:3:14: Method uses \\cite{smith20}.",
    );
  });

  it("rejects ignored and binary-like paths", () => {
    expect(isProjectSearchablePath("paper.tex")).toBe(true);
    expect(isProjectSearchablePath("figures/diagram.asy")).toBe(true);
    expect(isProjectSearchablePath("figure.pdf")).toBe(false);
    expect(isProjectSearchablePath("node_modules/pkg/file.ts")).toBe(false);
  });
});
