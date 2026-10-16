import {
  analyzeCitationLibrary,
  type CitationProjectFile,
} from "../../latex/citationAnalysis";
import { bibBlocks } from "./mergeBibliographies";

export function removeUnusedBibliography(files: CitationProjectFile[]) {
  const analysis = analyzeCitationLibrary(files);
  const keep = new Set(analysis.citedKeys);
  for (const file of files) {
    if (file.path.endsWith(".tex")) {
      // Multi-cite commands and custom citation macros may have additional
      // braced arguments that the citation index does not yet recognize.
      // Retain matching keys in any braced argument rather than delete a use.
      for (const match of file.content.matchAll(/\{([^{}]*)\}/g)) {
        for (const key of match[1].split(",")) keep.add(key.trim());
      }
      for (const match of file.content.matchAll(/\\nocite\s*\{([^}]+)\}/g)) {
        for (const key of match[1].split(",").map((key) => key.trim())) {
          if (key === "*") return [];
          keep.add(key);
        }
      }
    } else if (file.path.endsWith(".bib")) {
      // Preserve dependency entries, including parents of uncited records.
      // Conservative retention is preferable to breaking BibTeX inheritance.
      for (const match of file.content.matchAll(
        /\b(?:crossref|xref|xdata|entryset)\s*=\s*[{"]([^}"]+)[}"]/gi,
      )) {
        for (const key of match[1].split(",")) keep.add(key.trim());
      }
    }
  }
  return files
    .filter((file) => file.path.endsWith(".bib"))
    .flatMap((file) => {
      const removals = bibBlocks(file.content).filter(
        (block) => block.key && !keep.has(block.key),
      );
      let content = file.content;
      for (const block of [...removals].reverse())
        content = content.slice(0, block.start) + content.slice(block.end);
      return removals.length
        ? [{ path: file.path, content, removed: removals.map((block) => block.key!) }]
        : [];
    });
}
