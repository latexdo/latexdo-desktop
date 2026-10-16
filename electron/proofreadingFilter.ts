// Filters LanguageTool matches that are artifacts of checking LaTeX source.
//
// Before proofreading, LaTeX commands and comments are blanked out with spaces
// so offsets still line up with the source. That leaves long runs of spaces the
// grammar checker then reports ("you repeated a whitespace"), and matches that
// land on blanked text point at markup, not prose. LaTeX also collapses spaces,
// so whitespace rules never describe a real problem in the PDF.

const latexIrrelevantRules = new Set([
  "WHITESPACE_RULE",
  "CONSECUTIVE_SPACES",
  "WHITESPACE_PARAGRAPH",
  "WHITESPACE_PARAGRAPH_BEGIN",
]);

export function isProofreadingNoise(
  source: string,
  sanitized: string,
  offset: number,
  length: number,
  ruleId: string | undefined,
): boolean {
  if (ruleId && latexIrrelevantRules.has(ruleId)) return true;
  const end = Math.min(source.length, offset + Math.max(1, length));
  const original = source.slice(offset, end);
  // Only blank text in the match: nothing a writer could fix.
  if (!original.trim()) return true;
  // Part of the match was LaTeX markup that the sanitizer removed.
  return sanitized.slice(offset, end) !== original;
}

// LanguageTool's spelling rules: MORFOLOGIK_RULE_EN_US, HUNSPELL_RULE, ...
const spellingRulePattern = /MORFOLOGIK|HUNSPELL|SPELL/i;

/**
 * True when a spelling match flags a word from the user's dictionary. Only
 * spelling matches are dropped: a grammar rule on that word still applies.
 */
export function isCustomDictionaryMatch(
  flaggedText: string,
  ruleId: string | undefined,
  issueType: string | undefined,
  customWords: ReadonlySet<string>,
): boolean {
  if (!customWords.size) return false;
  const spelling =
    issueType === "misspelling" || Boolean(ruleId && spellingRulePattern.test(ruleId));
  if (!spelling) return false;
  return customWords.has(flaggedText.trim().toLocaleLowerCase());
}

/** Lookup set for `isCustomDictionaryMatch`; matching ignores case. */
export function customDictionarySet(words: readonly string[]): Set<string> {
  return new Set(words.map((word) => word.trim().toLocaleLowerCase()).filter(Boolean));
}
