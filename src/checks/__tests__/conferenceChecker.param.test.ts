import { describe, it, expect } from "vitest";
import { runConferenceChecks } from "../conferenceChecker";
import type { ConferenceCheckerSettings } from "../../types";

const full: ConferenceCheckerSettings = {
  enabled: true,
  template: "neurips",
  customTemplate: "",
  checkMargins: true,
  checkFontSize: true,
  checkAbstractLength: true,
  checkKeywords: true,
  checkFigureReferences: true,
  checkTableReferences: true,
  checkBibliographyStyle: true,
  checkPageLimit: true,
  checkAuthorInfo: true,
  checkAnonymousReview: true,
  checkFigureResolution: true,
  checkEmbeddedFonts: true,
  checkCompiler: true,
};

function makeDoc(body: string): string {
  return "\\documentclass{article}\n\\begin{document}\n" + body + "\n\\end{document}\n";
}

// ── Template matching ────────────────────────────────────────────────────
const templateVariants = [
  {
    template: "neurips" as const,
    doc: "\\documentclass{neurips_2024}\\begin{document}H.\\end{document}",
  },
  {
    template: "neurips" as const,
    doc: "\\documentclass{article}\\begin{document}H.\\end{document}",
  },
  {
    template: "ieee" as const,
    doc: "\\documentclass{IEEEtran}\\begin{document}H.\\end{document}",
  },
  {
    template: "ieee" as const,
    doc: "\\documentclass{article}\\begin{document}H.\\end{document}",
  },
  {
    template: "acm" as const,
    doc: "\\documentclass{acmart}\\begin{document}H.\\end{document}",
  },
  {
    template: "acm" as const,
    doc: "\\documentclass{article}\\begin{document}H.\\end{document}",
  },
  {
    template: "springer" as const,
    doc: "\\documentclass{llncs}\\begin{document}H.\\end{document}",
  },
  {
    template: "springer" as const,
    doc: "\\documentclass{article}\\begin{document}H.\\end{document}",
  },
  {
    template: "elsevier" as const,
    doc: "\\documentclass{article}\\begin{document}H.\\end{document}",
  },
  {
    template: "cvpr" as const,
    doc: "\\documentclass{article}\\begin{document}H.\\end{document}",
  },
];
describe("Template matching — parameterized", () => {
  it.each(templateVariants)("template=$template doc=...", ({ template, doc }) => {
    const result = runConferenceChecks(doc, { ...full, template });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── Abstract length ──────────────────────────────────────────────────────
const abstractVariants = [
  { words: 100, expectIssues: false },
  { words: 200, expectIssues: false },
  { words: 300, expectIssues: true },
  { words: 400, expectIssues: true },
  { words: 500, expectIssues: true },
];
describe("Abstract length — parameterized", () => {
  it.each(abstractVariants)(
    "$words words → issues=$expectIssues",
    ({ words, expectIssues }) => {
      const content = Array(words).fill("word").join(" ");
      const doc =
        "\\begin{document}\\begin{abstract}" +
        content +
        "\\end{abstract}\\end{document}";
      const result = runConferenceChecks(doc, full);
      expect(
        result.filter((d) => d.message.toLowerCase().includes("abstract")).length > 0,
      ).toBe(expectIssues);
    },
  );
});

// ── Figure reference detection ──────────────────────────────────────────
const figureVariants = [
  {
    doc: makeDoc("\\begin{figure}\\label{fig:a}\\caption{A}\\end{figure}"),
    hasIssues: true,
  },
  { doc: makeDoc("\\begin{figure}\\caption{A}\\end{figure}"), hasIssues: false },
  {
    doc: makeDoc(
      "\\begin{figure}\\label{fig:a}\\caption{A}\\end{figure} See \\ref{fig:a}.",
    ),
    hasIssues: false,
  },
];
describe("Figure references — parameterized", () => {
  it.each(figureVariants)("issues=$hasIssues", ({ doc, hasIssues }) => {
    const result = runConferenceChecks(doc, full);
    expect(
      result.filter((d) => d.message.toLowerCase().includes("figure")).length > 0,
    ).toBe(hasIssues);
  });
});

// ── Table reference detection ───────────────────────────────────────────
const tableVariants = [
  {
    doc: makeDoc("\\begin{table}\\label{tab:a}\\caption{A}\\end{table}"),
    hasIssues: true,
  },
  { doc: makeDoc("\\begin{table}\\caption{A}\\end{table}"), hasIssues: false },
];
describe("Table references — parameterized", () => {
  it.each(tableVariants)("issues=$hasIssues", ({ doc, hasIssues }) => {
    const result = runConferenceChecks(doc, full);
    expect(
      result.filter((d) => d.message.toLowerCase().includes("table")).length > 0,
    ).toBe(hasIssues);
  });
});

// ── Check toggling ──────────────────────────────────────────────────────
type CheckField = keyof Omit<
  ConferenceCheckerSettings,
  "enabled" | "template" | "customTemplate"
>;
const checkToggles: [string, CheckField][] = [
  ["margins", "checkMargins"],
  ["font size", "checkFontSize"],
  ["abstract", "checkAbstractLength"],
  ["keywords", "checkKeywords"],
  ["figures", "checkFigureReferences"],
  ["tables", "checkTableReferences"],
  ["bib style", "checkBibliographyStyle"],
  ["page limit", "checkPageLimit"],
  ["author info", "checkAuthorInfo"],
  ["anonymous", "checkAnonymousReview"],
  ["figure res", "checkFigureResolution"],
  ["fonts", "checkEmbeddedFonts"],
  ["compiler", "checkCompiler"],
];
describe("Check toggling — parameterized", () => {
  it.each(checkToggles)("disabling %s", (name, field) => {
    const allOff = { ...full, [field]: false };
    const enabled = runConferenceChecks(makeDoc("Hello."), full);
    const disabled = runConferenceChecks(makeDoc("Hello."), allOff);
    expect(Array.isArray(enabled)).toBe(true);
    expect(Array.isArray(disabled)).toBe(true);
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────
const edgeCases = [
  {
    desc: "empty document",
    doc: "\\documentclass{article}\\begin{document}\\end{document}",
  },
  { desc: "no content", doc: "" },
  { desc: "very large", doc: makeDoc(Array(5000).fill("word").join(" ")) },
  { desc: "unicode", doc: makeDoc("∀x∃y") },
];
describe("Edge cases — parameterized", () => {
  it.each(edgeCases)("handles $desc", ({ doc }) => {
    const result = runConferenceChecks(doc, full);
    expect(Array.isArray(result)).toBe(true);
  });
});
