import { describe, it, expect } from "vitest";
import { runStructureChecks } from "../structureAssistant";
import { runAcronymChecks } from "../acronymManager";
import { runCitationChecks } from "../citationAssistant";
import { runReproducibilityChecks } from "../reproducibility";
import { runNotationChecks } from "../notationManager";
import { runPdfComplianceChecks } from "../pdfCompliance";
import { runConferenceChecks } from "../conferenceChecker";
import { analyzeCompileOutput } from "../errorDoctor";
import type {
  StructureAssistantSettings,
  AcronymManagerSettings,
  CitationAssistantSettings,
  ReproducibilitySettings,
  NotationManagerSettings,
  PdfComplianceSettings,
  ConferenceCheckerSettings,
  ErrorDoctorSettings,
} from "../../types";

const S: StructureAssistantSettings = {
  enabled: true,
  checkAbstractStructure: true,
  checkIntroductionStructure: true,
  checkRelatedWorkLength: true,
  checkMethodReproducibility: true,
  checkResultsDiscussion: true,
  checkConclusionClaims: true,
};
const A: AcronymManagerSettings = {
  enabled: true,
  checkUndefinedAcronym: true,
  checkDuplicateDefinition: true,
  checkUnusedAcronym: true,
  checkConflictingDefinitions: true,
};
const C: CitationAssistantSettings = {
  enabled: true,
  detectMissingCitations: true,
  detectUnusedEntries: true,
  detectDuplicateReferences: true,
  detectBrokenLinks: true,
  suggestCitationKeys: true,
  importMetadataSources: true,
  warnOldCitations: true,
};
const R: ReproducibilitySettings = {
  enabled: true,
  checkCodeLink: true,
  checkDatasetLink: true,
  checkLicenseMentioned: true,
  checkHyperparameters: true,
  checkHardwareDetails: true,
  checkRandomSeeds: true,
  checkEvaluationMetrics: true,
};
const N: NotationManagerSettings = {
  enabled: true,
  detectSymbols: true,
  detectConflicts: true,
  detectUndefinedNotation: true,
};
const P: PdfComplianceSettings = {
  enabled: true,
  maxPages: 8,
  maxAbstractWords: 250,
  checkPageCount: true,
  checkUnreferencedFigures: true,
  checkUncitedCitations: true,
  checkSectionsWithNoCitations: true,
  checkType3Fonts: true,
  checkAbstractWordCount: true,
};
const E: ErrorDoctorSettings = {
  enabled: true,
  explainErrors: true,
  suggestFixes: true,
  autoFixCommon: true,
};
const CF: ConferenceCheckerSettings = {
  enabled: true,
  template: "ieee",
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

function doc(body: string): string {
  return "\\documentclass{article}\n\\begin{document}\n" + body + "\n\\end{document}\n";
}

// ── Structure: extreme documents ─────────────────────────────────────────
const extremeDocs = [
  "",
  "   \n\n   ",
  "X",
  Array(100)
    .fill(null)
    .map((_, i) => `\\section{Section ${i}}`)
    .join("\n"),
  "\\section{A}\\subsection{B}\\subsubsection{C}\\paragraph{D}\\subparagraph{E}",
  "\\section{" + Array(500).fill("word").join(" ") + "}",
  Array(100)
    .fill(null)
    .map(() => "\\begin{figure}\\caption{X}\\end{figure}")
    .join("\n"),
  Array(100)
    .fill(null)
    .map(() => "\\begin{table}\\caption{Y}\\end{table}")
    .join("\n"),
  Array(100)
    .fill(null)
    .map((_, i) => `\\begin{equation}x=${i}\\label{eq:${i}}\\end{equation}`)
    .join("\n"),
  "\\appendix\\section{A}\\section{Introduction}",
  "Plain text without any sections.",
  "\\section*{A}\\section*{B}\\section*{C}",
  "\\foo\\bar\\baz",
  "\\section{A}\\label{\n\\section{B}",
  "\\chapter{A}\\section{B}\\chapter{C}\\section{D}",
  Array(20)
    .fill(null)
    .map(() => "\\begin{abstract}T\\end{abstract}")
    .join("\n"),
];
describe("Structure — extreme docs", () => {
  it.each(extremeDocs)("handles: %s", (body) => {
    expect(Array.isArray(runStructureChecks(doc(body as string), S))).toBe(true);
  });
});

// ── Acronym: extreme inputs ──────────────────────────────────────────────
const acronymExtremes = [
  "I AM A TEST WITH MANY CAPS LIKE THE CPU AND GPU OF A PC",
  "this is a lowercase document with no acronyms whatsoever",
  "The Quick Brown Fox Jumps Over The Lazy Dog",
  "The CNN 123 model uses GPU 456 with RAM 789 GB",
  Array(100)
    .fill(null)
    .map((_, i) => `ACRO${i}`)
    .join(" "),
  "(CNN)(RNN)[LSTM]{GAN}",
  "3D CNN 2D LSTM 4D GAN",
  Array(100).fill("CNN ").join(""),
  "CNN RNN LSTM GAN VAE BERT GPT ReLU SGD Adam",
];
describe("Acronym — extreme inputs", () => {
  it.each(acronymExtremes)("handles: %s", (body) => {
    expect(Array.isArray(runAcronymChecks(doc(body), A))).toBe(true);
  });
});

// ── Citation: extreme inputs ─────────────────────────────────────────────
const citationExtremes = [
  Array(100)
    .fill(null)
    .map((_, i) => `\\cite{ref${i}}`)
    .join(" "),
  `\\cite{${Array(100)
    .fill(null)
    .map((_, i) => `ref${i}`)
    .join(",")}}`,
  "\\cite[see][p.~5, and also \\cite{r2}]{r1}",
  "This paper has no references whatsoever.",
  "\\cite{  ref1  } \\cite{  ref2 , ref3 }",
  "\\citep{r1} \\citet{r2} \\citeauthor{r3} \\citeyear{r4}",
  "See \\cite{r1}. Also \\cite{r2}; and \\cite{r3}: finally \\cite{r4}.",
  "\\begin{thebibliography}{100}\n" +
    Array(100)
      .fill(null)
      .map((_, i) => `\\bibitem{r${i}} Author ${i}.`)
      .join("\n") +
    "\n\\end{thebibliography}",
];
describe("Citation — extreme inputs", () => {
  it.each(citationExtremes)("handles: %s", (body) => {
    expect(Array.isArray(runCitationChecks(doc(body), C))).toBe(true);
  });
});

// ── Notation: extreme inputs ─────────────────────────────────────────────
const notationExtremes = [
  "$" + Array(200).fill("x").join("+") + "$",
  Array(10)
    .fill(null)
    .map((_, i) => `\\newcommand{\\cmd${i}}{${i}}`)
    .join("\n"),
  "$\\alpha\\beta\\gamma\\delta\\epsilon\\zeta\\eta\\theta\\iota\\kappa\\lambda\\mu\\nu\\xi\\omicron\\pi\\rho\\sigma\\tau\\upsilon\\phi\\chi\\psi\\omega$",
  "$\\forall\\exists\\nexists\\emptyset\\varnothing\\implies\\iff\\land\\lor\\lnot$",
  "\\newcommand{\\myfunc}[3]{#1+#2+#3} $\\myfunc{a}{b}{c}$",
  Array(10)
    .fill(null)
    .map((_, i) => "$\\frac{")
    .join("") +
    "x" +
    Array(10)
      .fill(null)
      .map(() => "}{y}$")
      .join(""),
  "The $\\theta$ function. Here $\\Theta$ is different.",
  "$\\mathbb{N}\\mathbb{Z}\\mathbb{Q}\\mathbb{R}\\mathbb{C}$",
  "$\\mathcal{A}\\mathcal{B}\\mathcal{L}\\mathcal{M}\\mathcal{X}$",
];
describe("Notation — extreme inputs", () => {
  it.each(notationExtremes)("handles: %s", (body) => {
    const r = runNotationChecks(doc(body), N);
    expect(Array.isArray(r.diagnostics)).toBe(true);
    expect(Array.isArray(r.symbols)).toBe(true);
  });
});

// ── PDF Compliance: extreme inputs ───────────────────────────────────────
const pdfExtremes: [string, string][] = [
  ["", "Output written on paper.pdf (0 pages)."],
  ["", "Output written on paper.pdf (1000 pages)."],
  [
    Array(100)
      .fill(null)
      .map((_, i) => `\\begin{figure}\\caption{${i}}\\end{figure}`)
      .join("\n"),
    "",
  ],
  [
    "\\begin{thebibliography}{1000}\n" +
      Array(1000)
        .fill(null)
        .map((_, i) => `\\bibitem{r${i}} A.`)
        .join("\n") +
      "\n\\end{thebibliography}",
    "",
  ],
  ["\\begin{abstract}" + Array(250).fill("word").join(" ") + "\\end{abstract}", ""],
  ["\\begin{abstract}" + Array(251).fill("word").join(" ") + "\\end{abstract}", ""],
  ["", "Output written on paper.pdf (5 pages). Type 3 fonts. No type 3 fonts."],
];
describe("PDF Compliance — extreme inputs", () => {
  it.each(pdfExtremes)("handles: %s | %s", (content, output) => {
    expect(Array.isArray(runPdfComplianceChecks(doc(content), output, P))).toBe(true);
  });
});

// ── Error Doctor: extreme outputs ────────────────────────────────────────
const errExtremes = [
  Array(50)
    .fill(null)
    .map(() => "! Undefined control sequence.\nl.10 \\bad")
    .join("\n"),
  "! Undefined control sequence." +
    Array(1000)
      .fill(null)
      .map((_, i) => `\\cmd${i}`)
      .join(""),
  "! Undefined control sequence.\nl.1 \\a\n! Missing $ inserted.\nl.2 \n! LaTeX Error: File `x.sty' not found.\nRunaway argument?\nl.3 ",
  "Overfull \\hbox. Underfull \\hbox. LaTeX Warning: Citation undefined.",
  Array(30)
    .fill(null)
    .map((_, i) => `! LaTeX Error: File \`pkg${i}.sty' not found.`)
    .join("\n"),
  "! TeX capacity exceeded, sorry [main memory size=5000000].",
  "! Package amsmath Error: \\hat allowed only in math mode.",
  "! LaTeX Error: Something's wrong--perhaps a missing \\item.",
];
describe("Error Doctor — extreme outputs", () => {
  it.each(errExtremes)("handles: %s", (output) => {
    const r = analyzeCompileOutput(output, "", E);
    expect(Array.isArray(r.diagnostics)).toBe(true);
  });
});
