import { isPdfReadingTheme, type PdfReadingTheme } from "../pdf/readingThemes";
import { productIsPro } from "../../productConfig";
import {
  categoryLabel,
  type LatexDoExtensionManifest,
  type LatexDoExtensionTemplate,
} from "../../extensions";
import type {
  Engine,
  OpenDocument,
  ProjectEntry,
  ProjectListOptions,
} from "../../types";
import { normalizeRelativePath } from "../project/projectUtils";
import {
  normalizeKnowledgeGraphParams,
  type KnowledgeGraphParams,
} from "../graph/knowledgeGraph";

export type ColorTheme = "graphite" | "midnight" | "forest" | "sepia";
export type BookmarkStore = Record<string, number[]>;

export interface WelcomeTemplate {
  id: string;
  name: string;
  summary: string;
  files: string;
  mainTex: string;
  bibTex?: string;
}

/**
 * A theme is a color family: its accent and the tint of the editor and
 * canvas. Whether the app is light or dark is the separate Appearance setting,
 * and every theme has both.
 */
export const colorThemeOptions: {
  id: ColorTheme;
  name: string;
  description: string;
  /** Background, accent and text, for the light and the dark appearance. */
  swatches: { light: [string, string, string]; dark: [string, string, string] };
}[] = [
  {
    id: "graphite",
    name: "Graphite",
    description: "Neutral grays with crisp blue accents.",
    swatches: {
      light: ["#f6f8fd", "#2f6fdb", "#1f2937"],
      dark: ["#15181e", "#729bf0", "#e0e4eb"],
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Cool navy tones for long writing sessions.",
    swatches: {
      light: ["#f3f8ff", "#2458c8", "#1b2a41"],
      dark: ["#0b1424", "#5fa8ff", "#dce8f8"],
    },
  },
  {
    id: "forest",
    name: "Forest",
    description: "Calm greens with strong text contrast.",
    swatches: {
      light: ["#f4f8f5", "#2f8f6b", "#1f2a24"],
      dark: ["#111a16", "#65c28f", "#e1ebe5"],
    },
  },
  {
    id: "sepia",
    name: "Sepia",
    description: "Warm, low-glare tones for reading dense drafts.",
    swatches: {
      light: ["#faf5ec", "#a06a26", "#2e261c"],
      dark: ["#1b1510", "#d69a5b", "#eee4d4"],
    },
  },
];

/**
 * "Studio White" and "Paper White" were light-only copies of Graphite and
 * Forest. Saved settings that use them keep their look.
 */
const retiredLightThemes: Record<string, ColorTheme> = {
  studio: "graphite",
  paper: "forest",
};

export type AppearanceMode = "auto" | "light" | "dark";

export const appearanceModeOptions: {
  id: AppearanceMode;
  name: string;
  description: string;
}[] = [
  {
    id: "auto",
    name: "Auto",
    description: "Follow the system light/dark appearance.",
  },
  {
    id: "light",
    name: "Light",
    description: "Always use the light appearance.",
  },
  {
    id: "dark",
    name: "Dark",
    description: "Always use the dark appearance.",
  },
];

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === "auto" || value === "light" || value === "dark";
}

const baseWelcomeTemplates: WelcomeTemplate[] = [
  {
    id: "article",
    name: "Clean Article",
    summary: "A minimal paper with title, abstract, sections, and conclusion.",
    files: "main.tex",
    mainTex: String.raw`\documentclass[11pt]{article}

\usepackage[margin=1in]{geometry}
\usepackage{microtype}
\usepackage{hyperref}

\title{Untitled Article}
\author{Your Name}
\date{\today}

\begin{document}

\maketitle

\begin{abstract}
Write a one-paragraph summary of the work here.
\end{abstract}

\section{Introduction}

Start with the problem, context, and main claim.

\section{Main Result}

Develop the argument or result.

\section{Conclusion}

Close with the key takeaway.

\end{document}
`,
  },
  {
    id: "research",
    name: "Research Paper",
    summary: "Structured manuscript with figures, tables, and bibliography.",
    files: "main.tex + references.bib",
    mainTex: String.raw`\documentclass[11pt]{article}

\usepackage[margin=1in]{geometry}
\usepackage{amsmath}
\usepackage{booktabs}
\usepackage{graphicx}
\usepackage{microtype}
\usepackage{hyperref}

\title{Research Paper Title}
\author{Your Name}
\date{\today}

\begin{document}

\maketitle

\begin{abstract}
Summarize the question, approach, result, and implication.
\end{abstract}

\section{Introduction}

State the problem and why it matters. Cite the closest related work here \cite{latexdo2026}.

\section{Method}

Describe the setup, assumptions, and procedure.

\section{Results}

\begin{table}[h]
\centering
\begin{tabular}{lrr}
\toprule
Condition & Baseline & Ours \\
\midrule
Example & 0.72 & 0.84 \\
\bottomrule
\end{tabular}
\caption{Replace this table with your main result.}
\end{table}

\section{Discussion}

Explain what changed, what stayed uncertain, and what follows next.

\bibliographystyle{plain}
\bibliography{references}

\end{document}
`,
    bibTex: String.raw`@misc{latexdo2026,
  author = {LatexDo},
  title = {A Local LaTeX Writing Workflow},
  year = {2026},
  note = {Starter reference}
}
`,
  },
  {
    id: "notes",
    name: "Lecture Notes",
    summary: "Definitions, theorem blocks, examples, and exercises.",
    files: "main.tex",
    mainTex: String.raw`\documentclass[11pt]{article}

\usepackage[margin=1in]{geometry}
\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{amsthm}
\usepackage{microtype}
\usepackage{hyperref}

\newtheorem{definition}{Definition}
\newtheorem{theorem}{Theorem}
\newtheorem{example}{Example}

\title{Lecture Notes}
\author{Course or Topic}
\date{\today}

\begin{document}

\maketitle

\section{Topic}

\begin{definition}
Write the main definition here.
\end{definition}

\begin{theorem}
State the main claim.
\end{theorem}

\begin{proof}
Add the proof or derivation.
\end{proof}

\begin{example}
Work through a concrete example.
\end{example}

\section{Exercises}

\begin{enumerate}
  \item Add the first exercise.
  \item Add a follow-up exercise.
\end{enumerate}

\end{document}
`,
  },
  {
    id: "beamer",
    name: "Beamer Presentation",
    summary: "A presentation with title slide, outline, theorem, and closing slide.",
    files: "main.tex",
    mainTex: String.raw`\documentclass{beamer}

\usetheme{Madrid}
\usepackage{amsmath}
\usepackage{graphicx}

\title{Presentation Title}
\author{Your Name}
\date{\today}

\begin{document}

\frame{\titlepage}

\begin{frame}{Outline}
\tableofcontents
\end{frame}

\section{Motivation}

\begin{frame}{Motivation}
\begin{itemize}
  \item State the problem.
  \item Explain why it matters.
  \item Preview the contribution.
\end{itemize}
\end{frame}

\section{Result}

\begin{frame}{Main Result}
\begin{theorem}
State the main result here.
\end{theorem}
\end{frame}

\begin{frame}{Conclusion}
Summarize the takeaway and next steps.
\end{frame}

\end{document}
`,
  },
  {
    id: "letter",
    name: "Letter",
    summary: "A formal letter template with address, opening, and closing.",
    files: "main.tex",
    mainTex: String.raw`\documentclass{letter}

\signature{Your Name}
\address{Your Address \\ City, Country}
\date{\today}

\begin{document}

\begin{letter}{Recipient Name \\ Recipient Address}

\opening{Dear Recipient,}

Write the body of the letter here.

\closing{Sincerely,}

\end{letter}

\end{document}
`,
  },
  {
    id: "response",
    name: "Review Response",
    summary: "A concise rebuttal letter with reviewer-by-reviewer sections.",
    files: "main.tex",
    mainTex: String.raw`\documentclass[11pt]{article}

\usepackage[margin=1in]{geometry}
\usepackage{xcolor}
\usepackage{enumitem}
\usepackage{microtype}
\usepackage{hyperref}

\newcommand{\reviewer}[1]{\section*{Reviewer #1}}
\newcommand{\comment}[1]{\paragraph{Comment.}\emph{#1}}
\newcommand{\response}[1]{\paragraph{Response.}#1}

\title{Response to Reviewers}
\author{Paper ID or Title}
\date{\today}

\begin{document}

\maketitle

We thank the reviewers for their careful reading and constructive feedback.

\reviewer{1}

\comment{Summarize the first reviewer comment.}

\response{Describe the change made in the manuscript and point to the relevant section, figure, or line.}

\reviewer{2}

\comment{Summarize the second reviewer comment.}

\response{Explain the clarification, added experiment, or limitation.}

\section*{Summary of Changes}

\begin{itemize}[leftmargin=*]
  \item Added or revised the main contribution.
  \item Clarified the experimental setup.
  \item Updated the discussion of limitations.
\end{itemize}

\end{document}
`,
  },
];

const businessWelcomeTemplates: WelcomeTemplate[] = [
  {
    id: "business-proposal",
    name: "Client Proposal",
    summary: "A structured proposal with scope, schedule, pricing, and acceptance.",
    files: "main.tex + references.bib",
    mainTex: String.raw`\documentclass[11pt]{article}

\usepackage[margin=1in]{geometry}
\usepackage{booktabs}
\usepackage{enumitem}
\usepackage{hyperref}
\usepackage{microtype}

\title{Client Proposal}
\author{Company Name}
\date{\today}

\begin{document}

\maketitle

\section*{Executive Summary}

Summarize the client's business problem, the proposed outcome, and the measurable value.

\section{Objectives}

\begin{itemize}[leftmargin=*]
  \item Define the first business objective.
  \item Define the second business objective.
  \item Define the success criteria for acceptance.
\end{itemize}

\section{Scope of Work}

Describe the deliverables, assumptions, exclusions, and responsibilities.

\section{Timeline}

\begin{tabular}{lll}
\toprule
Phase & Duration & Output \\
\midrule
Discovery & 2 weeks & Requirements and risk register \\
Delivery & 6 weeks & Working solution and documentation \\
Handover & 1 week & Training and acceptance pack \\
\bottomrule
\end{tabular}

\section{Commercial Terms}

State pricing, payment milestones, validity period, and change control.

\section{Acceptance}

Approval confirms that both parties agree to the scope, timeline, and terms.

\bibliographystyle{plain}
\bibliography{references}

\end{document}
`,
    bibTex: String.raw`@misc{company2026,
  author = {Company Name},
  title = {Proposal Reference Pack},
  year = {2026},
  note = {Replace with client or industry reference}
}
`,
  },
  {
    id: "board-report",
    name: "Board Report",
    summary: "Decision-ready reporting with KPIs, risks, asks, and next actions.",
    files: "main.tex",
    mainTex: String.raw`\documentclass[11pt]{article}

\usepackage[margin=1in]{geometry}
\usepackage{booktabs}
\usepackage{enumitem}
\usepackage{microtype}

\title{Board Report}
\author{Business Unit}
\date{\today}

\begin{document}

\maketitle

\section*{Executive Summary}

Give the board the essential status, decision required, and business impact.

\section{Performance Snapshot}

\begin{tabular}{lrrr}
\toprule
Metric & Current & Target & Status \\
\midrule
Revenue & \$0.0M & \$0.0M & On track \\
Gross margin & 0\% & 0\% & Watch \\
Customer retention & 0\% & 0\% & On track \\
\bottomrule
\end{tabular}

\section{Decisions Required}

\begin{enumerate}[leftmargin=*]
  \item State the decision, recommendation, and deadline.
  \item State the tradeoff and expected financial impact.
\end{enumerate}

\section{Risks and Mitigations}

\begin{tabular}{lll}
\toprule
Risk & Exposure & Mitigation \\
\midrule
Market timing & Medium & Stage rollout by segment \\
Delivery capacity & Low & Reserve specialist support \\
\bottomrule
\end{tabular}

\section{Next Actions}

List owners, dates, and operating checkpoints.

\end{document}
`,
  },
  {
    id: "policy-document",
    name: "Company Policy",
    summary:
      "Controlled policy format with ownership, rules, exceptions, and review cadence.",
    files: "main.tex",
    mainTex: String.raw`\documentclass[11pt]{article}

\usepackage[margin=1in]{geometry}
\usepackage{booktabs}
\usepackage{enumitem}
\usepackage{hyperref}
\usepackage{microtype}

\title{Company Policy}
\author{Owner: Department or Function}
\date{Effective date: \today}

\begin{document}

\maketitle

\section*{Document Control}

\begin{tabular}{ll}
\toprule
Owner & Department or function \\
Approver & Executive sponsor \\
Review cycle & Annual \\
Classification & Internal \\
\bottomrule
\end{tabular}

\section{Purpose}

Explain the risk, obligation, or operating standard this policy addresses.

\section{Scope}

Define the people, teams, systems, and geographies covered by this policy.

\section{Policy Requirements}

\begin{enumerate}[leftmargin=*]
  \item State the mandatory requirement.
  \item State the control or evidence required.
  \item State the escalation path for exceptions.
\end{enumerate}

\section{Exceptions}

Describe how exceptions are requested, reviewed, approved, and logged.

\section{Review}

Name the owner responsible for periodic review and version updates.

\end{document}
`,
  },
  {
    id: "technical-brief",
    name: "Technical Brief",
    summary:
      "Business-facing technical note with decision context and implementation detail.",
    files: "main.tex",
    mainTex: String.raw`\documentclass[11pt]{article}

\usepackage[margin=1in]{geometry}
\usepackage{amsmath}
\usepackage{booktabs}
\usepackage{hyperref}
\usepackage{microtype}

\title{Technical Brief}
\author{Team or Author}
\date{\today}

\begin{document}

\maketitle

\section*{Decision Context}

Summarize the business decision, constraints, and recommended technical direction.

\section{Current State}

Describe the current system, process, cost, or operational issue.

\section{Options}

\begin{tabular}{lll}
\toprule
Option & Benefit & Tradeoff \\
\midrule
Option A & Fastest delivery & Higher operating cost \\
Option B & Lower risk & Longer rollout \\
\bottomrule
\end{tabular}

\section{Recommendation}

State the recommended option, rationale, and implementation owner.

\section{Validation Plan}

Define measurements, acceptance criteria, rollback plan, and reporting cadence.

\end{document}
`,
  },
];

export const welcomeTemplates = productIsPro
  ? [...businessWelcomeTemplates, ...baseWelcomeTemplates]
  : baseWelcomeTemplates;

function isColorTheme(value: unknown): value is ColorTheme {
  return colorThemeOptions.some((theme) => theme.id === value);
}

export function monacoThemeFor(
  theme: ColorTheme,
  appearance: AppearanceMode = "dark",
): string {
  return `latexdo${appearance === "light" ? "-light" : ""}-${theme}`;
}

export interface AppSettings {
  /** 1 once built-in tools no longer depend on store extensions. */
  builtInToolsVersion: number;
  legalAccepted: boolean;
  legalAcceptedAt: string;
  legalPolicyVersion: string;
  colorTheme: ColorTheme;
  appearanceMode: AppearanceMode;
  pdfReadingTheme: PdfReadingTheme;
  defaultEngine: Engine;
  livePreview: boolean;
  editorFontSize: number;
  wordWrap: boolean;
  minimap: boolean;
  /** Plain word suggestions from the project and an English dictionary. */
  wordCompletion: boolean;
  /** AI ghost text and next-edit predictions while typing. */
  intelligentCompletion: boolean;
  inlineBlame: boolean;
  showRawLatex: boolean;
  projectTreeIgnoredNames: string[];
  projectTreeMaxDepth: number;
  projectTreeMaxEntries: number;

  // Conference Checker
  conferenceCheckerEnabled: boolean;
  conferenceTemplate: string;
  conferenceChecker_customTemplate: string;
  checkMargins: boolean;
  checkFontSize: boolean;
  checkAbstractLength: boolean;
  checkKeywords: boolean;
  checkFigureReferences: boolean;
  checkTableReferences: boolean;
  checkBibliographyStyle: boolean;
  checkPageLimit: boolean;
  checkAuthorInfo: boolean;
  checkAnonymousReview: boolean;
  checkFigureResolution: boolean;
  checkEmbeddedFonts: boolean;
  checkCompiler: boolean;

  // Citation Assistant
  projectBibliographyEnabled: boolean;
  citationAssistantEnabled: boolean;
  detectMissingCitations: boolean;
  detectUnusedEntries: boolean;
  detectDuplicateReferences: boolean;
  detectBrokenLinks: boolean;
  suggestCitationKeys: boolean;
  importMetadataSources: boolean;
  warnOldCitations: boolean;

  // Structure Assistant
  structureAssistantEnabled: boolean;
  checkAbstractStructure: boolean;
  checkIntroductionStructure: boolean;
  checkRelatedWorkLength: boolean;
  checkMethodReproducibility: boolean;
  checkResultsDiscussion: boolean;
  checkConclusionClaims: boolean;

  // Reproducibility Checklist
  reproducibilityEnabled: boolean;
  checkCodeLink: boolean;
  checkDatasetLink: boolean;
  checkLicenseMentioned: boolean;
  checkHyperparameters: boolean;
  checkHardwareDetails: boolean;
  checkRandomSeeds: boolean;
  checkEvaluationMetrics: boolean;

  // Acronym Manager
  acronymManagerEnabled: boolean;
  checkUndefinedAcronym: boolean;
  checkDuplicateDefinition: boolean;
  checkUnusedAcronym: boolean;
  checkConflictingDefinitions: boolean;

  // Error Doctor
  errorDoctorEnabled: boolean;
  explainErrors: boolean;
  suggestFixes: boolean;
  autoFixCommon: boolean;

  // TikZ Converter
  tableGeneratorEnabled: boolean;
  tikzConverterEnabled: boolean;
  tikzConverterAutoOpen: boolean;

  // Notation Manager
  notationManagerEnabled: boolean;
  detectNotation: boolean;
  detectNotationConflicts: boolean;
  detectUndefinedNotation: boolean;

  // PDF Compliance
  pdfComplianceEnabled: boolean;
  checkPageCount: boolean;
  maxPages: number;
  checkUnreferencedFigures: boolean;
  checkUncitedCitations: boolean;
  checkSectionsWithNoCitations: boolean;
  checkType3Fonts: boolean;
  checkAbstractWordCount: boolean;
  maxAbstractWords: number;

  // Rebuttal Generator
}

export const settingsStorageKey = "latexdo.settings";
export const installedExtensionsStorageKey = "latexdo.extensions.installed.v1";
export const legalPolicyVersion = "2026-08-26-google-tag-manager";
/** LatexDo is free and built by a nonprofit; this is where people can help (#181). */
export const supportLatexDoUrl = "https://www.latexdo.org/donations/";
export const legalTermsUrl = `https://www.latexdo.org/terms?__latexdo_asset_version=${legalPolicyVersion}`;
export const legalPrivacyUrl = `https://www.latexdo.org/privacy?__latexdo_asset_version=${legalPolicyVersion}`;
const cloudClientNameKey = "latexdo.cloud.clientName";

export function hasAcceptedLegalPolicies(
  settings: Pick<AppSettings, "legalAccepted" | "legalPolicyVersion">,
): boolean {
  return (
    settings.legalAccepted === true &&
    settings.legalPolicyVersion === legalPolicyVersion
  );
}
const defaultProjectTreeIgnoredNames = [
  ".git",
  ".latexdo",
  "node_modules",
  "dist",
  "dist-electron",
  "release",
  "coverage",
  "out",
  ".cache",
];
export const minProjectTreeDepth = 1;
export const maxProjectTreeDepth = 50;
export const minProjectTreeEntries = 100;
export const maxProjectTreeEntries = 100_000;
export const minEditorFontSize = 11;
export const maxEditorFontSize = 22;
export const defaultSettings: AppSettings = {
  builtInToolsVersion: 1,
  legalAccepted: false,
  legalAcceptedAt: "",
  legalPolicyVersion,
  colorTheme: "graphite",
  // New users start on the white theme; anyone who chose a look keeps it.
  appearanceMode: "light",
  pdfReadingTheme: "original",
  defaultEngine: "pdflatex",
  livePreview: false,
  editorFontSize: 13.5,
  wordWrap: true,
  minimap: true,
  wordCompletion: true,
  intelligentCompletion: false,
  inlineBlame: true,
  showRawLatex: true,
  projectTreeIgnoredNames: defaultProjectTreeIgnoredNames,
  projectTreeMaxDepth: 8,
  projectTreeMaxEntries: 5000,

  conferenceCheckerEnabled: true,
  conferenceTemplate: "ieee",
  conferenceChecker_customTemplate: "",
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

  projectBibliographyEnabled: false,
  citationAssistantEnabled: false,
  detectMissingCitations: false,
  detectUnusedEntries: false,
  detectDuplicateReferences: false,
  detectBrokenLinks: false,
  suggestCitationKeys: false,
  importMetadataSources: false,
  warnOldCitations: false,

  structureAssistantEnabled: true,
  checkAbstractStructure: true,
  checkIntroductionStructure: true,
  checkRelatedWorkLength: true,
  checkMethodReproducibility: true,
  checkResultsDiscussion: true,
  checkConclusionClaims: true,

  reproducibilityEnabled: true,
  checkCodeLink: true,
  checkDatasetLink: true,
  checkLicenseMentioned: true,
  checkHyperparameters: true,
  checkHardwareDetails: true,
  checkRandomSeeds: true,
  checkEvaluationMetrics: true,

  acronymManagerEnabled: true,
  checkUndefinedAcronym: true,
  checkDuplicateDefinition: true,
  checkUnusedAcronym: true,
  checkConflictingDefinitions: true,

  errorDoctorEnabled: true,
  explainErrors: true,
  suggestFixes: true,
  autoFixCommon: true,

  tableGeneratorEnabled: true,
  tikzConverterEnabled: true,
  tikzConverterAutoOpen: false,

  notationManagerEnabled: true,
  detectNotation: false,
  detectNotationConflicts: false,
  detectUndefinedNotation: false,

  pdfComplianceEnabled: true,
  checkPageCount: true,
  maxPages: 8,
  checkUnreferencedFigures: true,
  checkUncitedCitations: true,
  checkSectionsWithNoCitations: true,
  checkType3Fonts: true,
  checkAbstractWordCount: true,
  maxAbstractWords: 250,
};

export function normalizeBookmarkLines(lines: unknown): number[] {
  if (!Array.isArray(lines)) {
    return [];
  }
  return [
    ...new Set(
      lines
        .filter((line): line is number => Number.isInteger(line) && line > 0)
        .sort((left, right) => left - right),
    ),
  ];
}

export function remapBookmarkLinesForContentChange(
  lines: unknown,
  previousContent: string,
  nextContent: string,
): number[] {
  const bookmarks = normalizeBookmarkLines(lines);
  if (!bookmarks.length || previousContent === nextContent) {
    return bookmarks;
  }

  const previousLines = previousContent.replace(/\r\n?/g, "\n").split("\n");
  const nextLines = nextContent.replace(/\r\n?/g, "\n").split("\n");

  let prefixLength = 0;
  while (
    prefixLength < previousLines.length &&
    prefixLength < nextLines.length &&
    previousLines[prefixLength] === nextLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < previousLines.length - prefixLength &&
    suffixLength < nextLines.length - prefixLength &&
    previousLines[previousLines.length - 1 - suffixLength] ===
      nextLines[nextLines.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const oldChangedCount = previousLines.length - prefixLength - suffixLength;
  const newChangedCount = nextLines.length - prefixLength - suffixLength;
  const delta = newChangedCount - oldChangedCount;
  const changedStartLine = prefixLength + 1;
  const oldChangedEndLine = prefixLength + oldChangedCount;
  const nextLineCount = Math.max(1, nextLines.length);

  return normalizeBookmarkLines(
    bookmarks
      .map((line) => {
        if (oldChangedCount === 0) {
          return line >= changedStartLine ? line + delta : line;
        }
        if (line < changedStartLine) {
          return line;
        }
        if (line > oldChangedEndLine) {
          return line + delta;
        }

        const offset = line - changedStartLine;
        const replacementOffset = Math.min(offset, Math.max(0, newChangedCount - 1));
        return Math.min(changedStartLine + replacementOffset, nextLineCount);
      })
      .filter((line) => line <= nextLineCount),
  );
}

export function loadBookmarkStore(): BookmarkStore {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(bookmarksStorageKey) ?? "{}",
    ) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, lines]) => [key, normalizeBookmarkLines(lines)] as const)
        .filter(([, lines]) => lines.length > 0),
    );
  } catch {
    return {};
  }
}

export function loadCollaborationDisplayName(): string {
  return (window.localStorage.getItem(cloudClientNameKey) ?? "").slice(0, 80);
}

export function storeCollaborationDisplayName(value: string): string {
  const normalized = value.slice(0, 80);
  window.localStorage.setItem(cloudClientNameKey, normalized);
  return normalized;
}

export function bookmarkKey(projectKey: string, relativePath: string): string {
  return `${projectKey || "workspace"}:${normalizeRelativePath(relativePath)}`;
}

export function loadInstalledExtensionIds(): string[] {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(installedExtensionsStorageKey) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return [
      ...new Set(
        parsed.filter(
          (value): value is string =>
            typeof value === "string" && /^[a-z0-9][a-z0-9.-]{2,80}$/.test(value),
        ),
      ),
    ];
  } catch {
    return [];
  }
}

function hasInvalidProjectTreeIgnoreNameCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === "/" || character === "\\" || code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

function normalizeProjectTreeIgnoredNames(value: unknown): string[] {
  const values =
    typeof value === "string"
      ? value.split(/\r?\n|,/)
      : Array.isArray(value)
        ? value
        : defaultProjectTreeIgnoredNames;
  return [
    ...new Set(
      values
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(
          (entry) =>
            entry.length > 0 &&
            entry.length <= 128 &&
            entry !== "." &&
            entry !== ".." &&
            !hasInvalidProjectTreeIgnoreNameCharacter(entry),
        )
        .slice(0, 256),
    ),
  ];
}

export function parseProjectTreeIgnoredNamesText(value: string): string[] {
  return normalizeProjectTreeIgnoredNames(value);
}

export function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function projectListOptionsFromSettings(
  settings: AppSettings,
): ProjectListOptions {
  return {
    ignoredNames: settings.projectTreeIgnoredNames,
    maxDepth: settings.projectTreeMaxDepth,
    maxEntries: settings.projectTreeMaxEntries,
  };
}

export function hasProjectTreeLimitEntry(entries: ProjectEntry[]): boolean {
  return entries.some(
    (entry) =>
      entry.limited ||
      (entry.children ? hasProjectTreeLimitEntry(entry.children) : false),
  );
}

export function matchesExtensionQuery(
  extension: LatexDoExtensionManifest,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [
    extension.name,
    extension.description,
    extension.author,
    categoryLabel(extension.category),
    ...extension.tags,
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

export function extensionTemplateToWelcomeTemplate(
  extension: LatexDoExtensionManifest,
  template: LatexDoExtensionTemplate,
): WelcomeTemplate {
  return {
    id: `${extension.id}:${template.id}`,
    name: template.name,
    summary: template.summary,
    files: template.files,
    mainTex: template.mainTex,
    bibTex: template.bibTex,
  };
}

export function buildAutoCompileSignature(
  documents: OpenDocument[],
  projectId: string,
  rootFile: string,
  engine: Engine,
): string {
  return JSON.stringify({
    projectId,
    rootFile,
    engine,
    dirtyDocuments: documents
      .filter((document) => document.content !== document.savedContent)
      .map((document) => ({
        relativePath: document.relativePath,
        content: document.content,
      })),
  });
}

/**
 * The table generator, TikZ converter and notation manager used to be unlocked
 * by store extensions; they are now built in. Settings saved before that
 * (builtInToolsVersion 0) turn them on once; afterwards the user's choice stays.
 */
export function migrateBuiltInTools(settings: AppSettings): AppSettings {
  if (settings.builtInToolsVersion >= 1) return settings;
  return {
    ...settings,
    builtInToolsVersion: 1,
    tableGeneratorEnabled: true,
    tikzConverterEnabled: true,
    notationManagerEnabled: true,
  };
}

export function loadSettings(): AppSettings {
  return migrateBuiltInTools(readSavedSettings());
}

function readSavedSettings(): AppSettings {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(settingsStorageKey) ?? "{}",
    ) as Partial<AppSettings>;
    const defaultEngine =
      saved.defaultEngine === "xelatex" || saved.defaultEngine === "lualatex"
        ? saved.defaultEngine
        : "pdflatex";

    return {
      builtInToolsVersion:
        typeof saved.builtInToolsVersion === "number" ? saved.builtInToolsVersion : 0,
      legalAccepted:
        typeof saved.legalAccepted === "boolean"
          ? saved.legalAccepted
          : defaultSettings.legalAccepted,
      legalAcceptedAt:
        typeof saved.legalAcceptedAt === "string"
          ? saved.legalAcceptedAt
          : defaultSettings.legalAcceptedAt,
      legalPolicyVersion:
        typeof saved.legalPolicyVersion === "string"
          ? saved.legalPolicyVersion
          : defaultSettings.legalPolicyVersion,
      colorTheme: isColorTheme(saved.colorTheme)
        ? saved.colorTheme
        : typeof saved.colorTheme === "string" && saved.colorTheme in retiredLightThemes
          ? retiredLightThemes[saved.colorTheme]
          : defaultSettings.colorTheme,
      appearanceMode:
        typeof saved.colorTheme === "string" && saved.colorTheme in retiredLightThemes
          ? "light"
          : isAppearanceMode(saved.appearanceMode)
            ? saved.appearanceMode
            : defaultSettings.appearanceMode,
      defaultEngine,
      livePreview:
        typeof saved.livePreview === "boolean"
          ? saved.livePreview
          : defaultSettings.livePreview,
      pdfReadingTheme: isPdfReadingTheme(saved.pdfReadingTheme)
        ? saved.pdfReadingTheme
        : defaultSettings.pdfReadingTheme,
      editorFontSize:
        typeof saved.editorFontSize === "number" &&
        saved.editorFontSize >= minEditorFontSize &&
        saved.editorFontSize <= maxEditorFontSize
          ? saved.editorFontSize
          : defaultSettings.editorFontSize,
      wordWrap:
        typeof saved.wordWrap === "boolean" ? saved.wordWrap : defaultSettings.wordWrap,
      minimap:
        typeof saved.minimap === "boolean" ? saved.minimap : defaultSettings.minimap,
      wordCompletion:
        typeof saved.wordCompletion === "boolean"
          ? saved.wordCompletion
          : defaultSettings.wordCompletion,
      intelligentCompletion:
        typeof saved.intelligentCompletion === "boolean"
          ? saved.intelligentCompletion
          : defaultSettings.intelligentCompletion,
      inlineBlame:
        typeof saved.inlineBlame === "boolean"
          ? saved.inlineBlame
          : defaultSettings.inlineBlame,
      showRawLatex:
        typeof saved.showRawLatex === "boolean"
          ? saved.showRawLatex
          : defaultSettings.showRawLatex,
      projectTreeIgnoredNames: normalizeProjectTreeIgnoredNames(
        saved.projectTreeIgnoredNames,
      ),
      projectTreeMaxDepth: boundedInteger(
        saved.projectTreeMaxDepth,
        defaultSettings.projectTreeMaxDepth,
        minProjectTreeDepth,
        maxProjectTreeDepth,
      ),
      projectTreeMaxEntries: boundedInteger(
        saved.projectTreeMaxEntries,
        defaultSettings.projectTreeMaxEntries,
        minProjectTreeEntries,
        maxProjectTreeEntries,
      ),

      conferenceCheckerEnabled:
        typeof saved.conferenceCheckerEnabled === "boolean"
          ? saved.conferenceCheckerEnabled
          : defaultSettings.conferenceCheckerEnabled,
      conferenceTemplate:
        typeof saved.conferenceTemplate === "string"
          ? saved.conferenceTemplate
          : defaultSettings.conferenceTemplate,
      conferenceChecker_customTemplate:
        typeof saved.conferenceChecker_customTemplate === "string"
          ? saved.conferenceChecker_customTemplate
          : defaultSettings.conferenceChecker_customTemplate,
      checkMargins:
        typeof saved.checkMargins === "boolean"
          ? saved.checkMargins
          : defaultSettings.checkMargins,
      checkFontSize:
        typeof saved.checkFontSize === "boolean"
          ? saved.checkFontSize
          : defaultSettings.checkFontSize,
      checkAbstractLength:
        typeof saved.checkAbstractLength === "boolean"
          ? saved.checkAbstractLength
          : defaultSettings.checkAbstractLength,
      checkKeywords:
        typeof saved.checkKeywords === "boolean"
          ? saved.checkKeywords
          : defaultSettings.checkKeywords,
      checkFigureReferences:
        typeof saved.checkFigureReferences === "boolean"
          ? saved.checkFigureReferences
          : defaultSettings.checkFigureReferences,
      checkTableReferences:
        typeof saved.checkTableReferences === "boolean"
          ? saved.checkTableReferences
          : defaultSettings.checkTableReferences,
      checkBibliographyStyle:
        typeof saved.checkBibliographyStyle === "boolean"
          ? saved.checkBibliographyStyle
          : defaultSettings.checkBibliographyStyle,
      checkPageLimit:
        typeof saved.checkPageLimit === "boolean"
          ? saved.checkPageLimit
          : defaultSettings.checkPageLimit,
      checkAuthorInfo:
        typeof saved.checkAuthorInfo === "boolean"
          ? saved.checkAuthorInfo
          : defaultSettings.checkAuthorInfo,
      checkAnonymousReview:
        typeof saved.checkAnonymousReview === "boolean"
          ? saved.checkAnonymousReview
          : defaultSettings.checkAnonymousReview,
      checkFigureResolution:
        typeof saved.checkFigureResolution === "boolean"
          ? saved.checkFigureResolution
          : defaultSettings.checkFigureResolution,
      checkEmbeddedFonts:
        typeof saved.checkEmbeddedFonts === "boolean"
          ? saved.checkEmbeddedFonts
          : defaultSettings.checkEmbeddedFonts,
      checkCompiler:
        typeof saved.checkCompiler === "boolean"
          ? saved.checkCompiler
          : defaultSettings.checkCompiler,

      projectBibliographyEnabled:
        typeof saved.projectBibliographyEnabled === "boolean"
          ? saved.projectBibliographyEnabled
          : defaultSettings.projectBibliographyEnabled,
      citationAssistantEnabled:
        typeof saved.citationAssistantEnabled === "boolean"
          ? saved.citationAssistantEnabled
          : defaultSettings.citationAssistantEnabled,
      detectMissingCitations:
        typeof saved.detectMissingCitations === "boolean"
          ? saved.detectMissingCitations
          : defaultSettings.detectMissingCitations,
      detectUnusedEntries:
        typeof saved.detectUnusedEntries === "boolean"
          ? saved.detectUnusedEntries
          : defaultSettings.detectUnusedEntries,
      detectDuplicateReferences:
        typeof saved.detectDuplicateReferences === "boolean"
          ? saved.detectDuplicateReferences
          : defaultSettings.detectDuplicateReferences,
      detectBrokenLinks:
        typeof saved.detectBrokenLinks === "boolean"
          ? saved.detectBrokenLinks
          : defaultSettings.detectBrokenLinks,
      suggestCitationKeys:
        typeof saved.suggestCitationKeys === "boolean"
          ? saved.suggestCitationKeys
          : defaultSettings.suggestCitationKeys,
      importMetadataSources:
        typeof saved.importMetadataSources === "boolean"
          ? saved.importMetadataSources
          : defaultSettings.importMetadataSources,
      warnOldCitations:
        typeof saved.warnOldCitations === "boolean"
          ? saved.warnOldCitations
          : defaultSettings.warnOldCitations,

      structureAssistantEnabled:
        typeof saved.structureAssistantEnabled === "boolean"
          ? saved.structureAssistantEnabled
          : defaultSettings.structureAssistantEnabled,
      checkAbstractStructure:
        typeof saved.checkAbstractStructure === "boolean"
          ? saved.checkAbstractStructure
          : defaultSettings.checkAbstractStructure,
      checkIntroductionStructure:
        typeof saved.checkIntroductionStructure === "boolean"
          ? saved.checkIntroductionStructure
          : defaultSettings.checkIntroductionStructure,
      checkRelatedWorkLength:
        typeof saved.checkRelatedWorkLength === "boolean"
          ? saved.checkRelatedWorkLength
          : defaultSettings.checkRelatedWorkLength,
      checkMethodReproducibility:
        typeof saved.checkMethodReproducibility === "boolean"
          ? saved.checkMethodReproducibility
          : defaultSettings.checkMethodReproducibility,
      checkResultsDiscussion:
        typeof saved.checkResultsDiscussion === "boolean"
          ? saved.checkResultsDiscussion
          : defaultSettings.checkResultsDiscussion,
      checkConclusionClaims:
        typeof saved.checkConclusionClaims === "boolean"
          ? saved.checkConclusionClaims
          : defaultSettings.checkConclusionClaims,

      reproducibilityEnabled:
        typeof saved.reproducibilityEnabled === "boolean"
          ? saved.reproducibilityEnabled
          : defaultSettings.reproducibilityEnabled,
      checkCodeLink:
        typeof saved.checkCodeLink === "boolean"
          ? saved.checkCodeLink
          : defaultSettings.checkCodeLink,
      checkDatasetLink:
        typeof saved.checkDatasetLink === "boolean"
          ? saved.checkDatasetLink
          : defaultSettings.checkDatasetLink,
      checkLicenseMentioned:
        typeof saved.checkLicenseMentioned === "boolean"
          ? saved.checkLicenseMentioned
          : defaultSettings.checkLicenseMentioned,
      checkHyperparameters:
        typeof saved.checkHyperparameters === "boolean"
          ? saved.checkHyperparameters
          : defaultSettings.checkHyperparameters,
      checkHardwareDetails:
        typeof saved.checkHardwareDetails === "boolean"
          ? saved.checkHardwareDetails
          : defaultSettings.checkHardwareDetails,
      checkRandomSeeds:
        typeof saved.checkRandomSeeds === "boolean"
          ? saved.checkRandomSeeds
          : defaultSettings.checkRandomSeeds,
      checkEvaluationMetrics:
        typeof saved.checkEvaluationMetrics === "boolean"
          ? saved.checkEvaluationMetrics
          : defaultSettings.checkEvaluationMetrics,

      acronymManagerEnabled:
        typeof saved.acronymManagerEnabled === "boolean"
          ? saved.acronymManagerEnabled
          : defaultSettings.acronymManagerEnabled,
      checkUndefinedAcronym:
        typeof saved.checkUndefinedAcronym === "boolean"
          ? saved.checkUndefinedAcronym
          : defaultSettings.checkUndefinedAcronym,
      checkDuplicateDefinition:
        typeof saved.checkDuplicateDefinition === "boolean"
          ? saved.checkDuplicateDefinition
          : defaultSettings.checkDuplicateDefinition,
      checkUnusedAcronym:
        typeof saved.checkUnusedAcronym === "boolean"
          ? saved.checkUnusedAcronym
          : defaultSettings.checkUnusedAcronym,
      checkConflictingDefinitions:
        typeof saved.checkConflictingDefinitions === "boolean"
          ? saved.checkConflictingDefinitions
          : defaultSettings.checkConflictingDefinitions,

      errorDoctorEnabled:
        typeof saved.errorDoctorEnabled === "boolean"
          ? saved.errorDoctorEnabled
          : defaultSettings.errorDoctorEnabled,
      explainErrors:
        typeof saved.explainErrors === "boolean"
          ? saved.explainErrors
          : defaultSettings.explainErrors,
      suggestFixes:
        typeof saved.suggestFixes === "boolean"
          ? saved.suggestFixes
          : defaultSettings.suggestFixes,
      autoFixCommon:
        typeof saved.autoFixCommon === "boolean"
          ? saved.autoFixCommon
          : defaultSettings.autoFixCommon,

      tableGeneratorEnabled:
        typeof saved.tableGeneratorEnabled === "boolean"
          ? saved.tableGeneratorEnabled
          : defaultSettings.tableGeneratorEnabled,
      tikzConverterEnabled:
        typeof saved.tikzConverterEnabled === "boolean"
          ? saved.tikzConverterEnabled
          : defaultSettings.tikzConverterEnabled,
      tikzConverterAutoOpen:
        typeof saved.tikzConverterAutoOpen === "boolean"
          ? saved.tikzConverterAutoOpen
          : defaultSettings.tikzConverterAutoOpen,

      notationManagerEnabled:
        typeof saved.notationManagerEnabled === "boolean"
          ? saved.notationManagerEnabled
          : defaultSettings.notationManagerEnabled,
      detectNotation:
        typeof saved.detectNotation === "boolean"
          ? saved.detectNotation
          : defaultSettings.detectNotation,
      detectNotationConflicts:
        typeof saved.detectNotationConflicts === "boolean"
          ? saved.detectNotationConflicts
          : defaultSettings.detectNotationConflicts,
      detectUndefinedNotation:
        typeof saved.detectUndefinedNotation === "boolean"
          ? saved.detectUndefinedNotation
          : defaultSettings.detectUndefinedNotation,

      pdfComplianceEnabled:
        typeof saved.pdfComplianceEnabled === "boolean"
          ? saved.pdfComplianceEnabled
          : defaultSettings.pdfComplianceEnabled,
      checkPageCount:
        typeof saved.checkPageCount === "boolean"
          ? saved.checkPageCount
          : defaultSettings.checkPageCount,
      maxPages:
        typeof saved.maxPages === "number" ? saved.maxPages : defaultSettings.maxPages,
      checkUnreferencedFigures:
        typeof saved.checkUnreferencedFigures === "boolean"
          ? saved.checkUnreferencedFigures
          : defaultSettings.checkUnreferencedFigures,
      checkUncitedCitations:
        typeof saved.checkUncitedCitations === "boolean"
          ? saved.checkUncitedCitations
          : defaultSettings.checkUncitedCitations,
      checkSectionsWithNoCitations:
        typeof saved.checkSectionsWithNoCitations === "boolean"
          ? saved.checkSectionsWithNoCitations
          : defaultSettings.checkSectionsWithNoCitations,
      checkType3Fonts:
        typeof saved.checkType3Fonts === "boolean"
          ? saved.checkType3Fonts
          : defaultSettings.checkType3Fonts,
      checkAbstractWordCount:
        typeof saved.checkAbstractWordCount === "boolean"
          ? saved.checkAbstractWordCount
          : defaultSettings.checkAbstractWordCount,
      maxAbstractWords:
        typeof saved.maxAbstractWords === "number"
          ? saved.maxAbstractWords
          : defaultSettings.maxAbstractWords,
    };
  } catch {
    return defaultSettings;
  }
}

export const bookmarksStorageKey = "latexdo.bookmarks.v1";
export const knowledgeGraphParamsStorageKey = "latexdo.knowledgeGraph.params.v1";

/** Load the knowledge-graph parameters, repairing anything invalid to defaults. */
export function loadKnowledgeGraphParams(): KnowledgeGraphParams {
  try {
    const raw = window.localStorage.getItem(knowledgeGraphParamsStorageKey);
    return normalizeKnowledgeGraphParams(raw ? JSON.parse(raw) : undefined);
  } catch {
    return normalizeKnowledgeGraphParams(undefined);
  }
}

export function storeKnowledgeGraphParams(params: KnowledgeGraphParams): void {
  try {
    window.localStorage.setItem(
      knowledgeGraphParamsStorageKey,
      JSON.stringify(normalizeKnowledgeGraphParams(params)),
    );
  } catch {
    /* localStorage unavailable (e.g. private mode) — params stay in-memory. */
  }
}

export function getSetting(key: string, settings: AppSettings): boolean {
  return (settings as unknown as Record<string, boolean>)[key] ?? true;
}
