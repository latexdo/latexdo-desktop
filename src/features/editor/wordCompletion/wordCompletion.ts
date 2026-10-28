// Plain word completion for prose: words already in the project first (most
// used first), then common English words ranked by how common they are. No AI.

/** A dictionary word and how common it is (0 is most common). */
export interface DictionaryWord {
  word: string;
  /** Lower-cased, for prefix search. */
  key: string;
  tier: number;
}

export interface WordSuggestion {
  word: string;
  source: "document" | "dictionary";
}

/** Shortest typed prefix that shows suggestions. */
export const MIN_PREFIX_LENGTH = 2;
const MIN_DOCUMENT_WORD_LENGTH = 3;
const DEFAULT_LIMIT = 40;

// Commands whose argument holds keys, names or paths, not prose.
const nonProseCommand =
  "\\\\(?:cite[a-zA-Z]*|[a-zA-Z]*ref|label|begin|end|usepackage|RequirePackage|documentclass|input|include|includegraphics|includeonly|bibliography|bibliographystyle|addbibresource|url|href|newcommand|renewcommand|providecommand|newenvironment|renewenvironment|DeclareMathOperator|hypersetup|graphicspath|lstinputlisting|pagestyle|thispagestyle|setlength|setcounter|addtocounter|color|textcolor|definecolor)\\*?(?:\\[[^\\]]*\\])*\\{";
/** The cursor is inside such an argument. */
const openNonProseArgument = new RegExp(`${nonProseCommand}[^}]*$`);
/** Such an argument, opened and closed. */
const nonProseArgument = new RegExp(`${nonProseCommand}[^}]*\\}?`, "g");

/**
 * True when the word ending at `column` (1-based, as in Monaco) is prose:
 * not a command name, not a key or path argument, not inline math and not
 * after a comment marker.
 */
export function isProseWordContext(lineText: string, column: number): boolean {
  const before = lineText.slice(0, column - 1);
  const wordStart = before.search(/[\p{L}\p{M}]*$/u);
  if (wordStart > 0 && before[wordStart - 1] === "\\") return false;
  const head = before.slice(0, wordStart);
  if (openNonProseArgument.test(head)) return false;
  // An odd number of unescaped $ means the cursor is in inline math.
  const dollars = head.replace(/\\\$/g, "").match(/\$/g)?.length ?? 0;
  if (dollars % 2 === 1) return false;
  if (/\\\(((?!\\\)).)*$/.test(head) || /\\\[((?!\\\]).)*$/.test(head)) return false;
  return true;
}

/**
 * Counts the prose words in LaTeX source. Command names and the contents of
 * key/path arguments (labels, citations, packages…) are skipped.
 */
export function countDocumentWords(
  text: string,
  counts: Map<string, number> = new Map(),
): Map<string, number> {
  const prose = text
    .replace(/(^|[^\\])%.*$/gm, "$1")
    .replace(nonProseArgument, " ")
    .replace(/\\[a-zA-Z@]+\*?/g, " ")
    .replace(/\$[^$]*\$/g, " ");
  // Hyphens and apostrophes split words, as they do for the editor.
  for (const [word] of prose.matchAll(/\p{L}[\p{L}\p{M}]*/gu)) {
    if (word.length < MIN_DOCUMENT_WORD_LENGTH) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}

/** Shapes a suggestion like what was typed: "Th" → "The", "TH" → "THE". */
export function matchTypedCase(word: string, typed: string): string {
  // Words with their own capitals (LaTeX, PhD) keep their spelling.
  if (/\p{Lu}/u.test(word.slice(1))) return word;
  if (
    typed.length > 1 &&
    typed === typed.toUpperCase() &&
    typed !== typed.toLowerCase()
  )
    return word.toUpperCase();
  if (
    typed[0] &&
    typed[0] === typed[0].toUpperCase() &&
    typed[0] !== typed[0].toLowerCase()
  )
    return word[0].toUpperCase() + word.slice(1);
  return word;
}

/** Index of the first dictionary entry whose key is >= `prefix`. */
function lowerBound(dictionary: readonly DictionaryWord[], prefix: string): number {
  let low = 0;
  let high = dictionary.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (dictionary[mid].key < prefix) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Sorts dictionary words for prefix search with `rankWordCompletions`. */
export function sortDictionary(words: DictionaryWord[]): DictionaryWord[] {
  return words.sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : a.tier - b.tier,
  );
}

/**
 * Words that complete `typed`, best first: project words by how often they
 * are used, then dictionary words by how common they are, shorter first.
 */
export function rankWordCompletions(
  typed: string,
  documentWords: ReadonlyMap<string, number>,
  dictionary: readonly DictionaryWord[] = [],
  limit = DEFAULT_LIMIT,
): WordSuggestion[] {
  if (typed.length < MIN_PREFIX_LENGTH) return [];
  const prefix = typed.toLowerCase();
  const seen = new Set<string>();
  const results: WordSuggestion[] = [];

  // "The" at the start of a sentence is the word "the"; "Monaco" stays a name.
  const isOrdinaryWord = (lower: string) => {
    if (documentWords.has(lower)) return true;
    const entry = dictionary[lowerBound(dictionary, lower)];
    return entry?.key === lower && entry.word === lower;
  };
  const merged = new Map<string, number>();
  for (const [word, count] of documentWords) {
    if (word.length <= typed.length || !word.toLowerCase().startsWith(prefix)) continue;
    const lower = word.toLowerCase();
    const spelling =
      word !== lower && word.slice(1) === lower.slice(1) && isOrdinaryWord(lower)
        ? lower
        : word;
    merged.set(spelling, (merged.get(spelling) ?? 0) + count);
  }
  const fromDocument = [...merged].sort(
    ([a, countA], [b, countB]) =>
      countB - countA || a.length - b.length || (a < b ? -1 : 1),
  );
  for (const [word] of fromDocument) {
    const shaped = matchTypedCase(word, typed);
    const key = shaped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ word: shaped, source: "document" });
  }

  const fromDictionary: DictionaryWord[] = [];
  for (let i = lowerBound(dictionary, prefix); i < dictionary.length; i += 1) {
    const entry = dictionary[i];
    if (!entry.key.startsWith(prefix)) break;
    if (entry.word.length > typed.length && !seen.has(entry.key))
      fromDictionary.push(entry);
  }
  fromDictionary.sort(
    (a, b) =>
      a.tier - b.tier || a.word.length - b.word.length || (a.key < b.key ? -1 : 1),
  );
  for (const entry of fromDictionary) {
    if (results.length >= limit) break;
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    results.push({ word: matchTypedCase(entry.word, typed), source: "dictionary" });
  }
  return results.slice(0, limit);
}
