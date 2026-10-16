import type { CitationEntry } from "../../latex/latexIndex";
import type { AiConfig } from "../ai/aiConfig";
import { generateStep } from "../ai/aiClient";
import { findLocalModel } from "../ai/aiModels";
import type { ChatMessage, GenerateRequest } from "../ai/aiTypes";
import { titleTokens, type KnowledgeGraph } from "./knowledgeGraph";

export interface AiDiscoveryPlan {
  queries: string[];
  focusTerms: string[];
  rationale: string;
}

export interface AiDiscoveryPlannerOptions {
  graph: KnowledgeGraph;
  entries: CitationEntry[];
  config: AiConfig;
  isDesktop: boolean;
  signal?: AbortSignal;
}

const maxAiQueries = 4;
const maxQueryLength = 140;
const maxRationaleLength = 240;

function providerFor(config: AiConfig): "local" | "ollama" | "cloud" {
  if (config.provider === "local" || config.provider === "ollama") {
    return config.provider;
  }
  return "cloud";
}

export function aiDiscoveryAvailable(config: AiConfig, isDesktop: boolean): boolean {
  if (config.provider === "off") return false;
  if (config.provider === "cloud") return config.cloud.credentialConfigured;
  if (!isDesktop) return false;
  if (config.provider === "local") return config.modelDownloaded;
  return Boolean(config.ollamaModel.trim());
}

function authorLine(entry: CitationEntry | undefined): string {
  return (entry?.author ?? entry?.editor ?? "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

function graphContext(graph: KnowledgeGraph, entries: CitationEntry[]): string {
  const entriesByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const nodes = [...graph.nodes]
    .filter((node) => node.title)
    .sort((a, b) => {
      const citedDelta = Number(b.cited) - Number(a.cited);
      if (citedDelta !== 0) return citedDelta;
      return b.degree - a.degree;
    })
    .slice(0, 16);

  const weightedTerms = new Map<string, number>();
  for (const node of nodes) {
    const weight = 1 + (node.cited ? 2 : 0) + Math.min(node.degree, 8) * 0.25;
    for (const token of titleTokens(node.title)) {
      weightedTerms.set(token, (weightedTerms.get(token) ?? 0) + weight);
    }
  }
  const terms = [...weightedTerms.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([term]) => term)
    .slice(0, 24)
    .join(", ");

  const papers = nodes
    .map((node, index) => {
      const entry = entriesByKey.get(node.key);
      const bits = [
        `${index + 1}. ${node.title}`,
        node.year ? `year ${node.year}` : "",
        node.venue ? `venue ${node.venue}` : "",
        node.cited ? "cited in manuscript" : "bibliography only",
        `degree ${node.degree}`,
        authorLine(entry) ? `authors ${authorLine(entry)}` : "",
      ].filter(Boolean);
      return bits.join("; ");
    })
    .join("\n");

  return [
    `Graph stats: ${graph.stats.nodeCount} papers, ${graph.stats.edgeCount} links, ${graph.stats.citedCount} cited, ${graph.stats.componentCount} clusters.`,
    terms ? `High-signal graph terms: ${terms}.` : "",
    "Representative papers:",
    papers || "No titled papers.",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const query = value
    .replace(/[^\p{L}\p{N}\s:+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxQueryLength);
  if (query.length < 8) return null;
  if (/^https?:/i.test(query)) return null;
  return query;
}

function normalizeStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const normalized = normalizeQuery(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const stripped = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function requestFor(
  config: AiConfig,
  requestId: string,
  messages: ChatMessage[],
): GenerateRequest {
  const model = findLocalModel(config.modelId);
  return {
    requestId,
    provider: providerFor(config),
    messages,
    tools: [],
    options: {
      modelId: config.modelId,
      fileName: model?.fileName,
      temperature: 0.1,
      effort: "low",
      maxTokens: 320,
      ollamaBaseUrl: config.ollamaBaseUrl,
      ollamaModel: config.ollamaModel,
      cloudVendor: config.cloud.vendor,
      cloudBaseUrl: config.cloud.baseUrl,
      cloudModel: config.cloud.model,
      cloudCredentialId: config.cloud.credentialId,
    },
  };
}

export async function planScholarlyDiscoveryWithAi({
  graph,
  entries,
  config,
  isDesktop,
  signal,
}: AiDiscoveryPlannerOptions): Promise<AiDiscoveryPlan | null> {
  if (!aiDiscoveryAvailable(config, isDesktop)) return null;
  if (signal?.aborted) return null;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a senior research librarian helping a LaTeX author find related academic papers. Return strict JSON only. Do not explain outside JSON.",
    },
    {
      role: "user",
      content: [
        "Use this bibliography knowledge graph to produce search intents for scholarly metadata APIs.",
        "Find papers that are related but probably missing from the bibliography.",
        "Avoid copying an existing title verbatim. Prefer technical topic queries, methods, applications, benchmarks, and survey angles.",
        'Return JSON: {"queries":["3-4 concise scholarly search queries"],"focus_terms":["5-10 key terms"],"rationale":"one short sentence"}.',
        graphContext(graph, entries),
      ].join("\n\n"),
    },
  ];

  const requestId = `kg-ai-plan-${Date.now().toString(36)}`;
  const step = await generateStep(requestFor(config, requestId, messages), () => {});
  if (signal?.aborted || step.type === "error") return null;
  const parsed = parseJsonObject(step.content);
  if (!parsed) return null;

  const queries = normalizeStringList(parsed.queries, maxAiQueries);
  if (queries.length === 0) return null;

  return {
    queries,
    focusTerms: normalizeStringList(parsed.focus_terms, 10),
    rationale:
      typeof parsed.rationale === "string"
        ? parsed.rationale.replace(/\s+/g, " ").trim().slice(0, maxRationaleLength)
        : "",
  };
}
