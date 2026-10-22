import { describe, expect, it } from "vitest";
import { buildNextEditMessages, buildNextEditModelContext } from "./nextEditPrompt";
import type {
  NextEditCandidate,
  NormalizedEdit,
  SemanticNextEditInput,
} from "./nextEditTypes";

function edit(startOffsetBefore: number, oldText = "a", newText = "b"): NormalizedEdit {
  return {
    id: `e${startOffsetBefore}`,
    documentKey: "k",
    revisionBefore: 0,
    revisionAfter: 1,
    origin: "user",
    startOffsetBefore,
    endOffsetBefore: startOffsetBefore + oldText.length,
    oldText,
    newText,
    beforeContext: "",
    afterContext: "",
    cursorOffsetAfter: startOffsetBefore,
    timestamp: 0,
  } as NormalizedEdit;
}

function candidate(
  startOffset: number,
  endOffset: number,
  confidence = 0.12345,
): NextEditCandidate {
  return {
    id: `c${startOffset}`,
    documentKey: "k",
    source: "pattern",
    startOffset,
    endOffset,
    expectedText: "x",
    replacementText: "y",
    confidence,
    reason: "",
    basedOnRevision: 1,
  } as NextEditCandidate;
}

function input(
  text: string,
  cursorOffset: number,
  extra: Partial<SemanticNextEditInput> = {},
): SemanticNextEditInput {
  return {
    snapshot: { documentKey: "k", revision: 1, text, language: "latex" },
    cursorOffset,
    recentEdits: [],
    deterministicCandidates: [],
    requestId: "r",
    basedOnRevision: 1,
    ...extra,
  };
}

describe("buildNextEditModelContext", () => {
  it("keeps a short document whole and maps offsets into the window", () => {
    const context = buildNextEditModelContext(
      input("hello world", 5, {
        recentEdits: [edit(2, "x".repeat(200), "y")],
        deterministicCandidates: [candidate(6, 11, 0.98765)],
      }),
    );
    expect(context.documentWindow).toBe("hello world");
    expect(context.windowStartOffset).toBe(0);
    expect(context.cursorOffsetInWindow).toBe(5);
    expect(context.recentEdits[0].oldText).toHaveLength(160);
    expect(context.recentEdits[0].relativeLocation).toBe(2);
    expect(context.deterministicCandidates).toEqual([
      { index: 0, start: 6, end: 11, expected: "x", replacement: "y", score: 0.988 },
    ]);
  });

  it("centres the window on the cursor when anchors are spread too far apart", () => {
    const text = "a".repeat(20_000);
    const context = buildNextEditModelContext(
      input(text, 10_000, {
        deterministicCandidates: [candidate(100, 105), candidate(19_000, 19_005)],
        recentEdits: [edit(5)],
      }),
      1_000,
    );
    expect(context.windowStartOffset).toBe(9_500);
    expect(context.documentWindow).toHaveLength(1_000);
    expect(context.cursorOffsetInWindow).toBe(500);
    // Candidates outside the window are dropped.
    expect(context.deterministicCandidates).toEqual([]);
    expect(context.recentEdits[0].relativeLocation).toBe(5 - 9_500);
  });

  it("clamps the window when the cursor is near the end", () => {
    const text = "b".repeat(5_000);
    const context = buildNextEditModelContext(
      input(text, 9_999, { deterministicCandidates: [candidate(0, 1)] }),
      1_000,
    );
    expect(context.windowStartOffset).toBe(4_000);
    expect(context.documentWindow).toHaveLength(1_000);
    expect(context.cursorOffsetInWindow).toBe(1_000);
  });
});

describe("buildNextEditMessages", () => {
  it("asks for JSON and embeds the context", () => {
    const messages = buildNextEditMessages({
      language: "latex",
      documentWindow: "doc",
      windowStartOffset: 0,
      cursorOffsetInWindow: 1,
      recentEdits: [],
      deterministicCandidates: [],
    });
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Return JSON only");
    expect(messages[1].content).toContain("cursor_offset_in_window: 1");
    expect(messages[1].content).toContain("document_window:\ndoc");
  });
});
