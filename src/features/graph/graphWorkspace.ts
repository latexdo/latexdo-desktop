import type { CitationEntry } from "../../latex/latexIndex";
import { recommendCitations } from "./citationRecommender";
import { citationKeysInText } from "../../latex/citationAnalysis";

export const knowledgeGraphTabId = "workspace:knowledge-graph";

export interface GraphViewState {
  selectedKey: string | null;
  query: string;
  citedOnly: boolean;
}
export const defaultGraphViewState: GraphViewState = {
  selectedKey: null,
  query: "",
  citedOnly: false,
};

export interface GraphViewFilter {
  keys: string[] | null;
  label: string;
}

export interface GraphFilterRequest {
  mode: "all" | "cited" | "related" | "keys" | "query";
  query?: string;
  keys?: string;
  paperPath?: string;
}

/** Cite evidence is kept even when lexical ranking cannot score a reference. */
export function relatedBibliography(paper: string, entries: CitationEntry[]) {
  const cited = new Set(citationKeysInText(paper));
  const ranked = recommendCitations(paper, entries, { limit: 100, citedKeys: cited });
  const byKey = new Map(ranked.map((item) => [item.key, item]));
  return entries
    .flatMap((entry) => {
      const match = byKey.get(entry.key);
      if (!match && !cited.has(entry.key)) return [];
      return [
        {
          key: entry.key,
          title: entry.title,
          score: match?.score ?? 0,
          reasons: [
            ...(cited.has(entry.key) ? ["Cited in this paper"] : []),
            ...(match?.reasons ?? []),
          ],
        },
      ];
    })
    .sort((a, b) => b.score - a.score);
}

/** Read the root and its local includes, preserving unsaved text via the supplied reader. */
export async function readPaperSources(
  root: string,
  read: (path: string) => Promise<string>,
) {
  const visited = new Set<string>();
  async function visit(path: string): Promise<string> {
    if (visited.has(path) || visited.size >= 100) return "";
    const text = await read(path);
    visited.add(path);
    const includes = [
      ...text
        .replace(/(?<!\\)%[^\n]*/g, "")
        .matchAll(/\\(?:input|include|subfile)\s*\{([^}]+)\}/g),
    ];
    const children: string[] = [];
    for (const match of includes) {
      let child = match[1].trim();
      if (
        !child ||
        child.includes("\\") ||
        child.startsWith("/") ||
        child.split("/").includes("..")
      )
        continue;
      if (!/\.[a-z]+$/i.test(child)) child += ".tex";
      // TeX normally resolves from the project root; subfiles may be relative.
      try {
        children.push(await visit(child));
      } catch {
        const directory = path.slice(0, path.lastIndexOf("/") + 1);
        if (!directory)
          throw new Error(`Could not read included paper source: ${child}`);
        children.push(await visit(directory + child));
      }
    }
    return [text, ...children].join("\n");
  }
  return visit(root);
}
