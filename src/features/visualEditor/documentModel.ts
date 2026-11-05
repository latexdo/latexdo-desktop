import {
  findCommandArgument,
  findEnvironmentEnd,
  matchBrace,
  readCommand,
  stripComment,
} from "./latexSyntax";

/**
 * The visual editor's view of a .tex file. Only the body (between
 * \begin{document} and \end{document}) is shown; the preamble and the end
 * stay untouched. Each block keeps its exact source and the whitespace before
 * it, so serializing an unedited document returns it byte for byte.
 */

export type HeadingCommand =
  | "chapter"
  | "section"
  | "subsection"
  | "subsubsection"
  | "paragraph";
export type ListEnvironment = "itemize" | "enumerate" | "description";

export const headingCommands: HeadingCommand[] = [
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
];

export interface ListItem {
  content: string;
  /** \item[label] (description lists). */
  label?: string;
  children: ListNode[];
}

export interface ListNode {
  environment: ListEnvironment;
  items: ListItem[];
  /** Text after \begin{…} on its line, such as [label=(\alph*)]. */
  options: string;
  indent: string;
}

export type BlockData =
  | { kind: "paragraph"; text: string }
  | {
      kind: "heading";
      command: HeadingCommand;
      star: boolean;
      text: string;
      label: string;
    }
  | { kind: "list"; list: ListNode }
  | { kind: "abstract"; paragraphs: string[] }
  | { kind: "math" }
  | { kind: "figure" }
  | { kind: "table" }
  | { kind: "title" }
  | { kind: "command"; command: string }
  | { kind: "comment" }
  | { kind: "code" };

export type BlockKind = BlockData["kind"];

export interface DocBlock {
  /** Whitespace (newlines, blank lines) between the previous block and this one. */
  sep: string;
  /** The block's exact LaTeX. */
  source: string;
  data: BlockData;
}

export interface VisualDocument {
  /** Everything up to and including the \begin{document} line. */
  head: string;
  blocks: DocBlock[];
  /** Whitespace after the last block. */
  trailing: string;
  /** \end{document} and what follows. */
  tail: string;
}

/** Block kinds shown as self-contained objects rather than editable text. */
export const islandKinds = new Set<BlockKind>([
  "math",
  "figure",
  "table",
  "title",
  "command",
  "comment",
  "code",
]);

export function serializeDocument(document: VisualDocument): string {
  return (
    document.head +
    document.blocks.map((block) => block.sep + block.source).join("") +
    document.trailing +
    document.tail
  );
}

function splitDocument(content: string): { head: string; body: string; tail: string } {
  const begin = /^[ \t]*\\begin\{document\}[^\n]*(\n|$)/m.exec(content);
  if (!begin) return { head: "", body: content, tail: "" };
  const bodyStart = begin.index + begin[0].length;
  const endPattern = /^[ \t]*\\end\{document\}/gm;
  endPattern.lastIndex = bodyStart;
  const end = endPattern.exec(content);
  const bodyEnd = end ? end.index : content.length;
  return {
    head: content.slice(0, bodyStart),
    body: content.slice(bodyStart, bodyEnd),
    tail: content.slice(bodyEnd),
  };
}

const mathEnvironments = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "flalign",
  "flalign*",
  "eqnarray",
  "eqnarray*",
  "displaymath",
]);

const commandBlocks: Array<[RegExp, string]> = [
  [/^\\(?:newpage|clearpage|cleardoublepage|pagebreak)\b\s*$/, "pagebreak"],
  [/^\\tableofcontents\s*$/, "toc"],
  [/^\\listoffigures\s*$/, "lof"],
  [/^\\listoftables\s*$/, "lot"],
  [/^\\(?:bibliography\{[^}]*\}|printbibliography(?:\[[^\]]*\])?)\s*$/, "bibliography"],
  [/^\\bibliographystyle\{[^}]*\}\s*$/, "bibliographystyle"],
  [/^\\appendix\s*$/, "appendix"],
  [/^\\(?:input|include|subfile)\{[^}]*\}\s*$/, "include"],
];

export function parseHeadingLine(
  line: string,
): Extract<BlockData, { kind: "heading" }> | null {
  const trimmed = line.trim();
  const command = readCommand(trimmed, 0, 1);
  if (!command || !headingCommands.includes(command.name as HeadingCommand))
    return null;
  if (command.args.length !== 1 || command.options.length) return null;
  let rest = trimmed.slice(command.end).trim();
  let label = "";
  if (rest) {
    const labelCommand = readCommand(rest, 0, 1);
    if (
      !labelCommand ||
      labelCommand.name !== "label" ||
      labelCommand.args.length !== 1
    ) {
      return null;
    }
    label = labelCommand.args[0];
    rest = rest.slice(labelCommand.end).trim();
    if (rest) return null;
  }
  return {
    kind: "heading",
    command: command.name as HeadingCommand,
    star: command.star,
    text: command.args[0],
    label,
  };
}

export function headingSource(data: Extract<BlockData, { kind: "heading" }>): string {
  return `\\${data.command}${data.star ? "*" : ""}{${data.text}}${
    data.label ? `\\label{${data.label}}` : ""
  }`;
}

const listBegin = /^(\s*)\\begin\{(itemize|enumerate|description)\}(.*)$/;

/** Parses the list starting at `start`; null when it is not a plain list. */
export function parseList(
  lines: readonly string[],
  start: number,
  end: number,
): ListNode | null {
  const open = listBegin.exec(lines[start] ?? "");
  if (!open) return null;
  if (!new RegExp(`^\\s*\\\\end\\{${open[2]}\\}\\s*$`).test(lines[end] ?? ""))
    return null;
  const options = open[3] ?? "";
  if (options.trim() && !/^\s*\[[^\]]*\]\s*$/.test(options)) return null;
  const list: ListNode = {
    environment: open[2] as ListEnvironment,
    items: [],
    options: options.trim(),
    indent: open[1] ?? "",
  };
  let index = start + 1;
  while (index < end) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    const current = list.items[list.items.length - 1];
    if (listBegin.test(line)) {
      if (!current) return null;
      const nestedEnd = findEnvironmentEnd(lines, index, listBegin.exec(line)![2]);
      if (nestedEnd === -1 || nestedEnd >= end) return null;
      const nested = parseList(lines, index, nestedEnd);
      if (!nested) return null;
      current.children.push(nested);
      index = nestedEnd + 1;
      continue;
    }
    const item = /^\\item\b(\s*\[([^\]]*)\])?\s?(.*)$/.exec(trimmed);
    if (item) {
      list.items.push({
        content: item[3] ?? "",
        label: item[1] ? item[2] : undefined,
        children: [],
      });
      index += 1;
      continue;
    }
    // Text continuing an item, but not after its nested list or outside items.
    if (
      !current ||
      current.children.length ||
      /\\begin\{/.test(stripComment(trimmed))
    ) {
      return null;
    }
    current.content = current.content ? `${current.content}\n${trimmed}` : trimmed;
    index += 1;
  }
  return list;
}

export function listSource(list: ListNode, indent = list.indent): string {
  const inner = `${indent}  `;
  const lines = [`${indent}\\begin{${list.environment}}${list.options}`];
  for (const item of list.items) {
    const [first = "", ...rest] = item.content.split("\n");
    const label = item.label !== undefined ? `[${item.label}]` : "";
    lines.push(`${inner}\\item${label}${first ? ` ${first}` : ""}`);
    for (const line of rest) lines.push(`${inner}${line}`);
    for (const child of item.children) lines.push(listSource(child, inner));
  }
  lines.push(`${indent}\\end{${list.environment}}`);
  return lines.join("\n");
}

function parseAbstract(
  lines: readonly string[],
  start: number,
  end: number,
): string[] | null {
  if (!/^\s*\\begin\{abstract\}\s*$/.test(lines[start] ?? "")) return null;
  if (!/^\s*\\end\{abstract\}\s*$/.test(lines[end] ?? "")) return null;
  const inner = lines.slice(start + 1, end);
  if (inner.some((line) => /\\begin\{/.test(stripComment(line)))) return null;
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of inner) {
    if (!line.trim()) {
      if (current.length) paragraphs.push(current.join("\n"));
      current = [];
    } else {
      current.push(line.trim());
    }
  }
  if (current.length) paragraphs.push(current.join("\n"));
  return paragraphs.length ? paragraphs : [""];
}

export function abstractSource(paragraphs: readonly string[]): string {
  return ["\\begin{abstract}", paragraphs.join("\n\n"), "\\end{abstract}"].join("\n");
}

/** Whether a line starts a block of its own (ending a paragraph). */
function startsBlock(line: string): boolean {
  const trimmed = line.trim();
  return (
    !trimmed ||
    trimmed.startsWith("%") ||
    /^\\begin\{/.test(trimmed) ||
    /^\\end\{/.test(trimmed) ||
    trimmed === "\\[" ||
    trimmed === "\\maketitle" ||
    Boolean(parseHeadingLine(trimmed)) ||
    commandBlocks.some(([pattern]) => pattern.test(trimmed))
  );
}

function blockForRange(
  lines: readonly string[],
  start: number,
  end: number,
): BlockData {
  const first = (lines[start] ?? "").trim();
  const environment = /^\\begin\{([^}]+)\}/.exec(first)?.[1];
  if (environment) {
    if (/^(itemize|enumerate|description)$/.test(environment)) {
      const list = parseList(lines, start, end);
      return list ? { kind: "list", list } : { kind: "code" };
    }
    if (environment === "abstract") {
      const paragraphs = parseAbstract(lines, start, end);
      return paragraphs ? { kind: "abstract", paragraphs } : { kind: "code" };
    }
    if (mathEnvironments.has(environment)) {
      return isMathSource(lines.slice(start, end + 1).join("\n"))
        ? { kind: "math" }
        : { kind: "code" };
    }
    if (environment === "figure" || environment === "figure*") {
      return parseFigure(lines.slice(start, end + 1).join("\n"))
        ? { kind: "figure" }
        : { kind: "code" };
    }
    if (
      environment === "table" ||
      environment === "table*" ||
      environment === "tabular"
    ) {
      return parseTable(lines.slice(start, end + 1).join("\n"))
        ? { kind: "table" }
        : { kind: "code" };
    }
    return { kind: "code" };
  }
  if (first === "\\[") {
    return isMathSource(lines.slice(start, end + 1).join("\n"))
      ? { kind: "math" }
      : { kind: "code" };
  }
  return { kind: "code" };
}

export function parseDocument(content: string): VisualDocument {
  const normalized = content.replace(/\r\n?/g, "\n");
  const { head, body, tail } = splitDocument(normalized);
  const lines = body.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const lineEnd = (index: number) => lineStarts[index] + lines[index].length;

  const blocks: DocBlock[] = [];
  let previousEnd = 0;
  const push = (start: number, end: number, data: BlockData) => {
    const from = lineStarts[start];
    const to = lineEnd(end);
    blocks.push({
      sep: body.slice(previousEnd, from),
      source: body.slice(from, to),
      data,
    });
    previousEnd = to;
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("%")) {
      let end = index;
      while (end + 1 < lines.length && lines[end + 1].trim().startsWith("%")) end += 1;
      push(index, end, { kind: "comment" });
      index = end + 1;
      continue;
    }

    const environment = /^\\begin\{([^}]+)\}/.exec(trimmed)?.[1];
    if (environment) {
      const end = findEnvironmentEnd(lines, index, environment);
      const last = end === -1 ? lines.length - 1 : end;
      push(
        index,
        last,
        end === -1 ? { kind: "code" } : blockForRange(lines, index, last),
      );
      index = last + 1;
      continue;
    }
    if (trimmed === "\\[") {
      let end = index + 1;
      while (end < lines.length && lines[end].trim() !== "\\]") end += 1;
      const last = Math.min(end, lines.length - 1);
      push(
        index,
        last,
        end < lines.length ? blockForRange(lines, index, last) : { kind: "code" },
      );
      index = last + 1;
      continue;
    }
    if (/^\\end\{/.test(trimmed)) {
      push(index, index, { kind: "code" });
      index += 1;
      continue;
    }

    const heading = parseHeadingLine(trimmed);
    if (heading) {
      push(index, index, heading);
      index += 1;
      continue;
    }
    if (trimmed === "\\maketitle") {
      push(index, index, { kind: "title" });
      index += 1;
      continue;
    }
    const command = commandBlocks.find(([pattern]) => pattern.test(trimmed));
    if (command) {
      push(index, index, { kind: "command", command: command[1] });
      index += 1;
      continue;
    }

    let end = index;
    while (end + 1 < lines.length && !startsBlock(lines[end + 1])) end += 1;
    push(index, end, {
      kind: "paragraph",
      text: lines.slice(index, end + 1).join("\n"),
    });
    index = end + 1;
  }

  return { head, blocks, trailing: body.slice(previousEnd), tail };
}

// ---------- display math ----------

export interface MathParts {
  open: string;
  body: string;
  close: string;
  environment: string;
}

/** Splits display math whose \begin and \end sit on their own lines. */
export function splitMath(source: string): MathParts | null {
  const lines = source.split("\n");
  if (lines.length < 2) return null;
  const open = lines[0];
  const close = lines[lines.length - 1];
  const trimmedOpen = open.trim();
  const environment =
    trimmedOpen === "\\["
      ? "display"
      : /^\\begin\{([^}]+)\}\s*$/.exec(trimmedOpen)?.[1];
  if (!environment) return null;
  const expectedClose = environment === "display" ? "\\]" : `\\end{${environment}}`;
  if (close.trim() !== expectedClose) return null;
  return { open, close, environment, body: lines.slice(1, -1).join("\n") };
}

function isMathSource(source: string): boolean {
  return splitMath(source) !== null;
}

export function mathSource(parts: MathParts, body: string): string {
  return [parts.open, body, parts.close].join("\n");
}

/** TeX MathJax can render for an environment's body. */
export function mathPreviewTex(parts: MathParts): string {
  const body = parts.body
    .replace(/\\label\{[^}]*\}/g, "")
    .replace(/\\(?:nonumber|notag)\b/g, "");
  const base = parts.environment.replace("*", "");
  if (base === "align" || base === "flalign" || base === "eqnarray") {
    return `\\begin{aligned}${body}\\end{aligned}`;
  }
  if (base === "gather") return `\\begin{gathered}${body}\\end{gathered}`;
  if (base === "multline") return `\\begin{gathered}${body}\\end{gathered}`;
  return body;
}

// ---------- figures ----------

export interface FigureParts {
  imagePath: string;
  /** Range of the path inside the source. */
  pathRange: [number, number];
  options: string;
  optionsRange: [number, number] | null;
  /** Index just after \includegraphics (where options go if there are none). */
  includeNameEnd: number;
  caption: string | null;
  captionRange: [number, number] | null;
  label: string;
  includeLineEnd: number;
}

export function parseFigure(source: string): FigureParts | null {
  const matches = [...source.matchAll(/\\includegraphics\*?/g)];
  if (matches.length !== 1) return null;
  const inner = source.replace(/^[^\n]*\n/, "").replace(/\n[^\n]*$/, "");
  if (/\\begin\{(?!center\})/.test(stripCommentsOf(inner))) return null;
  const match = matches[0];
  let index = match.index + match[0].length;
  let options = "";
  let optionsRange: [number, number] | null = null;
  while (source[index] === " ") index += 1;
  if (source[index] === "[") {
    const end = matchBrace(source, index);
    if (end === -1) return null;
    options = source.slice(index + 1, end);
    optionsRange = [index + 1, end];
    index = end + 1;
  }
  while (source[index] === " ") index += 1;
  if (source[index] !== "{") return null;
  const pathEnd = matchBrace(source, index);
  if (pathEnd === -1) return null;
  const caption = findCommandArgument(source, "caption");
  const label = findCommandArgument(source, "label");
  const lineEnd = source.indexOf("\n", pathEnd);
  return {
    imagePath: source.slice(index + 1, pathEnd).trim(),
    pathRange: [index + 1, pathEnd],
    options,
    optionsRange,
    includeNameEnd: match.index + match[0].length,
    caption: caption ? source.slice(caption.argStart, caption.argEnd) : null,
    captionRange: caption ? [caption.argStart, caption.argEnd] : null,
    label: label ? source.slice(label.argStart, label.argEnd) : "",
    includeLineEnd: lineEnd === -1 ? source.length : lineEnd,
  };
}

function stripCommentsOf(text: string): string {
  return text.split("\n").map(stripComment).join("\n");
}

function replaceRange(source: string, range: [number, number], value: string): string {
  return source.slice(0, range[0]) + value + source.slice(range[1]);
}

function lineIndent(source: string, index: number): string {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  return /^[ \t]*/.exec(source.slice(lineStart))?.[0] ?? "";
}

/** Sets a float's caption, adding \caption{…} when it has none. */
export function setCaption(
  source: string,
  caption: string,
  afterIndex: number,
): string {
  const existing = findCommandArgument(source, "caption");
  if (existing)
    return replaceRange(source, [existing.argStart, existing.argEnd], caption);
  if (!caption) return source;
  const lineEnd = source.indexOf("\n", afterIndex);
  const at = lineEnd === -1 ? source.length : lineEnd;
  return `${source.slice(0, at)}\n${lineIndent(source, afterIndex)}\\caption{${caption}}${source.slice(at)}`;
}

export function setFigureCaption(source: string, caption: string): string {
  const parts = parseFigure(source);
  return parts ? setCaption(source, caption, parts.includeLineEnd - 1) : source;
}

/** The figure's width as a fraction of the text width, when it says so. */
export function figureWidth(options: string): number | null {
  const match =
    /(?:^|,)\s*width\s*=\s*([0-9.]*)\s*\\(?:textwidth|linewidth|columnwidth)/.exec(
      options,
    );
  if (!match) return null;
  return match[1] ? Number(match[1]) : 1;
}

export function setFigureWidth(source: string, fraction: number): string {
  const parts = parseFigure(source);
  if (!parts) return source;
  const value = `width=${Number(fraction.toFixed(2))}\\linewidth`;
  if (!parts.optionsRange) {
    return `${source.slice(0, parts.includeNameEnd)}[${value}]${source.slice(parts.includeNameEnd)}`;
  }
  const options = parts.options
    .split(",")
    .map((option) => option.trim())
    .filter((option) => option && !/^(?:width|scale)\s*=/.test(option));
  return replaceRange(source, parts.optionsRange, [value, ...options].join(", "));
}

export function setFigureImage(source: string, imagePath: string): string {
  const parts = parseFigure(source);
  return parts ? replaceRange(source, parts.pathRange, imagePath) : source;
}

// ---------- tables ----------

export interface TableRow {
  cells: string[];
  /** Rule commands (\hline, \toprule…) on the lines before this row. */
  rulesBefore: string[];
}

export interface TableParts {
  spec: string;
  specRange: [number, number];
  bodyRange: [number, number];
  rows: TableRow[];
  trailingRules: string[];
  columns: number;
  /** Whether the column spec is simple enough to add or remove columns. */
  simpleSpec: boolean;
  caption: string | null;
  tabularEnd: number;
  indent: string;
}

const rulePattern = /^\\(?:hline|toprule|midrule|bottomrule)(?:\[[^\]]*\])?$/;

function splitTopLevel(text: string, separator: "&" | "\\\\"): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      if (separator === "\\\\" && text[index + 1] === "\\" && depth === 0) {
        parts.push(text.slice(last, index));
        index += 1;
        // An optional spacing argument belongs to the row break.
        const spacing = /^\s*\[[^\]]*\]/.exec(text.slice(index + 1));
        if (spacing) index += spacing[0].length;
        last = index + 1;
        continue;
      }
      index += 1;
      continue;
    }
    if (char === "%") {
      const newline = text.indexOf("\n", index);
      index = newline === -1 ? text.length : newline;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    if (depth < 0) return null;
    if (char === "&" && separator === "&" && depth === 0) {
      parts.push(text.slice(last, index));
      last = index + 1;
    }
  }
  if (depth !== 0) return null;
  parts.push(text.slice(last));
  return parts;
}

function countColumns(spec: string): { count: number; simple: boolean } {
  let count = 0;
  let simple = true;
  for (let index = 0; index < spec.length; index += 1) {
    const char = spec[index];
    if ("lcrX".includes(char)) count += 1;
    else if ("pmb".includes(char)) {
      count += 1;
      const end = matchBrace(spec, index + 1);
      if (end === -1) return { count: -1, simple: false };
      index = end;
    } else if ("@!><".includes(char)) {
      simple = false;
      const end = matchBrace(spec, index + 1);
      if (end === -1) return { count: -1, simple: false };
      index = end;
    } else if (char === "*") {
      return { count: -1, simple: false };
    } else if (!"| \t".includes(char)) {
      return { count: -1, simple: false };
    }
  }
  return { count, simple };
}

export function parseTable(source: string): TableParts | null {
  const begin = /\\begin\{tabular\}\s*(?:\[[^\]]*\])?\s*\{/.exec(source);
  if (!begin) return null;
  if ((source.match(/\\begin\{tabular\}/g) ?? []).length !== 1) return null;
  const specOpen = begin.index + begin[0].length - 1;
  const specClose = matchBrace(source, specOpen);
  if (specClose === -1) return null;
  const endIndex = source.indexOf("\\end{tabular}", specClose);
  if (endIndex === -1) return null;
  const spec = source.slice(specOpen + 1, specClose);
  const { count, simple } = countColumns(spec);
  if (count <= 0) return null;
  const body = source.slice(specClose + 1, endIndex);
  if (/\\(?:multicolumn|multirow|cline|cmidrule|begin)\b/.test(body)) return null;
  const rawRows = splitTopLevel(body, "\\\\");
  if (!rawRows) return null;

  const rows: TableRow[] = [];
  let pendingRules: string[] = [];
  for (const raw of rawRows) {
    const lines = raw.split("\n").map((line) => stripComment(line).trim());
    const content: string[] = [];
    for (const line of lines) {
      if (!line) continue;
      // Rules may share a line with the row that follows them.
      let rest = line;
      for (
        let rule = /^\\(?:hline|toprule|midrule|bottomrule)(?:\[[^\]]*\])?/.exec(rest);
        rule;
        rule = /^\\(?:hline|toprule|midrule|bottomrule)(?:\[[^\]]*\])?/.exec(rest)
      ) {
        if (content.length) return null;
        pendingRules.push(rule[0]);
        rest = rest.slice(rule[0].length).trim();
      }
      if (rest) content.push(rest);
    }
    if (!content.length) continue;
    const cells = splitTopLevel(content.join(" "), "&");
    if (!cells || cells.length > count) return null;
    rows.push({ cells: cells.map((cell) => cell.trim()), rulesBefore: pendingRules });
    pendingRules = [];
  }
  if (pendingRules.some((rule) => !rulePattern.test(rule))) return null;
  for (const row of rows) {
    while (row.cells.length < count) row.cells.push("");
  }
  return {
    spec,
    specRange: [specOpen + 1, specClose],
    bodyRange: [specClose + 1, endIndex],
    rows,
    trailingRules: pendingRules,
    columns: count,
    simpleSpec: simple,
    caption: findCommandArgument(source, "caption")
      ? source.slice(
          findCommandArgument(source, "caption")!.argStart,
          findCommandArgument(source, "caption")!.argEnd,
        )
      : null,
    tabularEnd: endIndex + "\\end{tabular}".length,
    indent: lineIndent(source, endIndex),
  };
}

/** Writes rows back into the tabular, keeping everything around it. */
export function setTableRows(
  source: string,
  rows: readonly TableRow[],
  trailingRules: readonly string[],
  columns: number,
): string {
  const parts = parseTable(source);
  if (!parts) return source;
  const rowIndent = `${parts.indent}  `;
  const lines: string[] = [];
  for (const row of rows) {
    for (const rule of row.rulesBefore) lines.push(`${rowIndent}${rule}`);
    const cells = Array.from({ length: columns }, (_, index) => row.cells[index] ?? "");
    lines.push(`${rowIndent}${cells.join(" & ")} \\\\`);
  }
  for (const rule of trailingRules) lines.push(`${rowIndent}${rule}`);
  let next = replaceRange(
    source,
    parts.bodyRange,
    `\n${lines.join("\n")}\n${parts.indent}`,
  );
  if (columns !== parts.columns && parts.simpleSpec) {
    next = replaceRange(next, parts.specRange, resizeSpec(parts.spec, columns));
  }
  return next;
}

function resizeSpec(spec: string, columns: number): string {
  const tokens = spec.match(/[lcrX]|[pmb]\{[^}]*\}/g) ?? [];
  if (columns < tokens.length) {
    // Drop column letters from the end, keeping the rules around them.
    let toRemove = tokens.length - columns;
    let result = spec;
    while (toRemove > 0) {
      const last = Math.max(
        result.lastIndexOf("l"),
        result.lastIndexOf("c"),
        result.lastIndexOf("r"),
        result.lastIndexOf("X"),
      );
      result = result.slice(0, last) + result.slice(last + 1);
      result = result.replace(/\|\|$/, "|");
      toRemove -= 1;
    }
    return result;
  }
  const extra = "l".repeat(columns - tokens.length);
  const separated = /\|\s*$/.test(spec) && /\|/.test(spec.slice(0, -1));
  return separated ? `${spec}${extra.split("").join("|")}|` : `${spec}${extra}`;
}

export function setTableCaption(source: string, caption: string): string {
  const parts = parseTable(source);
  if (!parts) return source;
  // Bare tabulars have nowhere to put a caption.
  if (!/\\begin\{table\*?\}/.test(source)) return source;
  return setCaption(source, caption, parts.tabularEnd);
}

// ---------- title (\maketitle) ----------

export interface TitleParts {
  title: string | null;
  author: string | null;
  date: string | null;
}

export function readTitleParts(head: string): TitleParts {
  const read = (name: string) => {
    const found = findCommandArgument(head, name);
    return found ? head.slice(found.argStart, found.argEnd) : null;
  };
  return { title: read("title"), author: read("author"), date: read("date") };
}

export function setTitlePart(
  head: string,
  name: "title" | "author" | "date",
  value: string,
): string {
  const found = findCommandArgument(head, name);
  if (found) return replaceRange(head, [found.argStart, found.argEnd], value);
  // Add the command just before \begin{document}.
  const begin = head.search(/^[ \t]*\\begin\{document\}/m);
  const at = begin === -1 ? head.length : begin;
  return `${head.slice(0, at)}\\${name}{${value}}\n${head.slice(at)}`;
}

/** New blocks, in the shape the editor inserts them. */
export const blockTemplates = {
  table: [
    "\\begin{table}[ht]",
    "  \\centering",
    "  \\begin{tabular}{lll}",
    "    \\hline",
    "    Column 1 & Column 2 & Column 3 \\\\",
    "    \\hline",
    "     &  &  \\\\",
    "     &  &  \\\\",
    "    \\hline",
    "  \\end{tabular}",
    "  \\caption{}",
    "\\end{table}",
  ].join("\n"),
  equation: "\\begin{equation}\n\n\\end{equation}",
  pagebreak: "\\newpage",
};

export { readCommand };
