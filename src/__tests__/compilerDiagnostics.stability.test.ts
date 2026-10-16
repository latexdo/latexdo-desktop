import { describe, expect, it } from "vitest";
import { parseDiagnostics } from "../../electron/compiler";

const projectPath = "/project";
const caseIds = Array.from({ length: 250 }, (_, index) => index + 1);

const undefinedControlSequenceCases = caseIds.map((id) => {
  const line = 10 + id;
  const command = `\\unknownCommand${id}`;
  return {
    label: `undefined-command-${id}`,
    line,
    command,
    output: [
      "This is pdfTeX, Version 3.141592653.",
      "! Undefined control sequence.",
      `l.${line} Text before ${command}{value}`,
      "?",
    ].join("\n"),
  };
});

const missingMathModeCases = caseIds.map((id) => {
  const line = 300 + id;
  const sourceLine = `model_${id}_name should be escaped`;
  return {
    label: `missing-math-${id}`,
    line,
    sourceLine,
    output: [
      "! Missing $ inserted.",
      "<inserted text>",
      "                $",
      `l.${line} ${sourceLine}`,
      "?",
    ].join("\n"),
  };
});

const fallbackErrorCases = caseIds.map((id) => {
  if (id % 2 === 0) {
    return {
      label: `runaway-fallback-${id}`,
      message: "Runaway argument?",
      excerpt: `! File ended while scanning use of \\textbf${id}.`,
      output: [
        "Runaway argument?",
        `{The text for generated case ${id} never closes`,
        `! File ended while scanning use of \\textbf${id}.`,
        "<inserted text>",
        "                \\par",
        "<*> main.tex",
      ].join("\n"),
    };
  }

  return {
    label: `missing-file-fallback-${id}`,
    message: `LaTeX Error: File \`generated-${id}.sty' not found.`,
    excerpt: `generated-${id}.sty`,
    output: [
      `! LaTeX Error: File \`generated-${id}.sty' not found.`,
      "Type X to quit or <RETURN> to proceed,",
      "or enter new name. (Default extension: sty)",
    ].join("\n"),
  };
});

const warningContinuationCases = caseIds.map((id) => {
  const line = 700 + id;
  const packageName = `generatedpkg${id}`;
  return {
    label: `package-warning-${id}`,
    line,
    detail: `Generated warning detail ${id} on input line ${line}`,
    output: [
      `Package ${packageName} Warning: Generated warning detail ${id}`,
      `(${packageName})                on input line ${line}.`,
    ].join("\n"),
  };
});

describe("compiler diagnostics generated stability coverage", () => {
  it.each(undefinedControlSequenceCases)(
    "preserves explicit compiler excerpt for $label",
    ({ command, line, output }) => {
      const diagnostics = parseDiagnostics(output, projectPath, "main.tex");

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          file: "main.tex",
          line,
          severity: "error",
          message: "Undefined control sequence.",
          compilerExcerpt: expect.stringContaining(command),
        }),
      );
    },
  );

  it.each(missingMathModeCases)(
    "preserves failing source line for $label",
    ({ line, output, sourceLine }) => {
      const diagnostics = parseDiagnostics(output, projectPath, "main.tex");

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          file: "main.tex",
          line,
          severity: "error",
          message: "Missing $ inserted.",
          compilerExcerpt: expect.stringContaining(sourceLine),
        }),
      );
    },
  );

  it.each(fallbackErrorCases)(
    "creates fallback diagnostic for $label",
    ({ excerpt, message, output }) => {
      const diagnostics = parseDiagnostics(output, projectPath, "main.tex");

      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          file: "main.tex",
          line: 1,
          severity: "error",
          message,
          compilerExcerpt: expect.stringContaining(excerpt),
          locationAccuracy: "inferred",
        }),
      );
    },
  );

  it.each(warningContinuationCases)(
    "keeps package warning continuation for $label",
    ({ detail, line, output }) => {
      const diagnostics = parseDiagnostics(output, projectPath, "main.tex");
      const diagnostic = diagnostics.find(
        (item) => item.line === line && item.severity === "warning",
      );

      expect(diagnostic).toEqual(
        expect.objectContaining({
          file: "main.tex",
          line,
          severity: "warning",
          message: detail,
        }),
      );
      expect(diagnostic?.compilerExcerpt).toContain(detail.split(" on input line ")[0]);
      expect(diagnostic?.compilerExcerpt).toContain(`on input line ${line}.`);
    },
  );
});
