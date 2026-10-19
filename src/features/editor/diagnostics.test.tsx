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

describe("diagnostic message variants", () => {
  it("summarises undefined reference and citation warnings", () => {
    expect(diagnosticHeadline(diagnostic("LaTeX Warning: There were undefined references."))).toBe(
      "Some references are unresolved",
    );
    expect(diagnosticHeadline(diagnostic("There were undefined citations."))).toBe(
      "Some citations are unresolved",
    );
  });

  it("builds the full marker message with every optional section", () => {
    const text = diagnosticMarkerMessage(
      diagnostic("Undefined control sequence", {
        highlightText: "\\foo",
        detail: "detail",
        originReason: "macro defined here",
        reportedLine: 9,
        suggestion: "define it",
        compilerExcerpt: "l.9 \\foo",
      }),
    );
    expect(text).toContain("Problem: \\foo");
    expect(text).toContain("Why this location: macro defined here");
    expect(text).toContain("LaTeX stopped later at line 9, column 1.");
    expect(text).toContain("Suggested fix: define it");
    expect(text).toContain("Compiler excerpt:\nl.9 \\foo");

    const minimal = diagnosticMarkerMessage(diagnostic("  ", { reportedLine: 2, reportedColumn: 4 }));
    expect(minimal).not.toContain("Problem:");
    expect(minimal).not.toContain("stopped later");
    expect(
      diagnosticMarkerMessage(diagnostic("x", { reportedLine: 5, reportedColumn: 4 })),
    ).toContain("line 5, column 4.");
  });

  it("labels accuracy with and without confidence", () => {
    expect(diagnosticAccuracyLabel(diagnostic("x", { locationAccuracy: "exact" }))).toBe(
      "Exact origin",
    );
    expect(
      diagnosticAccuracyLabel(diagnostic("x", { locationAccuracy: "inferred", locationConfidence: 70 })),
    ).toBe("Likely origin · 70%");
    expect(diagnosticAccuracyLabel(diagnostic("x"))).toBe("Compiler line");
  });

  it("highlights with an explicit end column and empty highlighted text", () => {
    const { container } = render(
      <p>{diagnosticContextContent(diagnostic("x", { column: 2, endColumn: 4 }), "abcdef", true)}</p>,
    );
    expect(container.querySelector("mark")?.textContent).toBe("bc");
    const { container: empty } = render(
      <p>{diagnosticContextContent(diagnostic("x", { column: 9 }), "ab", true)}</p>,
    );
    expect(empty.querySelector("mark")?.textContent).toBe(" ");
    expect(diagnosticContextContent(diagnostic(), "", false)).toBe(" ");
  });
});

