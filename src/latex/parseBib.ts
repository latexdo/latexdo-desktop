import bibtexParse from "bibtex-parse";
import type { CitationEntry } from "./latexIndex";

type ParsedBibEntry = {
  key?: string;
  type?: string;
  [field: string]: unknown;
};

// Large shared bibliographies are common (a lab's 4 MB, 9,000-entry .bib parses
// in well under a second); the limits only guard against pathological files.
const maxBibtexSourceLength = 32 * 1024 * 1024;
const maxBibtexEntries = 100_000;

/**
 * Parses a whole file, or entry by entry when one malformed entry makes the
 * whole file fail, so a single typo never hides the rest of the bibliography.
 */
function parseEntries(content: string): ParsedBibEntry[] {
  try {
    return bibtexParse.entries(content, { number: "string" }) as ParsedBibEntry[];
  } catch {
    const parsed: ParsedBibEntry[] = [];
    for (const chunk of content.split(/^(?=@)/m)) {
      try {
        parsed.push(
          ...(bibtexParse.entries(chunk, { number: "string" }) as ParsedBibEntry[]),
        );
      } catch {
        // Skip only the broken entry.
      }
    }
    return parsed;
  }
}

function cleanBibValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

export function parseBibFile(content: string, sourceFile: string): CitationEntry[] {
  if (content.length > maxBibtexSourceLength) return [];

  const parsed = parseEntries(content);

  return parsed
    .slice(0, maxBibtexEntries)
    .filter((entry): entry is ParsedBibEntry & { key: string } => Boolean(entry.key))
    .map((entry) => {
      const tags = entry;
      return {
        key: entry.key,
        type: entry.type ?? "unknown",
        title: cleanBibValue(tags.TITLE),
        author: cleanBibValue(tags.AUTHOR),
        editor: cleanBibValue(tags.EDITOR),
        year: cleanBibValue(tags.YEAR),
        journal: cleanBibValue(tags.JOURNAL),
        booktitle: cleanBibValue(tags.BOOKTITLE),
        publisher: cleanBibValue(tags.PUBLISHER),
        school: cleanBibValue(tags.SCHOOL),
        institution: cleanBibValue(tags.INSTITUTION),
        doi: cleanBibValue(tags.DOI),
        url: cleanBibValue(tags.URL),
        eprint: cleanBibValue(tags.EPRINT),
        archivePrefix: cleanBibValue(tags.ARCHIVEPREFIX),
        howpublished: cleanBibValue(tags.HOWPUBLISHED),
        abstract: cleanBibValue(tags.ABSTRACT),
        keywords: cleanBibValue(tags.KEYWORDS),
        note: cleanBibValue(tags.NOTE),
        raw: JSON.stringify(tags, null, 2),
        sourceFile,
      } as CitationEntry;
    });
}
