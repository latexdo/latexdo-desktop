import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import {
  diagnosticHeadline,
  diagnosticLocationLabel,
  diagnosticMarkerMessage,
  diagnosticExplicitProblem,
  diagnosticAccuracyLabel,
  diagnosticContextContent,
  positionOffset,
  applyTextFix,
} from "./diagnostics";
import type { Diagnostic } from "../../types";
const diagnostic = (
  message = "message",
  patch: Partial<Diagnostic> = {},
): Diagnostic => ({
  file: "main.tex",
  line: 2,
  column: 3,
  severity: "error",
  message,
  ...patch,
});
afterEach(cleanup);
describe("diagnostic presentation and safe fixes", () => {
  it.each([
    ["Undefined control sequence", "Unknown LaTeX command"],
    ["Missing $ inserted", "Math content is outside math mode"],
    ["Extra }, or forgotten $", "Unbalanced braces or math delimiters"],
    ["Runaway argument", "A command argument was never closed"],
    ["File `data.tex' not found", "A required file is missing"],
    ["Citation smith undefined", "Citation key not found"],
    ["Reference fig undefined", "Reference could not be resolved"],
    ["mystery", "LaTeX error"],
  ])("explains %s", (message, title) =>
    expect(diagnosticHeadline(diagnostic(message))).toBe(title),
  );
  it("prefers enriched diagnostics and exposes origin, compiler stop and repair evidence", () => {
    const item = diagnostic("raw error", {
      title: "Known issue",
      highlightText: "\\bad",
      detail: "Details",
      originReason: "Unclosed argument",
      reportedLine: 20,
      reportedColumn: 4,
      suggestion: "Close it",
      compilerExcerpt: "! failure",
    });
    expect(diagnosticHeadline(item)).toBe("Known issue");
    expect(diagnosticExplicitProblem(item)).toBe("\\bad");
    const marker = diagnosticMarkerMessage(item);
    for (const evidence of [
      "Known issue",
      "Problem: \\bad",
      "Details",
      "Why this location: Unclosed argument",
      "line 20, column 4",
      "Suggested fix: Close it",
      "! failure",
      "Compiler message: raw error",
    ])
      expect(marker).toContain(evidence);
    expect(diagnosticExplicitProblem(diagnostic("  "))).toBeNull();
    expect(diagnosticHeadline(diagnostic("custom", { severity: "warning" }))).toBe(
      "LaTeX warning",
    );
  });
  it.each([
    ["exact", "Exact origin"],
    ["inferred", "Likely origin"],
    [undefined, "Compiler line"],
  ] as const)("labels %s accuracy", (accuracy, label) => {
    expect(
      diagnosticAccuracyLabel(
        diagnostic("m", { locationAccuracy: accuracy, locationConfidence: 95 }),
      ),
    ).toBe(`${label} · 95%`);
  });
  it("uses the root file and clamps invalid columns", () =>
    expect(
      diagnosticLocationLabel(diagnostic("x", { file: "", column: 0 }), "root.tex"),
    ).toBe("root.tex:2:1"));
  it("highlights only the identified source span", () => {
    render(
      <div data-testid="context">
        {diagnosticContextContent(
          diagnostic("x", { column: 3, endColumn: 6 }),
          "abcdefgh",
          true,
        )}
      </div>,
    );
    expect(screen.getByTestId("context")).toHaveTextContent("abcdefgh");
    expect(screen.getByText("cde", { selector: "mark" })).toBeInTheDocument();
    expect(diagnosticContextContent(diagnostic(), "", false)).toBe(" ");
  });
  it("maps CRLF and out-of-range positions without crossing line boundaries", () => {
    expect(positionOffset("ab\r\ncd", 1, 99)).toBe(2);
    expect(positionOffset("ab\r\ncd", 2, 2)).toBe(5);
    expect(positionOffset("ab\r\ncd", 99, 99)).toBe(6);
    expect(positionOffset("abc", -1, -1)).toBe(0);
  });
  it("applies a verified repair and refuses a stale repair", () => {
    const fix = {
      title: "Replace",
      confidence: 100,
      line: 2,
      column: 1,
      endLine: 2,
      endColumn: 4,
      expectedText: "bad",
      replacement: "good",
    };
    expect(applyTextFix("intro\nbad end", fix)).toBe("intro\ngood end");
    expect(applyTextFix("intro\nchanged end", fix)).toBeNull();
  });
});
