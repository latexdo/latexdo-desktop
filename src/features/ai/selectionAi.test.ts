import { describe, expect, it } from "vitest";
import {
  buildReformulationMessages,
  buildReformulationProposal,
  buildSelectionMessageText,
  captureEditorSelection,
  maxReformulationSelectionChars,
  validateSelectionForReformulation,
  validateSnapshotRange,
  type AiSelectionSnapshot,
} from "./selectionAi";

function makeSnapshot(
  overrides: Partial<AiSelectionSnapshot> = {},
): AiSelectionSnapshot {
  return {
    filePath: "main.tex",
    text: "The proposed architecture improves the result by $12.4\\%$ as shown in \\cref{fig:architecture}.",
    range: {
      startLineNumber: 5,
      startColumn: 3,
      endLineNumber: 5,
      endColumn: 89,
    },
    documentVersionId: 7,
    ...overrides,
  };
}

type FakeModel = {
  getValueInRange: (range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }) => string;
  getVersionId: () => number;
};
type FakeEditor = {
  getSelection: () => {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
  getModel: () => FakeModel | null;
};

describe("captureEditorSelection", () => {
  it("returns null when no editor is mounted", () => {
    expect(captureEditorSelection(null, "main.tex")).toBeNull();
  });

  it("returns null when there is no file path", () => {
    const editor = {
      getSelection: () => null,
      getModel: () => null,
    };
    expect(captureEditorSelection(editor, null)).toBeNull();
  });

  it("returns null when no model exists", () => {
    const editor: FakeEditor = {
      getSelection: () => ({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 2,
        endColumn: 5,
      }),
      getModel: () => null,
    };
    expect(captureEditorSelection(editor, "main.tex")).toBeNull();
  });

  it("returns null when there is no selection", () => {
    const editor: FakeEditor = {
      getSelection: () => null,
      getModel: () => ({
        getValueInRange: () => "x",
        getVersionId: () => 1,
      }),
    };
    expect(captureEditorSelection(editor, "main.tex")).toBeNull();
  });

  it("returns null for emptly whitespace-only selection", () => {
    const editor: FakeEditor = {
      getSelection: () => ({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 10,
      }),
      getModel: () => ({
        getValueInRange: () => "   \n  ",
        getVersionId: () => 1,
      }),
    };
    expect(captureEditorSelection(editor, "main.tex")).toBeNull();
  });

  it("captures range, text, file path and model version", () => {
    const editor: FakeEditor = {
      getSelection: () => ({
        startLineNumber: 5,
        startColumn: 3,
        endLineNumber: 6,
        endColumn: 12,
      }),
      getModel: () => ({
        getValueInRange: () => "selected \\cite{key}",
        getVersionId: () => 42,
      }),
    };
    const snapshot = captureEditorSelection(editor, "sections/intro.tex");
    expect(snapshot).toEqual({
      filePath: "sections/intro.tex",
      text: "selected \\cite{key}",
      range: {
        startLineNumber: 5,
        startColumn: 3,
        endLineNumber: 6,
        endColumn: 12,
      },
      documentVersionId: 42,
    });
  });
});

describe("buildReformulationMessages", () => {
  it("sends the exact selected text to the provider context", () => {
    const snapshot = makeSnapshot();
    const messages = buildReformulationMessages(snapshot);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain(snapshot.text);
  });

  it("includes LaTeX math and references unchanged in the request context", () => {
    const snapshot = makeSnapshot({
      text: "As shown in \\cref{fig:architecture}, our method improves the result by $12.4\\%$.",
    });
    const messages = buildReformulationMessages(snapshot);
    expect(messages[1].content).toContain("\\cref{fig:architecture}");
    expect(messages[1].content).toContain("$12.4\\%$");
  });

  it("instructs the model to preserve LaTeX structure", () => {
    const system = buildReformulationMessages(makeSnapshot())[0].content;
    expect(system).toContain("\\cite{...}");
    expect(system).toContain("\\ref{...}");
    expect(system).toContain("Preserve ALL valid LaTeX commands");
  });
});

describe("validateSelectionForReformulation", () => {
  it("returns null for normal-size selections", () => {
    expect(validateSelectionForReformulation(makeSnapshot())).toBeNull();
  });

  it("rejects very large selections without truncating them", () => {
    const snapshot = makeSnapshot({
      text: "x".repeat(maxReformulationSelectionChars + 1),
    });
    const error = validateSelectionForReformulation(snapshot);
    expect(error).toContain("too large");
  });
});

describe("buildReformulationProposal", () => {
  it("builds a replace-selection proposal with old and new text", () => {
    const snapshot = makeSnapshot({ text: "Old prose." });
    const proposal = buildReformulationProposal(snapshot, "New and improved prose.");
    expect(proposal).toEqual({
      path: "main.tex",
      kind: "replace-selection",
      newText: "New and improved prose.",
      oldText: "Old prose.",
      source: "reformulate",
    });
  });

  it("trims surrounding whitespace from the replacement", () => {
    const proposal = buildReformulationProposal(makeSnapshot(), "  Clean.  ");
    expect(proposal?.newText).toBe("Clean.");
  });

  it("returns null for empty results", () => {
    expect(buildReformulationProposal(makeSnapshot(), "   ")).toBeNull();
  });
});

describe("validateSnapshotRange", () => {
  const text = "original selected text";

  it("accepts an unchanged selection", () => {
    const editor = {
      getSelection: () => ({
        startLineNumber: 5,
        startColumn: 3,
        endLineNumber: 6,
        endColumn: 12,
      }),
      getModel: () => ({
        getValueInRange: () => text,
      }),
    } as unknown as Parameters<typeof validateSnapshotRange>[0];
    expect(
      validateSnapshotRange(
        editor,
        makeSnapshot({
          text,
          range: {
            startLineNumber: 5,
            startColumn: 3,
            endLineNumber: 6,
            endColumn: 12,
          },
        }),
      ),
    ).toBe(true);
  });

  it("rejects when the range moved", () => {
    const snapshot = makeSnapshot({
      range: {
        startLineNumber: 5,
        startColumn: 3,
        endLineNumber: 6,
        endColumn: 12,
      },
      text,
    });
    const editor = {
      getSelection: () => ({
        startLineNumber: 20,
        startColumn: 1,
        endLineNumber: 21,
        endColumn: 2,
      }),
      getModel: () => ({
        getValueInRange: () => text,
      }),
    } as unknown as Parameters<typeof validateSnapshotRange>[0];
    expect(validateSnapshotRange(editor, snapshot)).toBe(false);
  });

  it("rejects when the text at the range changed (stale selection)", () => {
    const snapshot = makeSnapshot({
      range: {
        startLineNumber: 5,
        startColumn: 3,
        endLineNumber: 6,
        endColumn: 12,
      },
      text: "old content",
    });
    const editor = {
      getSelection: () => ({
        startLineNumber: 5,
        startColumn: 3,
        endLineNumber: 6,
        endColumn: 12,
      }),
      getModel: () => ({
        getValueInRange: () => "user wrote newer text",
      }),
    } as unknown as Parameters<typeof validateSnapshotRange>[0];
    expect(validateSnapshotRange(editor, snapshot)).toBe(false);
  });

  it("rejects when no editor or model is present", () => {
    expect(validateSnapshotRange(null, makeSnapshot())).toBe(false);
  });
});

describe("selection chat handoff", () => {
  it("builds a clearly delimited selection block", () => {
    const text = buildSelectionMessageText({
      type: "editor-selection",
      filePath: "main.tex",
      text: "\\section{Foo}\nAnd content.",
      startLine: 42,
      endLine: 48,
    });
    expect(text).toContain("Selection from main.tex (lines 42–48)");
    expect(text).toContain("\\section{Foo}");
    expect(text).toContain("End of selection");
  });

  it("truncates a very large selection preview in the block", () => {
    const text = buildSelectionMessageText({
      type: "editor-selection",
      filePath: "main.tex",
      text: "y".repeat(1000),
      startLine: 1,
      endLine: 2,
    });
    expect(text.length).toBeLessThan(600);
    expect(text).toContain("…");
  });
});
