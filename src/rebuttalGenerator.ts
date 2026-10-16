// The response letter built from the Rebuttal panel: a plain, editable LaTeX
// file. Comments are grouped by reviewer and numbered within each reviewer
// (Comment 2.3 is the third comment of Reviewer 2). Anything still to write
// is marked with \fillin{...} so it stands out in the PDF.

import type { RebuttalItem } from "./types";
import { escapeLatexText } from "./reviewMarkup";

/** Where the letter is written, relative to the project folder. */
export const rebuttalLetterFileName = "rebuttal-letter.tex";

export const defaultReviewerName = "Reviewer 1";

export interface RebuttalLetterDetails {
  /** The paper's title as LaTeX, usually taken from its \title{...}. */
  manuscriptTitle?: string;
}

const esc = escapeLatexText;
const signaturePrefix = "% latexdo-letter: ";

/** Paragraphs separated by blank lines stay paragraphs in the letter. */
function prose(value: string): string {
  return value
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => esc(paragraph.replace(/\s*\n\s*/g, " ")))
    .join("\n\n");
}

function splitLines(value: string): string[] {
  return value.replace(/\r\n?/g, "\n").trimEnd().split("\n");
}

/** Older items could hold a unified diff instead of the revised text. */
function looksLikeDiff(value: string): boolean {
  return (
    splitLines(value).filter((line) => /^(?:--- |\+\+\+ |@@|[-+] )/.test(line))
      .length >= 2
  );
}

function changeBlock(item: RebuttalItem): string[] {
  const before = item.originalText?.trim() ?? "";
  const after = (item.revisedText ?? item.modificationMade ?? "").trim();
  if (!before && !after) return [];

  if (!before && looksLikeDiff(after)) {
    const removed: string[] = [];
    const added: string[] = [];
    for (const line of splitLines(after)) {
      if (/^(?:--- |\+\+\+ |@@)/.test(line)) continue;
      if (line.startsWith("-")) removed.push(line.slice(1).trim());
      else if (line.startsWith("+")) added.push(line.slice(1).trim());
    }
    return changeBlock({
      ...item,
      originalText: removed.join("\n"),
      revisedText: added.join("\n"),
      modificationMade: "",
    });
  }

  const lines = ["\\begin{manuscriptchange}"];
  if (before && after && before !== after) {
    lines.push(`\\beforechange{${prose(before)}}`, `\\afterchange{${prose(after)}}`);
  } else {
    lines.push(`\\afterchange{${prose(after || before)}}`);
  }
  lines.push("\\end{manuscriptchange}");
  return lines;
}

/** Reviewers in the order their first comment appears. */
export function groupByReviewer(
  items: RebuttalItem[],
): Array<[string, RebuttalItem[]]> {
  const groups = new Map<string, RebuttalItem[]>();
  for (const item of items) {
    const reviewer = item.reviewer?.trim() || defaultReviewerName;
    groups.set(reviewer, [...(groups.get(reviewer) ?? []), item]);
  }
  return [...groups];
}

function preamble(): string {
  return String.raw`\documentclass[11pt,a4paper]{article}

\usepackage[margin=2.5cm]{geometry}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage{microtype}
\usepackage{parskip}
\usepackage{xcolor}
\usepackage[hidelinks]{hyperref}

% How the letter looks. Change anything here.
\definecolor{commentcolor}{HTML}{4B5563}
\definecolor{beforecolor}{HTML}{B42318}
\definecolor{aftercolor}{HTML}{1A7F37}
\newenvironment{reviewercomment}
  {\begin{quote}\color{commentcolor}\itshape}
  {\end{quote}}
\newcommand{\response}{\noindent\textbf{Response.}\ }
\newenvironment{manuscriptchange}
  {\par\smallskip\noindent\textbf{Change in the manuscript.}\begin{quote}\small}
  {\end{quote}}
\newcommand{\beforechange}[1]{{\color{beforecolor}\textit{Before:} #1}\par}
\newcommand{\afterchange}[1]{{\color{aftercolor}\textit{After:} #1}\par}
% Marks what is left to write. Delete the marks when the letter is done.
\newcommand{\fillin}[1]{{\color{red}\textbf{[#1]}}}`;
}

function body(items: RebuttalItem[], details: RebuttalLetterDetails): string {
  const title = details.manuscriptTitle?.trim();
  const lines = [
    "\\begin{document}",
    "",
    "\\begin{center}",
    "  {\\LARGE\\bfseries Response to the Reviewers}\\\\[0.8em]",
    `  {\\large ${title || "\\fillin{Title of the manuscript}"}}\\\\[0.4em]`,
    "  Manuscript ID: \\fillin{add the ID given by the journal, or delete this line}\\\\[0.4em]",
    "  \\today",
    "\\end{center}",
    "",
    "Dear Editor, dear Reviewers,",
    "",
    "We thank you for your careful reading of our manuscript and for your constructive",
    "comments, which helped us improve it. We revised the manuscript accordingly.",
    "Below, we answer each comment in turn: the reviewer's comment is shown in",
    "italics, followed by our response and, where relevant, the change we made.",
    "",
    "\\fillin{Summarize the main changes of this revision in two or three sentences.}",
  ];

  const groups = groupByReviewer(items);
  if (groups.length === 0) {
    lines.push(
      "",
      "% Add reviewer comments in the Rebuttal panel, then create the letter again.",
    );
  }
  groups.forEach(([reviewer, comments], reviewerIndex) => {
    lines.push("", `\\section*{${esc(reviewer)}}`);
    comments.forEach((item, commentIndex) => {
      lines.push(
        "",
        `\\subsection*{Comment ${reviewerIndex + 1}.${commentIndex + 1}}`,
        "\\begin{reviewercomment}",
        item.reviewerComment.trim()
          ? prose(item.reviewerComment)
          : "\\fillin{Paste the reviewer's comment.}",
        "\\end{reviewercomment}",
        "",
        `\\response ${
          item.authorComment.trim()
            ? prose(item.authorComment)
            : "\\fillin{Write your response to this comment.}"
        }`,
        ...changeBlock(item),
      );
    });
  });

  lines.push(
    "",
    "\\bigskip",
    "We thank the reviewers again for their time and helpful suggestions.",
    "",
    "Sincerely,\\\\",
    "\\fillin{Author names}",
    "",
    "\\end{document}",
  );
  return lines.join("\n");
}

/** FNV-1a: enough to tell whether the letter was edited after it was created. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function generateRebuttalLetter(
  items: RebuttalItem[],
  details: RebuttalLetterDetails = {},
): string {
  const content = `${preamble()}\n\n${body(items, details)}\n`;
  return [
    "% Response letter created by LatexDo from the Rebuttal panel.",
    "% It is yours to edit. If you create the letter again, LatexDo asks before",
    "% replacing a letter you have edited.",
    `${signaturePrefix}${fingerprint(content)}`,
    content,
  ].join("\n");
}

/** True when the file is a letter LatexDo created and nobody edited since. */
export function isUneditedRebuttalLetter(file: string): boolean {
  const lines = file.split("\n");
  const index = lines.findIndex((line) => line.startsWith(signaturePrefix));
  if (index < 0) return false;
  const expected = lines[index].slice(signaturePrefix.length).trim();
  return fingerprint(lines.slice(index + 1).join("\n")) === expected;
}

/** The paper's \title{...}, without \thanks and line breaks, or null. */
export function manuscriptTitleFromSource(source: string): string | null {
  const start = source.search(/\\title\s*(?:\[[^\]]*\])?\s*\{/);
  if (start < 0) return null;
  let index = source.indexOf("{", start) + 1;
  const from = index;
  let depth = 1;
  while (index < source.length && depth > 0) {
    if (source[index] === "{" && source[index - 1] !== "\\") depth += 1;
    else if (source[index] === "}" && source[index - 1] !== "\\") depth -= 1;
    index += 1;
  }
  if (depth !== 0) return null;
  const title = source
    .slice(from, index - 1)
    .replace(/\\thanks\s*\{[^{}]*\}/g, "")
    .replace(/\\\\(\[[^\]]*\])?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title || null;
}

/** A free name next to rebuttal-letter.tex, for keeping an edited letter. */
export function nextRebuttalLetterName(exists: (name: string) => boolean): string {
  for (let copy = 2; ; copy += 1) {
    const name = rebuttalLetterFileName.replace(/\.tex$/, `-${copy}.tex`);
    if (!exists(name)) return name;
  }
}
