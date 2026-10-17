/*
 * Tidy: lays out a LaTeX source the way a careful author would by hand.
 *
 * - One blank line around every sectioning command; a \label stays on the
 *   line after its heading and comments directly above a heading stay with it.
 * - Environment bodies are indented one level. In lists, \item sits at the
 *   list's level and the item's continuation lines one level deeper.
 * - No blank lines right after \begin{...}, before \end{...} or before \item.
 * - Runs of blank lines collapse to one; trailing spaces go.
 *
 * Math, tables and pictures keep the author's own alignment (the block moves
 * as a whole); verbatim-like environments are never touched.
 */

const indentUnit = "    ";

const verbatimEnvironments = new Set([
  "verbatim",
  "verbatim*",
  "Verbatim",
  "Verbatim*",
  "BVerbatim",
  "LVerbatim",
  "lstlisting",
  "minted",
  "comment",
  "alltt",
  "filecontents",
  "filecontents*",
]);

/** Bodies whose own indentation carries meaning: shift them, never flatten. */
const alignedEnvironments = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "alignat",
  "alignat*",
  "flalign",
  "flalign*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "eqnarray",
  "eqnarray*",
  "split",
  "cases",
  "array",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
  "tabular",
  "tabular*",
  "tabularx",
  "tabulary",
  "longtable",
  "longtable*",
  "tblr",
  "tikzpicture",
  "pgfpicture",
  "tikzcd",
  "circuitikz",
  "axis",
  "scope",
  "algorithmic",
  "algorithmic*",
  "asy",
]);

const listEnvironments = new Set([
  "itemize",
  "enumerate",
  "description",
  "compactitem",
  "compactenum",
  "compactdesc",
  "inparaenum",
  "asparaitem",
  "asparaenum",
]);

/** Environments whose body stays at the outer level. */
const flatEnvironments = new Set(["document"]);

const headingPattern =
  /^\\(?:part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{/;
const itemPattern = /^\\item(?![a-zA-Z@])/;
const labelPattern = /^\\label\s*\{/;
const environmentPattern = /\\(begin|end)\s*\{([^}]+)\}/g;
const leadingEndPattern = /^\\end\s*\{([^}]+)\}\s*/;

interface Frame {
  environment: string;
  list: boolean;
  itemOpen: boolean;
}

type LineKind = "code" | "blank" | "protected";

interface OutputLine {
  text: string;
  kind: LineKind;
}

/** The part of a line before an unescaped `%`. */
function codePart(line: string): string {
  let backslashes = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\\") {
      backslashes += 1;
      continue;
    }
    if (character === "%" && backslashes % 2 === 0) {
      return line.slice(0, index);
    }
    backslashes = 0;
  }
  return line;
}

function environmentTokens(line: string): { kind: "begin" | "end"; name: string }[] {
  return [...codePart(line).matchAll(environmentPattern)].map((match) => ({
    kind: match[1] as "begin" | "end",
    name: match[2].trim(),
  }));
}

function leadingWidth(line: string): number {
  let width = 0;
  for (const character of line) {
    if (character === " ") width += 1;
    else if (character === "\t") width += indentUnit.length;
    else break;
  }
  return width;
}

function stripLeading(line: string, width: number): string {
  let consumed = 0;
  let index = 0;
  while (index < line.length && consumed < width) {
    const character = line[index];
    if (character === " ") consumed += 1;
    else if (character === "\t") consumed += indentUnit.length;
    else break;
    index += 1;
  }
  return line.slice(index);
}

function frameIndent(frames: readonly Frame[]): string {
  let depth = 0;
  for (const frame of frames) {
    if (!flatEnvironments.has(frame.environment)) depth += 1;
    if (frame.list && frame.itemOpen) depth += 1;
  }
  return indentUnit.repeat(depth);
}

function popTo(frames: Frame[], environment: string): void {
  const index = frames.map((frame) => frame.environment).lastIndexOf(environment);
  if (index >= 0) frames.splice(index);
}

/** Index of the line closing a block that `\begin{environment}` opens at `start`. */
function findBlockEnd(lines: readonly string[], start: number, environment: string) {
  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    for (const token of environmentTokens(lines[index])) {
      if (token.name !== environment) continue;
      depth += token.kind === "begin" ? 1 : -1;
      if (depth === 0) return index === start ? -1 : index;
    }
  }
  return -1;
}

/** Re-indents the source; blank-line rules run afterwards. */
function indentLines(lines: readonly string[]): OutputLine[] {
  const output: OutputLine[] = [];
  const frames: Frame[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      output.push({ text: "", kind: "blank" });
      continue;
    }

    // Leading \end{...} tokens close before this line is indented.
    let rest = trimmed;
    let leadingEnd: RegExpExecArray | null;
    while ((leadingEnd = leadingEndPattern.exec(rest))) {
      popTo(frames, leadingEnd[1].trim());
      rest = rest.slice(leadingEnd[0].length);
    }
    const top = frames.at(-1);
    const isItem = itemPattern.test(trimmed);
    if (isItem && top?.list) top.itemOpen = false;
    const indent = frameIndent(frames);
    if (isItem && top?.list) top.itemOpen = true;

    const tokens = environmentTokens(rest);
    const opener = trimmed.match(/^\\begin\s*\{([^}]+)\}/)?.[1].trim();

    // Verbatim and aligned blocks: the opening line is laid out, the body is
    // copied (verbatim) or moved as a whole (aligned).
    if (
      opener &&
      (verbatimEnvironments.has(opener) || alignedEnvironments.has(opener))
    ) {
      const end = findBlockEnd(lines, index, opener);
      if (end > index) {
        output.push({ text: `${indent}${trimmed}`, kind: "code" });
        const body = lines.slice(index + 1, end);
        if (verbatimEnvironments.has(opener)) {
          for (const bodyLine of body)
            output.push({ text: bodyLine, kind: "protected" });
        } else {
          const nonBlank = body.filter((bodyLine) => bodyLine.trim());
          const base = nonBlank.length ? Math.min(...nonBlank.map(leadingWidth)) : 0;
          const inner = indent + indentUnit;
          for (const bodyLine of body) {
            output.push({
              text: bodyLine.trim()
                ? `${inner}${stripLeading(bodyLine, base).trimEnd()}`
                : "",
              kind: "protected",
            });
          }
        }
        const closing = lines[end].trim();
        output.push({ text: `${indent}${closing}`, kind: "code" });
        // Whatever else the closing line opens or closes still counts.
        const closingTokens = environmentTokens(closing);
        const closeIndex = closingTokens.findIndex(
          (token) => token.kind === "end" && token.name === opener,
        );
        for (const token of closingTokens.slice(closeIndex + 1)) {
          if (token.kind === "begin") {
            frames.push({
              environment: token.name,
              list: listEnvironments.has(token.name),
              itemOpen: false,
            });
          } else {
            popTo(frames, token.name);
          }
        }
        index = end;
        continue;
      }
    }

    output.push({ text: `${indent}${trimmed}`, kind: "code" });
    for (const token of tokens) {
      if (token.kind === "begin") {
        frames.push({
          environment: token.name,
          list: listEnvironments.has(token.name),
          itemOpen: false,
        });
      } else {
        popTo(frames, token.name);
      }
    }
  }

  return output;
}

function isBeginLine(text: string): boolean {
  return /^\s*\\begin\s*\{/.test(text);
}

function isBodyBegin(text: string): boolean {
  const name = text
    .trim()
    .match(/^\\begin\s*\{([^}]+)\}/)?.[1]
    .trim();
  return Boolean(name && !flatEnvironments.has(name));
}

function isBodyEnd(text: string): boolean {
  const name = text
    .trim()
    .match(/^\\end\s*\{([^}]+)\}/)?.[1]
    .trim();
  return Boolean(name && !flatEnvironments.has(name));
}

function isComment(text: string): boolean {
  return text.trimStart().startsWith("%");
}

/** Blank-line rules: one around headings, none at the edges of environments. */
function spaceLines(lines: readonly OutputLine[]): string[] {
  const output: OutputLine[] = [];
  let afterHeading = false;
  let afterBegin = false;

  const dropTrailingBlanks = () => {
    while (output.at(-1)?.kind === "blank") output.pop();
  };

  for (const line of lines) {
    if (line.kind === "protected") {
      output.push(line);
      afterHeading = false;
      afterBegin = false;
      continue;
    }
    if (line.kind === "blank") {
      if (afterHeading || afterBegin || output.length === 0) continue;
      if (output.at(-1)?.kind === "blank") continue;
      output.push(line);
      continue;
    }

    const trimmed = line.text.trim();
    if (headingPattern.test(trimmed)) {
      dropTrailingBlanks();
      // Comments directly above a heading belong to it.
      let attach = output.length;
      while (
        attach > 0 &&
        output[attach - 1].kind === "code" &&
        isComment(output[attach - 1].text)
      ) {
        attach -= 1;
      }
      const before = output[attach - 1];
      if (before && before.kind !== "blank" && !isBeginLine(before.text)) {
        output.splice(attach, 0, { text: "", kind: "blank" });
      }
      output.push(line);
      afterHeading = true;
      afterBegin = false;
      continue;
    }

    if (isBodyEnd(trimmed) || (itemPattern.test(trimmed) && output.length)) {
      dropTrailingBlanks();
    }

    if (afterHeading) {
      if (labelPattern.test(trimmed)) {
        output.push(line);
        continue;
      }
      if (!isBodyEnd(trimmed)) output.push({ text: "", kind: "blank" });
      afterHeading = false;
    }

    output.push(line);
    afterBegin = isBodyBegin(trimmed);
  }

  dropTrailingBlanks();
  return output.map((line) => line.text);
}

/** The tidied source, or null when it is already tidy. */
export function tidyLatex(text: string): string | null {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const endsWithNewline = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  if (endsWithNewline) lines.pop();

  const tidied = spaceLines(indentLines(lines)).join(newline);
  const result = endsWithNewline ? `${tidied}${newline}` : tidied;
  return result === text ? null : result;
}
