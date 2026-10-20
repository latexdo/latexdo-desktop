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

describe("buildAiSuggestions edge cases", () => {
  const ids = (result: { id: string }[]) => result.map((r) => r.id);
  const all = (overrides: Partial<AiSuggestionSignals>) => buildAiSuggestions(signals(overrides), 50);

  it("describes a failed build without diagnostics", () => {
    const result = all({ compile: { ok: false, diagnostics: [] } });
    const fix = result.find((r) => r.id === "fix-compile")!;
    expect(fix.reason).toBe("The last build failed");
    expect(fix.prompt.startsWith("The last build failed.")).toBe(true);
    expect(result.find((r) => r.id === "explain-compile")!.reason).toBe(
      "The last build failed",
    );
  });

  it("falls back to cascade errors and omits locations without a file", () => {
    const result = all({
      compile: {
        ok: false,
        diagnostics: [
          diag({ isCascade: true, file: "", message: "Cascade" }),
          diag({ isCascade: true, file: "C:\\p\\a.tex", line: 0, message: "Other" }),
          diag({ source: "proofread", message: "lint" }),
        ],
      },
    });
    const fix = result.find((r) => r.id === "fix-compile")!;
    expect(fix.label).toBe("Fix the 2 compile errors");
    expect(fix.reason).toBe("Cascade");
    expect(fix.prompt).toContain("- Cascade");
    expect(fix.prompt).toContain("- a.tex: Other");
    expect(fix.prompt).not.toContain("lint");
  });

  it("names references, mixed unresolved items and overfull boxes", () => {
    const refs = all({
      compile: {
        ok: true,
        diagnostics: [diag({ severity: "warning", message: "Reference `fig:a' undefined" })],
      },
    });
    expect(refs.find((r) => r.id === "fix-undefined-refs")!.label).toBe(
      "Resolve 1 undefined reference",
    );
    const mixed = all({
      compile: {
        ok: true,
        diagnostics: [
          diag({ severity: "warning", message: "Citation `x' undefined" }),
          diag({ severity: "warning", message: "Reference `y' undefined" }),
          diag({ severity: "warning", message: "Overfull \\hbox (3pt too wide)", file: "" }),
          diag({ severity: "warning", message: "Overfull \\hbox (1pt too wide)" }),
        ],
      },
    });
    expect(mixed.find((r) => r.id === "fix-undefined-refs")!.label).toBe(
      "Resolve 2 undefined citation or references",
    );
    const boxes = mixed.find((r) => r.id === "fix-overfull")!;
    expect(boxes.label).toBe("Fix 2 overfull lines");
    expect(boxes.reason).toBe("Overfull \\hbox (3pt too wide)");
    const located = all({
      compile: { ok: true, diagnostics: [diag({ severity: "warning", message: "Overfull \\vbox" })] },
    });
    expect(located.find((r) => r.id === "fix-overfull")!.reason).toBe(
      "Overfull \\vbox · main.tex:42",
    );
  });

  it("explains selected math and truncates long previews", () => {
    const math = all({ selectionText: "$$ \\frac{a}{b} $$" });
    expect(ids(math)).toContain("explain-math");
    const long = all({ selectionText: "word ".repeat(40) });
    const rewrite = long.find((r) => r.id === "rewrite-selection")!;
    expect(rewrite.reason.endsWith("…”")).toBe(true);
    expect(ids(long)).toContain("cite-selection");
    expect(ids(all({ selectionText: "\\cite{a} " + "word ".repeat(20) }))).not.toContain(
      "cite-selection",
    );
  });

  it("offers bibliography cleanup for .bib files and nothing for other files", () => {
    const bib = all({ activeFile: "/p/refs.bib" });
    expect(bib.find((r) => r.id === "tidy-bib")!.reason).toBe("refs.bib");
    expect(ids(all({ activeFile: "/p/fig.png" }))).not.toContain("draft-outline");
    expect(ids(all({ activeFile: null }))).not.toContain("draft-outline");
  });

  it("describes drafts by word count, TODOs, abstracts and summaries", () => {
    const draft = all({ documentText: "word ".repeat(50) + " TODO" });
    expect(draft.find((r) => r.id === "draft-outline")!.reason).toBe("main.tex has 51 words so far");
    expect(draft.find((r) => r.id === "work-todos")!.label).toBe("Resolve the TODO");

    const noAbstract = `\\documentclass{article}\n\\begin{document}\n\\section{A}\n${"w ".repeat(300)}\\section{B}\n${"w ".repeat(300)}\\end{document}`;
    const result = all({ documentText: noAbstract });
    expect(ids(result)).toContain("write-abstract");
    expect(result.find((r) => r.id === "summarize")!.reason).toBe("2 sections in main.tex");

    const flat = all({ documentText: "w ".repeat(200) });
    expect(flat.find((r) => r.id === "summarize")!.reason).toBe("main.tex");
  });

  it("offers a LaTeX question without a project and applies weekly recency", () => {
    expect(ids(all({ hasProject: false }))).toContain("latex-help");
    const week = all({
      hasProject: false,
      usage: {
        "make-table": { count: 2, lastUsed: now - 3 * 24 * 60 * 60 * 1000 },
        "make-figure": { count: 1, lastUsed: now - 30 * 24 * 60 * 60 * 1000 },
        "latex-help": { count: 0, lastUsed: now },
      },
    });
    expect(week.find((r) => r.id === "make-table")!.fromHistory).toBe(true);
    expect(week.find((r) => r.id === "make-figure")!.fromHistory).toBe(false);
    expect(week.find((r) => r.id === "latex-help")!.fromHistory).toBe(false);
  });

  it("ignores storage entries that are not usage records and setItem failures", () => {
    window.localStorage.setItem(
      aiSuggestionUsageStorageKey,
      JSON.stringify({ ok: { count: 1, lastUsed: 2 }, bad: null, half: { count: 1 } }),
    );
    expect(loadAiSuggestionUsage()).toEqual({ ok: { count: 1, lastUsed: 2 } });
    window.localStorage.setItem(aiSuggestionUsageStorageKey, "42");
    expect(loadAiSuggestionUsage()).toEqual({});

    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("quota");
    };
    try {
      expect(recordAiSuggestionUsage("x", 5)).toEqual({ x: { count: 1, lastUsed: 5 } });
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });

  it("caps a single group at two cards even with a high limit", () => {
    const result = all({ selectionText: "$$ \\frac{a}{b} $$ " + "word ".repeat(15) });
    expect(result.filter((r) => ["explain-math", "rewrite-selection", "cite-selection"].includes(r.id))).toHaveLength(2);
  });

  it("handles bare file names and documents without \\end{document}", () => {
    const result = all({ activeFile: "main.tex", documentText: "\\begin{document} TODO TODO" });
    expect(result.find((r) => r.id === "work-todos")).toMatchObject({
      label: "Work through 2 TODOs",
      reason: "2 markers in main.tex",
    });
  });

  it("returns null for blank or unrecognised typed requests", () => {
    expect(classifyTypedRequest("   ")).toBeNull();
    expect(classifyTypedRequest("hello there")).toBeNull();
  });
});

