import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CitationEntry } from "../latex/latexIndex";
import {
  buildKnowledgeGraph,
  defaultKnowledgeGraphParams,
  type KnowledgeGraph,
} from "../features/graph/knowledgeGraph";
import { KnowledgeGraphView } from "./KnowledgeGraphView";

const entries: CitationEntry[] = [
  {
    key: "smith2020",
    type: "article",
    title: "Graph neural networks for citation recommendation",
    author: "Smith, Jane and Doe, John",
    year: "2020",
    journal: "Journal of Machine Learning Research",
    sourceFile: "refs.bib",
  },
  {
    key: "smith2021",
    type: "article",
    title: "Citation recommendation with graph neural networks",
    author: "Smith, Jane",
    year: "2021",
    journal: "Journal of Machine Learning Research",
    sourceFile: "refs.bib",
  },
  {
    key: "lee2020",
    type: "inproceedings",
    title: "Bayesian optimization for compiler flags",
    author: "Lee, Kai",
    year: "2020",
    booktitle: "Systems Conference",
    sourceFile: "refs.bib",
  },
];

function emptyGraph(): KnowledgeGraph {
  return {
    nodes: [],
    edges: [],
    params: defaultKnowledgeGraphParams,
    stats: {
      nodeCount: 0,
      edgeCount: 0,
      citedCount: 0,
      componentCount: 0,
    },
  };
}

function graphFixture(): KnowledgeGraph {
  return buildKnowledgeGraph(entries, ["smith2020"], defaultKnowledgeGraphParams);
}

function entriesByKey() {
  return new Map(entries.map((entry) => [entry.key, entry]));
}

function renderGraph(
  overrides: Partial<React.ComponentProps<typeof KnowledgeGraphView>> = {},
) {
  const props: React.ComponentProps<typeof KnowledgeGraphView> = {
    graph: graphFixture(),
    params: defaultKnowledgeGraphParams,
    entriesByKey: entriesByKey(),
    onParamsChange: vi.fn(),
    onInsertCitation: vi.fn(),
    ...overrides,
  };

  return {
    ...render(<KnowledgeGraphView {...props} />),
    props,
  };
}

let frameQueue: FrameRequestCallback[];
let nextFrameId: number;

function flushAnimationFrame() {
  const callback = frameQueue.shift();
  if (!callback) return;
  act(() => {
    callback(performance.now());
  });
}

function stubSvgBounds(svg: SVGSVGElement) {
  Object.defineProperty(svg, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 500,
      bottom: 360,
      width: 500,
      height: 360,
      toJSON: () => ({}),
    }),
  });
}

function requestHostname(input: RequestInfo | URL): string {
  try {
    const url =
      input instanceof URL
        ? input
        : typeof Request !== "undefined" && input instanceof Request
          ? new URL(input.url)
          : new URL(String(input));
    return url.hostname;
  } catch {
    return "";
  }
}

describe("KnowledgeGraphView", () => {
  beforeEach(() => {
    frameQueue = [];
    nextFrameId = 1;
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        frameQueue.push(callback);
        nextFrameId += 1;
        return nextFrameId;
      }),
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows graph stats, search highlighting, cited filtering, and AI recommendations", () => {
    const onRecommendForSelection = vi.fn();
    const { container } = renderGraph({ onRecommendForSelection });

    flushAnimationFrame();

    expect(screen.getByText(/3 papers/)).toBeVisible();
    expect(screen.getByText(/1 links/)).toBeVisible();
    expect(screen.getByText(/1 cited/)).toBeVisible();
    expect(container.querySelectorAll(".kg-node")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /recommend citations/i }));
    expect(onRecommendForSelection).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByPlaceholderText(/find paper/i), {
      target: { value: "lee" },
    });
    expect(container.querySelectorAll(".kg-node.match")).toHaveLength(1);
    expect(container.querySelectorAll(".kg-node.dim")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText(/cited only/i));
    expect(container.querySelectorAll(".kg-node")).toHaveLength(1);

    fireEvent.click(screen.getByLabelText(/cited only/i));
    flushAnimationFrame();
    expect(container.querySelectorAll(".kg-node")).toHaveLength(3);
  });

  it("updates graph parameters from the controls panel", () => {
    const onParamsChange = vi.fn();
    renderGraph({ onParamsChange });

    fireEvent.click(screen.getByRole("button", { name: /parameters/i }));

    fireEvent.click(screen.getByLabelText("Shared author"));
    expect(onParamsChange).toHaveBeenLastCalledWith({
      ...defaultKnowledgeGraphParams,
      relations: {
        ...defaultKnowledgeGraphParams.relations,
        "shared-author": false,
      },
    });

    fireEvent.change(screen.getByLabelText(/topic similarity threshold/i), {
      target: { value: "0.32" },
    });
    expect(onParamsChange).toHaveBeenLastCalledWith({
      ...defaultKnowledgeGraphParams,
      titleSimilarityThreshold: 0.32,
    });

    fireEvent.change(screen.getByLabelText(/max links per paper/i), {
      target: { value: "9" },
    });
    expect(onParamsChange).toHaveBeenLastCalledWith({
      ...defaultKnowledgeGraphParams,
      maxEdgesPerNode: 9,
    });
  });

  it("opens the inspector, inserts citations, navigates neighbors, and clears selection", () => {
    const onInsertCitation = vi.fn();
    const { container } = renderGraph({ onInsertCitation });
    flushAnimationFrame();

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    stubSvgBounds(svg as SVGSVGElement);

    const firstNode = container.querySelector(".kg-node");
    expect(firstNode).not.toBeNull();
    fireEvent.pointerDown(firstNode as Element, {
      pointerId: 1,
      clientX: 120,
      clientY: 120,
    });

    expect(
      screen.getByText("Graph neural networks for citation recommendation"),
    ).toBeVisible();
    expect(screen.getByText("Smith, Jane and Doe, John")).toBeVisible();
    expect(screen.getByText("Journal of Machine Learning Research")).toBeVisible();
    expect(screen.getByText("Cited in text")).toBeVisible();

    fireEvent.pointerMove(svg as SVGSVGElement, {
      clientX: 250,
      clientY: 180,
    });
    fireEvent.pointerUp(svg as SVGSVGElement);

    fireEvent.click(screen.getByRole("button", { name: /insert/i }));
    expect(onInsertCitation).toHaveBeenCalledWith("smith2020");

    fireEvent.click(screen.getByRole("button", { name: /smith 2021/i }));
    expect(
      screen.getByText("Citation recommendation with graph neural networks"),
    ).toBeVisible();
    expect(screen.getByText("Not cited yet")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(
      screen.queryByText("Citation recommendation with graph neural networks"),
    ).not.toBeInTheDocument();

    fireEvent.pointerDown(svg as SVGSVGElement, {
      pointerId: 2,
      clientX: 10,
      clientY: 20,
    });
    fireEvent.pointerMove(svg as SVGSVGElement, {
      clientX: 25,
      clientY: 35,
    });
    fireEvent.wheel(svg as SVGSVGElement, { deltaY: -120 });

    const viewport = container.querySelector("svg g");
    expect(viewport?.getAttribute("transform")).toContain("scale(");
  });

  it("searches online from the graph checkbox and can add discovered BibTeX", async () => {
    const onAppendBibEntry = vi.fn();
    const onOpenExternal = vi.fn();
    const onPlanDiscoveryWithAi = vi.fn().mockResolvedValue({
      queries: ["graph transformers citation discovery"],
      focusTerms: ["citation", "graph"],
      rationale: "Use AI query expansion.",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (requestHostname(input) === "api.openalex.org") {
          return new Response(
            JSON.stringify({
              results: [
                {
                  id: "https://openalex.org/WNEW",
                  doi: "https://doi.org/10.5555/new",
                  display_name: "Graph transformers for citation discovery",
                  publication_year: 2025,
                  cited_by_count: 120,
                  authorships: [{ author: { display_name: "Jane Smith" } }],
                  primary_location: {
                    landing_page_url: "https://doi.org/10.5555/new",
                    source: { display_name: "ACM Computing Surveys" },
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ message: { items: [] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    renderGraph({
      bibFiles: ["references.bib"],
      onAppendBibEntry,
      onOpenExternal,
      onPlanDiscoveryWithAi,
    });

    fireEvent.click(screen.getByLabelText(/search online/i));

    expect(
      await screen.findByText("Graph transformers for citation discovery"),
    ).toBeVisible();
    expect(onPlanDiscoveryWithAi).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/ai-assisted/i)).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", {
        name: /open graph transformers for citation discovery/i,
      }),
    );
    expect(onOpenExternal).toHaveBeenCalledWith("https://doi.org/10.5555/new");

    fireEvent.click(
      screen.getByRole("button", {
        name: /add bibtex for graph transformers for citation discovery/i,
      }),
    );

    await waitFor(() => {
      expect(onAppendBibEntry).toHaveBeenCalledWith(
        "references.bib",
        expect.stringContaining("@article{smith2025graph"),
      );
    });
    expect(screen.getByRole("button", { name: /add bibtex/i })).toHaveTextContent(
      "Added",
    );
  });

  it("shows the empty state when no bibliography entries are available", () => {
    renderGraph({
      graph: emptyGraph(),
      entriesByKey: new Map(),
    });

    expect(screen.getByText(/no bibliography entries yet/i)).toBeVisible();
    expect(screen.getByText(/0 papers/)).toBeVisible();
  });
});
