import { describe, expect, it } from "vitest";
import { loadPaperSource, paperLineOrigin, stripLatexComments } from "../paperSource";
import { detectConferenceTemplate } from "../conferenceChecker";
import { runAcronymChecks } from "../acronymManager";

const files: Record<string, string> = {
  "main.tex": [
    "%\\documentclass{IEEEtran}",
    "\\documentclass{sn-jnl}",
    "\\begin{document}",
    "\\input{content/intro}",
    "\\InputIfFileExists{tables/t.tex}{}{}",
    "\\end{document}",
  ].join("\n"),
  "content/intro.tex": "\\section{Introduction}\nHello % note\n50\\% done",
  "tables/t.tex": "A table.",
};
const read = async (path: string) => files[path] ?? null;

describe("loadPaperSource", () => {
  it("expands inputs and maps every line back to its file", async () => {
    const source = await loadPaperSource("main.tex", read);
    const lines = source.text.split("\n");
    const intro = lines.indexOf("\\section{Introduction}") + 1;
    expect(paperLineOrigin(source, intro)).toEqual({
      file: "content/intro.tex",
      line: 1,
    });
    expect(source.text).toContain("A table.");
  });

  it("drops comments but keeps escaped percent signs", async () => {
    const source = await loadPaperSource("main.tex", read);
    expect(source.text).not.toContain("IEEEtran");
    expect(source.text).not.toContain("note");
    expect(source.text).toContain("50\\% done");
  });

  it("survives files that include each other", async () => {
    const loop = async (path: string) =>
      path === "a.tex" ? "\\input{b}" : path === "b.tex" ? "\\input{a}" : null;
    const source = await loadPaperSource("a.tex", loop);
    expect(source.origins.map((origin) => origin.file)).toEqual(["a.tex", "b.tex"]);
  });
});

describe("detectConferenceTemplate", () => {
  it("reads the active document class, not a commented-out one", () => {
    const content = stripLatexComments(files["main.tex"]!);
    expect(detectConferenceTemplate(content)).toBe("springer");
  });
});

describe("acronyms in prose only", () => {
  it("ignores color codes, affiliations, roman numerals and the preamble", () => {
    const doc = [
      "\\documentclass{article}",
      "\\definecolor{bg}{HTML}{FFFFFF}",
      "\\begin{document}",
      "\\affil{CNRS, UMR 9189}",
      "Section IV shows it.",
      "\\end{document}",
    ].join("\n");
    const result = runAcronymChecks(doc, {
      enabled: true,
      checkUndefinedAcronym: true,
      checkDuplicateDefinition: true,
      checkUnusedAcronym: true,
      checkConflictingDefinitions: true,
    });
    expect(result).toHaveLength(0);
  });

  it("reads the full form from the words whose initials match", () => {
    const doc =
      "\\begin{document}American Physical Society (APS) and APS again.\\end{document}";
    const result = runAcronymChecks(doc, {
      enabled: true,
      checkUndefinedAcronym: false,
      checkDuplicateDefinition: false,
      checkUnusedAcronym: false,
      checkConflictingDefinitions: true,
    });
    expect(result).toHaveLength(0);
  });
});
