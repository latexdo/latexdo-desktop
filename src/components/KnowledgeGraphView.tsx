import { AiIcon } from "./AiIcon";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  FilePlus2,
  Globe2,
  LoaderCircle,
  Quote,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { CitationEntry } from "../latex/latexIndex";
import {
  edgeRelationLabels,
  neighborsOf,
  type EdgeRelation,
  type KnowledgeGraph,
  type KnowledgeGraphParams,
} from "../features/graph/knowledgeGraph";
import {
  discoverRelatedPapers,
  formatDiscoveredPaperAuthors,
  type DiscoveredPaper,
  type ScholarlyDiscoveryResult,
} from "../features/graph/scholarlyDiscovery";
import type { AiDiscoveryPlan } from "../features/graph/aiDiscoveryPlanner";

import {
  defaultGraphViewState,
  type GraphViewState,
  type GraphViewFilter,
} from "../features/graph/graphWorkspace";

interface KnowledgeGraphViewProps {
  filter?: GraphViewFilter;
  viewState?: GraphViewState;
  onViewStateChange?: (state: GraphViewState) => void;
  onClearFilter?: () => void;
  graph: KnowledgeGraph;
  params: KnowledgeGraphParams;
  onParamsChange: (params: KnowledgeGraphParams) => void;
  entriesByKey: Map<string, CitationEntry>;
  /** Insert the key at the cursor using the active document's citation style. */
  onInsertCitation?: (key: string) => void;
  /** Ask the AI to recommend citations for the current selection/paragraph. */
  onRecommendForSelection?: () => void;
  /** Project BibTeX files that can receive discovered online papers. */
  bibFiles?: string[];
  /** Append a fully materialized BibTeX entry to the selected project file. */
  onAppendBibEntry?: (targetFile: string, bibtex: string) => void | Promise<void>;
  /** Open DOI / publisher / PDF URLs with the app's external-link handling. */
  onOpenExternal?: (url: string) => void;
  /** Ask the configured AI to plan better scholarly search queries from the graph. */
  onPlanDiscoveryWithAi?: (
    graph: KnowledgeGraph,
    entries: CitationEntry[],
    signal: AbortSignal,
  ) => Promise<AiDiscoveryPlan | null>;
}

interface NodePosition {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const relationOrder: EdgeRelation[] = [
  "shared-author",
  "shared-venue",
  "shared-year",
  "title-similarity",
];

const width = 1000;
const height = 720;
const maxRenderedNodes = 350;

function seededPosition(index: number, total: number): { x: number; y: number } {
  // Deterministic starting layout on a spiral so runs look identical.
  const angle = index * 2.399963; // golden angle
  const radius = 20 + 14 * Math.sqrt(index);
  return {
    x: width / 2 + radius * Math.cos(angle) * (total > 1 ? 1 : 0),
    y: height / 2 + radius * Math.sin(angle) * (total > 1 ? 1 : 0),
  };
}

export const KnowledgeGraphView: React.FC<KnowledgeGraphViewProps> = ({
  graph,
  filter,
  viewState,
  onViewStateChange,
  onClearFilter,
  params,
  onParamsChange,
  entriesByKey,
  onInsertCitation,
  onRecommendForSelection,
  bibFiles = [],
  onAppendBibEntry,
  onOpenExternal,
  onPlanDiscoveryWithAi,
}) => {
  const [localViewState, setLocalViewState] = useState(defaultGraphViewState);
  const currentViewState = viewState ?? localViewState;
  const { selectedKey, query, citedOnly } = currentViewState;
  const updateViewState = useCallback(
    (patch: Partial<GraphViewState>) => {
      const next = { ...currentViewState, ...patch };
      if (onViewStateChange) onViewStateChange(next);
      else setLocalViewState(next);
    },
    [currentViewState, onViewStateChange],
  );
  const setSelectedKey = useCallback(
    (selectedKey: string | null) => updateViewState({ selectedKey }),
    [updateViewState],
  );
  const setQuery = (query: string) => updateViewState({ query });
  const setCitedOnly = (citedOnly: boolean) => updateViewState({ citedOnly });
  const [showControls, setShowControls] = useState(false);
  const [onlineDiscovery, setOnlineDiscovery] = useState(false);
  const [onlineResult, setOnlineResult] = useState<ScholarlyDiscoveryResult>({
    papers: [],
    queries: [],
    providerErrors: [],
    aiQueriesUsed: [],
  });
  const [onlineState, setOnlineState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [onlineError, setOnlineError] = useState("");
  const [targetBibFile, setTargetBibFile] = useState(bibFiles[0] ?? "");
  const [addedOnlineIds, setAddedOnlineIds] = useState<Set<string>>(() => new Set());
  const [aiPlan, setAiPlan] = useState<AiDiscoveryPlan | null>(null);
  const [aiPlanState, setAiPlanState] = useState<
    "idle" | "planning" | "used" | "unavailable"
  >("idle");
  const [, forceTick] = useState(0);

  // Only the strongest-connected nodes are drawn when a library is huge.
  const rendered = useMemo(() => {
    let nodes = graph.nodes;
    if (filter?.keys !== null && filter?.keys !== undefined) {
      const keys = new Set(filter.keys);
      nodes = nodes.filter((node) => keys.has(node.key));
    }
    if (citedOnly) nodes = nodes.filter((node) => node.cited);
    if (nodes.length > maxRenderedNodes) {
      nodes = [...nodes].sort((a, b) => b.degree - a.degree).slice(0, maxRenderedNodes);
    }
    const keySet = new Set(nodes.map((node) => node.key));
    const edges = graph.edges.filter(
      (edge) => keySet.has(edge.source) && keySet.has(edge.target),
    );
    return { nodes, edges, keySet };
  }, [graph, citedOnly, filter]);

  const positions = useRef(new Map<string, NodePosition>());
  const dragging = useRef<string | null>(null);
  const alpha = useRef(1);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const panning = useRef<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const frame = useRef<number | null>(null);
  const discoveryAbort = useRef<AbortController | null>(null);
  const discoveryRunId = useRef(0);

  useEffect(() => {
    if (!bibFiles.length) {
      setTargetBibFile("");
      return;
    }
    if (!targetBibFile || !bibFiles.includes(targetBibFile)) {
      setTargetBibFile(bibFiles[0]);
    }
  }, [bibFiles, targetBibFile]);

  // (Re)seed positions whenever the rendered node set changes.
  useEffect(() => {
    const next = new Map<string, NodePosition>();
    rendered.nodes.forEach((node, index) => {
      const existing = positions.current.get(node.key);
      const seed = seededPosition(index, rendered.nodes.length);
      next.set(node.key, existing ?? { x: seed.x, y: seed.y, vx: 0, vy: 0 });
    });
    positions.current = next;
    alpha.current = 1;
  }, [rendered.nodes]);

  // Force simulation loop.
  useEffect(() => {
    const edges = rendered.edges;
    const nodes = rendered.nodes;
    const pos = positions.current;

    const tick = () => {
      if (alpha.current > 0.01) {
        const repulsion = 5200;
        const centerPull = 0.012;
        // Repulsion (O(n^2), bounded by maxRenderedNodes).
        for (let i = 0; i < nodes.length; i += 1) {
          const a = pos.get(nodes[i].key);
          if (!a) continue;
          for (let j = i + 1; j < nodes.length; j += 1) {
            const b = pos.get(nodes[j].key);
            if (!b) continue;
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let distSq = dx * dx + dy * dy;
            if (distSq < 0.01) {
              dx = (Math.random() - 0.5) * 0.5;
              dy = (Math.random() - 0.5) * 0.5;
              distSq = dx * dx + dy * dy + 0.01;
            }
            const force = (repulsion / distSq) * alpha.current;
            const dist = Math.sqrt(distSq);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            a.vx += fx;
            a.vy += fy;
            b.vx -= fx;
            b.vy -= fy;
          }
        }
        // Springs along edges (stronger edges = shorter target length).
        for (const edge of edges) {
          const a = pos.get(edge.source);
          const b = pos.get(edge.target);
          if (!a || !b) continue;
          const target = Math.max(60, 200 - edge.weight * 14);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const force = (dist - target) * 0.02 * alpha.current;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
        // Centering + integrate.
        for (const node of nodes) {
          const p = pos.get(node.key);
          if (!p) continue;
          if (dragging.current === node.key) {
            p.vx = 0;
            p.vy = 0;
            continue;
          }
          p.vx += (width / 2 - p.x) * centerPull * alpha.current;
          p.vy += (height / 2 - p.y) * centerPull * alpha.current;
          p.vx *= 0.82;
          p.vy *= 0.82;
          p.x += Math.max(-30, Math.min(30, p.vx));
          p.y += Math.max(-30, Math.min(30, p.vy));
        }
        alpha.current *= 0.975;
        forceTick((value) => (value + 1) % 1_000_000);
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [rendered]);

  const reheat = useCallback(() => {
    alpha.current = Math.max(alpha.current, 0.6);
  }, []);

  const refreshOnlineDiscovery = useCallback(async () => {
    discoveryAbort.current?.abort();
    const controller = new AbortController();
    discoveryAbort.current = controller;
    const runId = discoveryRunId.current + 1;
    discoveryRunId.current = runId;
    setOnlineState("loading");
    setOnlineError("");

    try {
      const entries = [...entriesByKey.values()];
      setAiPlanState(onPlanDiscoveryWithAi ? "planning" : "unavailable");
      const planned = onPlanDiscoveryWithAi
        ? await onPlanDiscoveryWithAi(graph, entries, controller.signal)
        : null;
      if (discoveryRunId.current !== runId || controller.signal.aborted) return;
      setAiPlan(planned);
      setAiPlanState(planned ? "used" : "unavailable");

      const result = await discoverRelatedPapers(graph, entries, {
        signal: controller.signal,
        aiQueries: planned?.queries,
      });
      if (discoveryRunId.current !== runId || controller.signal.aborted) return;
      setOnlineResult(result);
      setOnlineState(
        result.providerErrors.length && !result.papers.length ? "error" : "ready",
      );
      setOnlineError(
        result.providerErrors.length && !result.papers.length
          ? result.providerErrors.join("; ")
          : "",
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      if (discoveryRunId.current !== runId) return;
      setOnlineState("error");
      setOnlineError(
        error instanceof Error ? error.message : "Could not search scholarly sources.",
      );
      setOnlineResult({
        papers: [],
        queries: [],
        providerErrors: [],
        aiQueriesUsed: [],
      });
      setAiPlan(null);
      setAiPlanState(onPlanDiscoveryWithAi ? "unavailable" : "idle");
    }
  }, [entriesByKey, graph, onPlanDiscoveryWithAi]);

  useEffect(() => {
    if (!onlineDiscovery) {
      discoveryAbort.current?.abort();
      discoveryAbort.current = null;
      setOnlineState("idle");
      setOnlineError("");
      setAiPlan(null);
      setAiPlanState("idle");
      return;
    }
    void refreshOnlineDiscovery();
    return () => {
      discoveryAbort.current?.abort();
    };
  }, [onlineDiscovery, refreshOnlineDiscovery]);

  const toScene = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * width;
    const sy = ((clientY - rect.top) / rect.height) * height;
    return {
      x: (sx - view.current.x) / view.current.k,
      y: (sy - view.current.y) / view.current.k,
    };
  }, []);

  const onNodePointerDown = useCallback(
    (event: React.PointerEvent, key: string) => {
      event.stopPropagation();
      (event.target as Element).setPointerCapture?.(event.pointerId);
      dragging.current = key;
      setSelectedKey(key);
      reheat();
    },
    [reheat, setSelectedKey],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (dragging.current) {
        const scene = toScene(event.clientX, event.clientY);
        const p = positions.current.get(dragging.current);
        if (p) {
          p.x = scene.x;
          p.y = scene.y;
          p.vx = 0;
          p.vy = 0;
        }
        reheat();
      } else if (panning.current) {
        view.current.x += event.clientX - panning.current.x;
        view.current.y += event.clientY - panning.current.y;
        panning.current = { x: event.clientX, y: event.clientY };
        forceTick((value) => (value + 1) % 1_000_000);
      }
    },
    [reheat, toScene],
  );

  const endDrag = useCallback(() => {
    dragging.current = null;
    panning.current = null;
  }, []);

  const onBackgroundPointerDown = useCallback(
    (event: React.PointerEvent) => {
      panning.current = { x: event.clientX, y: event.clientY };
      setSelectedKey(null);
    },
    [setSelectedKey],
  );

  const onWheel = useCallback((event: React.WheelEvent) => {
    const delta = -event.deltaY * 0.0015;
    const nextK = Math.max(0.3, Math.min(3, view.current.k * (1 + delta)));
    view.current.k = nextK;
    forceTick((value) => (value + 1) % 1_000_000);
  }, []);

  const highlight = query.trim().toLowerCase();
  const matches = useCallback(
    (key: string): boolean => {
      if (!highlight) return false;
      const node = rendered.nodes.find((n) => n.key === key);
      if (!node) return false;
      return (
        node.key.toLowerCase().includes(highlight) ||
        (node.title?.toLowerCase().includes(highlight) ?? false) ||
        node.authors.some((a) => a.includes(highlight))
      );
    },
    [highlight, rendered.nodes],
  );

  const selectedNeighbors = selectedKey ? neighborsOf(graph, selectedKey) : [];
  const selectedNode = selectedKey
    ? graph.nodes.find((n) => n.key === selectedKey)
    : null;
  const selectedEntry = selectedKey ? entriesByKey.get(selectedKey) : undefined;

  const maxDegree = Math.max(1, ...rendered.nodes.map((n) => n.degree));

  const setRelation = (relation: EdgeRelation, value: boolean) => {
    onParamsChange({
      ...params,
      relations: { ...params.relations, [relation]: value },
    });
  };

  const openPaper = (paper: DiscoveredPaper) => {
    const url = paper.url ?? paper.pdfUrl;
    if (!url) return;
    if (onOpenExternal) onOpenExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  const addOnlineBibEntry = async (paper: DiscoveredPaper) => {
    if (!onAppendBibEntry || !targetBibFile) return;
    await onAppendBibEntry(targetBibFile, paper.bibtex);
    setAddedOnlineIds((current) => new Set(current).add(paper.id));
  };

  const onlineSummary =
    aiPlanState === "planning"
      ? "AI is planning scholarly search queries..."
      : onlineState === "loading"
        ? "Searching scholarly sources..."
        : onlineState === "error"
          ? onlineError || "Scholarly search failed."
          : onlineResult.papers.length
            ? `${onlineResult.papers.length} related papers found`
            : onlineDiscovery
              ? "No new related papers found"
              : "Online discovery off";

  return (
    <div className="kg-view">
      {filter?.keys !== null && filter?.keys !== undefined ? (
        <div className="kg-filter-banner" role="status">
          <span>
            {filter.label} · {rendered.nodes.length} of {graph.nodes.length} entries
          </span>
          <button
            type="button"
            className="kg-btn"
            onClick={() => {
              setCitedOnly(false);
              onClearFilter?.();
            }}
          >
            Show all entries
          </button>
        </div>
      ) : null}
      <div className="kg-toolbar">
        <div className="kg-search">
          <Search size={13} />
          <input
            type="text"
            value={query}
            placeholder="Find paper, author…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <label
          className={`kg-pill ${citedOnly ? "on" : ""}`}
          title="Show only papers cited in your text"
        >
          <input
            type="checkbox"
            aria-label="Cited only"
            checked={citedOnly}
            onChange={(event) => setCitedOnly(event.target.checked)}
          />
          Cited
        </label>
        <label
          className={`kg-pill ${onlineDiscovery ? "on" : ""}`}
          title="Find related papers online (OpenAlex, Crossref)"
        >
          <input
            type="checkbox"
            aria-label="Search online"
            checked={onlineDiscovery}
            onChange={(event) => setOnlineDiscovery(event.target.checked)}
          />
          Online
        </label>
        <span className="kg-stats">
          {graph.stats.nodeCount} papers · {graph.stats.edgeCount} links ·{" "}
          {graph.stats.citedCount} cited · {graph.stats.componentCount} clusters
        </span>
        <button
          type="button"
          className={`kg-icon-btn ${showControls ? "active" : ""}`}
          onClick={() => setShowControls((value) => !value)}
          title="Graph parameters"
          aria-label="Graph parameters"
          aria-expanded={showControls}
          aria-controls="knowledge-graph-parameters"
        >
          <SlidersHorizontal size={14} />
        </button>
        {onRecommendForSelection ? (
          <button
            type="button"
            className="kg-icon-btn"
            onClick={onRecommendForSelection}
            title="Recommend citations for the selected text"
            aria-label="Recommend citations"
          >
            <AiIcon size={14} />
          </button>
        ) : null}
      </div>

      {onlineDiscovery ? (
        <div className="kg-online-panel">
          <div className="kg-online-head">
            <div>
              <strong>
                <Globe2 size={14} /> Online paper discovery
              </strong>
              <span>{onlineSummary}</span>
              {aiPlanState === "used" && aiPlan ? (
                <span className="kg-online-ai">
                  AI-assisted: {aiPlan.queries.slice(0, 2).join(" · ")}
                </span>
              ) : aiPlanState === "unavailable" ? (
                <span className="kg-online-ai">
                  AI planning unavailable; using graph fingerprint.
                </span>
              ) : null}
            </div>
            <div className="kg-online-actions">
              {bibFiles.length ? (
                <select
                  value={targetBibFile}
                  onChange={(event) => setTargetBibFile(event.target.value)}
                  aria-label="Target BibTeX file"
                >
                  {bibFiles.map((file) => (
                    <option key={file} value={file}>
                      {file}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                type="button"
                className="kg-btn"
                onClick={() => void refreshOnlineDiscovery()}
                disabled={onlineState === "loading"}
              >
                {onlineState === "loading" ? (
                  <LoaderCircle size={13} className="spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                Refresh
              </button>
            </div>
          </div>

          {onlineResult.queries.length ? (
            <div className="kg-online-query">
              Search fingerprint: {onlineResult.queries.slice(0, 2).join(" · ")}
            </div>
          ) : null}

          <div className="kg-online-results">
            {onlineState === "loading" && onlineResult.papers.length === 0 ? (
              <div className="kg-online-empty">Searching OpenAlex and Crossref...</div>
            ) : onlineResult.papers.length ? (
              onlineResult.papers.slice(0, 10).map((paper) => {
                const added = addedOnlineIds.has(paper.id);
                return (
                  <article key={paper.id} className="kg-online-card">
                    <div className="kg-online-card-main">
                      <div className="kg-online-card-meta">
                        <span>{paper.source}</span>
                        <span>{Math.round(paper.score * 100)}% match</span>
                        {paper.year ? <span>{paper.year}</span> : null}
                      </div>
                      <h3>{paper.title}</h3>
                      <p>
                        {formatDiscoveredPaperAuthors(paper)}
                        {paper.venue ? ` · ${paper.venue}` : ""}
                      </p>
                      {paper.reasons.length ? (
                        <small>{paper.reasons.slice(0, 3).join(" · ")}</small>
                      ) : null}
                    </div>
                    <div className="kg-online-card-actions">
                      <button
                        type="button"
                        onClick={() => openPaper(paper)}
                        disabled={!paper.url && !paper.pdfUrl}
                        aria-label={`Open ${paper.title}`}
                      >
                        <ExternalLink size={12} /> Open
                      </button>
                      <button
                        type="button"
                        onClick={() => void addOnlineBibEntry(paper)}
                        disabled={
                          added ||
                          !onAppendBibEntry ||
                          !targetBibFile ||
                          !bibFiles.length
                        }
                        aria-label={`Add BibTeX for ${paper.title}`}
                      >
                        <FilePlus2 size={12} /> {added ? "Added" : "Add BibTeX"}
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="kg-online-empty">
                {onlineState === "error"
                  ? onlineSummary
                  : "Enable discovery or refresh after adding bibliography entries."}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="kg-canvas-wrap">
        {showControls ? (
          <div
            className="kg-controls"
            id="knowledge-graph-parameters"
            role="region"
            aria-label="Graph parameters"
          >
            <span className="kg-controls-title">Link papers that share</span>
            <div className="kg-controls-relations">
              {relationOrder.map((relation) => (
                <label
                  key={relation}
                  className={`kg-pill ${params.relations[relation] ? "on" : ""}`}
                >
                  <input
                    type="checkbox"
                    aria-label={edgeRelationLabels[relation]}
                    checked={params.relations[relation]}
                    onChange={(event) => setRelation(relation, event.target.checked)}
                  />
                  {edgeRelationLabels[relation]}
                </label>
              ))}
            </div>
            <label className="kg-slider">
              <span>
                Topic match
                <output>{params.titleSimilarityThreshold.toFixed(2)}</output>
              </span>
              <input
                type="range"
                aria-label="Topic similarity threshold"
                min={0.05}
                max={0.6}
                step={0.01}
                value={params.titleSimilarityThreshold}
                onChange={(event) =>
                  onParamsChange({
                    ...params,
                    titleSimilarityThreshold: Number(event.target.value),
                  })
                }
              />
              <small>
                <span>Loose</span>
                <span>Strict</span>
              </small>
            </label>
            <label className="kg-slider">
              <span>
                Links per paper
                <output>{params.maxEdgesPerNode}</output>
              </span>
              <input
                type="range"
                aria-label="Max links per paper"
                min={2}
                max={12}
                step={1}
                value={params.maxEdgesPerNode}
                onChange={(event) =>
                  onParamsChange({
                    ...params,
                    maxEdgesPerNode: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
        ) : null}

        {rendered.nodes.length === 0 ? (
          <div className="kg-empty">
            {graph.nodes.length ? (
              "No entries match the current filters. Try showing all entries."
            ) : (
              <>
                No bibliography entries yet. Add a <code>.bib</code> file (or citations)
                to build the knowledge graph.
              </>
            )}
          </div>
        ) : (
          <svg
            ref={svgRef}
            className="kg-canvas"
            viewBox={`0 0 ${width} ${height}`}
            onPointerDown={onBackgroundPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            onWheel={onWheel}
          >
            <g
              transform={`translate(${view.current.x} ${view.current.y}) scale(${view.current.k})`}
            >
              {rendered.edges.map((edge) => {
                const a = positions.current.get(edge.source);
                const b = positions.current.get(edge.target);
                if (!a || !b) return null;
                const active =
                  selectedKey === edge.source || selectedKey === edge.target;
                return (
                  <line
                    key={`${edge.source}--${edge.target}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className={`kg-edge ${active ? "active" : ""}`}
                    strokeWidth={Math.min(4, 0.6 + edge.weight * 0.25)}
                  />
                );
              })}
              {rendered.nodes.map((node) => {
                const p = positions.current.get(node.key);
                if (!p) return null;
                const radius = 6 + (node.degree / maxDegree) * 12;
                const isSelected = selectedKey === node.key;
                const isMatch = matches(node.key);
                const dim = highlight && !isMatch;
                return (
                  <g
                    key={node.key}
                    transform={`translate(${p.x} ${p.y})`}
                    className={`kg-node ${node.cited ? "cited" : "uncited"} ${
                      isSelected ? "selected" : ""
                    } ${dim ? "dim" : ""} ${isMatch ? "match" : ""}`}
                    onPointerDown={(event) => onNodePointerDown(event, node.key)}
                  >
                    <circle r={radius} />
                    {radius > 9 || isSelected || isMatch ? (
                      <text y={-radius - 4} className="kg-label">
                        {node.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {selectedNode ? (
          <aside className="kg-inspector">
            <div className="kg-inspector-head">
              <strong>{selectedNode.label}</strong>
              <button
                type="button"
                className="kg-icon"
                onClick={() => setSelectedKey(null)}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="kg-inspector-body">
              {selectedNode.title ? (
                <p className="kg-title">{selectedNode.title}</p>
              ) : null}
              <dl className="kg-meta">
                {selectedEntry?.author ? (
                  <>
                    <dt>Authors</dt>
                    <dd>{selectedEntry.author}</dd>
                  </>
                ) : null}
                {selectedNode.year ? (
                  <>
                    <dt>Year</dt>
                    <dd>{selectedNode.year}</dd>
                  </>
                ) : null}
                {selectedNode.venue ? (
                  <>
                    <dt>Venue</dt>
                    <dd>{selectedNode.venue}</dd>
                  </>
                ) : null}
                <dt>Key</dt>
                <dd>
                  <code>{selectedNode.key}</code>
                </dd>
                <dt>Status</dt>
                <dd>{selectedNode.cited ? "Cited in text" : "Not cited yet"}</dd>
              </dl>
              <button
                type="button"
                className="kg-cite-btn"
                onClick={() => onInsertCitation?.(selectedNode.key)}
                disabled={!onInsertCitation}
                title={
                  !onInsertCitation
                    ? "Open a LaTeX document to insert a citation"
                    : undefined
                }
              >
                <Quote size={13} /> Insert citation
              </button>

              <div className="kg-neighbors">
                <span className="kg-neighbors-head">
                  Connections ({selectedNeighbors.length})
                </span>
                {selectedNeighbors.length === 0 ? (
                  <p className="kg-muted">No connections with current parameters.</p>
                ) : (
                  selectedNeighbors.slice(0, 12).map(({ key, edge }) => {
                    const neighbor = graph.nodes.find((n) => n.key === key);
                    return (
                      <button
                        type="button"
                        key={key}
                        className="kg-neighbor"
                        onClick={() => setSelectedKey(key)}
                      >
                        <span className="kg-neighbor-label">
                          {neighbor?.label ?? key}
                        </span>
                        <span className="kg-neighbor-why">
                          {edge.relations
                            .map((relation) => edgeRelationLabels[relation])
                            .join(" · ")}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
};
