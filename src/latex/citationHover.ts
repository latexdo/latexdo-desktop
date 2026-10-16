import type { CitationEntry } from "./latexIndex";

export type CitationKeyAtPosition = {
  key: string;
  start: number;
  end: number;
};

const citationKeyPattern =
  /\\(?:cite|citep|citet|citealp|parencite|textcite|autocite|footcite)\*?(?:\[[^\]]*\])*\{([^}]*)\}/g;

export function citationKeyAtPosition(
  line: string,
  offset: number,
): CitationKeyAtPosition | null {
  for (const match of line.matchAll(citationKeyPattern)) {
    const args = match[1];
    if (!args || match.index === undefined) continue;
    const argsStart = match.index + match[0].indexOf("{") + 1;
    for (const keyMatch of args.matchAll(/[^,\s]+/g)) {
      if (keyMatch.index === undefined) continue;
      const start = argsStart + keyMatch.index;
      const end = start + keyMatch[0].length;
      if (offset >= start && offset <= end) {
        return { key: keyMatch[0], start, end };
      }
    }
  }
  return null;
}

export function citationHoverMarkdown(entry: CitationEntry): string {
  return [
    entry.author ? `**Author:** ${entry.author}` : undefined,
    entry.title ? `**Title:** ${entry.title}` : undefined,
    entry.journal ? `**Journal:** ${entry.journal}` : undefined,
    entry.booktitle ? `**Book:** ${entry.booktitle}` : undefined,
    entry.publisher ? `**Publisher:** ${entry.publisher}` : undefined,
    entry.year ? `**Year:** ${entry.year}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}
