import { describe, expect, it } from "vitest";
import {
  AiSemanticNextEditPredictor,
  parseNextEditModelResponse,
} from "./semanticPredictor";
import type { NextEditModelClient } from "./nextEditModelClient";
import type { DocumentSnapshot, SemanticNextEditInput } from "./nextEditTypes";
import type { NextEditModelContext } from "./nextEditPrompt";

const snapshot: DocumentSnapshot = {
  documentKey: "project:main.tex",
  revision: 7,
  text: "alpha beta gamma",
  language: "latex",
};

const context: NextEditModelContext = {
  language: "latex",
  documentWindow: snapshot.text,
  windowStartOffset: 0,
  cursorOffsetInWindow: 6,
  recentEdits: [],
  deterministicCandidates: [
    {
      index: 0,
      start: 6,
      end: 10,
      expected: "beta",
      replacement: "BETA",
      score: 0.73,
    },
  ],
};

const input: SemanticNextEditInput = {
  snapshot,
  cursorOffset: 6,
  recentEdits: [],
  deterministicCandidates: [],
  requestId: "request-1",
  basedOnRevision: 7,
};

class FakeClient implements NextEditModelClient {
  constructor(private readonly result: string | null | Error) {}

  async complete() {
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

describe("semanticPredictor", () => {
  it("parses a valid bounded edit JSON response", () => {
    const candidate = parseNextEditModelResponse(
      '{"action":"edit","start":6,"end":10,"expected":"beta","replacement":"delta","confidence":0.82}',
      context,
      input,
    );

    expect(candidate).toMatchObject({
      source: "semantic",
      startOffset: 6,
      endOffset: 10,
      expectedText: "beta",
      replacementText: "delta",
      basedOnRevision: 7,
    });
    expect(candidate?.confidence).toBeGreaterThan(0.7);
  });

  it("parses a single Markdown-fenced JSON response", () => {
    const candidate = parseNextEditModelResponse(
      '```json\n{"action":"edit","start":0,"end":5,"expected":"alpha","replacement":"ALPHA","confidence":1}\n```',
      context,
      input,
    );

    expect(candidate?.replacementText).toBe("ALPHA");
  });

  it("returns null for malformed JSON and none actions", () => {
    expect(parseNextEditModelResponse("try beta", context, input)).toBeNull();
    expect(parseNextEditModelResponse('{"action":"none"}', context, input)).toBeNull();
  });

  it("rejects out-of-range offsets", () => {
    expect(
      parseNextEditModelResponse(
        '{"action":"edit","start":6,"end":99,"expected":"beta","replacement":"delta","confidence":0.9}',
        context,
        input,
      ),
    ).toBeNull();
  });

  it("rejects mismatched expected text", () => {
    expect(
      parseNextEditModelResponse(
        '{"action":"edit","start":6,"end":10,"expected":"wrong","replacement":"delta","confidence":0.9}',
        context,
        input,
      ),
    ).toBeNull();
  });

  it("rejects enormous replacements", () => {
    expect(
      parseNextEditModelResponse(
        JSON.stringify({
          action: "edit",
          start: 6,
          end: 10,
          expected: "beta",
          replacement: "x".repeat(600),
          confidence: 0.9,
        }),
        context,
        input,
      ),
    ).toBeNull();
  });

  it("supports deterministic candidate selection mode for small models", () => {
    const candidate = parseNextEditModelResponse('{"candidate":0}', context, input);

    expect(candidate).toMatchObject({
      startOffset: 6,
      endOffset: 10,
      expectedText: "beta",
      replacementText: "BETA",
      modelRequestId: "request-1",
    });
    expect(candidate?.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("returns null when the provider fails or returns no content", async () => {
    await expect(
      new AiSemanticNextEditPredictor(new FakeClient(null)).predict(
        input,
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
    await expect(
      new AiSemanticNextEditPredictor(new FakeClient(new Error("offline"))).predict(
        input,
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
  });

  it("returns null after abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const predictor = new AiSemanticNextEditPredictor(
      new FakeClient(
        '{"action":"edit","start":6,"end":10,"expected":"beta","replacement":"delta","confidence":0.9}',
      ),
    );

    await expect(predictor.predict(input, controller.signal)).resolves.toBeNull();
  });
});
