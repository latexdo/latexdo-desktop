import type { Diagnostic, DiagnosticContextLine, DiagnosticFix } from "./types.js";

interface DiagnosticAnalysis {
  title: string;
  detail: string;
  suggestion?: string;
  message?: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  locationAccuracy: "exact" | "inferred" | "line";
  highlightText?: string;
  sourceLine?: string;
  sourceContext?: DiagnosticContextLine[];
  reportedLine: number;
  reportedColumn: number;
  originReason?: string;
  locationConfidence: number;
  fixes?: DiagnosticFix[];
}

interface LocatedToken {
  line?: number;
  start: number;
  end: number;
  text: string;
  accuracy: "exact" | "inferred";
  reason?: string;
  confidence?: number;
}

const mathCommands =
  /\\(?:alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|rho|sigma|tau|phi|chi|psi|omega|frac|sqrt|sum|prod|int|lim|left|right|mathrm|mathbf|mathit|mathcal)\b/;

const commonCommands = [
  "author",
  "begin",
  "caption",
  "chapter",
  "cite",
  "date",
  "documentclass",
  "emph",
  "end",
  "frac",
  "include",
  "includegraphics",
  "input",
  "item",
  "label",
  "maketitle",
  "paragraph",
  "ref",
  "section",
  "sqrt",
  "subsection",
  "subsubsection",
  "textbf",
  "textit",
  "title",
  "usepackage",
] as const;

const commonEnvironments = [
  "align",
  "align*",
  "array",
  "center",
  "description",
  "document",
  "enumerate",
  "equation",
  "equation*",
  "figure",
  "itemize",
  "table",
  "tabular",
  "theorem",
  "verbatim",
] as const;

const unicodeReplacements: Record<string, { replacement: string; label: string }> = {
  "\u00a0": { replacement: "~", label: "Replace with a non-breaking LaTeX space" },
  "\u2013": { replacement: "--", label: "Replace with a LaTeX en dash" },
  "\u2014": { replacement: "---", label: "Replace with a LaTeX em dash" },
  "\u2018": { replacement: "`", label: "Replace with a LaTeX opening quote" },
  "\u2019": { replacement: "'", label: "Replace with a LaTeX closing quote" },
  "\u201c": { replacement: "``", label: "Replace with LaTeX opening quotes" },
  "\u201d": { replacement: "''", label: "Replace with LaTeX closing quotes" },
  "\u2026": { replacement: "\\ldots{}", label: "Replace with \\ldots{}" },
};

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function uniqueNearMatch(value: string, candidates: readonly string[]): string | null {
  const ranked = candidates
    .map((candidate) => ({ candidate, distance: editDistance(value, candidate) }))
    .sort((left, right) => left.distance - right.distance);
  if (!ranked.length || ranked[0].distance > 1) {
    return null;
  }
  return ranked[1]?.distance === ranked[0].distance ? null : ranked[0].candidate;
}

function locationText(diagnostic: Diagnostic): string {
  const file = diagnostic.file || "the source file";
  return `${file}, line ${diagnostic.line}`;
}

function findLiteral(line: string, value: string | null): LocatedToken | null {
  if (!value) {
    return null;
  }

  const start = line.indexOf(value);
  return start >= 0
    ? {
        start,
        end: start + value.length,
        text: value,
        accuracy: "exact",
        reason: `The compiler named ${value}, and that exact text occurs here.`,
        confidence: 100,
      }
    : null;
}

function findPattern(line: string, pattern: RegExp): LocatedToken | null {
  const match = line.match(pattern);
  if (!match || match.index === undefined) {
    return null;
  }

  const text = match[0];
  return {
    start: match.index,
    end: match.index + Math.max(1, text.length),
    text,
    accuracy: "inferred",
    reason: `This token matches the syntax described by the compiler error.`,
    confidence: 88,
  };
}

function findUnescapedCharacter(line: string, character: string): LocatedToken | null {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== character) {
      continue;
    }

    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 0) {
      return {
        start: index,
        end: index + 1,
        text: character,
        accuracy: "inferred",
        reason: `This is the first unescaped ${character} on the reported line.`,
        confidence: 90,
      };
    }
  }

  return null;
}

function commandFromOutput(output: string, lineNumber: number): string | null {
  const escapedLine = String(lineNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lineMatch = output.match(new RegExp(`l\\.${escapedLine}\\s*(.*)`));
  return lineMatch?.[1]?.match(/\\[A-Za-z@]+|\\./)?.[0] ?? null;
}

function quotedValue(message: string, label: string): string | null {
  const patterns = [
    new RegExp(`${label}\\s+['\`]([^'\`]+)['\`]`, "i"),
    new RegExp(`${label}\\s+“([^”]+)”`, "i"),
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function missingFileName(message: string): string | null {
  return message.match(/file\s+[`']([^`']+)[`']\s+not found/i)?.[1] ?? null;
}

const lowInformationMessagePattern =
  /^(?:emergency stop|fatal error occurred|==>\s*fatal error|interruption|job aborted|runaway argument\??$)/i;

/**
 * Messages like "Emergency stop." carry no information about the actual
 * problem. The real cause is almost always an explicit error earlier in the
 * compiler log, so surface that instead.
 */
function resolveUnderlyingErrorMessage(message: string, output: string): string | null {
  if (!lowInformationMessagePattern.test(message.trim())) {
    return null;
  }

  for (const line of output.split(/\r?\n/)) {
    const bangMatch = line.match(/^!\s*(.+)$/);
    const fileLineMatch = line.match(
      /^[^\s:]+:\d+:\s*((?:LaTeX|Package\s+\S+|Class\s+\S+)\s+Error:.+)$/,
    );
    const candidate = (bangMatch?.[1] ?? fileLineMatch?.[1])?.trim();
    if (candidate && !lowInformationMessagePattern.test(candidate)) {
      return candidate.replace(/\s+/g, " ");
    }
  }
  return null;
}

function runawayCommandName(message: string): string | null {
  return (
    message.match(/(?:while scanning use of|use of)\s+(\\[a-zA-Z@]+)/)?.[1] ??
    message.match(/paragraph ended before\s+(\\[a-zA-Z@]+)\s+was complete/i)?.[1] ??
    null
  );
}

function findFileReference(
  lines: string[],
  fileName: string,
  throughLine: number,
): LocatedToken | null {
  const baseName = fileName.replace(/\.[a-z0-9]+$/i, "");
  const candidates = fileName === baseName ? [fileName] : [fileName, baseName];

  for (const candidate of candidates) {
    const located =
      findLiteralBeforeLine(lines, candidate, throughLine) ??
      findLiteralBeforeLine(lines, candidate, lines.length);
    if (located) {
      return {
        ...located,
        accuracy: "exact",
        reason: `This is where the missing file ${fileName} is referenced.`,
        confidence: 96,
      };
    }
  }
  return null;
}

function findSecondScriptCharacter(
  line: string,
  character: string,
): LocatedToken | null {
  let seen = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== character || isEscaped(line, index)) {
      continue;
    }
    seen += 1;
    if (seen === 2) {
      return {
        start: index,
        end: index + 1,
        text: character,
        accuracy: "exact",
        reason: `This is the second ${character} applied to the same expression.`,
        confidence: 95,
      };
    }
  }
  return null;
}

function environmentName(message: string): string | null {
  return (
    message.match(/environment\s+([^\s.]+)\s+undefined/i)?.[1] ??
    message.match(/\\begin\{([^}]+)\}.*ended by.*\\end\{([^}]+)\}/i)?.[1] ??
    null
  );
}

function unmatchedClosingBrace(line: string): LocatedToken | null {
  let depth = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "%" && (index === 0 || line[index - 1] !== "\\")) {
      break;
    }
    if (line[index] === "{" && (index === 0 || line[index - 1] !== "\\")) {
      depth += 1;
    } else if (line[index] === "}" && (index === 0 || line[index - 1] !== "\\")) {
      if (depth === 0) {
        return {
          start: index,
          end: index + 1,
          text: "}",
          accuracy: "inferred",
          reason:
            "Source scanning proves this closing brace has no matching opening brace on the line.",
          confidence: 97,
        };
      }
      depth -= 1;
    }
  }
  return null;
}

function lastUnmatchedOpeningBrace(line: string): LocatedToken | null {
  const stack: number[] = [];
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "%" && (index === 0 || line[index - 1] !== "\\")) {
      break;
    }
    if (line[index] === "{" && (index === 0 || line[index - 1] !== "\\")) {
      stack.push(index);
    } else if (
      line[index] === "}" &&
      (index === 0 || line[index - 1] !== "\\") &&
      stack.length
    ) {
      stack.pop();
    }
  }

  const start = stack.at(-1);
  return start === undefined
    ? null
    : {
        start,
        end: start + 1,
        text: "{",
        accuracy: "inferred",
        reason:
          "This is the last opening brace on the line without a matching closing brace.",
        confidence: 92,
      };
}

function findUnclosedBrace(lines: string[], throughLine: number): LocatedToken | null {
  const stack: Array<{ line: number; column: number }> = [];
  const end = Math.min(lines.length, Math.max(1, throughLine));

  for (let lineNumber = 1; lineNumber <= end; lineNumber += 1) {
    const line = lines[lineNumber - 1] ?? "";
    for (let column = 0; column < line.length; column += 1) {
      if (line[column] === "%" && (column === 0 || line[column - 1] !== "\\")) {
        break;
      }
      if (line[column] === "{" && (column === 0 || line[column - 1] !== "\\")) {
        stack.push({ line: lineNumber, column });
      } else if (
        line[column] === "}" &&
        (column === 0 || line[column - 1] !== "\\") &&
        stack.length
      ) {
        stack.pop();
      }
    }
  }

  const opening = stack.at(-1);
  return opening
    ? {
        line: opening.line,
        start: opening.column,
        end: opening.column + 1,
        text: "{",
        accuracy: "exact",
        reason:
          "A full source scan found this opening brace still unmatched when LaTeX stopped.",
        confidence: 99,
      }
    : null;
}

function findUnmatchedClosingBrace(
  lines: string[],
  throughLine: number,
): LocatedToken | null {
  let depth = 0;
  const end = Math.min(lines.length, Math.max(1, throughLine));

  for (let lineNumber = 1; lineNumber <= end; lineNumber += 1) {
    const line = codeBeforeComment(lines[lineNumber - 1] ?? "");
    for (let column = 0; column < line.length; column += 1) {
      if (line[column] === "{" && !isEscaped(line, column)) {
        depth += 1;
      } else if (line[column] === "}" && !isEscaped(line, column)) {
        if (depth === 0) {
          return {
            line: lineNumber,
            start: column,
            end: column + 1,
            text: "}",
            accuracy: "exact",
            reason:
              "A full source scan proves this closing brace has no matching opening brace.",
            confidence: 100,
          };
        }
        depth -= 1;
      }
    }
  }
  return null;
}

function isEscaped(line: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function codeBeforeComment(line: string): string {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "%" && !isEscaped(line, index)) {
      return line.slice(0, index);
    }
  }
  return line;
}

function findUnclosedMathDelimiter(
  lines: string[],
  throughLine: number,
): LocatedToken | null {
  const stack: Array<{
    line: number;
    start: number;
    end: number;
    text: string;
    close: string;
  }> = [];
  const end = Math.min(lines.length, Math.max(1, throughLine));

  for (let lineNumber = 1; lineNumber <= end; lineNumber += 1) {
    const line = codeBeforeComment(lines[lineNumber - 1] ?? "");
    for (let index = 0; index < line.length; index += 1) {
      if (line.startsWith("\\(", index) || line.startsWith("\\[", index)) {
        const text = line.slice(index, index + 2);
        stack.push({
          line: lineNumber,
          start: index,
          end: index + 2,
          text,
          close: text === "\\(" ? "\\)" : "\\]",
        });
        index += 1;
        continue;
      }

      if (line.startsWith("\\)", index) || line.startsWith("\\]", index)) {
        const close = line.slice(index, index + 2);
        if (stack.at(-1)?.close === close) {
          stack.pop();
        }
        index += 1;
        continue;
      }

      if (line[index] !== "$" || isEscaped(line, index)) {
        continue;
      }

      const display = line[index + 1] === "$";
      const text = display ? "$$" : "$";
      const current = stack.at(-1);
      if (current?.close === text) {
        stack.pop();
      } else {
        stack.push({
          line: lineNumber,
          start: index,
          end: index + text.length,
          text,
          close: text,
        });
      }
      if (display) {
        index += 1;
      }
    }
  }

  const opening = stack.at(-1);
  return opening
    ? {
        line: opening.line,
        start: opening.start,
        end: opening.end,
        text: opening.text,
        accuracy: "exact",
        reason:
          "A full source scan found this math delimiter still open when LaTeX stopped.",
        confidence: 99,
      }
    : null;
}

interface EnvironmentToken {
  name: string;
  line: number;
  start: number;
  end: number;
  text: string;
}

function scanEnvironmentMismatch(
  lines: string[],
  throughLine: number,
): LocatedToken | null {
  const stack: EnvironmentToken[] = [];
  const end = Math.min(lines.length, Math.max(1, throughLine));
  const pattern = /\\(begin|end)\s*\{([^}]+)\}/g;

  for (let lineNumber = 1; lineNumber <= end; lineNumber += 1) {
    const line = codeBeforeComment(lines[lineNumber - 1] ?? "");
    pattern.lastIndex = 0;
    for (const match of line.matchAll(pattern)) {
      const token = {
        name: match[2],
        line: lineNumber,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      };
      if (match[1] === "begin") {
        stack.push(token);
        continue;
      }

      const opening = stack.at(-1);
      if (!opening || opening.name !== token.name) {
        return {
          ...token,
          accuracy: "exact",
          reason: opening
            ? `This closes ${token.name}, but the currently open environment is ${opening.name}.`
            : `This closes ${token.name}, but no matching \\begin{${token.name}} is open.`,
          confidence: 100,
        };
      }
      stack.pop();
    }
  }

  const opening = stack.at(-1);
  return opening
    ? {
        ...opening,
        accuracy: "exact",
        reason: `This \\begin{${opening.name}} has no matching \\end{${opening.name}} before LaTeX stops.`,
        confidence: 99,
      }
    : null;
}

function findLiteralBeforeLine(
  lines: string[],
  value: string,
  throughLine: number,
): LocatedToken | null {
  for (
    let lineNumber = Math.min(lines.length, throughLine);
    lineNumber >= 1;
    lineNumber -= 1
  ) {
    const token = findLiteral(lines[lineNumber - 1] ?? "", value);
    if (token) {
      return { ...token, line: lineNumber };
    }
  }
  return null;
}

function buildContext(lines: string[], lineNumber: number): DiagnosticContextLine[] {
  const start = Math.max(1, lineNumber - 2);
  const end = Math.min(lines.length, lineNumber + 2);
  const context: DiagnosticContextLine[] = [];

  for (let number = start; number <= end; number += 1) {
    context.push({
      line: number,
      text: lines[number - 1] ?? "",
      focus: number === lineNumber,
    });
  }

  return context;
}

function locateToken(
  diagnostic: Diagnostic,
  sourceLine: string,
  lines: string[],
  output: string,
): LocatedToken | null {
  const message = diagnostic.message;
  const normalized = message.toLowerCase();

  if (normalized.includes("undefined control sequence")) {
    const command = commandFromOutput(output, diagnostic.line);
    return (
      findLiteral(sourceLine, command) ?? findPattern(sourceLine, /\\[A-Za-z@]+|\\./)
    );
  }

  if (normalized.includes("missing $ inserted")) {
    return (
      findUnescapedCharacter(sourceLine, "_") ??
      findUnescapedCharacter(sourceLine, "^") ??
      findPattern(sourceLine, mathCommands) ??
      findUnclosedMathDelimiter(lines, diagnostic.line)
    );
  }

  if (
    normalized.includes("extra }, or forgotten $") ||
    normalized.includes("too many }")
  ) {
    return (
      findUnmatchedClosingBrace(lines, diagnostic.line) ??
      unmatchedClosingBrace(sourceLine) ??
      findUnescapedCharacter(sourceLine, "}") ??
      findUnclosedMathDelimiter(lines, diagnostic.line)
    );
  }

  if (
    normalized.includes("missing } inserted") ||
    normalized.includes("runaway argument") ||
    normalized.includes("file ended while scanning") ||
    normalized.includes("paragraph ended before")
  ) {
    // "File ended" means the argument stayed open until EOF, so the reported
    // line (often line 1 or the last line) says nothing — scan everything.
    const scanLimit = normalized.includes("file ended")
      ? lines.length
      : diagnostic.line;
    return findUnclosedBrace(lines, scanLimit) ?? lastUnmatchedOpeningBrace(sourceLine);
  }

  if (normalized.includes("double superscript")) {
    return findSecondScriptCharacter(sourceLine, "^");
  }

  if (normalized.includes("double subscript")) {
    return findSecondScriptCharacter(sourceLine, "_");
  }

  if (normalized.includes("missing \\begin{document}")) {
    const leadingText = sourceLine.match(/\S.*$/);
    return leadingText
      ? {
          start: leadingText.index ?? 0,
          end: (leadingText.index ?? 0) + leadingText[0].trimEnd().length,
          text: leadingText[0].trimEnd(),
          accuracy: "inferred",
          reason: "This is the content LaTeX found before \\begin{document}.",
          confidence: 92,
        }
      : null;
  }

  if (normalized.includes("\\caption outside float")) {
    return (
      findPattern(sourceLine, /\\caption\b/) ??
      findLiteralBeforeLine(lines, "\\caption", diagnostic.line)
    );
  }

  const fragileArgument = normalized.match(
    /argument of \\@?sect|argument of \\@caption/,
  );
  if (fragileArgument) {
    const fragile = findLiteralBeforeLine(lines, "\\footnote", diagnostic.line);
    if (fragile) {
      return {
        ...fragile,
        accuracy: "inferred",
        reason:
          "A fragile command inside a sectioning or caption argument usually causes this failure.",
        confidence: 85,
      };
    }
  }

  if (normalized.includes("misplaced alignment tab character")) {
    return findUnescapedCharacter(sourceLine, "&");
  }

  if (normalized.includes("there's no line here to end")) {
    return findPattern(sourceLine, /\\\\/);
  }

  if (
    normalized.includes("lonely \\item") ||
    normalized.includes("perhaps a missing list environment")
  ) {
    return findPattern(sourceLine, /\\item\b/);
  }

  if (
    normalized.includes("ended by") ||
    normalized.includes("missing \\end") ||
    normalized.includes("end occurred inside a group")
  ) {
    return scanEnvironmentMismatch(lines, diagnostic.line);
  }

  const missingFile = missingFileName(message);
  if (missingFile) {
    return (
      findLiteral(sourceLine, missingFile) ??
      findFileReference(lines, missingFile, diagnostic.line)
    );
  }

  const environment = environmentName(message);
  if (environment) {
    return (
      findLiteral(sourceLine, `\\begin{${environment}}`) ??
      findLiteral(sourceLine, `\\end{${environment}}`) ??
      scanEnvironmentMismatch(lines, diagnostic.line) ??
      findLiteralBeforeLine(lines, `\\begin{${environment}}`, diagnostic.line)
    );
  }

  const citation = quotedValue(message, "citation");
  if (citation) {
    return findLiteral(sourceLine, citation);
  }

  const reference = quotedValue(message, "reference");
  if (reference) {
    return findLiteral(sourceLine, reference);
  }

  const unicode = message.match(/unicode character\s+(.+?)\s+\(U\+/i)?.[1]?.trim();
  if (unicode) {
    return findLiteral(sourceLine, unicode);
  }

  return null;
}

function buildQuickFixes(
  diagnostic: Diagnostic,
  token: LocatedToken | null,
): DiagnosticFix[] | undefined {
  if (!token || (token.line === undefined && diagnostic.line < 1)) {
    return undefined;
  }

  const normalized = diagnostic.message.toLowerCase();
  const line = token.line ?? diagnostic.line;
  const range = {
    line,
    column: token.start + 1,
    endLine: line,
    endColumn: token.end + 1,
  };
  const fixes: DiagnosticFix[] = [];

  if (
    normalized.includes("undefined control sequence") &&
    token.text.startsWith("\\")
  ) {
    const command = token.text.slice(1);
    const replacement = uniqueNearMatch(command, commonCommands);
    if (replacement) {
      fixes.push({
        title: `Change ${token.text} to \\${replacement}`,
        expectedText: token.text,
        replacement: `\\${replacement}`,
        ...range,
        confidence: 98,
      });
    }
  }

  if (normalized.includes("missing $ inserted") && token.text === "_") {
    fixes.push({
      title: "Escape this literal underscore as \\_",
      expectedText: token.text,
      replacement: "\\_",
      ...range,
      confidence: 78,
    });
  }

  if (normalized.includes("misplaced alignment tab character") && token.text === "&") {
    fixes.push({
      title: "Escape this literal ampersand as \\&",
      expectedText: token.text,
      replacement: "\\&",
      ...range,
      confidence: 80,
    });
  }

  if (
    (normalized.includes("extra }, or forgotten $") ||
      normalized.includes("too many }")) &&
    token.text === "}" &&
    (token.confidence ?? 0) >= 97
  ) {
    fixes.push({
      title: "Remove this unmatched closing brace",
      expectedText: token.text,
      replacement: "",
      ...range,
      confidence: token.confidence ?? 97,
    });
  }

  if (normalized.includes("there's no line here to end") && token.text === "\\\\") {
    fixes.push({
      title: "Remove this invalid forced line break",
      expectedText: token.text,
      replacement: "",
      ...range,
      confidence: 80,
    });
  }

  if (normalized.includes("ended by") && token.text.startsWith("\\end{")) {
    const mismatch = diagnostic.message.match(
      /\\begin\{([^}]+)\}.*ended by.*\\end\{([^}]+)\}/i,
    );
    if (mismatch && token.text === `\\end{${mismatch[2]}}`) {
      fixes.push({
        title: `Close the open ${mismatch[1]} environment`,
        expectedText: token.text,
        replacement: `\\end{${mismatch[1]}}`,
        ...range,
        confidence: 100,
      });
    }
  }

  if (normalized.includes("environment") && normalized.includes("undefined")) {
    const environment = environmentName(diagnostic.message);
    const replacement = environment
      ? uniqueNearMatch(environment, commonEnvironments)
      : null;
    if (environment && replacement) {
      const correctedToken = token.text.replace(`{${environment}}`, `{${replacement}}`);
      if (correctedToken !== token.text) {
        fixes.push({
          title: `Change environment ${environment} to ${replacement}`,
          expectedText: token.text,
          replacement: correctedToken,
          ...range,
          confidence: 97,
        });
      }
    }
  }

  if (normalized.includes("unicode character")) {
    const unicodeFix = unicodeReplacements[token.text];
    if (unicodeFix) {
      fixes.push({
        title: unicodeFix.label,
        expectedText: token.text,
        replacement: unicodeFix.replacement,
        ...range,
        confidence: 100,
      });
    }
  }

  return fixes.length ? fixes : undefined;
}

function explainDiagnostic(
  diagnostic: Diagnostic,
  sourceLine: string | undefined,
  token: LocatedToken | null,
): Pick<DiagnosticAnalysis, "title" | "detail" | "suggestion"> {
  const normalized = diagnostic.message.toLowerCase();
  const location = locationText(diagnostic);
  const tokenText = token?.text;

  if (normalized.includes("undefined control sequence")) {
    return {
      title: "Unknown LaTeX command",
      detail: tokenText
        ? `LaTeX stopped at ${location} because it does not recognize ${tokenText}.`
        : `LaTeX found a command it does not recognize at ${location}.`,
      suggestion: tokenText
        ? `Check the spelling of ${tokenText}. If it is valid, load the package that defines it in the preamble.`
        : "Check the command spelling and whether its package is loaded in the preamble.",
    };
  }

  if (normalized.includes("missing $ inserted")) {
    if (
      tokenText === "$" ||
      tokenText === "$$" ||
      tokenText === "\\(" ||
      tokenText === "\\["
    ) {
      return {
        title: "Math mode was opened but never closed",
        detail: `The math delimiter ${tokenText} opened at ${location} remains active when LaTeX reaches the reported failure.`,
        suggestion:
          tokenText === "\\("
            ? "Add the matching \\) after the intended inline equation."
            : tokenText === "\\["
              ? "Add the matching \\] after the intended display equation."
              : `Add a matching ${tokenText} after the intended mathematical expression.`,
      };
    }
    return {
      title: "Math syntax used outside math mode",
      detail: tokenText
        ? `${tokenText} is math-only syntax, but LaTeX found it in normal text at ${location}.`
        : `LaTeX found math-only syntax in normal text at ${location}.`,
      suggestion:
        "Wrap the mathematical expression in $...$, \\(...\\), or a display-math environment. Escape a literal underscore as \\_.",
    };
  }

  if (
    normalized.includes("extra }, or forgotten $") ||
    normalized.includes("too many }")
  ) {
    if (
      tokenText === "$" ||
      tokenText === "$$" ||
      tokenText === "\\(" ||
      tokenText === "\\["
    ) {
      return {
        title: "Math delimiter was never closed",
        detail: `The highlighted ${tokenText} at ${location} opens math mode without a matching closing delimiter.`,
        suggestion:
          "Close the mathematical expression with the matching delimiter before the reported failure.",
      };
    }
    return {
      title: "Unexpected closing brace",
      detail: `The closing brace highlighted at ${location} has no matching opening brace, or an earlier math delimiter is missing.`,
      suggestion:
        "Remove the extra }, add the missing { earlier in the expression, and verify that every $ has a matching $.",
    };
  }

  if (normalized.includes("missing } inserted")) {
    return {
      title: "Missing closing brace",
      detail: `A group or command argument opened near ${location} was not closed before LaTeX needed it.`,
      suggestion:
        "Add the missing } after the intended argument. Check nested commands on this line and the lines immediately above it.",
    };
  }

  if (
    normalized.includes("file ended while scanning") ||
    normalized.includes("paragraph ended before")
  ) {
    const command = runawayCommandName(diagnostic.message);
    return {
      title: command
        ? `Argument of ${command} was never closed`
        : "Command argument was never closed",
      detail: command
        ? `LaTeX read to the end of the input while still inside the argument of ${command}. The opening brace highlighted here was never closed.`
        : `LaTeX read to the end of the input while an argument or group opened at ${location} was still open.`,
      suggestion: command
        ? `Add the missing } that closes the argument of ${command}.`
        : "Add the missing } or \\end{...} that closes the highlighted group.",
    };
  }

  if (normalized.includes("runaway argument")) {
    return {
      title: "Command argument was never closed",
      detail: `LaTeX kept reading past ${location} because an argument, group, or environment remained open.`,
      suggestion:
        "Check for a missing }, ], or \\end{...}, starting at the highlighted opening delimiter and scanning upward.",
    };
  }

  if (normalized.includes("file") && normalized.includes("not found")) {
    const file = missingFileName(diagnostic.message);
    if (file?.toLowerCase().endsWith(".sty")) {
      const packageName = file.slice(0, -4);
      return {
        title: `LaTeX package "${packageName}" is not installed`,
        detail: `The document loads the package ${packageName}, but ${file} is not available in the local TeX installation.`,
        suggestion: `Install it (TeX Live: "tlmgr install ${packageName}", MiKTeX installs on demand), fix the package name if it is misspelled, or remove the \\usepackage{${packageName}} line.`,
      };
    }
    if (file?.toLowerCase().endsWith(".cls")) {
      const className = file.slice(0, -4);
      return {
        title: `Document class "${className}" is not installed`,
        detail: `The \\documentclass{${className}} at ${location} refers to ${file}, which is not available in the local TeX installation.`,
        suggestion: `Install the class (TeX Live: "tlmgr install ${className}"), fix the class name, or place ${file} next to the document.`,
      };
    }
    if (file?.toLowerCase().endsWith(".bib")) {
      return {
        title: "Bibliography file not found",
        detail: `The bibliography file ${file} referenced at ${location} does not exist in the project.`,
        suggestion: `Create ${file}, fix the \\bibliography or \\addbibresource path, or remove the reference.`,
      };
    }
    return {
      title: "Required file not found",
      detail: file
        ? `LaTeX could not resolve ${file} from ${location}.`
        : `LaTeX could not load a required file referenced at ${location}.`,
      suggestion:
        "Check the relative path, filename capitalization, and extension. For packages, verify that the package is installed.",
    };
  }

  if (
    normalized.includes("double superscript") ||
    normalized.includes("double subscript")
  ) {
    const script = normalized.includes("superscript") ? "superscript" : "subscript";
    const character = script === "superscript" ? "^" : "_";
    return {
      title: `Two ${script}s on the same expression`,
      detail: `The highlighted ${character} at ${location} applies a second ${script} to something that already has one, which LaTeX does not allow.`,
      suggestion: `Group the scripts with braces: write x${character}{a${character}b} for nesting, or {x${character}a}${character}b to apply the second ${script} to the whole expression.`,
    };
  }

  if (normalized.includes("missing \\begin{document}")) {
    return {
      title: "Content appears before \\begin{document}",
      detail: `LaTeX found printable content at ${location}, but the preamble may only contain setup commands such as \\usepackage and \\newcommand.`,
      suggestion:
        "Move the highlighted content after \\begin{document}, or remove it. A stray character in the preamble (often from a bad paste) also triggers this.",
    };
  }

  if (normalized.includes("\\caption outside float")) {
    return {
      title: "\\caption is outside a figure or table",
      detail: `The \\caption command at ${location} only works inside a floating environment.`,
      suggestion:
        "Wrap it in \\begin{figure}...\\end{figure} or \\begin{table}...\\end{table}, or use \\captionof{figure}{...} from the caption package.",
    };
  }

  if (/argument of \\@sect|argument of \\@caption/.test(normalized)) {
    return {
      title: "Fragile command inside a section or caption",
      detail: `A fragile command (usually \\footnote) inside a \\section, \\subsection, or \\caption argument breaks at ${location} when LaTeX writes it to the table of contents or list of figures.`,
      suggestion:
        "Prefix the command with \\protect (e.g. \\section{Title\\protect\\footnote{...}}), or move the footnote out of the heading.",
    };
  }

  const extraBraceArgument = normalized.match(
    /argument of (\\[a-z@]+) has an extra \}/i,
  );
  if (extraBraceArgument) {
    return {
      title: `Unbalanced braces in the argument of ${extraBraceArgument[1]}`,
      detail: `The argument of ${extraBraceArgument[1]} near ${location} contains a } without a matching {, or a fragile command that breaks the argument apart.`,
      suggestion: `Balance the braces inside the argument of ${extraBraceArgument[1]}, and \\protect any fragile commands used inside it.`,
    };
  }

  if (normalized.includes("environment") && normalized.includes("undefined")) {
    const environment = environmentName(diagnostic.message);
    return {
      title: "Unknown LaTeX environment",
      detail: environment
        ? `The environment ${environment} is not defined at ${location}.`
        : `LaTeX found an environment it does not know at ${location}.`,
      suggestion:
        "Check the environment name and load the package that provides it. Ensure \\begin{...} and \\end{...} use the same name.",
    };
  }

  if (
    normalized.includes("ended by") ||
    normalized.includes("missing \\end") ||
    normalized.includes("end occurred inside a group")
  ) {
    return {
      title: "Environment is not closed correctly",
      detail: tokenText
        ? `The environment token ${tokenText} at ${location} does not match the surrounding environment structure.`
        : `The environment structure is unbalanced near ${location}.`,
      suggestion:
        "Make every \\begin{name} pair with a later \\end{name} in the correct nesting order.",
    };
  }

  if (normalized.includes("misplaced alignment tab character")) {
    return {
      title: "Alignment character used in the wrong place",
      detail: `The highlighted & at ${location} is only valid inside an alignment environment such as tabular, align, or array.`,
      suggestion:
        "Move it inside an alignment environment, or write \\& if you intended to print an ampersand.",
    };
  }

  if (normalized.includes("there's no line here to end")) {
    return {
      title: "Forced line break is invalid here",
      detail: `The \\\\ command at ${location} does not follow a line of text that LaTeX can end.`,
      suggestion:
        "Remove the forced line break, add preceding text, or use paragraph spacing instead.",
    };
  }

  if (
    normalized.includes("lonely \\item") ||
    normalized.includes("perhaps a missing list environment")
  ) {
    return {
      title: "List item is outside a list",
      detail: `The \\item command at ${location} is not inside itemize, enumerate, or description.`,
      suggestion: "Wrap the item in a list environment or remove the \\item command.",
    };
  }

  if (normalized.includes("citation") && normalized.includes("undefined")) {
    return {
      title: "Citation key not found",
      detail: tokenText
        ? `The citation key ${tokenText} used at ${location} is not present in the loaded bibliography.`
        : `A citation at ${location} does not match a loaded bibliography entry.`,
      suggestion:
        "Check the key spelling, verify the .bib file is loaded, and compile enough times for bibliography processing to finish.",
    };
  }

  if (normalized.includes("reference") && normalized.includes("undefined")) {
    return {
      title: "Reference label not found",
      detail: tokenText
        ? `The label ${tokenText} referenced at ${location} does not match any known \\label.`
        : `A reference at ${location} does not match any known \\label.`,
      suggestion:
        "Check the label spelling and compile again after the matching \\label has been created.",
    };
  }

  if (normalized.includes("unicode character")) {
    return {
      title: "Unsupported Unicode character",
      detail: tokenText
        ? `The character ${tokenText} at ${location} is not supported by the current engine or font setup.`
        : `The source contains a character at ${location} that the current engine cannot process.`,
      suggestion:
        "Use XeLaTeX or LuaLaTeX for Unicode text, replace the character with a LaTeX command, or configure an appropriate font.",
    };
  }

  return {
    title:
      diagnostic.severity === "warning" ? "LaTeX warning" : "LaTeX compilation error",
    detail: `LaTeX reported this problem at ${location}: ${diagnostic.message}`,
    suggestion:
      sourceLine !== undefined
        ? "Inspect the highlighted source and the lines immediately before it; LaTeX often reports where it noticed an earlier structural mistake."
        : "Open the build output for the complete compiler message and inspect the source near the reported line.",
  };
}

export function analyzeLatexDiagnostic(
  diagnostic: Diagnostic,
  content: string | undefined,
  output: string,
): DiagnosticAnalysis {
  const resolvedMessage = resolveUnderlyingErrorMessage(diagnostic.message, output);
  const effectiveDiagnostic = resolvedMessage
    ? { ...diagnostic, message: resolvedMessage }
    : diagnostic;
  const lines = content?.split(/\r?\n/) ?? [];
  const sourceLine = lines[effectiveDiagnostic.line - 1];
  // The reported line may be blank (e.g. errors triggered by a paragraph
  // break), so only skip token location when there is no content at all.
  const token =
    sourceLine !== undefined
      ? locateToken(effectiveDiagnostic, sourceLine, lines, output)
      : null;
  const analyzedLine = token?.line ?? effectiveDiagnostic.line;
  const analyzedSourceLine = lines[analyzedLine - 1] ?? sourceLine;
  const analyzedDiagnostic = {
    ...effectiveDiagnostic,
    line: analyzedLine,
  };
  const explanation = explainDiagnostic(analyzedDiagnostic, analyzedSourceLine, token);
  const fallbackColumn = Math.max(1, diagnostic.column || 1);
  const column = token ? token.start + 1 : fallbackColumn;
  const endColumn = token
    ? token.end + 1
    : Math.max(column + 1, diagnostic.endColumn ?? column + 1);

  return {
    ...explanation,
    ...(resolvedMessage ? { message: resolvedMessage } : {}),
    line: analyzedLine,
    column,
    endLine: analyzedLine,
    endColumn,
    locationAccuracy:
      token?.accuracy ??
      diagnostic.locationAccuracy ??
      (diagnostic.column > 1 ? "exact" : "line"),
    highlightText: token?.text,
    sourceLine: analyzedSourceLine,
    sourceContext: lines.length ? buildContext(lines, analyzedLine) : undefined,
    reportedLine: diagnostic.line,
    reportedColumn: Math.max(1, diagnostic.column),
    originReason: token?.reason,
    locationConfidence:
      token?.confidence ??
      diagnostic.locationConfidence ??
      (diagnostic.column > 1 ? 95 : 45),
    fixes: buildQuickFixes(analyzedDiagnostic, token),
  };
}

function diagnosticPriority(diagnostic: Diagnostic): number {
  if (diagnostic.severity === "warning") {
    return 10;
  }

  const normalized = diagnostic.message.toLowerCase();
  if (
    normalized.includes("runaway argument") ||
    normalized.includes("missing } inserted") ||
    normalized.includes("extra }, or forgotten $") ||
    normalized.includes("missing $ inserted") ||
    normalized.includes("ended by") ||
    normalized.includes("missing \\end")
  ) {
    return 100;
  }
  if (
    normalized.includes("undefined control sequence") ||
    (normalized.includes("file") && normalized.includes("not found")) ||
    (normalized.includes("environment") && normalized.includes("undefined"))
  ) {
    return 90;
  }
  if (diagnostic.locationAccuracy === "exact") {
    return 80;
  }
  return 60;
}

function isStructuralError(diagnostic: Diagnostic): boolean {
  const normalized = diagnostic.message.toLowerCase();
  return (
    normalized.includes("runaway argument") ||
    normalized.includes("missing } inserted") ||
    normalized.includes("extra }, or forgotten $") ||
    normalized.includes("missing $ inserted") ||
    normalized.includes("ended by") ||
    normalized.includes("missing \\end")
  );
}

function isCompilerFallout(diagnostic: Diagnostic): boolean {
  const normalized = diagnostic.message.toLowerCase();
  return (
    normalized.includes("emergency stop") ||
    normalized.includes("fatal error") ||
    normalized.includes("no legal \\end found") ||
    normalized.includes("job aborted") ||
    normalized.includes("cannot be completed")
  );
}

export function rankLatexDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const ranked: Diagnostic[] = diagnostics.map((diagnostic) => ({
    ...diagnostic,
    priority: diagnosticPriority(diagnostic),
    isPrimary: false,
    isCascade: false,
    cascadeReason: undefined,
  }));
  const primaryIndex = ranked.reduce((bestIndex, diagnostic, index) => {
    if (diagnostic.severity !== "error") {
      return bestIndex;
    }
    if (
      bestIndex < 0 ||
      (diagnostic.priority ?? 0) > (ranked[bestIndex].priority ?? 0)
    ) {
      return index;
    }
    return bestIndex;
  }, -1);

  if (primaryIndex < 0) {
    return ranked;
  }

  const primary = ranked[primaryIndex];
  primary.isPrimary = true;
  const primaryLine = primary.reportedLine ?? primary.line;

  for (let index = 0; index < ranked.length; index += 1) {
    if (index === primaryIndex || ranked[index].severity !== "error") {
      continue;
    }
    const diagnostic = ranked[index];
    const diagnosticLine = diagnostic.reportedLine ?? diagnostic.line;
    const followsStructuralRoot =
      isStructuralError(primary) &&
      diagnostic.file === primary.file &&
      diagnosticLine >= primaryLine;
    const duplicatesRoot =
      diagnostic.file === primary.file &&
      diagnostic.line === primary.line &&
      diagnostic.title === primary.title;

    if (isCompilerFallout(diagnostic) || followsStructuralRoot || duplicatesRoot) {
      diagnostic.isCascade = true;
      diagnostic.cascadeReason = `This message is probably a consequence of "${primary.title ?? primary.message}". Fix the primary error first and compile again.`;
    }
  }

  return ranked;
}
