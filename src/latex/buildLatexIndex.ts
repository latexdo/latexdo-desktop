import type { LatexIndex } from "./latexIndex";
import { citationKeysInText } from "./citationAnalysis";
import { parseBibFile } from "./parseBib";
import { parseTexLabels } from "./parseTexLabels";

export type ProjectFile = {
  path: string;
  content: string;
};

export function buildLatexIndex(files: ProjectFile[]): LatexIndex {
  const citations = files
    .filter((file) => file.path.endsWith(".bib"))
    .flatMap((file) => parseBibFile(file.content, file.path));
  const labels = files
    .filter((file) => file.path.endsWith(".tex"))
    .flatMap((file) => parseTexLabels(file.content, file.path));
  const citedKeys = [
    ...new Set(
      files
        .filter((file) => file.path.endsWith(".tex"))
        .flatMap((file) => citationKeysInText(file.content)),
    ),
  ];
  return {
    citations,
    citedKeys,
    labels,
  };
}
