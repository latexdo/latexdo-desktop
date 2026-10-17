/*
 * Exact-word synchronization between LaTeX source and its PDF.
 *
 * SyncTeX only knows lines (pdflatex records no columns) and, going forward,
 * the box of a whole PDF line. To land on the exact word, both directions
 * match the word together with a few words around it, read the way a reader
 * sees them: comments, command names, labels, citations and environment names
 * are not words of the text; ligatures (ﬁ), hyphenated line breaks, curly
 * quotes and accents are normalized.
 */

/** A clicked word and its neighbours, in reading order. */
export interface WordContext {
  word: string;
  before: string[];
  after: string[];
}

export interface SourceToken {
  /** As written in the source. */
  text: string;
  /** Normalized for comparison. */
  norm: string;
  /** 1-based line and column of the first character. */
  line: number;
  column: number;
  /** Characters on that line (tokens never span lines). */
  length: number;
}

export interface SourceWordMatch {
  line: number;
  column: number;
  length: number;
}

/** How many neighbours on each side are compared. */
export const contextSize = 4;

const wordPattern = /[\p{L}\p{N}]+/gu;

export function normalizeWord(word: string): string {
  return word.normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Words of a piece of visible text (a PDF text run), with offsets. */
export function textWords(
  text: string,
): Array<{ word: string; start: number; end: number }> {
  return Array.from(text.matchAll(wordPattern), (match) => ({
    word: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

// Commands whose arguments are not text the reader sees in the PDF.
const hiddenArgumentCommands = new Set([
  "label",
  "ref",
  "eqref",
  "pageref",
  "autoref",
  "cref",
  "Cref",
  "cite",
  "citep",
  "citet",
  "citeauthor",
  "citeyear",
  "parencite",
  "textcite",
  "autocite",
  "nocite",
  "begin",
  "end",
  "includegraphics",
  "input",
  "include",
  "subfile",
  "usepackage",
  "RequirePackage",
  "documentclass",
  "bibliography",
  "bibliographystyle",
  "addbibresource",
  "newcommand",
  "renewcommand",
  "providecommand",
  "newenvironment",
  "renewenvironment",
  "setlength",
  "addtolength",
  "vspace",
  "hspace",
  "color",
  "pagestyle",
  "thispagestyle",
  "graphicspath",
  "hypersetup",
  "geometry",
  "url",
]);

// \'e, \"{o}, \^a, \v{c}, \c{c}: one accented letter in the PDF.
const symbolAccent = /^\\['`^"~=.]\s*(?:\{\s*\\?([A-Za-z])\s*\}|([A-Za-z]))/;
const letterAccent = /^\\[uvHcdbrkt]\s*\{\s*([A-Za-z])\s*\}/;
const dotless = /^\\([ij])(?![A-Za-z])/;

function readAccent(
  text: string,
  index: number,
): { letter: string; end: number } | null {
  const rest = text.slice(index, index + 12);
  const match =
    symbolAccent.exec(rest) ?? letterAccent.exec(rest) ?? dotless.exec(rest);
  if (!match) return null;
  return { letter: (match[1] ?? match[2])!, end: index + match[0].length };
}

const wordChar = /[\p{L}\p{N}]/u;

/** A word starting at index (letters, digits and accent commands), or null. */
function readWord(text: string, index: number): { plain: string; end: number } | null {
  let plain = "";
  let position = index;
  while (position < text.length) {
    const char = text[position]!;
    if (wordChar.test(char)) {
      plain += char;
      position++;
      continue;
    }
    if (char === "\\") {
      const accent = readAccent(text, position);
      if (accent) {
        plain += accent.letter;
        position = accent.end;
        continue;
      }
    }
    // {\'e} inside a word.
    if (char === "{" || char === "}") {
      const accent = char === "{" ? readAccent(text, position + 1) : null;
      if (accent && text[accent.end] === "}") {
        plain += accent.letter;
        position = accent.end + 1;
        continue;
      }
    }
    break;
  }
  return plain ? { plain, end: position } : null;
}

/**
 * The words of LaTeX source as they appear in the PDF, in reading order, with
 * their positions in the source.
 */
export function sourceTokens(source: string): SourceToken[] {
  const tokens: SourceToken[] = [];
  const lines = source.split(/\r\n|\r|\n/);
  // A hidden argument being skipped (brace depth), and how many remain.
  let depth = 0;
  let groupsLeft = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const text = lines[lineIndex]!;
    let index = 0;
    while (index < text.length) {
      const char = text[index]!;
      if (depth > 0) {
        if (char === "\\") index += 2;
        else if (char === "%") break;
        else {
          if (char === "{") depth++;
          else if (char === "}" && --depth === 0) {
            groupsLeft--;
            // \begin{figure}[ht]: its options are not text either.
            if (text[index + 1] === "[") {
              const close = text.indexOf("]", index + 1);
              index = close < 0 ? text.length : close;
            }
          }
          index++;
        }
        continue;
      }
      if (groupsLeft > 0) {
        if (char === "{") {
          depth = 1;
          index++;
          continue;
        }
        if (char === " " || char === "\t" || char === "*") {
          index++;
          continue;
        }
        if (char === "[") {
          const close = text.indexOf("]", index);
          index = close < 0 ? text.length : close + 1;
          continue;
        }
        if (char !== "%") groupsLeft = 0;
      }
      if (char === "%") break;
      const word = readWord(text, index);
      if (word) {
        tokens.push({
          text: text.slice(index, word.end),
          norm: normalizeWord(word.plain),
          line: lineIndex + 1,
          column: index + 1,
          length: word.end - index,
        });
        index = word.end;
        continue;
      }
      if (char === "\\") {
        const name = /^[A-Za-z@]+/.exec(text.slice(index + 1))?.[0];
        if (!name) {
          index += 2;
          continue;
        }
        index += 1 + name.length;
        if (hiddenArgumentCommands.has(name)) {
          groupsLeft = name.endsWith("command")
            ? 2
            : name.endsWith("environment")
              ? 3
              : 1;
        }
        continue;
      }
      index++;
    }
  }
  return tokens;
}

/** The neighbours of tokens[index], as a context to search for elsewhere. */
export function contextAt<T extends { norm: string; text?: string; word?: string }>(
  tokens: readonly T[],
  index: number,
  size = contextSize,
): WordContext {
  const token = tokens[index]!;
  const word = (token.text ?? token.word ?? token.norm) as string;
  return {
    word,
    before: tokens.slice(Math.max(0, index - size), index).map((item) => item.norm),
    after: tokens.slice(index + 1, index + 1 + size).map((item) => item.norm),
  };
}

/** How well a word matches: 2 exactly, 1 as part of a hyphenated word, 0 not. */
export function wordSimilarity(candidate: string, wanted: string): number {
  if (!candidate || !wanted) return 0;
  if (candidate === wanted) return 2;
  // "vex-" + "ingly" in the PDF against "vexingly" in the source, either way.
  if (wanted.length >= 3 && candidate.length > wanted.length) {
    if (candidate.startsWith(wanted) || candidate.endsWith(wanted)) return 1;
  }
  if (candidate.length >= 3 && wanted.length > candidate.length) {
    if (wanted.startsWith(candidate) || wanted.endsWith(candidate)) return 1;
  }
  return 0;
}

/** Shared neighbours, nearest first counting most; order may differ slightly. */
export function contextScore(
  tokens: readonly { norm: string }[],
  index: number,
  context: WordContext,
): number {
  const side = (mine: string[], theirs: string[], nearestLast: boolean) => {
    let score = 0;
    const pool = new Map<string, number>();
    for (const word of theirs) pool.set(word, (pool.get(word) ?? 0) + 1);
    mine.forEach((word, position) => {
      const left = pool.get(word) ?? 0;
      if (!left) return;
      pool.set(word, left - 1);
      const distance = nearestLast ? mine.length - position : position + 1;
      score += 1 + 1 / distance;
    });
    return score;
  };
  const size = Math.max(context.before.length, context.after.length, 1);
  const before = tokens
    .slice(Math.max(0, index - size), index)
    .map((item) => item.norm);
  const after = tokens.slice(index + 1, index + 1 + size).map((item) => item.norm);
  return (
    side(before, context.before.map(normalizeWord), true) +
    side(after, context.after.map(normalizeWord), false)
  );
}

/**
 * Finds the word clicked in the PDF in the source file SyncTeX named, near
 * the line it named. Returns null when the word is not in this file.
 */
export function findSourceWord(
  source: string,
  line: number,
  context: WordContext,
): SourceWordMatch | null {
  const wanted = normalizeWord(context.word);
  if (!wanted) return null;
  const tokens = sourceTokens(source);
  let bestIndex = -1;
  let bestScore = -Infinity;
  tokens.forEach((token, index) => {
    const similarity = wordSimilarity(token.norm, wanted);
    if (!similarity) return;
    // Neighbours decide; the line SyncTeX named breaks ties (it can be off by
    // a line or two inside a paragraph, or stale after edits).
    const score =
      similarity * 3 +
      contextScore(tokens, index, context) * 4 -
      Math.abs(token.line - line) * 0.25;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  if (bestIndex < 0) return null;
  const token = tokens[bestIndex]!;
  return { line: token.line, column: token.column, length: token.length };
}

/** The word under (or next to) a source position, with its neighbours. */
export function sourceContextAt(
  source: string,
  line: number,
  column: number,
): WordContext | null {
  const tokens = sourceTokens(source);
  let nearest = -1;
  let nearestDistance = Infinity;
  tokens.forEach((token, index) => {
    if (token.line !== line) return;
    const start = token.column;
    const end = token.column + token.length;
    const distance = column < start ? start - column : column > end ? column - end : 0;
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });
  // Only a word the cursor is on or right beside; a command shows the line box.
  if (nearest < 0 || nearestDistance > 1) return null;
  return contextAt(tokens, nearest);
}
