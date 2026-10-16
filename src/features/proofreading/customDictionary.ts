// The user's custom dictionary, readable from anywhere in the renderer (AI
// prompts, rewrites) without threading settings through every caller. The
// spell-checker settings state keeps it current.

let customWords: readonly string[] = [];

export function setCustomDictionaryWords(words: readonly string[]): void {
  customWords = [...words];
}

export function getCustomDictionaryWords(): readonly string[] {
  return customWords;
}

const maxPromptWords = 300;

/**
 * Prompt text telling a model the user's dictionary words are spelled as the
 * user wants. Empty when the dictionary is empty.
 */
export function customDictionaryPromptSection(
  words: readonly string[] = customWords,
): string {
  if (!words.length) return "";
  const shown = words.slice(0, maxPromptWords);
  const more =
    words.length > shown.length ? ` (and ${words.length - shown.length} more)` : "";
  return `The user's custom dictionary lists words they spell on purpose: ${shown.join(", ")}${more}. Treat them as correctly spelled: never correct, respell, or flag them as typos, and keep their exact spelling when rewriting.`;
}
