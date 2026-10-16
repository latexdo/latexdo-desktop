// Knowledge graph model built from the project's bibliography.
//
// A node is one bib entry (a paper). An edge connects two papers that share
// something meaningful — authors, venue, publication year, or similar titles.
// Edge weight is the sum of the enabled relation weights, so the more two
// papers have in common the stronger their link. Everything here is pure and
// deterministic; the AI layer and the interactive view consume this output.

import type { CitationEntry } from "../../latex/latexIndex";

export type EdgeRelation =
  | "shared-author"
  | "shared-venue"
  | "shared-year"
  | "title-similarity";

export interface KnowledgeGraphParams {
  /** Toggle whether each relation is allowed to create edges. */
  relations: Record<EdgeRelation, boolean>;
  /** Weight contributed by each relation when it applies. */
  weights: Record<EdgeRelation, number>;
  /** Minimum Jaccard overlap of title tokens (0..1) to link two papers. */
  titleSimilarityThreshold: number;
  /** Drop any edge whose total weight is below this. */
  minEdgeWeight: number;
  /** Keep at most this many edges per node (strongest first) for readability. */
  maxEdgesPerNode: number;
}

export const defaultKnowledgeGraphParams: KnowledgeGraphParams = {
  relations: {
    "shared-author": true,
    "shared-venue": true,
    "shared-year": true,
    "title-similarity": true,
  },
  weights: {
    "shared-author": 3,
    "shared-venue": 1.5,
    "shared-year": 0.5,
    "title-similarity": 2,
  },
  titleSimilarityThreshold: 0.18,
  minEdgeWeight: 1,
  maxEdgesPerNode: 6,
};

const relationKeys: EdgeRelation[] = [
  "shared-author",
  "shared-venue",
  "shared-year",
  "title-similarity",
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Validate/repair a persisted params object back into a safe KnowledgeGraphParams,
 * falling back to defaults for any missing or out-of-range field. Pure so it can
 * be unit-tested and reused by the settings loader.
 */
export function normalizeKnowledgeGraphParams(value: unknown): KnowledgeGraphParams {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const savedRelations =
    source.relations && typeof source.relations === "object"
      ? (source.relations as Record<string, unknown>)
      : {};
  const savedWeights =
    source.weights && typeof source.weights === "object"
      ? (source.weights as Record<string, unknown>)
      : {};

  const relations = {} as Record<EdgeRelation, boolean>;
  const weights = {} as Record<EdgeRelation, number>;
  for (const relation of relationKeys) {
    relations[relation] =
      typeof savedRelations[relation] === "boolean"
        ? (savedRelations[relation] as boolean)
        : defaultKnowledgeGraphParams.relations[relation];
    const weight = savedWeights[relation];
    weights[relation] =
      typeof weight === "number" && Number.isFinite(weight)
        ? clamp(weight, 0, 20)
        : defaultKnowledgeGraphParams.weights[relation];
  }

  const threshold = source.titleSimilarityThreshold;
  const minEdge = source.minEdgeWeight;
  const maxEdges = source.maxEdgesPerNode;

  return {
    relations,
    weights,
    titleSimilarityThreshold:
      typeof threshold === "number" && Number.isFinite(threshold)
        ? clamp(threshold, 0.01, 1)
        : defaultKnowledgeGraphParams.titleSimilarityThreshold,
    minEdgeWeight:
      typeof minEdge === "number" && Number.isFinite(minEdge)
        ? clamp(minEdge, 0, 50)
        : defaultKnowledgeGraphParams.minEdgeWeight,
    maxEdgesPerNode:
      typeof maxEdges === "number" && Number.isFinite(maxEdges)
        ? clamp(Math.round(maxEdges), 2, 20)
        : defaultKnowledgeGraphParams.maxEdgesPerNode,
  };
}

export interface GraphNode {
  key: string;
  /** Short human label, e.g. "Vaswani 2017". */
  label: string;
  title?: string;
  authors: string[];
  year: number | null;
  venue?: string;
  type: string;
  /** True when the paper is actually \cited somewhere in the .tex sources. */
  cited: boolean;
  /** Number of edges touching this node (filled in after pruning). */
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  relations: EdgeRelation[];
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  params: KnowledgeGraphParams;
  stats: {
    nodeCount: number;
    edgeCount: number;
    citedCount: number;
    /** Number of connected components (isolated nodes each count as one). */
    componentCount: number;
  };
}

// Bounded so an enormous library can't make the O(n^2) pairing hang the UI.
const maxGraphNodes = 2000;

const titleStopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "via",
  "with",
  "using",
  "toward",
  "towards",
  "based",
  "approach",
  "method",
  "methods",
  "study",
  "analysis",
  "novel",
  "new",
  "model",
  "models",
  "system",
  "systems",
  "all",
  "you",
  "your",
  "our",
  "we",
  "can",
  "not",
  "but",
  "how",
  "why",
]);

function stripBraces(value: string): string {
  return value.replace(/[{}]/g, "").trim();
}

/** Normalized last names for every author in an entry's author field. */
export function authorLastNames(author: string | undefined): string[] {
  if (!author) return [];
  return author
    .split(/\s+and\s+/i)
    .map((name) => {
      const cleaned = stripBraces(name);
      // "Last, First" -> Last ; otherwise take the final whitespace token.
      const last = cleaned.includes(",")
        ? cleaned.split(",")[0]
        : (cleaned.split(/\s+/).filter(Boolean).pop() ?? "");
      return last.toLowerCase().replace(/[^a-z]/g, "");
    })
    .filter((name) => name.length >= 2);
}

export function titleTokens(title: string | undefined): Set<string> {
  if (!title) return new Set();
  const tokens = title
    .toLowerCase()
    .replace(/\\[a-z]+/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length >= 3 && !titleStopWords.has(token));
  return new Set(tokens);
}

function parseYear(entry: CitationEntry): number | null {
  const match = entry.year?.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function venueOf(entry: CitationEntry): string | undefined {
  const venue =
    entry.journal ??
    entry.booktitle ??
    entry.publisher ??
    entry.school ??
    entry.institution ??
    entry.howpublished;
  return venue ? stripBraces(venue) : undefined;
}

function normalizedVenue(venue: string | undefined): string {
  return (venue ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function shortLabel(entry: CitationEntry, year: number | null): string {
  const last = authorLastNames(entry.author)[0];
  if (last) {
    const capped = last.charAt(0).toUpperCase() + last.slice(1);
    return year ? `${capped} ${year}` : capped;
  }
  const title = entry.title ? stripBraces(entry.title) : "";
  if (title) return title.length > 24 ? `${title.slice(0, 24)}…` : title;
  return entry.key;
}

interface UnionFind {
  find: (x: number) => number;
  union: (a: number, b: number) => void;
}

function createUnionFind(size: number): UnionFind {
  const parent = Array.from({ length: size }, (_, index) => index);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };
  return {
    find,
    union: (a, b) => {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent[rootA] = rootB;
    },
  };
}

/**
 * Build the knowledge graph from bib entries and the keys actually cited in the
 * .tex sources. Duplicate keys are collapsed (first wins) so the graph matches
 * what BibTeX would resolve.
 */
export function buildKnowledgeGraph(
  entries: CitationEntry[],
  citedKeys: Iterable<string> = [],
  params: KnowledgeGraphParams = defaultKnowledgeGraphParams,
): KnowledgeGraph {
  const citedSet = new Set(citedKeys);

  const uniqueEntries: CitationEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    uniqueEntries.push(entry);
    if (uniqueEntries.length >= maxGraphNodes) break;
  }

  const nodes: GraphNode[] = uniqueEntries.map((entry) => {
    const year = parseYear(entry);
    return {
      key: entry.key,
      label: shortLabel(entry, year),
      title: entry.title ? stripBraces(entry.title) : undefined,
      authors: authorLastNames(entry.author),
      year,
      venue: venueOf(entry),
      type: entry.type,
      cited: citedSet.has(entry.key),
      degree: 0,
    };
  });

  // Precompute per-node features once to keep the pair loop cheap.
  const features = nodes.map((node) => ({
    authors: new Set(node.authors),
    venue: normalizedVenue(node.venue),
    year: node.year,
    titleTokens: titleTokens(node.title),
  }));

  const { relations, weights, titleSimilarityThreshold } = params;
  const candidateEdges: GraphEdge[] = [];

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = features[i];
      const b = features[j];
      const edgeRelations: EdgeRelation[] = [];
      let weight = 0;

      if (relations["shared-author"]) {
        let shared = 0;
        for (const author of a.authors) {
          if (b.authors.has(author)) shared += 1;
        }
        if (shared > 0) {
          weight += weights["shared-author"] * Math.min(shared, 3);
          edgeRelations.push("shared-author");
        }
      }
      if (relations["shared-venue"] && a.venue && a.venue === b.venue) {
        weight += weights["shared-venue"];
        edgeRelations.push("shared-venue");
      }
      if (relations["shared-year"] && a.year !== null && a.year === b.year) {
        weight += weights["shared-year"];
        edgeRelations.push("shared-year");
      }
      if (relations["title-similarity"]) {
        const similarity = jaccard(a.titleTokens, b.titleTokens);
        if (similarity >= titleSimilarityThreshold) {
          weight += weights["title-similarity"] * similarity * 4;
          edgeRelations.push("title-similarity");
        }
      }

      if (edgeRelations.length > 0 && weight >= params.minEdgeWeight) {
        candidateEdges.push({
          source: nodes[i].key,
          target: nodes[j].key,
          weight: Number(weight.toFixed(3)),
          relations: edgeRelations,
        });
      }
    }
  }

  // Prune to the strongest edges per node so dense libraries stay legible.
  candidateEdges.sort((left, right) => right.weight - left.weight);
  const perNodeCount = new Map<string, number>();
  const edges: GraphEdge[] = [];
  for (const edge of candidateEdges) {
    const sourceCount = perNodeCount.get(edge.source) ?? 0;
    const targetCount = perNodeCount.get(edge.target) ?? 0;
    if (
      sourceCount >= params.maxEdgesPerNode ||
      targetCount >= params.maxEdgesPerNode
    ) {
      continue;
    }
    perNodeCount.set(edge.source, sourceCount + 1);
    perNodeCount.set(edge.target, targetCount + 1);
    edges.push(edge);
  }

  // Degree + connected components.
  const indexByKey = new Map(nodes.map((node, index) => [node.key, index]));
  const unionFind = createUnionFind(nodes.length);
  for (const edge of edges) {
    const s = indexByKey.get(edge.source);
    const t = indexByKey.get(edge.target);
    if (s === undefined || t === undefined) continue;
    nodes[s].degree += 1;
    nodes[t].degree += 1;
    unionFind.union(s, t);
  }
  const roots = new Set<number>();
  for (let index = 0; index < nodes.length; index += 1) {
    roots.add(unionFind.find(index));
  }

  return {
    nodes,
    edges,
    params,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      citedCount: nodes.filter((node) => node.cited).length,
      componentCount: roots.size,
    },
  };
}

/** Neighboring node keys and the edge that connects them, for a given node. */
export function neighborsOf(
  graph: KnowledgeGraph,
  key: string,
): { key: string; edge: GraphEdge }[] {
  const result: { key: string; edge: GraphEdge }[] = [];
  for (const edge of graph.edges) {
    if (edge.source === key) result.push({ key: edge.target, edge });
    else if (edge.target === key) result.push({ key: edge.source, edge });
  }
  return result.sort((a, b) => b.edge.weight - a.edge.weight);
}

export const edgeRelationLabels: Record<EdgeRelation, string> = {
  "shared-author": "Shared author",
  "shared-venue": "Same venue",
  "shared-year": "Same year",
  "title-similarity": "Similar topic",
};
