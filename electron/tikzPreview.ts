import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { latexPackageInstallAdvice } from "./texInstallAdvice.js";
import type { CompileRequest, CompileResult, Diagnostic } from "./types.js";

type CompileEngine = CompileRequest["engine"];

/** The largest TikZ snippet compiled for a preview. */
export const maxTikzSnippetLength = 200_000;

/**
 * Libraries loaded for a snippet that has no preamble of its own. Pasted
 * figures often use them without saying so; loading them is harmless and
 * makes most snippets compile as they are.
 */
export const defaultTikzLibraries = [
  "arrows.meta",
  "positioning",
  "calc",
  "shapes.geometric",
  "shapes.misc",
  "decorations.pathmorphing",
  "decorations.markings",
  "backgrounds",
  "fit",
  "patterns",
  "matrix",
  "shadows",
];

const preambleCommand =
  /^\\(usetikzlibrary|usepackage|tikzset|tikzstyle|pgfplotsset|definecolor|colorlet|newcommand|renewcommand|providecommand|def|pgfmathsetmacro|usepgfplotslibrary)\b/;

export interface TikzDocument {
  source: string;
  /** For each line of `source` (index = line - 1): the user's line, or 0. */
  lineMap: number[];
  /** True when the snippet already was a full document. */
  fullDocument: boolean;
}

function braceBalance(line: string): number {
  let balance = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "%") break;
    if (char === "{") balance += 1;
    else if (char === "}") balance -= 1;
  }
  return balance;
}

/**
 * Turns what the user typed into a document LaTeX can compile: a full
 * document is used as it is; otherwise preamble commands (libraries, styles,
 * colours) go to the preamble and the drawing goes in a tikzpicture of a
 * standalone page.
 */
export function buildTikzDocument(code: string): TikzDocument {
  const userLines = code.replace(/\r\n?/g, "\n").split("\n");
  if (/\\documentclass\b/.test(code)) {
    return {
      source: userLines.join("\n"),
      lineMap: userLines.map((_line, index) => index + 1),
      fullDocument: true,
    };
  }

  const preamble: Array<{ text: string; line: number }> = [];
  const body: Array<{ text: string; line: number }> = [];
  let pendingBalance = 0;
  let inPreambleCommand = false;
  userLines.forEach((text, index) => {
    const line = index + 1;
    const trimmed = text.trim();
    if (inPreambleCommand) {
      preamble.push({ text, line });
      pendingBalance += braceBalance(text);
      if (pendingBalance <= 0) inPreambleCommand = false;
      return;
    }
    if (preambleCommand.test(trimmed)) {
      preamble.push({ text, line });
      pendingBalance = braceBalance(text);
      inPreambleCommand = pendingBalance > 0;
      return;
    }
    body.push({ text, line });
  });

  const bodyText = body.map((entry) => entry.text).join("\n");
  const hasPicture = /\\begin\{tikzpicture\}/.test(bodyText);
  const usesPgfplots = /\\begin\{(?:semilog[xy])?(?:log)?axis\}|\\addplot\b/.test(code);
  const loadsPgfplots = /\\usepackage(?:\[[^\]]*\])?\{[^}]*\bpgfplots\b/.test(code);

  const lines: Array<{ text: string; line: number }> = [
    { text: "\\documentclass[border=8pt]{standalone}", line: 0 },
    { text: "\\usepackage{tikz}", line: 0 },
    { text: `\\usetikzlibrary{${defaultTikzLibraries.join(",")}}`, line: 0 },
  ];
  if (usesPgfplots && !loadsPgfplots) {
    lines.push({ text: "\\usepackage{pgfplots}", line: 0 });
    lines.push({ text: "\\pgfplotsset{compat=newest}", line: 0 });
  }
  lines.push(...preamble);
  lines.push({ text: "\\begin{document}", line: 0 });
  if (!hasPicture) lines.push({ text: "\\begin{tikzpicture}", line: 0 });
  lines.push(...body);
  if (!hasPicture) lines.push({ text: "\\end{tikzpicture}", line: 0 });
  lines.push({ text: "\\end{document}", line: 0 });

  return {
    source: lines.map((entry) => entry.text).join("\n") + "\n",
    lineMap: lines.map((entry) => entry.line),
    fullDocument: false,
  };
}

/** Which library provides an option or shape TikZ did not recognise. */
const libraryForKey: Array<[RegExp, string]> = [
  [
    /^(?:above|below|left|right)(?: (?:left|right))?$|^node distance$|=of\b/,
    "positioning",
  ],
  [/^(?:state|initial|accepting)(?: .*)?$/, "automata"],
  [/^(?:mindmap|concept|concept color)$/, "mindmap"],
  [/^(?:circuit|resistor|inductor|capacitor)/, "circuits.ee.IEC"],
  [/^(?:decorate|decoration)$/, "decorations.pathmorphing"],
  [/^(?:spy|spy using)/, "spy"],
  [/^(?:3d|canvas is)/, "3d"],
  [/^(?:intersection|name intersections)/, "intersections"],
  [/^(?:tree|edge from parent|level)/, "trees"],
];

export interface TikzError {
  /** Line in the user's code, or null when the error is in generated code. */
  line: number | null;
  message: string;
  /** What it means in plain words, and what to do. */
  hint?: string;
  /** The user's line, for context. */
  sourceLine?: string;
}

/** A plain-language explanation of a LaTeX/TikZ error, when one is known. */
export function explainTikzError(message: string, output = ""): string | undefined {
  const text = `${message}\n${output}`;
  const unknownKey = text.match(/I do not know the key '\/tikz\/([^']+)'/);
  if (unknownKey) {
    const key = unknownKey[1].replace(/\s*'.*$/, "");
    const library = libraryForKey.find(([pattern]) => pattern.test(key))?.[1];
    return library
      ? `TikZ does not know the option “${key}”. It comes from a library: add \\usetikzlibrary{${library}} at the top of your code.`
      : `TikZ does not know the option “${key}”. Check its spelling, or add the \\usetikzlibrary{…} it comes from at the top of your code.`;
  }
  const unknownShape = text.match(/I do not know the shape named `([^']+)'/);
  if (unknownShape) {
    return `TikZ does not know the shape “${unknownShape[1]}”. Shapes such as diamond, star or trapezium need \\usetikzlibrary{shapes.geometric}; check the name.`;
  }
  if (/Giving up on this path\. Did you forget a semicolon\?/.test(text)) {
    return "A path command (\\draw, \\fill, \\path, \\node…) does not end with “;”. Add the semicolon at the end of the command on this line or the one before.";
  }
  if (/Cannot parse this coordinate/.test(text)) {
    return "A coordinate is malformed. Coordinates look like (1,2), (30:1cm) or (A) for a named node; check brackets and commas.";
  }
  if (/No shape named `?([^' ]+)'? is known/.test(text)) {
    const name = text.match(/No shape named `?([^' ]+)'? is known/)![1];
    return `Nothing is named “${name}”. A node must be defined with \\node (${name}) … before a line refers to it.`;
  }
  const undefinedCommand = text.match(
    /Undefined control sequence[\s\S]*?(\\[A-Za-z@]+)\s*$/m,
  );
  if (/Undefined control sequence/.test(text)) {
    const command = undefinedCommand?.[1];
    return command
      ? `LaTeX does not know the command ${command}. Check its spelling, or load the package that defines it with \\usepackage{…} at the top of your code.`
      : "LaTeX does not know a command on this line. Check its spelling, or load the package that defines it.";
  }
  const missingFile = text.match(/File `([^']+)' not found/);
  if (missingFile) {
    const packageName = missingFile[1].replace(/\.[^.]+$/, "");
    return `The file ${missingFile[1]} is not installed in your TeX distribution. ${latexPackageInstallAdvice(packageName)}, or remove the line that loads it.`;
  }
  if (/Missing \$ inserted/.test(text)) {
    return "Math (like ^, _ or \\alpha) is used outside math mode. Put it between $…$, for example node {$x^2$}.";
  }
  if (/Missing \} inserted|Extra \}|Missing \{ inserted|Runaway argument/.test(text)) {
    return "The braces { } do not match. Every { needs its }.";
  }
  if (/Package pgfkeys Error/.test(text)) {
    return "An option in [ ] is not valid. Check the spelling of each option on this line.";
  }
  if (/Dimension too large/.test(text)) {
    return "A number is too large for TeX: the figure goes very far off. Check the coordinates and scale.";
  }
  if (/Emergency stop|Fatal error occurred/.test(text)) {
    return "LaTeX stopped early. The first error above is the one to fix.";
  }
  return undefined;
}

function sourceFileIsSnippet(file: string): boolean {
  return path.basename(file) === "figure.tex";
}

/** The user's line for a line of the compiled document. */
export function userLineFor(document: TikzDocument, line: number): number | null {
  if (line < 1) return null;
  const mapped = document.lineMap[Math.min(line, document.lineMap.length) - 1];
  if (mapped) return mapped;
  // LaTeX reports a missing ; or } on the line that closes the picture:
  // point at the last line of the drawing instead.
  for (
    let index = Math.min(line, document.lineMap.length) - 1;
    index >= 0;
    index -= 1
  ) {
    if (document.lineMap[index]) return document.lineMap[index];
  }
  return null;
}

export function tikzErrorsFromResult(
  document: TikzDocument,
  code: string,
  result: Pick<CompileResult, "diagnostics" | "output" | "error">,
): TikzError[] {
  const userLines = code.replace(/\r\n?/g, "\n").split("\n");
  const errors: TikzError[] = [];
  const seen = new Set<string>();
  for (const diagnostic of result.diagnostics as Diagnostic[]) {
    if (diagnostic.severity !== "error") continue;
    const line = sourceFileIsSnippet(diagnostic.file)
      ? userLineFor(document, diagnostic.line)
      : null;
    const key = `${line}:${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const message = diagnostic.message.replace(/^!\s*/, "");
    const local = `${message}\n${diagnostic.compilerExcerpt ?? ""}\n${diagnostic.detail ?? ""}`;
    errors.push({
      line,
      message,
      // The error's own text first; the whole log only when it says nothing.
      hint:
        explainTikzError(local) ??
        explainTikzError(local, result.output) ??
        diagnostic.suggestion,
      sourceLine: line ? userLines[line - 1]?.trim() : undefined,
    });
  }
  // "Fatal error occurred, no output PDF" only repeats that the build failed.
  const stopNotice = /Fatal error occurred|Emergency stop/;
  const real = errors.filter((error) => !stopNotice.test(error.message));
  if (real.length) errors.splice(0, errors.length, ...real);
  if (!errors.length) {
    // No file:line error (a missing package, no TeX installed): explain the
    // first message LaTeX printed.
    const first =
      result.output.match(/^! (.+)$/m)?.[1] ??
      result.output.match(/^(.*File `[^']+' not found.*)$/m)?.[1] ??
      result.error ??
      "LaTeX could not build the figure.";
    errors.push({
      line: null,
      message: first,
      hint: explainTikzError(first, result.output),
    });
  }
  return errors;
}

export interface TikzPreviewResult {
  ok: boolean;
  pdf?: Uint8Array;
  errors: TikzError[];
  output: string;
  /** The document that was compiled, so the user can see what was added. */
  source: string;
  durationMs: number;
}

export interface TikzPreviewOptions {
  code: string;
  engine: CompileEngine;
  /** A scratch folder owned by the app; each run gets its own subfolder. */
  scratchRoot: string;
  signal?: AbortSignal;
  compile: (
    request: { projectPath: string; rootFile: string; engine: CompileEngine },
    signal?: AbortSignal,
  ) => Promise<CompileResult>;
}

export async function compileTikzPreview(
  options: TikzPreviewOptions,
): Promise<TikzPreviewResult> {
  const document = buildTikzDocument(options.code);
  const folder = path.join(options.scratchRoot, randomUUID());
  await mkdir(folder, { recursive: true });
  try {
    await writeFile(path.join(folder, "figure.tex"), document.source, "utf8");
    const result = await options.compile(
      { projectPath: folder, rootFile: "figure.tex", engine: options.engine },
      options.signal,
    );
    const pdf =
      result.ok && result.pdfPath
        ? await readFile(result.pdfPath).catch(() => null)
        : null;
    if (pdf) {
      return {
        ok: true,
        pdf: new Uint8Array(pdf),
        errors: [],
        output: result.output,
        source: document.source,
        durationMs: result.durationMs,
      };
    }
    return {
      ok: false,
      errors: tikzErrorsFromResult(document, options.code, result),
      output: result.output,
      source: document.source,
      durationMs: result.durationMs,
    };
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
}
