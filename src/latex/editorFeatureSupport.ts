export interface LatexCommandSnippet {
  label: string;
  insertText: string;
  detail: string;
  documentation?: string;
}

export interface LatexDocumentLink {
  url: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface LatexFoldingRange {
  start: number;
  end: number;
  kind: "comment" | "region";
}

export interface LatexOutlineItem {
  id: string;
  label: string;
  detail: string;
  line: number;
  column: number;
  level: number;
}

export interface LatexTableFormatResult {
  startOffset: number;
  endOffset: number;
  text: string;
}

const latexListEnvironments = new Set(["itemize", "enumerate", "description"]);
const latexStructuralHeadingPattern =
  /^\\(?:part|chapter|section|subsection|subsubsection)\*?\s*(?:\[[^\]]*\])?\s*\{/;

export const latexCommandSnippets: LatexCommandSnippet[] = [
  {
    label: "section",
    insertText: "\\section{${1:title}}",
    detail: "Section heading",
  },
  {
    label: "subsection",
    insertText: "\\subsection{${1:title}}",
    detail: "Subsection heading",
  },
  {
    label: "subsubsection",
    insertText: "\\subsubsection{${1:title}}",
    detail: "Subsubsection heading",
  },
  {
    label: "paragraph",
    insertText: "\\paragraph{${1:title}} ${0}",
    detail: "Paragraph heading",
  },
  {
    label: "begin",
    insertText: "\\begin{${1:environment}}\n\t${0}\n\\end{${1:environment}}",
    detail: "Environment block",
  },
  {
    label: "figure",
    insertText:
      "\\begin{figure}[ht]\n\t\\centering\n\t\\includegraphics[width=${1:0.8}\\textwidth]{${2:file}}\n\t\\caption{${3:caption}}\n\t\\label{fig:${4:label}}\n\\end{figure}",
    detail: "Figure environment",
  },
  {
    label: "subfigure",
    insertText:
      "\\begin{subfigure}{${1:0.48}\\textwidth}\n\t\\centering\n\t\\includegraphics[width=\\linewidth]{${2:file}}\n\t\\caption{${3:caption}}\n\t\\label{fig:${4:label}}\n\\end{subfigure}",
    detail: "Subfigure block",
  },
  {
    label: "table",
    insertText:
      "\\begin{table}[ht]\n\t\\centering\n\t\\begin{tabular}{${1:cc}}\n\t\t${0}\n\t\\end{tabular}\n\t\\caption{${2:caption}}\n\t\\label{tab:${3:label}}\n\\end{table}",
    detail: "Table environment",
  },
  {
    label: "tabular",
    insertText:
      "\\begin{tabular}{${1:lcr}}\n\t\\toprule\n\t${2:Name} & ${3:Value} & ${4:Note} \\\\\n\t\\midrule\n\t${5:A} & ${6:1.0} & ${0:ok} \\\\\n\t\\bottomrule\n\\end{tabular}",
    detail: "Tabular environment",
  },
  {
    label: "tabbing",
    insertText:
      "\\begin{tabbing}\n\t${1:Label} \\= ${2:Value} \\= ${0:Note} \\\\\n\\end{tabbing}",
    detail: "Tabbing environment",
  },
  {
    label: "array",
    insertText:
      "\\begin{array}{${1:cc}}\n\t${2:a} & ${3:b} \\\\\n\t${4:c} & ${0:d}\n\\end{array}",
    detail: "Math array",
  },
  {
    label: "equation",
    insertText: "\\begin{equation}\n\t${0:E = mc^2}\n\\end{equation}",
    detail: "Numbered equation",
  },
  {
    label: "equation*",
    insertText: "\\begin{equation*}\n\t${0:E = mc^2}\n\\end{equation*}",
    detail: "Unnumbered equation",
  },
  {
    label: "align",
    insertText: "\\begin{align}\n\t${1:a} &= ${2:b} \\\\\n\t&= ${0:c}\n\\end{align}",
    detail: "Aligned equations",
  },
  {
    label: "align*",
    insertText: "\\begin{align*}\n\t${1:a} &= ${2:b} \\\\\n\t&= ${0:c}\n\\end{align*}",
    detail: "Unnumbered aligned equations",
  },
  {
    label: "gather",
    insertText: "\\begin{gather}\n\t${1:a = b} \\\\\n\t${0:c = d}\n\\end{gather}",
    detail: "Gathered equations",
  },
  {
    label: "multline",
    insertText:
      "\\begin{multline}\n\t${1:first line} \\\\\n\t${0:last line}\n\\end{multline}",
    detail: "Multiline equation",
  },
  {
    label: "cases",
    insertText:
      "\\begin{equation}\n\t${1:f(x)} = \\begin{cases}\n\t\t${2:0}, & ${3:x < 0} \\\\\n\t\t${4:1}, & ${0:x \\ge 0}\n\t\\end{cases}\n\\end{equation}",
    detail: "Piecewise cases",
  },
  {
    label: "matrix",
    insertText:
      "\\begin{bmatrix}\n\t${1:a} & ${2:b} \\\\\n\t${3:c} & ${0:d}\n\\end{bmatrix}",
    detail: "Bracketed matrix",
  },
  {
    label: "pmatrix",
    insertText:
      "\\begin{pmatrix}\n\t${1:a} & ${2:b} \\\\\n\t${3:c} & ${0:d}\n\\end{pmatrix}",
    detail: "Parenthesized matrix",
  },
  {
    label: "frac",
    insertText: "\\frac{${1:numerator}}{${0:denominator}}",
    detail: "Fraction",
  },
  {
    label: "dfrac",
    insertText: "\\dfrac{${1:numerator}}{${0:denominator}}",
    detail: "Display fraction",
  },
  { label: "sqrt", insertText: "\\sqrt{${0:x}}", detail: "Square root" },
  { label: "sum", insertText: "\\sum_{${1:i=1}}^{${2:n}} ${0:x_i}", detail: "Sum" },
  {
    label: "prod",
    insertText: "\\prod_{${1:i=1}}^{${2:n}} ${0:x_i}",
    detail: "Product",
  },
  {
    label: "int",
    insertText: "\\int_{${1:a}}^{${2:b}} ${0:f(x)}\\,dx",
    detail: "Integral",
  },
  {
    label: "iint",
    insertText: "\\iint_{${1:D}} ${0:f(x,y)}\\,dx\\,dy",
    detail: "Double integral",
  },
  {
    label: "lim",
    insertText: "\\lim_{${1:n \\to \\infty}} ${0:a_n}",
    detail: "Limit",
  },
  {
    label: "itemize",
    insertText: "\\begin{itemize}\n\t\\item ${0}\n\\end{itemize}",
    detail: "Bullet list",
  },
  {
    label: "enumerate",
    insertText: "\\begin{enumerate}\n\t\\item ${0}\n\\end{enumerate}",
    detail: "Numbered list",
  },
  {
    label: "description",
    insertText:
      "\\begin{description}\n\t\\item[${1:Term}] ${0:Definition}\n\\end{description}",
    detail: "Description list",
  },
  {
    label: "theorem",
    insertText: "\\begin{theorem}\n\t${0}\n\\end{theorem}",
    detail: "Theorem block",
  },
  {
    label: "proof",
    insertText: "\\begin{proof}\n\t${0}\n\\end{proof}",
    detail: "Proof block",
  },
  {
    label: "definition",
    insertText: "\\begin{definition}\n\t${0}\n\\end{definition}",
    detail: "Definition block",
  },
  {
    label: "lemma",
    insertText: "\\begin{lemma}\n\t${0}\n\\end{lemma}",
    detail: "Lemma block",
  },
  {
    label: "cite",
    insertText: "\\cite{${1:key}}",
    detail: "Citation",
  },
  {
    label: "citep",
    insertText: "\\citep{${1:key}}",
    detail: "Parenthetical citation",
  },
  {
    label: "citet",
    insertText: "\\citet{${1:key}}",
    detail: "Textual citation",
  },
  {
    label: "ref",
    insertText: "\\ref{${1:label}}",
    detail: "Reference",
  },
  {
    label: "eqref",
    insertText: "\\eqref{${1:label}}",
    detail: "Equation reference",
  },
  {
    label: "label",
    insertText: "\\label{${1:label}}",
    detail: "Label",
  },
  {
    label: "includegraphics",
    insertText: "\\includegraphics[width=${1:\\textwidth}]{${2:file}}",
    detail: "Image include",
  },
  {
    label: "graphicspath",
    insertText: "\\graphicspath{{${1:figures/}}}",
    detail: "Graphics search path",
  },
  {
    label: "url",
    insertText: "\\url{${1:https://example.com}}",
    detail: "URL",
  },
  {
    label: "href",
    insertText: "\\href{${1:https://example.com}}{${0:link text}}",
    detail: "Hyperlink",
  },
  {
    label: "footnote",
    insertText: "\\footnote{${0:note}}",
    detail: "Footnote",
  },
  {
    label: "emph",
    insertText: "\\emph{${0:text}}",
    detail: "Emphasis",
  },
  {
    label: "textbf",
    insertText: "\\textbf{${0:text}}",
    detail: "Bold text",
  },
  {
    label: "textit",
    insertText: "\\textit{${0:text}}",
    detail: "Italic text",
  },
  {
    label: "underline",
    insertText: "\\underline{${0:text}}",
    detail: "Underline",
  },
  {
    label: "maketitle",
    insertText: "\\maketitle",
    detail: "Make title",
  },
  {
    label: "abstract",
    insertText: "\\begin{abstract}\n\t${0}\n\\end{abstract}",
    detail: "Abstract environment",
  },
  {
    label: "bibliographystyle",
    insertText: "\\bibliographystyle{${1:plain}}",
    detail: "Bibliography style",
  },
  {
    label: "bibliography",
    insertText: "\\bibliography{${1:references}}",
    detail: "Bibliography",
  },
  {
    label: "printbibliography",
    insertText: "\\printbibliography",
    detail: "BibLaTeX bibliography",
  },
  {
    label: "input",
    insertText: "\\input{${1:file}}",
    detail: "Input file",
  },
  {
    label: "include",
    insertText: "\\include{${1:file}}",
    detail: "Include file",
  },
  {
    label: "newcommand",
    insertText: "\\newcommand{\\${1:name}}[${2:1}]{${0:definition}}",
    detail: "New command",
  },
  {
    label: "renewcommand",
    insertText: "\\renewcommand{\\${1:name}}[${2:1}]{${0:definition}}",
    detail: "Renew command",
  },
  {
    label: "usepackage",
    insertText: "\\usepackage{${1:package}}",
    detail: "Package import",
  },
  {
    label: "documentclass",
    insertText: "\\documentclass[${1:11pt}]{${2:article}}",
    detail: "Document class",
  },
  {
    label: "beamer",
    insertText:
      "\\documentclass{beamer}\n\\title{${1:Title}}\n\\author{${2:Author}}\n\\date{\\today}\n\n\\begin{document}\n\\frame{\\titlepage}\n\n\\begin{frame}{${3:Overview}}\n\t${0}\n\\end{frame}\n\\end{document}",
    detail: "Quick Beamer presentation",
  },
  {
    label: "frame",
    insertText: "\\begin{frame}{${1:Title}}\n\t${0}\n\\end{frame}",
    detail: "Beamer frame",
  },
  {
    label: "letter",
    insertText:
      "\\documentclass{letter}\n\\signature{${1:Your Name}}\n\\address{${2:Your Address}}\n\n\\begin{document}\n\\begin{letter}{${3:Recipient}}\n\\opening{${4:Dear Recipient,}}\n\n${0}\n\n\\closing{Sincerely,}\n\\end{letter}\n\\end{document}",
    detail: "Quick letter",
  },
  {
    label: "tikzpicture",
    insertText:
      "\\begin{tikzpicture}\n\t\\draw[${1:->}] (${2:0,0}) -- (${3:1,1});\n\\end{tikzpicture}",
    detail: "TikZ picture",
  },
  {
    label: "asy",
    insertText:
      "\\begin{asy}\n\tsize(${1:6cm});\n\tdraw((${2:0,0})--(${3:1,1}));\n\\end{asy}",
    detail: "Asymptote block",
  },
];

const sectionLevels = new Map([
  ["part", 0],
  ["chapter", 1],
  ["section", 2],
  ["subsection", 3],
  ["subsubsection", 4],
  ["paragraph", 5],
  ["subparagraph", 6],
]);

const foldableEnvironments = new Set([
  "abstract",
  "align",
  "align*",
  "array",
  "asy",
  "cases",
  "document",
  "enumerate",
  "equation",
  "equation*",
  "figure",
  "frame",
  "gather",
  "gather*",
  "itemize",
  "longtable",
  "proof",
  "subfigure",
  "table",
  "tabbing",
  "tabular",
  "tabular*",
  "tabularx",
  "theorem",
  "tikzpicture",
]);

const tableEnvironments = new Set([
  "array",
  "longtable",
  "tabular",
  "tabular*",
  "tabularx",
]);

function positionAtOffset(text: string, offset: number) {
  let line = 1;
  let column = 1;
  const safeOffset = Math.min(Math.max(0, offset), text.length);
  for (let index = 0; index < safeOffset; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function lineStartOffsets(text: string): number[] {
  const offsets = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function findLastIndex<T>(
  values: T[],
  predicate: (value: T, index: number) => boolean,
): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index], index)) {
      return index;
    }
  }
  return -1;
}

function normalizeUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim().replace(/[),.;:]+$/g, "");
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) {
    return trimmed;
  }
  if (/^doi:/i.test(trimmed)) {
    return `https://doi.org/${trimmed.slice(4)}`;
  }
  if (/^www\./i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

function linkFromOffsets(
  text: string,
  url: string,
  startOffset: number,
  endOffset: number,
): LatexDocumentLink {
  const start = positionAtOffset(text, startOffset);
  const end = positionAtOffset(text, endOffset);
  return {
    url,
    startOffset,
    endOffset,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

function overlaps(
  startOffset: number,
  endOffset: number,
  existing: LatexDocumentLink[],
): boolean {
  return existing.some(
    (link) => startOffset < link.endOffset && endOffset > link.startOffset,
  );
}

export function findLatexDocumentLinks(text: string): LatexDocumentLink[] {
  const links: LatexDocumentLink[] = [];
  const commandPattern = /\\(?:href|url)\s*\{([^}]+)\}(?:\s*\{([^}]*)\})?/g;
  let commandMatch: RegExpExecArray | null;
  while ((commandMatch = commandPattern.exec(text)) !== null) {
    const url = normalizeUrl(commandMatch[1] ?? "");
    if (!url) {
      continue;
    }
    links.push(
      linkFromOffsets(
        text,
        url,
        commandMatch.index,
        commandMatch.index + commandMatch[0].length,
      ),
    );
  }

  const literalPattern = /\b(?:https?:\/\/|www\.)[^\s{}\\]+/gi;
  let literalMatch: RegExpExecArray | null;
  while ((literalMatch = literalPattern.exec(text)) !== null) {
    const url = normalizeUrl(literalMatch[0]);
    if (!url) {
      continue;
    }
    const endOffset = literalMatch.index + literalMatch[0].length;
    if (!overlaps(literalMatch.index, endOffset, links)) {
      links.push(linkFromOffsets(text, url, literalMatch.index, endOffset));
    }
  }

  return links.sort((left, right) => left.startOffset - right.startOffset);
}

export function findLatexDocumentLinkAtOffset(
  text: string,
  offset: number,
): LatexDocumentLink | null {
  return (
    findLatexDocumentLinks(text).find(
      (link) => offset >= link.startOffset && offset <= link.endOffset,
    ) ?? null
  );
}

export function buildLatexFoldingRanges(text: string): LatexFoldingRange[] {
  const lines = text.split(/\r?\n/);
  const ranges: LatexFoldingRange[] = [];
  const environmentStack: Array<{ name: string; line: number }> = [];
  const sectionStack: Array<{ level: number; line: number }> = [];
  let commentStart: number | null = null;

  const closeComment = (line: number) => {
    if (commentStart !== null && line - commentStart >= 1) {
      ranges.push({ start: commentStart, end: line, kind: "comment" });
    }
    commentStart = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith("%")) {
      commentStart ??= lineNumber;
    } else {
      closeComment(lineNumber - 1);
    }

    const sectionMatch = line.match(
      /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*\{/,
    );
    if (sectionMatch) {
      closeComment(lineNumber - 1);
      const level = sectionLevels.get(sectionMatch[1]) ?? 9;
      while (
        sectionStack.length &&
        sectionStack[sectionStack.length - 1].level >= level
      ) {
        const previous = sectionStack.pop()!;
        if (lineNumber - previous.line >= 2) {
          ranges.push({
            start: previous.line,
            end: lineNumber - 1,
            kind: "region",
          });
        }
      }
      sectionStack.push({ level, line: lineNumber });
    }

    for (const beginMatch of line.matchAll(/\\begin\s*\{([^}]+)\}/g)) {
      const name = beginMatch[1];
      if (foldableEnvironments.has(name)) {
        environmentStack.push({ name, line: lineNumber });
      }
    }

    for (const endMatch of line.matchAll(/\\end\s*\{([^}]+)\}/g)) {
      const name = endMatch[1];
      const stackIndex = findLastIndex(environmentStack, (item) => item.name === name);
      if (stackIndex < 0) {
        continue;
      }
      const [start] = environmentStack.splice(stackIndex, 1);
      if (lineNumber - start.line >= 1) {
        ranges.push({ start: start.line, end: lineNumber, kind: "region" });
      }
    }
  }

  closeComment(lines.length);

  while (sectionStack.length) {
    const section = sectionStack.pop()!;
    if (lines.length - section.line >= 1) {
      ranges.push({ start: section.line, end: lines.length, kind: "region" });
    }
  }

  const uniqueRanges = new Map<string, LatexFoldingRange>();
  for (const range of ranges) {
    if (range.end > range.start) {
      uniqueRanges.set(`${range.kind}:${range.start}:${range.end}`, range);
    }
  }
  return [...uniqueRanges.values()].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
}

function readBraceArgument(line: string, startIndex: number): string {
  let depth = 0;
  let value = "";
  for (let index = startIndex; index < line.length; index += 1) {
    const character = line[index];
    if (character === "{") {
      if (depth > 0) {
        value += character;
      }
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.trim();
      }
    }
    if (depth > 0) {
      value += character;
    }
  }
  return value.trim();
}

export function extractLatexOutline(text: string): LatexOutlineItem[] {
  const lines = text.split(/\r?\n/);
  const items: LatexOutlineItem[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];
    const sectionMatch = line.match(
      /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*\{/,
    );
    if (sectionMatch?.index !== undefined) {
      const command = sectionMatch[1];
      const title = readBraceArgument(
        line,
        sectionMatch.index + sectionMatch[0].length - 1,
      );
      const level = sectionLevels.get(command) ?? 9;
      items.push({
        id: `${lineNumber}:section:${command}:${title}`,
        label: title || `Untitled ${command}`,
        detail: `\\${command}`,
        line: lineNumber,
        column: sectionMatch.index + 1,
        level,
      });
      continue;
    }

    const beginMatch = line.match(
      /\\begin\s*\{(figure|table|equation\*?|align\*?|tikzpicture|asy|frame)\}/,
    );
    if (beginMatch?.index !== undefined) {
      const environment = beginMatch[1];
      items.push({
        id: `${lineNumber}:env:${environment}`,
        label: environment,
        detail: `\\begin{${environment}}`,
        line: lineNumber,
        column: beginMatch.index + 1,
        level: 7,
      });
    }
  }

  return items;
}

function splitUnescapedAmpersands(row: string): string[] {
  const cells: string[] = [];
  let current = "";
  let slashCount = 0;

  for (const character of row) {
    if (character === "\\") {
      slashCount += 1;
      current += character;
      continue;
    }

    const escaped = slashCount % 2 === 1;
    slashCount = 0;
    if (character === "&" && !escaped) {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  cells.push(current.trim());
  return cells;
}

function padRight(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - value.length));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatLatexTableAtOffset(
  text: string,
  offset: number,
): LatexTableFormatResult | null {
  const starts = lineStartOffsets(text);
  const beginPattern = /\\begin\s*\{([^}]+)\}/g;
  let beginMatch: RegExpExecArray | null;

  while ((beginMatch = beginPattern.exec(text)) !== null) {
    const environment = beginMatch[1];
    if (!tableEnvironments.has(environment)) {
      continue;
    }

    const endPattern = new RegExp(`\\\\end\\s*\\{${escapeRegExp(environment)}\\}`, "g");
    endPattern.lastIndex = beginMatch.index + beginMatch[0].length;
    const endMatch = endPattern.exec(text);
    if (!endMatch) {
      continue;
    }

    const endOffset = endMatch.index + endMatch[0].length;
    if (offset < beginMatch.index || offset > endOffset) {
      continue;
    }

    const startLineIndex = findLastIndex(
      starts,
      (lineStart) => lineStart <= beginMatch!.index,
    );
    const endLineIndex = findLastIndex(starts, (lineStart) => lineStart <= endOffset);
    const rangeStartOffset = starts[Math.max(0, startLineIndex)];
    const rangeEndOffset =
      endLineIndex + 1 < starts.length ? starts[endLineIndex + 1] : text.length;
    const block = text.slice(rangeStartOffset, rangeEndOffset);
    const newline = block.includes("\r\n") ? "\r\n" : "\n";
    const lines = block.split(/\r?\n/);
    const rows: Array<{
      lineIndex: number;
      indent: string;
      cells: string[];
      rowBreak: string;
    }> = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!line.includes("&")) {
        continue;
      }
      const indent = line.match(/^\s*/)?.[0] ?? "";
      const trimmed = line.trim();
      const rowBreakMatch = trimmed.match(/(\\\\(?:\s*\[[^\]]+\])?)\s*$/);
      const rowBreak = rowBreakMatch?.[1] ?? "";
      const rowBody = rowBreak
        ? trimmed.slice(0, -rowBreakMatch![0].length).trimEnd()
        : trimmed;
      const cells = splitUnescapedAmpersands(rowBody);
      if (cells.length < 2) {
        continue;
      }
      rows.push({ lineIndex, indent, cells, rowBreak });
    }

    if (!rows.length) {
      return null;
    }

    const columnCount = Math.max(...rows.map((row) => row.cells.length));
    const widths = Array.from({ length: columnCount }, (_, column) =>
      Math.max(...rows.map((row) => row.cells[column]?.length ?? 0)),
    );

    for (const row of rows) {
      const formattedCells = row.cells.map((cell, column) =>
        column === row.cells.length - 1 ? cell : padRight(cell, widths[column]),
      );
      lines[row.lineIndex] = `${row.indent}${formattedCells.join(" & ")}${
        row.rowBreak ? ` ${row.rowBreak}` : ""
      }`;
    }

    const formatted = lines.join(newline);
    return formatted === block
      ? null
      : {
          startOffset: rangeStartOffset,
          endOffset: rangeEndOffset,
          text: formatted,
        };
  }

  return null;
}

export function formatLatexListIndentation(
  text: string,
  indent = "    ",
): string | null {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const stack: string[] = [];
  let changed = false;

  const formattedLines = lines.map((line) => {
    const trimmedStart = line.trimStart();
    if (trimmedStart.length === 0) return line;

    const environmentMatch = trimmedStart.match(/^\\(begin|end)\s*\{([^}]+)\}/);
    const kind = environmentMatch?.[1];
    const environment = environmentMatch?.[2];
    const isListEnvironment = Boolean(
      environment && latexListEnvironments.has(environment),
    );

    if (kind === "end" && isListEnvironment) {
      const index = stack.lastIndexOf(environment!);
      if (index >= 0) {
        stack.splice(index, stack.length - index);
      }
    }

    const shouldIndent = stack.length > 0 || isListEnvironment;
    const nextLine = shouldIndent
      ? `${indent.repeat(stack.length)}${trimmedStart}`
      : line;

    if (kind === "begin" && isListEnvironment) {
      stack.push(environment!);
    }

    if (nextLine !== line) changed = true;
    return nextLine;
  });

  if (!changed) return null;
  return formattedLines.join(newline);
}

export function formatLatexDocumentLayout(text: string): string | null {
  const listFormatted = formatLatexListIndentation(text) ?? text;
  const headingFormatted = formatLatexStructuralSpacing(listFormatted);
  return headingFormatted === text ? null : headingFormatted;
}

function formatLatexStructuralSpacing(text: string): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const formattedLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmedStart = line.trimStart();
    const isHeading = latexStructuralHeadingPattern.test(trimmedStart);

    if (!isHeading) {
      formattedLines.push(line);
      continue;
    }

    const previous = formattedLines.at(-1);
    const previousTrimmed = previous?.trim() ?? "";
    if (
      previous !== undefined &&
      previousTrimmed.length > 0 &&
      previousTrimmed !== "\\begin{document}"
    ) {
      formattedLines.push("");
    }

    formattedLines.push(trimmedStart.trimEnd());

    while (index + 1 < lines.length && lines[index + 1].trim().length === 0) {
      index += 1;
    }

    const next = lines[index + 1];
    if (next !== undefined && next.trim().length > 0) {
      formattedLines.push("");
    }
  }

  return formattedLines.join(newline);
}
