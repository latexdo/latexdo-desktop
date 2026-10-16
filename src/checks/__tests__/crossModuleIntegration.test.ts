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
  Diagnostic,
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
const E: ErrorDoctorSettings = {
  enabled: true,
  explainErrors: true,
  suggestFixes: true,
  autoFixCommon: true,
};

function doc(body: string): string {
  return "\\documentclass{article}\n\\begin{document}\n" + body + "\n\\end{document}\n";
}

// ── Scenarios run all 8 checkers ─────────────────────────────────────────
const scenarios: [string, string, string][] = [
  [
    "perfect paper",
    doc(
      "\\begin{abstract}Perfect abstract.\\end{abstract}\\section{Introduction}Work \\cite{r1}.\\section{Method}Our approach.\\section{Results}95\\%.\\section{Conclusion}Done.\\bibliographystyle{plain}\\bibliography{refs}",
    ),
    "Output written on paper.pdf (8 pages). No type 3 fonts.",
  ],
  [
    "paper with acronyms",
    doc(
      "CNN (CNN) CNN works. GPU training. lr=0.001. Seed 42. Code at \\url{https://github.com/user/repo}.\\section{Intro}\\cite{r1}.\\section{Method}\\cite{r2}.\\section{Results}\\cite{r3}.\\section{Conclusion}Done.",
    ),
    "Output written on paper.pdf (5 pages). No type 3 fonts.",
  ],
  ["empty paper", doc(""), ""],
  ["minimal abstract", doc("\\begin{abstract}Short.\\end{abstract}"), ""],
  [
    "with figures and tables",
    doc(
      "\\begin{abstract}Summary.\\end{abstract}\\section{Intro}Content.\\section{Method}\\begin{figure}\\caption{Arch}\\label{fig:a}\\end{figure}Our design.\\section{Results}\\begin{table}\\caption{Results}\\label{tab:r}\\end{table}Data.\\section{Conclusion}Done.",
    ),
    "Output written on paper.pdf (6 pages). No type 3 fonts.",
  ],
  [
    "with many cites",
    doc(
      "\\section{Intro}\\cite{r1,r2,r3,r4,r5}.\\section{Method}\\cite{r6,r7,r8}.\\section{Results}\\cite{r9,r10}.\\section{Conclusion}\\cite{r1,r2,r3,r4,r5,r6,r7,r8,r9,r10}.",
    ),
    "Output written on paper.pdf (10 pages). No type 3 fonts.",
  ],
  [
    "with notation",
    doc(
      "\\newcommand{\\loss}{\\mathcal{L}}\\begin{abstract}Test.\\end{abstract}\\section{Intro}$\\loss$ minimized. $\\theta$ params.\\section{Method}$\\hat{y} = \\sigma(Wx+b)$.\\section{Results}$\\loss$={$\\loss$}.\\section{Conclusion}Works.",
    ),
    "Output written on paper.pdf (6 pages). No type 3 fonts.",
  ],
  [
    "reproducible paper",
    doc(
      "\\begin{abstract}Reproducible.\\end{abstract}\\section{Intro}Code at \\url{https://github.com/u/r}.\\section{Method}lr=0.001, batch 64, Adam. A100 GPU. Seed 42.\\section{Results}Acc 95\\%, F1 0.93.\\section{Conclusion}Done.",
    ),
    "Output written on paper.pdf (5 pages). No type 3 fonts.",
  ],
  [
    "type3 fonts",
    doc(
      "\\section{Intro}\\cite{r1}.\\section{Method}\\cite{r2}.\\section{Results}\\cite{r3}.\\section{Conclusion}\\cite{r4}.",
    ),
    "Output written on paper.pdf (5 pages). PDF contains Type 3 fonts.",
  ],
];
describe("All checkers on scenarios", () => {
  it.each(scenarios)("runs on: %s", (name, content, output) => {
    const o = output || "";
    expect(Array.isArray(runStructureChecks(content, S))).toBe(true);
    expect(Array.isArray(runAcronymChecks(content, A))).toBe(true);
    expect(Array.isArray(runCitationChecks(content, C))).toBe(true);
    expect(Array.isArray(runReproducibilityChecks(content, R))).toBe(true);
    const n = runNotationChecks(content, N);
    expect(Array.isArray(n.diagnostics)).toBe(true);
    expect(Array.isArray(n.symbols)).toBe(true);
    expect(Array.isArray(runPdfComplianceChecks(content, o, P))).toBe(true);
    expect(Array.isArray(runConferenceChecks(content, CF))).toBe(true);
    const err = analyzeCompileOutput(o, content, E);
    expect(Array.isArray(err.diagnostics)).toBe(true);
    expect(typeof err.explain).toBe("string");
    expect(Array.isArray(err.fixes)).toBe(true);
  });
});

// ── Diagnostic property validation ──────────────────────────────────────
function allDiagnostics(
  content: string,
  output: string,
): { name: string; diags: Diagnostic[] }[] {
  const o = output || "";
  return [
    { name: "structure", diags: runStructureChecks(content, S) },
    { name: "acronym", diags: runAcronymChecks(content, A) },
    { name: "citation", diags: runCitationChecks(content, C) },
    { name: "reproducibility", diags: runReproducibilityChecks(content, R) },
    { name: "notation", diags: runNotationChecks(content, N).diagnostics },
    { name: "pdfCompliance", diags: runPdfComplianceChecks(content, o, P) },
    { name: "conference", diags: runConferenceChecks(content, CF) },
    { name: "errorDoctor", diags: analyzeCompileOutput(o, content, E).diagnostics },
  ];
}

const testDoc = doc(
  "\\begin{abstract}S.\\end{abstract}\\section{Intro}CNN \\cite{r1} $\\theta$. lr=0.001.\\section{Method}Approach.\\section{Results}$\\Theta$ is used.\\section{Conclusion}Done.",
);
const testOutput =
  "! Undefined control sequence.\nl.10 \\badmacro\nOutput written on paper.pdf (12 pages). Type 3 fonts.";

describe("Diagnostic property validation", () => {
  const all = allDiagnostics(testDoc, testOutput);
  it.each(all)("$name diags have required fields", ({ name, diags }) => {
    diags.forEach((d) => {
      expect(d).toHaveProperty("file");
      expect(d).toHaveProperty("line");
      expect(d).toHaveProperty("message");
      expect(typeof d.file).toBe("string");
      expect(typeof d.line).toBe("number");
      expect(typeof d.message).toBe("string");
      expect(d.message.length).toBeGreaterThan(0);
    });
  });
});
