import type { LatexIndex, CitationEntry, LabelEntry } from "./latexIndex";
import { parseBibFile } from "./parseBib";
import { parseTexLabels } from "./parseTexLabels";

export type ProjectFile = {
  path: string;
  content: string;
};

export function buildLatexIndex(files: ProjectFile[]): LatexIndex {
  const citations: CitationEntry[] = files
    .filter((file) => file.path.endsWith(".bib"))
    .flatMap((file) => parseBibFile(file.content, file.path));

  const labels: LabelEntry[] = files
    .filter((file) => file.path.endsWith(".tex"))
    .flatMap((file) => parseTexLabels(file.content, file.path));

  return {
    citations,
    labels,
  };
}
