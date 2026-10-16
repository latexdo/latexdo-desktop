import bibtexParse from "bibtex-parse-js";
import type { CitationEntry } from "./latexIndex";

function cleanBibValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

export function parseBibFile(content: string, sourceFile: string): CitationEntry[] {
  const parsed = (bibtexParse as any).toJSON(content);
  return parsed
    .filter((entry: any) => entry.citationKey)
    .map((entry: any) => {
      const tags = entry.entryTags ?? {};
      return {
        key: entry.citationKey,
        type: entry.entryType ?? "unknown",
        title: cleanBibValue(tags.title),
        author: cleanBibValue(tags.author),
        year: cleanBibValue(tags.year),
        journal: cleanBibValue(tags.journal),
        booktitle: cleanBibValue(tags.booktitle),
        publisher: cleanBibValue(tags.publisher),
        url: cleanBibValue(tags.url),
        raw: entry.entryTags ? JSON.stringify(entry.entryTags, null, 2) : undefined,
        sourceFile,
      } as CitationEntry;
    });
}
