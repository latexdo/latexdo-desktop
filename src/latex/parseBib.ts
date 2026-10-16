import bibtexParse from "bibtex-parse";
import type { CitationEntry } from "./latexIndex";

type ParsedBibEntry = {
  key?: string;
  type?: string;
  [field: string]: unknown;
};

const maxBibtexSourceLength = 2 * 1024 * 1024;
const maxBibtexEntries = 10_000;

function cleanBibValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

export function parseBibFile(content: string, sourceFile: string): CitationEntry[] {
  if (content.length > maxBibtexSourceLength) return [];

  let parsed: ParsedBibEntry[];
  try {
    parsed = bibtexParse.entries(content, { number: "string" });
  } catch {
    return [];
  }

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
