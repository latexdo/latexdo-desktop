import { formatCitation, type CitationCommand } from "./citationStyle";

export interface CitationInsertionPlan {
  text: string;
  command: CitationCommand;
  keys: string[];
  mode: "append" | "merge-existing";
  rangeStartOffset: number;
  rangeEndOffset: number;
}

const terminalPunctuation = new Set([".", "?", "!"]);

export function buildCitationInsertion(
  command: CitationCommand,
  keys: string[],
): string {
  return formatCitation(command, keys);
}

export function planCitationInsertion(
  documentText: string,
  offset: number,
  command: CitationCommand,
  keys: string[],
): CitationInsertionPlan | null {
  const cleanKeys = uniqueKeys(keys);
  if (cleanKeys.length === 0) return null;

  const boundedOffset = Math.max(0, Math.min(documentText.length, offset));
  const punctuated = punctuationBeforeOffset(documentText, boundedOffset);
  const insertionOffset = punctuated?.offset ?? boundedOffset;
  const beforeInsertion = documentText.slice(0, insertionOffset);

  const adjacent = adjacentCitation(beforeInsertion);
  if (adjacent && adjacent.keys.some((key) => cleanKeys.includes(key))) {
    return null;
  }

  if (adjacent?.command === command && !adjacent.hasOptionalArguments) {
    const mergedKeys = uniqueKeys([...adjacent.keys, ...cleanKeys]);
    return {
      text: formatCitation(command, mergedKeys),
      command,
      keys: mergedKeys,
      mode: "merge-existing",
      rangeStartOffset: adjacent.startOffset,
      rangeEndOffset: insertionOffset,
    };
  }

  const citation = formatCitation(command, cleanKeys);
  const left = documentText.slice(0, insertionOffset);
  const right =
    punctuated === null
      ? documentText.slice(insertionOffset)
      : documentText.slice(punctuated.offset + 1);
  const prefix = needsSpaceBefore(left) ? " " : "";
  const suffix = needsSpaceAfter(right, punctuated !== null) ? " " : "";
  const punctuation = punctuated?.char ?? "";

  return {
    text: `${prefix}${citation}${suffix}${punctuation}`,
    command,
    keys: cleanKeys,
    mode: "append",
    rangeStartOffset: insertionOffset,
    rangeEndOffset: punctuated === null ? insertionOffset : punctuated.offset + 1,
  };
}

interface AdjacentCitation {
  command: CitationCommand;
  keys: string[];
  startOffset: number;
  hasOptionalArguments: boolean;
}

function adjacentCitation(beforeInsertion: string): AdjacentCitation | null {
  const match = beforeInsertion.match(
    /\\(cite|citep|citet|citealp|citeauthor|citeyear|citeyearpar|parencite|textcite|autocite|footcite|supercite)(\*?)(\s*(?:\[[^\]]*\]\s*)*)\{([^}]*)\}\s*$/,
  );
  if (!match || match.index === undefined) return null;
  return {
    command: match[1] as CitationCommand,
    keys: splitKeys(match[4]),
    startOffset: match.index,
    hasOptionalArguments: Boolean(match[3]?.trim()),
  };
}

function punctuationBeforeOffset(
  text: string,
  offset: number,
): { offset: number; char: string } | null {
  if (offset <= 0) return null;
  const previous = text[offset - 1];
  if (!previous || !terminalPunctuation.has(previous)) return null;
  return { offset: offset - 1, char: previous };
}

function splitKeys(value: string): string[] {
  return value
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

function uniqueKeys(keys: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const cleaned = key.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

function needsSpaceBefore(left: string): boolean {
  return Boolean(left) && !/[\s([{~]$/.test(left);
}

function needsSpaceAfter(right: string, beforeTerminalPunctuation: boolean): boolean {
  if (beforeTerminalPunctuation) return false;
  return Boolean(right) && !/^[\s.,;:!?)}\]]/.test(right);
}
