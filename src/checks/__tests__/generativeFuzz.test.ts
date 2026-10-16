import { describe, it, expect } from "vitest";
import { runStructureChecks } from "../structureAssistant";
import { runAcronymChecks } from "../acronymManager";
import { runCitationChecks } from "../citationAssistant";
import { runReproducibilityChecks } from "../reproducibility";
import { runNotationChecks, analyzeNotation } from "../notationManager";
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

// ── Structure assistant: 24 edge cases ───────────────────────────────────
const structureCases = [
  "",
  " ",
  "\n\n\n",
  "\\section{}",
  "\\section{A}\\label{}",
  "\\section{A}\\section{B}",
  "\\section{A}Content.\\section{B}Data.\\section{C}Done.",
  "\\section*{A}\\section*{B}",
  "\\section{A}\\label{sec:a}Content. See \\ref{sec:a}.",
  "\\section{A}\\begin{figure}\\caption{X}\\end{figure}",
  "\\section{A}\\begin{figure}[h]\\caption{X}\\end{figure}",
  "\\section{A}\\begin{table}\\caption{Y}\\end{table}",
  "\\begin{abstract}Test\\end{abstract}",
  "\\begin{abstract}\\end{abstract}",
  "\\part{A}\\section{B}\\subsection{C}\\subsubsection{D}",
  "\\appendix\\section{Appendix}",
  "\\section{Intro}\\section{Related}\\section{Method}\\section{Results}\\section{Conclusion}",
  "\\section{Intro}We use \\gls{cpu}.",
  "\\section{A}\\begin{equation}a=b\\end{equation}",
  "\\section{Results}\\begin{figure}[!htbp]\\centering\\includegraphics{x}\\caption{Test}\\label{fig:x}\\end{figure}",
  "\\section{Results}\\begin{table}[!htbp]\\centering\\begin{tabular}{c}a\\end{tabular}\\caption{Test}\\label{tab:x}\\end{table}",
];
describe("Structure — edge case docs", () => {
  it.each(structureCases)("handles body: %s", (body) => {
    const r = runStructureChecks(doc(body), S);
    expect(Array.isArray(r)).toBe(true);
  });
});

// ── Acronym manager: 24 edge cases ──────────────────────────────────────
const acronymCases = [
  "",
  "ABC XYZ DEF",
  "a b c d e f g",
  "CNN (CNN) then CNN again.",
  "ANN (ANN) used again.",
  "The LSTM RNN CNN GAN models.",
  "ABC (Apple) XYZ (Xerox) ABC XYZ.",
  "CPU GPU RAM SSD HDD.",
  "API SDK CLI GUI IDE.",
  "HTML CSS JS TS JSON XML.",
  "HTTP HTTPS FTP SSH TCP IP.",
  "SQL NoSQL ACID BASE CAP.",
  "PDF XML CSV JSON YAML.",
  "ARM x86 RISC CISC MIPS.",
  "USA UK UN NATO WHO.",
  "NASA ESA JAXA CNSA ISRO.",
  "AI (AI) ML (ML) DL (DL) all used.",
  "NLP (NLP) CV (CV) used.",
  "NaN null undefined.",
  "The quick FOX jumps over the lazy DOG.",
  "ReLU (ReLU) is used.",
  "SGD Adam optimizers.",
  "3D CNN model.",
  "CNN RNN LSTM GAN VAE BERT GPT ReLU SGD Adam.",
];
describe("Acronym — edge case docs", () => {
  it.each(acronymCases)("handles: %s", (body) => {
    const r = runAcronymChecks(doc(body), A);
    expect(Array.isArray(r)).toBe(true);
  });
});

// ── Citation assistant: 24 edge cases ───────────────────────────────────
const citationCases = [
  "",
  "\\cite{r1}",
  "\\cite{r1,r2,r3}",
  "\\cite[see][p.5]{r1}",
  "See \\cite{r1} and \\cite{r2}.",
  "\\citep{r1} \\citet{r2}",
  "\\parencite{r1} \\textcite{r2}",
  "\\autocite{r1} \\footcite{r2}",
  "\\nocite{*}",
  "~\\cite{r1}",
  "\\label{sec:a} See \\ref{sec:a}.",
  "\\label{fig:x} See \\ref{fig:x}.",
  "\\label{tab:x} See \\ref{tab:x}.",
  "\\label{eq:x} See \\ref{eq:x}.",
  "\\bibliographystyle{plain}\\bibliography{refs}",
  "\\addbibresource{refs.bib}\\printbibliography",
  "\\begin{thebibliography}{1}\\bibitem{r1} A.\\end{thebibliography}",
  "\\cite{r1}\\cite{r2}\\cite{r3}\\cite{r4}\\cite{r5}",
  "\\cites{r1}{r2}{r3}",
  "\\cite[cf.][]{r1} \\cite[e.g.][]{r2}",
  "\\parencite{r1} \\footcite{r2} \\textcite{r3} \\smartcite{r4}",
  "\\citeauthor{r1} \\citeyear{r2}",
  "\\cite{r1,r2,r3,r4,r5,r6,r7,r8}",
];
describe("Citation — edge case docs", () => {
  it.each(citationCases)("handles: %s", (body) => {
    const r = runCitationChecks(doc(body), C);
    expect(Array.isArray(r)).toBe(true);
  });
});

// ── Reproducibility: 24 edge cases ───────────────────────────────────────
const reproCases = [
  "",
  "\\url{https://github.com/user/repo}",
  "\\href{https://github.com}{GH}",
  "Dataset at \\url{https://zenodo.org/12345}",
  "MIT License",
  "Apache 2.0",
  "Creative Commons 4.0",
  "Learning rate 0.001, batch 64",
  "Adam optimizer",
  "Dropout 0.5, weight decay 1e-4",
  "NVIDIA A100 GPU",
  "Training time: 2 hours",
  "Random seed: 42",
  "numpy.random.seed(42)",
  "torch.manual_seed(42)",
  "Accuracy 95%, F1 0.93",
  "MAE 0.05, RMSE 0.1",
  "Seed 42. GPU. lr=0.001.",
  "MIT. Adam. A100. Seed 42. Acc 95%.",
  "Python 3.9, PyTorch 2.0",
  "Grid search over [1e-5, 1e-3]",
  "4x NVIDIA A100 80GB",
  "accuracy (95.2%), F1 (0.93), AUROC (0.97)",
];
describe("Reproducibility — edge case docs", () => {
  it.each(reproCases)("handles: %s", (body) => {
    const r = runReproducibilityChecks(doc(body), R);
    expect(Array.isArray(r)).toBe(true);
  });
});

// ── Notation: edge cases ─────────────────────────────────────────────────
const notationCases = [
  "",
  "$a+b=c$",
  "$\\alpha\\beta\\gamma$",
  "$\\theta\\lambda\\mu$",
  "$\\Phi\\Psi\\Omega$",
  "$x_i$ and $x_{ij}$",
  "\\[ \\sum_{i=1}^n x_i \\]",
  "$$ \\int_a^b f(x) dx $$",
  "$\\mathbb{R}^n$ and $\\mathcal{L}$",
  "\\newcommand{\\loss}{\\mathcal{L}} $\\loss$",
  "$\\hat{y}$ $\\tilde{x}$ $\\bar{z}$",
  "$\\dot{a}$ $\\ddot{b}$ $\\vec{v}$",
  "$\\nabla f$ $\\partial f/\\partial x$",
  "$\\cup\\cap\\subset\\supseteq$",
  "$\\in\\notin\\forall\\exists$",
  "$\\to\\rightarrow\\leftarrow\\mapsto$",
  "$\\approx\\sim\\cong\\equiv\\propto$",
  "$\\oplus\\otimes\\odot$",
  "$\\frac{a}{b} \\sqrt{x}$",
  "$\\binom{n}{k}$",
  "\\begin{equation}E=mc^2\\end{equation}",
  "\\begin{align}a&=b\\end{align}",
  "$\\text{Attention}(Q,K,V) = \\text{softmax}(QK^\\top/\\sqrt{d_k})$",
  "$\\mathbb{E}_{x\\sim p}[\\log q(x)] - \\beta\\cdot\\text{KL}(q\\|p)$",
];
describe("Notation — edge case docs", () => {
  it.each(notationCases)("handles: %s", (body) => {
    const r = runNotationChecks(doc(body), N);
    expect(Array.isArray(r.diagnostics)).toBe(true);
    expect(Array.isArray(r.symbols)).toBe(true);
  });
});

// ── PDF compliance: 20 edge cases ────────────────────────────────────────
const pdfCases: [string, string][] = [
  ["", ""],
  ["\\section{A}Hi.", "Output written on paper.pdf (5 pages)."],
  ["\\begin{abstract}Short.\\end{abstract}", ""],
  ["\\begin{abstract}" + Array(300).fill("word").join(" ") + "\\end{abstract}", ""],
  ["\\begin{figure}\\label{fig:a}\\caption{A}\\end{figure}", ""],
  ["\\begin{figure}\\label{fig:a}\\caption{A}\\end{figure} See \\ref{fig:a}.", ""],
  ["\\begin{thebibliography}\\bibitem{r1} A.\\end{thebibliography}", ""],
  ["\\section{A}\\cite{r1}", ""],
  ["", "No type 3 fonts."],
  ["", "PDF contains Type 3 fonts."],
  ["\\section{A}B\\section{C}D\\section{E}F", "Output written on paper.pdf (3 pages)."],
  [
    "\\begin{figure}\\caption{A}\\end{figure}\\begin{figure}\\caption{B}\\end{figure}",
    "",
  ],
  ["\\cite{r1} \\cite{r2} \\cite{r3}", ""],
  ["\\section{A}See \\cite{r1}.", ""],
  ["\\section{A}", "Output written on paper.pdf (10 pages)."],
  ["", "Output written on paper.pdf (100 pages)."],
  ["\\begin{abstract}" + Array(250).fill("word").join(" ") + "\\end{abstract}", ""],
  ["\\begin{abstract}" + Array(251).fill("word").join(" ") + "\\end{abstract}", ""],
  ["\\section{A}B", "Type 3 fonts detected."],
];
describe("PDF Compliance — edge case docs", () => {
  it.each(pdfCases)("handles: %s", (body, output) => {
    const r = runPdfComplianceChecks(doc(body), output, P);
    expect(Array.isArray(r)).toBe(true);
  });
});

// ── Conference checker: 12 edge cases ────────────────────────────────────
const confCases: [string, string][] = [
  ["\\documentclass{article}\\begin{document}Hello.\\end{document}", ""],
  ["\\documentclass[twocolumn]{article}\\begin{document}Hi.\\end{document}", ""],
  ["\\documentclass{IEEEtran}\\begin{document}Hi.\\end{document}", ""],
  ["\\documentclass{acmart}\\begin{document}Hi.\\end{document}", ""],
  ["\\documentclass{llncs}\\begin{document}Hi.\\end{document}", ""],
  [
    "\\documentclass{article}\\begin{document}\\begin{abstract}T.\\end{abstract}\\section{A}H.\\end{document}",
    "",
  ],
  [
    "\\documentclass{article}\\begin{document}" +
      Array(400).fill("w").join(" ") +
      "\\end{document}",
    "",
  ],
  [
    "\\documentclass{article}\\begin{document}\\bibliographystyle{plain}\\bibliography{r}\\end{document}",
    "",
  ],
  [
    "\\documentclass{article}\\begin{document}\\section{Intro}Hi.\\end{document}",
    "Output written on paper.pdf (5 pages).",
  ],
  [
    "\\documentclass{article}\\begin{document}\\section{A}B\\section{C}D\\end{document}",
    "",
  ],
];
describe("Conference checker — edge case docs", () => {
  it.each(confCases)("handles: %s", (body, output) => {
    const r = runConferenceChecks(body, CF);
    expect(Array.isArray(r)).toBe(true);
  });
});

// ── Error doctor: 12 edge cases ──────────────────────────────────────────
const errorCases: [string, string][] = [
  ["", ""],
  [
    "\\documentclass{article}\\begin{document}Hi.\\end{document}",
    "Output written on paper.pdf.",
  ],
  ["", "! Undefined control sequence.\nl.10 \\bad"],
  ["", "! LaTeX Error: File `foo.sty' not found."],
  ["", "! Missing $ inserted.\nl.5 "],
  ["", "Runaway argument?\n! Paragraph ended."],
  ["", "! LaTeX Error: Missing \\begin{document}."],
  ["", "! TeX capacity exceeded, sorry [main memory size=5000000]."],
  ["", "! Package amsmath Error: \\hat allowed only in math mode."],
  ["", "Overfull \\hbox (12.5pt too wide)."],
  [
    "",
    "! Undefined control sequence.\nl.42 \\x\n! File `y.sty' not found.\nRunaway argument?\nl.100",
  ],
  ["", "LaTeX Warning: Citation undefined. LaTeX Warning: Reference undefined."],
];
describe("Error doctor — edge case docs", () => {
  it.each(errorCases)("handles: %s", (content, output) => {
    const r = analyzeCompileOutput(output, content, E);
    expect(Array.isArray(r.diagnostics)).toBe(true);
    expect(typeof r.explain).toBe("string");
    expect(Array.isArray(r.fixes)).toBe(true);
  });
});
