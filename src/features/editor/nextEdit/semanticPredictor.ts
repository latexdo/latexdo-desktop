import {
  buildNextEditMessages,
  buildNextEditModelContext,
  type NextEditModelContext,
} from "./nextEditPrompt";
import type { NextEditModelClient } from "./nextEditModelClient";
import {
  MAX_SEMANTIC_REPLACEMENT_TEXT,
  createNextEditId,
  type NextEditCandidate,
  type SemanticNextEditInput,
  type SemanticNextEditPredictor,
} from "./nextEditTypes";

export class AiSemanticNextEditPredictor implements SemanticNextEditPredictor {
  constructor(private readonly modelClient: NextEditModelClient) {}

  async predict(
    input: SemanticNextEditInput,
    signal: AbortSignal,
  ): Promise<NextEditCandidate | null> {
    const context = buildNextEditModelContext(input);
    let content: string | null;
    try {
      content = await this.modelClient.complete(
        {
          requestId: input.requestId,
          messages: buildNextEditMessages(context),
        },
        signal,
      );
    } catch {
      content = null;
    }
    if (!content || signal.aborted) return null;
    return parseNextEditModelResponse(content, context, input);
  }
}

export function parseNextEditModelResponse(
  text: string,
  context: NextEditModelContext,
  input: Pick<SemanticNextEditInput, "snapshot" | "requestId" | "basedOnRevision">,
): NextEditCandidate | null {
  const parsed = parseJsonObject(text);
  if (!parsed) return null;

  const candidateIndex = parsed.candidate;
  if (Number.isInteger(candidateIndex)) {
    const deterministic = context.deterministicCandidates.find(
      (candidate) => candidate.index === candidateIndex,
    );
    if (!deterministic) return null;
    return {
      id: createNextEditId("semantic-candidate"),
      documentKey: input.snapshot.documentKey,
      source: "semantic",
      startOffset: context.windowStartOffset + deterministic.start,
      endOffset: context.windowStartOffset + deterministic.end,
      expectedText: deterministic.expected,
      replacementText: deterministic.replacement,
      confidence: Math.max(0.7, Math.min(0.82, deterministic.score + 0.04)),
      reason: "semantic model selected deterministic candidate",
      basedOnRevision: input.basedOnRevision,
      modelRequestId: input.requestId,
    };
  }

  if (parsed.action === "none") return null;
  if (parsed.action !== "edit") return null;
  if (!Number.isInteger(parsed.start) || !Number.isInteger(parsed.end)) return null;
  if (typeof parsed.expected !== "string") return null;
  if (typeof parsed.replacement !== "string") return null;
  if (parsed.replacement.length > MAX_SEMANTIC_REPLACEMENT_TEXT) return null;

  const start = typeof parsed.start === "number" ? parsed.start : -1;
  const end = typeof parsed.end === "number" ? parsed.end : -1;
  if (start < 0 || end < start || end > context.documentWindow.length) return null;
  if (context.documentWindow.slice(start, end) !== parsed.expected) return null;

  const modelConfidence =
    typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
      ? clamp01(parsed.confidence)
      : 0.5;
  return {
    id: createNextEditId("semantic-candidate"),
    documentKey: input.snapshot.documentKey,
    source: "semantic",
    startOffset: context.windowStartOffset + start,
    endOffset: context.windowStartOffset + end,
    expectedText: parsed.expected,
    replacementText: parsed.replacement,
    confidence: clamp01(0.45 + 0.35 * modelConfidence),
    reason: "semantic model proposed bounded edit",
    basedOnRevision: input.basedOnRevision,
    modelRequestId: input.requestId,
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const stripped = stripSingleCodeFence(text.trim());
  const objectText = firstCompleteJsonObject(stripped);
  if (!objectText) return null;
  try {
    const parsed = JSON.parse(objectText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stripSingleCodeFence(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? (match[1]?.trim() ?? "") : text;
}

function firstCompleteJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
      if (depth < 0) return null;
    }
  }
  return null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
