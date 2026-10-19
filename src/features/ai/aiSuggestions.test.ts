import { beforeEach, describe, expect, it } from "vitest";
import type { Diagnostic } from "../../types";
import {
  aiSuggestionUsageStorageKey,
  buildAiSuggestions,
  classifyTypedRequest,
  loadAiSuggestionUsage,
  recordAiSuggestionUsage,
  type AiSuggestionSignals,
} from "./aiSuggestions";

const now = Date.UTC(2026, 9, 19);

function signals(overrides: Partial<AiSuggestionSignals> = {}): AiSuggestionSignals {
  return {
    hasProject: true,
    workspaceKind: "document",
    activeFile: "/p/main.tex",
    compiling: false,
    compile: { ok: true, diagnostics: [] },
    selectionText: "",
    documentText: "",
    usage: {},
    now,
    ...overrides,
  };
}

function diag(overrides: Partial<Diagnostic>): Diagnostic {
  return {
    file: "/p/main.tex",
    line: 42,
    column: 1,
    severity: "error",
    message: "Undefined control sequence",
    source: "latex",
    ...overrides,
  };
}

const longPaper = `\\documentclass{article}
\\begin{document}
${["Intro", "Method", "Results"].map((t) => `\\section{${t}}\n${"word ".repeat(500)}`).join("\n")}
\\end{document}`;

describe("buildAiSuggestions", () => {
  it("puts fixing a broken build first, with the error and location", () => {
    const result = buildAiSuggestions(
      signals({
        compile: { ok: false, diagnostics: [diag({ isPrimary: true })] },
        documentText: longPaper,
      }),
    );
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      id: "fix-compile",
      kind: "error",
      label: "Fix the compile error",
      reason: "Undefined control sequence · main.tex:42",
    });
    expect(result[0].prompt).toContain("main.tex:42: Undefined control sequence");
  });

  it("counts real errors and ignores cascades", () => {
    const [first] = buildAiSuggestions(
      signals({
        compile: {
          ok: false,
          diagnostics: [
            diag({}),
            diag({ line: 50, message: "Missing $ inserted" }),
            diag({ line: 51, isCascade: true }),
          ],
        },
      }),
    );
    expect(first.label).toBe("Fix the 2 compile errors");
  });

  it("offers nothing about the build while compiling or when TeX is missing", () => {
    const compiling = buildAiSuggestions(
      signals({ compiling: true, compile: { ok: false, diagnostics: [diag({})] } }),
    );
    expect(compiling.some((s) => s.kind === "error")).toBe(false);
    const missing = buildAiSuggestions(
      signals({
        compile: {
          ok: false,
          diagnostics: [diag({ code: "missing-latex-toolchain" })],
        },
      }),
    );
    expect(missing.some((s) => s.kind === "error")).toBe(false);
  });

  it("suggests resolving undefined citations", () => {
    const result = buildAiSuggestions(
      signals({
        compile: {
          ok: true,
          diagnostics: [
            diag({
              severity: "warning",
              message: "Citation `knuth84' on page 1 undefined on input line 12",
            }),
          ],
        },
      }),
    );
    expect(result[0]).toMatchObject({
      id: "fix-undefined-refs",
      label: "Resolve 1 undefined citation",
    });
  });

  it("works on the selection when there is one", () => {
    const result = buildAiSuggestions(
      signals({
        selectionText:
          "Large language models have recently shown strong results on many reasoning benchmarks and tasks.",
        documentText: longPaper,
      }),
    );
    expect(result.map((s) => s.id)).toEqual([
      "rewrite-selection",
      "cite-selection",
      "write-abstract",
    ]);
  });

  it("recognises TikZ in the selection", () => {
    const [first] = buildAiSuggestions(
      signals({ selectionText: "\\begin{tikzpicture}\\draw (0,0) -- (1,1);" }),
    );
    expect(first.id).toBe("improve-figure");
  });

  it("offers an outline for an empty draft", () => {
    const [first] = buildAiSuggestions(
      signals({
        documentText: "\\documentclass{article}\n\\begin{document}\n\\end{document}",
      }),
    );
    expect(first).toMatchObject({
      id: "draft-outline",
      reason: "main.tex is still empty",
    });
  });

  it("counts TODO markers outside comments and the preamble", () => {
    const result = buildAiSuggestions(
      signals({
        documentText:
          "% TODO preamble\n\\begin{document}\nTODO: intro \\todo{fig}\n% TODO hidden\n\\end{document}",
      }),
    );
    expect(result.find((s) => s.id === "work-todos")?.label).toBe(
      "Work through 2 TODOs",
    );
  });

  it("lifts what the person often asks for and marks it", () => {
    const base = signals({ documentText: longPaper });
    expect(buildAiSuggestions(base)[0].id).not.toBe("summarize");
    const result = buildAiSuggestions({
      ...base,
      usage: { summarize: { count: 6, lastUsed: now - 1000 } },
    });
    expect(result[0]).toMatchObject({ id: "summarize", fromHistory: true });
  });

  it("never lets habits outrank a broken build", () => {
    const [first] = buildAiSuggestions(
      signals({
        compile: { ok: false, diagnostics: [diag({})] },
        documentText: longPaper,
        usage: { summarize: { count: 50, lastUsed: now } },
      }),
    );
    expect(first.id).toBe("fix-compile");
  });

  it("caps cards from one source at two", () => {
    const result = buildAiSuggestions(
      signals({
        compile: { ok: false, diagnostics: [diag({})] },
        selectionText: "\\begin{tikzpicture}\\draw (0,0);",
      }),
    );
    expect(result.map((s) => s.id)).toEqual([
      "fix-compile",
      "improve-figure",
      "rewrite-selection",
    ]);
  });

  it("targets the Knowledge Graph when that tab is open", () => {
    const [first] = buildAiSuggestions(
      signals({ workspaceKind: "knowledge-graph", activeFile: null }),
    );
    expect(first.id).toBe("related-sources");
  });

  it("always fills three cards", () => {
    expect(
      buildAiSuggestions(signals({ hasProject: false, activeFile: null })),
    ).toHaveLength(3);
  });
});

describe("classifyTypedRequest", () => {
  it.each([
    ["\\fix", "fix-compile"],
    ["can you fix the compile error", "fix-compile"],
    ["why does the build fail?", "explain-compile"],
    ["please rephrase this paragraph", "rewrite-selection"],
    ["proofread section 2", "proofread"],
    ["draw a diagram of the pipeline", "make-figure"],
    ["hello", null],
  ])("%s → %s", (text, id) => {
    expect(classifyTypedRequest(text)).toBe(id);
  });
});

describe("suggestion usage", () => {
  beforeEach(() => window.localStorage.clear());

  it("records counts and recency", () => {
    recordAiSuggestionUsage("proofread", 1);
    recordAiSuggestionUsage("proofread", 2);
    expect(loadAiSuggestionUsage()).toEqual({ proofread: { count: 2, lastUsed: 2 } });
  });

  it("ignores corrupt storage", () => {
    window.localStorage.setItem(aiSuggestionUsageStorageKey, "{nope");
    expect(loadAiSuggestionUsage()).toEqual({});
    window.localStorage.setItem(
      aiSuggestionUsageStorageKey,
      JSON.stringify({ a: { count: "x" }, b: { count: 1, lastUsed: 3 } }),
    );
    expect(loadAiSuggestionUsage()).toEqual({ b: { count: 1, lastUsed: 3 } });
  });
});
