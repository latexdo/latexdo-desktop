// Full-sentence ghost-text completion for LaTeX prose. Pure helpers: when to
// offer a completion, the prompt, and how to turn a model reply into exactly
// one finished sentence. The Monaco wiring lives in registerSentenceCompletion.

import type { ChatMessage } from "../../ai/aiTypes";
import { customDictionaryPromptSection } from "../../proofreading/customDictionary";

/** Characters of preceding text sent to the model. */
export const sentenceCompletionContextChars = 2_000;
/** Words the current sentence needs before a completion is worth offering. */
const minSentenceWords = 3;
const maxCompletionChars = 400;

const mathEnvironments =
  /\\begin\{(equation|align|gather|multline|eqnarray|math|displaymath|tikzpicture|verbatim|lstlisting|minted)\*?\}/g;
const argumentCommands =
  /\\(?:[a-zA-Z]*cite[a-zA-Z]*|[a-zA-Z]*ref|label|input|include|includegraphics|usepackage|documentclass|begin|end|url|href)\*?(?:\[[^\]]*\])*\{[^}]*$/;
const abbreviations =
  /(?:\b(?:e\.g|i\.e|et al|cf|vs|etc|Fig|Figs|Eq|Eqs|Sec|Tab|resp|approx|No|Dr|Prof)|\b[A-Z])\.$/;

/** The text before the caret in the current paragraph. */
function currentParagraph(textBefore: string): string {
  const breakIndex = textBefore.search(/\n\s*\n(?![\s\S]*\n\s*\n)/);
  return breakIndex < 0 ? textBefore : textBefore.slice(breakIndex);
}

function insideMath(textBefore: string): boolean {
  const paragraph = currentParagraph(textBefore);
  const dollars = paragraph.replace(/\\\$/g, "").match(/\$/g)?.length ?? 0;
  if (dollars % 2 === 1) return true;
  const opens = paragraph.lastIndexOf("\\[");
  if (opens >= 0 && paragraph.indexOf("\\]", opens) < 0) return true;
  const opensParen = paragraph.lastIndexOf("\\(");
  if (opensParen >= 0 && paragraph.indexOf("\\)", opensParen) < 0) return true;
  let lastOpen = -1;
  let lastName = "";
  for (const match of textBefore.matchAll(mathEnvironments)) {
    lastOpen = match.index ?? -1;
    lastName = match[1];
  }
  if (lastOpen < 0) return false;
  return !new RegExp(`\\\\end\\{${lastName}\\*?\\}`).test(textBefore.slice(lastOpen));
}

/** The unfinished sentence the caret sits at the end of, or null. */
export function unfinishedSentence(
  textBefore: string,
  lineAfter: string,
): string | null {
  if (lineAfter.trim()) return null;
  const line = textBefore.slice(textBefore.lastIndexOf("\n") + 1);
  if (/(^|[^\\])%/.test(line)) return null;
  if (/\\[a-zA-Z@]*$/.test(textBefore)) return null;
  if (argumentCommands.test(line)) return null;
  if (insideMath(textBefore)) return null;
  const paragraph = currentParagraph(textBefore);
  const trimmed = paragraph.trimEnd();
  if (!trimmed || (/[.!?:;]$/.test(trimmed) && !abbreviations.test(trimmed)))
    return null;
  if (/^\s*\\(section|subsection|subsubsection|chapter|paragraph|item)\b/.test(line)) {
    return null;
  }
  const sentenceStart = Math.max(
    ...[". ", "! ", "? ", ".\n", "!\n", "?\n"].map((mark) => {
      const index = trimmed.lastIndexOf(mark);
      return index < 0 ? -1 : index + mark.length;
    }),
    0,
  );
  const sentence = trimmed.slice(sentenceStart).trim();
  const words = sentence
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^}]*\})?/g, " ")
    .split(/\s+/)
    .filter((word) => /[a-zA-Z]{2,}/.test(word));
  return words.length >= minSentenceWords ? sentence : null;
}

export function buildSentenceCompletionMessages(textBefore: string): ChatMessage[] {
  const context = textBefore.slice(-sentenceCompletionContextChars);
  return [
    {
      role: "system",
      content: [
        "You are the autocomplete of an academic LaTeX editor.",
        "Continue the author's unfinished last sentence so that it becomes one complete, well-formed sentence.",
        "Reply with only the words that come right after the cursor: no quotes, no Markdown, no explanations, no second sentence.",
        "Match the author's terminology, tense and tone. Keep LaTeX valid and only use commands the text already uses. Never invent citations.",
        customDictionaryPromptSection(),
      ]
        .filter(Boolean)
        .join(" "),
    },
    {
      role: "user",
      content: `Text before the cursor:\n<<<\n${context}\n>>>\nContinue the last sentence and end it with its final punctuation.`,
    },
  ];
}

function firstSentenceEnd(text: string): number {
  const pattern = /[.!?](?=["')\]}]*(\s|$))/g;
  for (const match of text.matchAll(pattern)) {
    const end = (match.index ?? 0) + 1;
    if (!abbreviations.test(text.slice(0, end))) return end;
  }
  return -1;
}

/**
 * Turns a model reply into the text to insert: one finished sentence, no
 * repeated prefix. Returns null when the reply does not finish the sentence.
 */
export function cleanSentenceCompletion(
  reply: string,
  textBefore: string,
): string | null {
  let text = reply
    .replace(/^```[a-z]*\s*|```\s*$/g, "")
    .replace(/^\s*(continuation|completion|answer)\s*:\s*/i, "")
    .replace(/\s*\n+\s*/g, " ");
  text = text.replace(/^["“'`]+|["”'`]+$/g, "");
  if (!text.trim()) return null;

  // Small models often echo the end of the sentence before continuing it.
  const tail = textBefore.slice(-200);
  const trimmedStart = text.trimStart();
  for (
    let length = Math.min(trimmedStart.length, tail.length);
    length >= 8;
    length -= 1
  ) {
    if (tail.endsWith(trimmedStart.slice(0, length))) {
      text = trimmedStart.slice(length);
      break;
    }
  }

  const end = firstSentenceEnd(text);
  if (end < 0) return null;
  text = text.slice(0, end);
  if (/\s$/.test(textBefore)) text = text.trimStart();
  else if (/[,;:]$/.test(textBefore) && /^[A-Za-z(]/.test(text)) text = ` ${text}`;
  if (!text.trim() || text.length > maxCompletionChars) return null;
  return text;
}
