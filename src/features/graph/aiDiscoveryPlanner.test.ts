import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CitationEntry } from "../../latex/latexIndex";
import { defaultAiConfig, type AiConfig } from "../ai/aiConfig";
import { generateStep } from "../ai/aiClient";
import { buildKnowledgeGraph, defaultKnowledgeGraphParams } from "./knowledgeGraph";
import {
  aiDiscoveryAvailable,
  planScholarlyDiscoveryWithAi,
} from "./aiDiscoveryPlanner";

vi.mock("../ai/aiClient", () => ({
  generateStep: vi.fn(),
}));

const generateStepMock = vi.mocked(generateStep);

function entry(partial: Partial<CitationEntry> & { key: string }): CitationEntry {
  return {
    type: "article",
    sourceFile: "refs.bib",
    ...partial,
  };
}

function graphFixture() {
  const entries = [
    entry({
      key: "smith2020",
      author: "Smith, Jane",
      title: "Graph neural networks for citation recommendation",
      year: "2020",
      journal: "Journal of Machine Learning Research",
    }),
    entry({
      key: "lee2021",
      author: "Lee, Kai",
      title: "Neural retrieval systems for scholarly recommendation",
      year: "2021",
      journal: "Information Retrieval",
    }),
  ];
  return {
    entries,
    graph: buildKnowledgeGraph(entries, ["smith2020"], defaultKnowledgeGraphParams),
  };
}

function cloudConfig(): AiConfig {
  return {
    ...defaultAiConfig,
    provider: "cloud",
    cloud: {
      ...defaultAiConfig.cloud,
      credentialConfigured: true,
      model: "gpt-test",
      vendor: "openai",
    },
  };
}

describe("aiDiscoveryPlanner", () => {
  beforeEach(() => {
    generateStepMock.mockReset();
  });

  it("checks configured AI availability", () => {
    expect(aiDiscoveryAvailable({ ...defaultAiConfig, provider: "off" }, true)).toBe(
      false,
    );
    expect(aiDiscoveryAvailable(cloudConfig(), false)).toBe(true);
    expect(
      aiDiscoveryAvailable(
        { ...defaultAiConfig, provider: "local", modelDownloaded: false },
        true,
      ),
    ).toBe(false);
    expect(
      aiDiscoveryAvailable(
        { ...defaultAiConfig, provider: "local", modelDownloaded: true },
        true,
      ),
    ).toBe(true);
  });

  it("asks AI for JSON search queries from graph context", async () => {
    const { graph, entries } = graphFixture();
    generateStepMock.mockResolvedValueOnce({
      type: "text",
      content: JSON.stringify({
        queries: [
          "graph neural citation discovery scholarly retrieval",
          "neural recommender systems academic citation graph",
        ],
        focus_terms: ["citation", "retrieval", "graph neural networks"],
        rationale: "Focus on graph-based scholarly retrieval methods.",
      }),
    });

    const plan = await planScholarlyDiscoveryWithAi({
      graph,
      entries,
      config: cloudConfig(),
      isDesktop: false,
    });

    expect(generateStepMock).toHaveBeenCalledTimes(1);
    expect(plan?.queries).toEqual([
      "graph neural citation discovery scholarly retrieval",
      "neural recommender systems academic citation graph",
    ]);
    expect(plan?.rationale).toContain("graph-based");
  });

  it("returns null when AI output is not parseable", async () => {
    const { graph, entries } = graphFixture();
    generateStepMock.mockResolvedValueOnce({
      type: "text",
      content: "try searching the web",
    });

    await expect(
      planScholarlyDiscoveryWithAi({
        graph,
        entries,
        config: cloudConfig(),
        isDesktop: false,
      }),
    ).resolves.toBeNull();
  });
});
