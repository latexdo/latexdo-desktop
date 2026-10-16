import { describe, expect, it } from "vitest";
import {
  commonPrefixSimilarity,
  commonSuffixSimilarity,
  rankCandidates,
  rankPatternCandidate,
} from "./candidateRanker";
import type {
  DocumentEditSession,
  EditPattern,
  LatexContextSignals,
  PatternExample,
  PatternRawCandidate,
} from "./nextEditTypes";

const baseContext: LatexContextSignals = {
  indentation: "",
  section: "\\section{Intro}",
  environment: "figure",
  command: "",
  inMath: false,
  inComment: false,
};

function example(partial: Partial<PatternExample> = {}): PatternExample {
  return {
    id: "edit-1",
    startOffsetBefore: 20,
    endOffsetBefore: 23,
    cursorOffsetAfter: 23,
    oldText: "foo",
    newText: "bar",
    beforeContext: "same prefix ",
    afterContext: " same suffix",
    timestamp: 100,
    latexContext: baseContext,
    ...partial,
  };
}

function pattern(partial: Partial<EditPattern> = {}): EditPattern {
  return {
    id: "pattern-1",
    documentKey: "project:main.tex",
    kind: "replace",
    signature: "replace\0foo\0bar",
    oldText: "foo",
    newText: "bar",
    examples: [example(), example({ id: "edit-2", startOffsetBefore: 40 })],
    createdAt: 100,
    lastSeenAt: 200,
    accepts: 0,
    dismissals: 0,
    ...partial,
  };
}

function rawCandidate(
  editPattern = pattern(),
  partial: Partial<PatternRawCandidate> = {},
): PatternRawCandidate {
  return {
    id: "candidate-1",
    documentKey: "project:main.tex",
    kind: editPattern.kind,
    startOffset: 60,
    endOffset: 63,
    expectedText: "foo",
    replacementText: "bar",
    basedOnRevision: 3,
    patternId: editPattern.id,
    pattern: editPattern,
    beforeContext: "same prefix ",
    afterContext: " same suffix",
    latexContext: baseContext,
    ...partial,
  };
}

function session(partial: Partial<DocumentEditSession> = {}): DocumentEditSession {
  return {
    documentKey: "project:main.tex",
    revision: 3,
    recentEdits: [],
    acceptedPredictionIds: new Set(),
    dismissedPatternIds: new Map(),
    ...partial,
  };
}

describe("candidateRanker", () => {
  it("computes prefix and suffix similarity near the edit boundary", () => {
    expect(commonSuffixSimilarity("abcXYZ", "123XYZ")).toBeGreaterThan(0.4);
    expect(commonSuffixSimilarity("abcXYZ", "XYZ123")).toBe(0);
    expect(commonPrefixSimilarity("XYZabc", "XYZ123")).toBeGreaterThan(0.4);
    expect(commonPrefixSimilarity("XYZabc", "123XYZ")).toBe(0);
  });

  it("rewards matching before and after context", () => {
    const high = rankPatternCandidate(rawCandidate(), session(), 63, 200);
    const low = rankPatternCandidate(
      rawCandidate(pattern(), {
        beforeContext: "different ",
        afterContext: " other",
      }),
      session(),
      63,
      200,
    );

    expect(high.confidence).toBeGreaterThan(low.confidence);
    expect(high.debug?.features.prefix).toBe(1);
    expect(high.debug?.features.suffix).toBe(1);
  });

  it("rewards matching LaTeX structure", () => {
    const high = rankPatternCandidate(rawCandidate(), session(), 63, 200);
    const low = rankPatternCandidate(
      rawCandidate(pattern(), {
        latexContext: {
          indentation: "  ",
          section: "\\section{Other}",
          environment: "table",
          command: "\\caption",
          inMath: true,
          inComment: true,
        },
      }),
      session(),
      63,
      200,
    );

    expect(high.debug?.features.structure).toBe(1);
    expect(low.debug?.features.structure).toBe(0);
    expect(high.confidence).toBeGreaterThan(low.confidence);
  });

  it("rewards the recent edit direction", () => {
    const forward = rankPatternCandidate(rawCandidate(), session(), 63, 200);
    const backward = rankPatternCandidate(
      rawCandidate(pattern(), { startOffset: 10, endOffset: 13 }),
      session(),
      63,
      200,
    );

    expect(forward.debug?.features.direction).toBe(1);
    expect(backward.debug?.features.direction).toBe(0);
    expect(forward.confidence).toBeGreaterThan(backward.confidence);
  });

  it("rewards proximity to the cursor or recent edit frontier", () => {
    const near = rankPatternCandidate(rawCandidate(), session(), 64, 200);
    const far = rankPatternCandidate(
      rawCandidate(pattern(), { startOffset: 5_000, endOffset: 5_003 }),
      session(),
      0,
      200,
    );

    expect(near.debug?.features.proximity).toBeGreaterThan(
      far.debug?.features.proximity ?? 1,
    );
  });

  it("uses acceptance and dismissal priors", () => {
    const accepted = rankPatternCandidate(
      rawCandidate(pattern({ accepts: 4 })),
      session(),
      63,
      200,
    );
    const dismissed = rankPatternCandidate(
      rawCandidate(pattern({ dismissals: 4 })),
      session({
        dismissedPatternIds: new Map([["pattern-1", 180]]),
      }),
      63,
      200,
    );

    expect(accepted.debug?.features.acceptance).toBeGreaterThan(0);
    expect(dismissed.debug?.features.dismissal).toBe(1);
    expect(accepted.confidence).toBeGreaterThan(dismissed.confidence);
  });

  it("deduplicates semantic agreement with deterministic candidates", () => {
    const ranked = rankCandidates({
      patternCandidates: [rawCandidate()],
      semanticCandidates: [
        {
          id: "semantic-1",
          documentKey: "project:main.tex",
          source: "semantic",
          startOffset: 60,
          endOffset: 63,
          expectedText: "foo",
          replacementText: "bar",
          confidence: 0.71,
          reason: "model",
          basedOnRevision: 3,
          modelRequestId: "request-1",
        },
      ],
      session: session(),
      cursorOffset: 63,
      revision: 3,
      now: 200,
    });

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.modelRequestId).toBe("request-1");
    expect(ranked[0]?.confidence).toBeGreaterThan(0.71);
  });

  it("filters stale revision candidates", () => {
    const ranked = rankCandidates({
      patternCandidates: [rawCandidate(pattern(), { basedOnRevision: 2 })],
      session: session(),
      cursorOffset: 63,
      revision: 3,
      now: 200,
    });

    expect(ranked).toEqual([]);
  });
});
