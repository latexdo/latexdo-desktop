import type { ChatMessage } from "../../ai/aiTypes";
import { customDictionaryPromptSection } from "../../proofreading/customDictionary";
import type { SemanticNextEditInput, SupportedNextEditLanguage } from "./nextEditTypes";

export interface NextEditModelContext {
  language: SupportedNextEditLanguage;
  documentWindow: string;
  windowStartOffset: number;
  cursorOffsetInWindow: number;
  recentEdits: Array<{
    oldText: string;
    newText: string;
    relativeLocation: number;
  }>;
  deterministicCandidates: Array<{
    index: number;
    start: number;
    end: number;
    expected: string;
    replacement: string;
    score: number;
  }>;
}

export function buildNextEditModelContext(
  input: SemanticNextEditInput,
  maxWindowChars = 4_000,
): NextEditModelContext {
  const anchorOffsets = [
    input.cursorOffset,
    ...input.deterministicCandidates
      .slice(0, 8)
      .flatMap((candidate) => [candidate.startOffset, candidate.endOffset]),
    ...input.recentEdits.slice(-4).map((edit) => edit.startOffsetBefore),
  ];
  const minAnchor = Math.max(0, Math.min(...anchorOffsets));
  const maxAnchor = Math.min(input.snapshot.text.length, Math.max(...anchorOffsets));
  const padding = Math.max(
    400,
    Math.floor((maxWindowChars - (maxAnchor - minAnchor)) / 2),
  );
  let start = Math.max(0, minAnchor - padding);
  let end = Math.min(input.snapshot.text.length, maxAnchor + padding);

  if (end - start > maxWindowChars) {
    const cursor = Math.min(
      input.snapshot.text.length,
      Math.max(0, input.cursorOffset),
    );
    start = Math.max(0, cursor - Math.floor(maxWindowChars / 2));
    end = Math.min(input.snapshot.text.length, start + maxWindowChars);
    start = Math.max(0, end - maxWindowChars);
  }

  return {
    language: input.snapshot.language,
    documentWindow: input.snapshot.text.slice(start, end),
    windowStartOffset: start,
    cursorOffsetInWindow: Math.min(
      end - start,
      Math.max(0, input.cursorOffset - start),
    ),
    recentEdits: input.recentEdits.slice(-8).map((edit) => ({
      oldText: edit.oldText.slice(0, 160),
      newText: edit.newText.slice(0, 160),
      relativeLocation: edit.startOffsetBefore - start,
    })),
    deterministicCandidates: input.deterministicCandidates
      .slice(0, 8)
      .map((candidate, index) => ({
        index,
        start: candidate.startOffset - start,
        end: candidate.endOffset - start,
        expected: candidate.expectedText,
        replacement: candidate.replacementText,
        score: Number(candidate.confidence.toFixed(3)),
      }))
      .filter(
        (candidate) =>
          candidate.start >= 0 &&
          candidate.end >= candidate.start &&
          candidate.end <= end - start,
      ),
  };
}

export function buildNextEditMessages(context: NextEditModelContext): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You predict one next editor edit for a LaTeX author. Return JSON only. Do not explain. Use offsets relative to the supplied document_window.",
        customDictionaryPromptSection(),
      ]
        .filter(Boolean)
        .join(" "),
    },
    {
      role: "user",
      content: [
        "Predict the next edit only if it is very likely.",
        'Return {"action":"none"} when uncertain.',
        'For a new edit return {"action":"edit","start":123,"end":131,"expected":"old text","replacement":"new text","confidence":0.82}.',
        'If the best answer is one deterministic candidate, return {"candidate":0} using the candidate index.',
        "Never edit outside document_window. Preserve LaTeX syntax. Do not include Markdown.",
        `language: ${context.language}`,
        `cursor_offset_in_window: ${context.cursorOffsetInWindow}`,
        `recent_edits: ${JSON.stringify(context.recentEdits)}`,
        `deterministic_candidates: ${JSON.stringify(context.deterministicCandidates)}`,
        `document_window:\n${context.documentWindow}`,
      ].join("\n\n"),
    },
  ];
}
