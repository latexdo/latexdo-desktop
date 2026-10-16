import type React from "react";
import type { Diagnostic, DiagnosticFix } from "../../types";

export function diagnosticHeadline(diagnostic: Diagnostic): string {
  if (diagnostic.title) {
    return diagnostic.title;
  }

  const normalized = diagnostic.message.toLowerCase();

  if (normalized.includes("undefined control sequence")) {
    return "Unknown LaTeX command";
  }
  if (normalized.includes("missing $ inserted")) {
    return "Math content is outside math mode";
  }
  if (normalized.includes("extra }, or forgotten $")) {
    return "Unbalanced braces or math delimiters";
  }
  if (normalized.includes("runaway argument")) {
    return "A command argument was never closed";
  }
  if (normalized.includes("file `") && normalized.includes("' not found")) {
    return "A required file is missing";
  }
  if (normalized.includes("citation") && normalized.includes("undefined")) {
    return "Citation key not found";
  }
  if (normalized.includes("reference") && normalized.includes("undefined")) {
    return "Reference could not be resolved";
  }
  if (normalized.includes("there were undefined references")) {
    return "Some references are unresolved";
  }
  if (normalized.includes("there were undefined citations")) {
    return "Some citations are unresolved";
  }

  return diagnostic.severity === "warning" ? "LaTeX warning" : "LaTeX error";
}

export function diagnosticLocationLabel(
  diagnostic: Diagnostic,
  rootFile: string,
): string {
  const file = diagnostic.file || rootFile;
  return `${file}:${diagnostic.line}:${Math.max(1, diagnostic.column)}`;
}

export function diagnosticMarkerMessage(diagnostic: Diagnostic): string {
  return [
    diagnosticHeadline(diagnostic),
    diagnosticExplicitProblem(diagnostic)
      ? `Problem: ${diagnosticExplicitProblem(diagnostic)}`
      : undefined,
    diagnostic.detail,
    diagnostic.originReason
      ? `Why this location: ${diagnostic.originReason}`
      : undefined,
    diagnostic.reportedLine && diagnostic.reportedLine !== diagnostic.line
      ? `LaTeX stopped later at line ${diagnostic.reportedLine}, column ${
          diagnostic.reportedColumn ?? 1
        }.`
      : undefined,
    diagnostic.suggestion ? `Suggested fix: ${diagnostic.suggestion}` : undefined,
    diagnostic.compilerExcerpt
      ? `Compiler excerpt:\n${diagnostic.compilerExcerpt}`
      : undefined,
    `Compiler message: ${diagnostic.message}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function diagnosticExplicitProblem(diagnostic: Diagnostic): string | null {
  if (diagnostic.highlightText) {
    return diagnostic.highlightText;
  }

  const message = diagnostic.message.trim();
  return message ? message : null;
}

export function diagnosticAccuracyLabel(diagnostic: Diagnostic): string {
  const confidence = diagnostic.locationConfidence
    ? ` · ${diagnostic.locationConfidence}%`
    : "";
  if (diagnostic.locationAccuracy === "exact") {
    return `Exact origin${confidence}`;
  }
  if (diagnostic.locationAccuracy === "inferred") {
    return `Likely origin${confidence}`;
  }
  return `Compiler line${confidence}`;
}

export function diagnosticContextContent(
  diagnostic: Diagnostic,
  text: string,
  focus: boolean,
): React.ReactNode {
  if (!focus) {
    return text || " ";
  }

  const start = Math.min(text.length, Math.max(0, diagnostic.column - 1));
  const end = Math.min(
    text.length,
    Math.max(start + 1, (diagnostic.endColumn ?? diagnostic.column + 1) - 1),
  );

  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, end) || " "}</mark>
      {text.slice(end)}
    </>
  );
}

export function positionOffset(content: string, line: number, column: number): number {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      starts.push(index + 1);
    }
  }

  const lineIndex = Math.min(starts.length - 1, Math.max(0, line - 1));
  const lineStart = starts[lineIndex];
  const nextLineStart = starts[lineIndex + 1] ?? content.length + 1;
  const lineEnd = Math.max(
    lineStart,
    nextLineStart - (content[nextLineStart - 2] === "\r" ? 2 : 1),
  );
  return Math.min(lineEnd, lineStart + Math.max(0, column - 1));
}

export function applyTextFix(content: string, fix: DiagnosticFix): string | null {
  const start = positionOffset(content, fix.line, fix.column);
  const end = positionOffset(content, fix.endLine, fix.endColumn);
  if (content.slice(start, Math.max(start, end)) !== fix.expectedText) {
    return null;
  }
  return (
    content.slice(0, start) + fix.replacement + content.slice(Math.max(start, end))
  );
}
