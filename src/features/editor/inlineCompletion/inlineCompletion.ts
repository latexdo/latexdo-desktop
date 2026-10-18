// Copilot-style ghost text for LaTeX. Pure helpers: where a suggestion may
// appear, the fill-in-the-middle prompt, and how a model reply becomes the text
// to insert. The Monaco wiring lives in registerInlineCompletion.

import type { ChatMessage } from "../../ai/aiTypes";
import { customDictionaryPromptSection } from "../../proofreading/customDictionary";

/** Characters before the cursor sent to the model. */
export const inlineCompletionPrefixChars = 3_000;
/** Characters after the cursor sent to the model. */
export const inlineCompletionSuffixChars = 1_000;
const maxCompletionLines = 8;
const maxCompletionChars = 600;
/** Overlap with the end of the text that counts as the model echoing it. */
const minEchoChars = 6;

export const cursorMarker = "<CURSOR>";

export interface InlineCompletionContext {
  /** Text before the cursor, at most inlineCompletionPrefixChars. */
  prefix: string;
  /** Text after the cursor, at most inlineCompletionSuffixChars. */
  suffix: string;
  /** The rest of the cursor's line. */
  lineSuffix: string;
}

export function inlineCompletionContext(
  text: string,
  offset: number,
): InlineCompletionContext {
  const suffix = text.slice(offset, offset + inlineCompletionSuffixChars);
  const lineBreak = suffix.indexOf("\n");
  return {
    prefix: text.slice(Math.max(0, offset - inlineCompletionPrefixChars), offset),
    suffix,
    lineSuffix: lineBreak < 0 ? suffix : suffix.slice(0, lineBreak),
  };
}

const argumentCommands =
  /\\(?:[a-zA-Z]*cite[a-zA-Z]*|[a-zA-Z]*ref|label|input|include|includegraphics|usepackage|documentclass|url|href)\*?(?:\[[^\]]*\])*\{[^}]*$/;

/**
 * Whether ghost text may appear here. Like Copilot, it appears at the end of a
 * line or before closing brackets and punctuation only, so it never covers
 * text the author already wrote. A request the author made (Alt+\) is honored
 * in more places than one made by a pause in typing.
 */
export function shouldOfferInlineCompletion(
  context: InlineCompletionContext,
  explicit: boolean,
): boolean {
  if (!/^[\s)\]}$'".,;:`]*$/.test(context.lineSuffix)) return false;
  if (context.prefix.trim().length === 0) return false;
  if (explicit) return true;
  const line = context.prefix.slice(context.prefix.lastIndexOf("\n") + 1);
  // A comment holds notes to self; a command name or a key is the suggest
  // list's job, and a model would invent citation keys and labels.
  if (/(^|[^\\])%/.test(line)) return false;
  if (/\\[a-zA-Z@]*$/.test(context.prefix)) return false;
  if (argumentCommands.test(line)) return false;
  return context.prefix.trim().length >= 20;
}

export function buildInlineCompletionMessages(
  context: InlineCompletionContext,
  fileName: string,
): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are the inline autocomplete of a LaTeX editor, like GitHub Copilot.",
        `Write the text that belongs at ${cursorMarker}.`,
        "Reply with only that text: no quotes, no Markdown fences, no explanations.",
        "Never repeat text that is already before or after the cursor.",
        "Usually finish the current sentence, line or LaTeX construct; continue over a few lines only when the structure calls for it, such as list items or closing an environment, and stop at the end of the paragraph.",
        "Match the author's language, terminology, tense and style. Keep LaTeX valid. Never invent citations, labels or references that do not appear in the text.",
        customDictionaryPromptSection(),
      ]
        .filter(Boolean)
        .join(" "),
    },
    {
      role: "user",
      content: `File: ${fileName || "document.tex"}\n<<<\n${context.prefix}${cursorMarker}${context.suffix}\n>>>`,
    },
  ];
}

const abbreviations =
  /(?:\b(?:e\.g|i\.e|et al|cf|vs|etc|Fig|Figs|Eq|Eqs|Sec|Tab|resp|approx|No|Dr|Prof)|\b[A-Z])\.$/;

function firstSentenceEnd(text: string): number {
  const pattern = /[.!?](?=["')\]}]*(\s|$))/g;
  for (const match of text.matchAll(pattern)) {
    const end = (match.index ?? 0) + 1;
    if (!abbreviations.test(text.slice(0, end))) return end;
  }
  return -1;
}

/**
 * Turns a model reply into the ghost text to show, or null when nothing useful
 * is left: fences and labels go, text the model echoed from before or after
 * the cursor goes, and the suggestion stops at the end of a paragraph.
 */
export function cleanInlineCompletion(
  reply: string,
  context: InlineCompletionContext,
): string | null {
  let text = reply
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*```[a-z]*\n?|\n?```\s*$/g, "")
    .replace(/^\s*(continuation|completion|answer|insert(ion)?)\s*:\s*/i, "")
    .replaceAll(cursorMarker, "");
  if (!text.includes("\n")) text = text.replace(/^["“`]+|["”`]+$/g, "");
  if (!text.trim()) return null;

  // Small models often start by repeating the end of the text.
  const tail = context.prefix.slice(-300);
  const start = text.trimStart();
  for (
    let length = Math.min(start.length, tail.length);
    length >= minEchoChars;
    length--
  ) {
    if (tail.endsWith(start.slice(0, length))) {
      text = start.slice(length);
      break;
    }
  }

  // Stop at the end of the paragraph.
  const paragraphEnd = text.search(/\n[ \t]*\n/);
  if (paragraphEnd >= 0) text = text.slice(0, paragraphEnd);

  // Before closing brackets or punctuation, Copilot suggests one line only.
  if (context.lineSuffix.trim()) text = text.split("\n")[0];

  const lines = text.split("\n");
  if (lines.length > maxCompletionLines) {
    text = lines.slice(0, maxCompletionLines).join("\n");
  }

  // Prose on one line ends with its sentence.
  if (!text.includes("\n") && !/\\(begin|item)\b/.test(text)) {
    const end = firstSentenceEnd(text);
    if (end >= 0) text = text.slice(0, end);
  }

  // Drop the end that repeats the text right after the cursor.
  const lineSuffix = context.lineSuffix;
  for (let length = Math.min(text.length, lineSuffix.length); length >= 1; length--) {
    if (text.endsWith(lineSuffix.slice(0, length))) {
      text = text.slice(0, -length);
      break;
    }
  }

  if (/[ \t]$/.test(context.prefix)) text = text.replace(/^[ \t]+/, "");
  text = text.replace(/[ \t]+$/, "");
  if (!text.trim() || text.length > maxCompletionChars) return null;
  return text;
}
