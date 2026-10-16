import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BringToFront,
  Circle,
  Cloud,
  Copy,
  CornerUpRight,
  Database,
  Diamond,
  Download,
  Eraser,
  Grid,
  Hand,
  Hexagon,
  Minus,
  MousePointer2,
  MoveHorizontal,
  Pen,
  Pentagon,
  Plus,
  Redo2,
  SendToBack,
  Square,
  Star,
  Trash2,
  Triangle,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DrawShape, ShapeKind } from "./tikzGenerator";
import { generateFullDocument, generateTikzCode, parseTikzCode } from "./tikzGenerator";
import React from "react";
import type { ReactElement } from "react";

// ---------- constants ----------

const GRID_SIZE = 25;
const DEFAULT_STROKE = "#d6dae2";
const DEFAULT_FILL = "none";
const DEFAULT_STROKE_WIDTH = 1.5;
const DEFAULT_FONT_SIZE = 14;

const COLORS = [
  "#d6dae2",
  "#000000",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#ffffff",
  "#a0522d",
];

// ---------- helpers ----------

let _idCounter = 0;
function uid(): string {
  return `s${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;
}

function snapGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function defaultShape(kind: ShapeKind): DrawShape {
  return {
    id: uid(),
    kind,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    label: "",
    points: [],
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    dashed: false,
    fontSize: DEFAULT_FONT_SIZE,
    rotation: 0,
  };
}

function cloneShape(shape: DrawShape): DrawShape {
  return {
    ...shape,
    points: shape.points.map(([x, y]) => [x, y]),
  };
}

function cloneShapes(shapes: DrawShape[]): DrawShape[] {
  return shapes.map(cloneShape);
}

function shapeContains(s: DrawShape, px: number, py: number): boolean {
  const margin = 6;
  if (s.kind === "line" || s.kind === "arrow" || s.kind === "freehand") {
    for (let i = 0; i < s.points.length - 1; i++) {
      const [ax, ay] = s.points[i];
      const [bx, by] = s.points[i + 1];
      const dist = pointToSegmentDist(px, py, ax, ay, bx, by);
      if (dist < 8) return true;
    }
    return false;
  }

  if (s.kind === "text") {
    return px >= s.x - 40 && px <= s.x + 80 && py >= s.y - 16 && py <= s.y + 16;
  }

  return (
    px >= s.x - margin &&
    px <= s.x + s.w + margin &&
    py >= s.y - margin &&
    py <= s.y + s.h + margin
  );
}

function pointToSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ---------- Component ----------

type ToolType = "select" | "pan" | ShapeKind;

interface HistoryEntry {
  shapes: DrawShape[];
}

interface DragSession {
  selectedId: string;
  start: { x: number; y: number };
  originalShapes: DrawShape[];
  latestShapes: DrawShape[];
  moved: boolean;
}

type LayerAction = "front" | "forward" | "backward" | "back";

interface ShapeContextMenu {
  shapeId: string;
  x: number;
  y: number;
}

export interface TikzCanvasProps {
  onInsertCode?: (code: string) => void;
  /** False while the tab is in the background: shortcuts then stay off. */
  active?: boolean;
}

/** Keys typed into a text field (the AI chat, the code panel) are not shortcuts. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export default function TikzCanvas({ onInsertCode, active = true }: TikzCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const drawingShapeIdRef = useRef<string | null>(null);
  const shapesRef = useRef<DrawShape[]>([]);
  const panStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    vbX: number;
    vbY: number;
  } | null>(null);

  // -- viewBox (zoom / pan) --
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 1200, h: 800 });
  const viewBoxRef = useRef(viewBox);
  viewBoxRef.current = viewBox;
  const [isPanning, setIsPanning] = useState(false);
  const zoomPercent = Math.round((1200 / viewBox.w) * 100);

  // -- state --
  const [shapes, setShapesState] = useState<DrawShape[]>([]);
  const [tool, setTool] = useState<ToolType>("select");
  const [stroke, setStroke] = useState(DEFAULT_STROKE);
  const [fill, setFill] = useState(DEFAULT_FILL);
  const [strokeWidth, setStrokeWidth] = useState(DEFAULT_STROKE_WIDTH);
  const [dashed, setDashed] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [textPrompt, setTextPrompt] = useState<{ x: number; y: number } | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [codeMode, setCodeMode] = useState<"tikz" | "full">("tikz");
  const [copied, setCopied] = useState(false);
  const [editableCode, setEditableCode] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ShapeContextMenu | null>(null);
  const manualEditRef = useRef(false);

  const setShapes = useCallback((next: DrawShape[]) => {
    shapesRef.current = next;
    setShapesState(next);
  }, []);

  const updateShapes = useCallback((updater: (current: DrawShape[]) => DrawShape[]) => {
    const next = updater(shapesRef.current);
    shapesRef.current = next;
    setShapesState(next);
    return next;
  }, []);

  // -- undo / redo --
  const [history, setHistory] = useState<HistoryEntry[]>([{ shapes: [] }]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const pushHistory = useCallback(
    (next: DrawShape[]) => {
      setHistory((prev) => {
        const trimmed = prev.slice(0, historyIndex + 1);
        return [...trimmed, { shapes: next }];
      });
      setHistoryIndex((i) => i + 1);
    },
    [historyIndex],
  );

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    setShapes(history[newIndex].shapes);
    setSelected(null);
  }, [history, historyIndex, setShapes]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    setShapes(history[newIndex].shapes);
    setSelected(null);
  }, [history, historyIndex, setShapes]);

  // -- canvas presets --
  const CANVAS_PRESETS = [
    { label: "Default (24×16cm)", width: 1200, height: 800 },
    { label: "A4 Portrait (21×29.7cm)", width: 1050, height: 1485 },
    { label: "A4 Landscape (29.7×21cm)", width: 1485, height: 1050 },
    { label: "Beamer (12.8×9.6cm)", width: 640, height: 480 },
    { label: "Letter (21.6×27.9cm)", width: 1080, height: 1397 },
  ];
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 800 });

  // -- generated code --
  const tikzCode = useMemo(() => {
    if (codeMode === "full") {
      return generateFullDocument(shapes, canvasSize.width, canvasSize.height);
    }
    return generateTikzCode(shapes, canvasSize.width, canvasSize.height);
  }, [shapes, codeMode, canvasSize]);

  // -- snap helper --
  const snap = useCallback(
    (v: number) => (snapEnabled ? snapGrid(v) : v),
    [snapEnabled],
  );

  // -- keyboard shortcuts --
  useEffect(() => {
    if (!active) return;
    const handle = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected) {
          const next = shapes.filter((s) => s.id !== selected);
          setShapes(next);
          pushHistory(next);
          setSelected(null);
        }
      }
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if (mod && (e.key === "Z" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
      if (e.key === "Escape") {
        setSelected(null);
        setContextMenu(null);
        setTool("select");
      }
      // tool shortcuts
      if (!mod && !e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case "v":
            setTool("select");
            break;
          case "h":
            setTool("pan");
            break;
          case "r":
            setTool("rect");
            break;
          case "c":
            setTool("circle");
            break;
          case "e":
            setTool("ellipse");
            break;
          case "l":
            setTool("line");
            break;
          case "a":
            setTool("arrow");
            break;
          case "t":
            setTool("text");
            break;
          case "d":
            setTool("diamond");
            break;
          case "p":
            setTool("freehand");
            break;
          // added tools
          case "g":
            setTool("grid");
            break;
          case "x":
            setTool("axes");
            break;
          // new shapes (no shortcut keys assigned)
        }
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [active, selected, shapes, setShapes, pushHistory, undo, redo]);

  // -- wheel zoom (non-passive listener) --
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const vb = viewBoxRef.current;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
      const newW = Math.max(60, Math.min(24000, vb.w * factor));
      const newH = newW * (800 / 1200);
      const svgX = mouseX * (vb.w / rect.width) + vb.x;
      const svgY = mouseY * (vb.h / rect.height) + vb.y;
      const newX = svgX - mouseX * (newW / rect.width);
      const newY = svgY - mouseY * (newH / rect.height);
      const next = { x: newX, y: newY, w: newW, h: newH };
      setViewBox(next);
      viewBoxRef.current = next;
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // -- helper: commit shape with history --
  const commitShape = useCallback(
    (next: DrawShape[]) => {
      setShapes(next);
      pushHistory(next);
    },
    [setShapes, pushHistory],
  );

  // -- event handlers --
  const getSvgPoint = (e: React.MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const sx = rect.width > 0 ? viewBox.w / rect.width : 1;
    const sy = rect.height > 0 ? viewBox.h / rect.height : 1;
    return {
      x: (e.clientX - rect.left) * sx + viewBox.x,
      y: (e.clientY - rect.top) * sy + viewBox.y,
    };
  };

  const shapeAtPoint = useCallback((px: number, py: number): DrawShape | null => {
    return (
      [...shapesRef.current].reverse().find((shape) => shapeContains(shape, px, py)) ??
      null
    );
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setContextMenu(null);
    const pt = getSvgPoint(e);
    const x = snap(pt.x);
    const y = snap(pt.y);
    const currentShapes = shapesRef.current;

    if (tool === "select") {
      // check if clicking a shape
      const hit = shapeAtPoint(pt.x, pt.y);
      if (hit) {
        const originalShapes = cloneShapes(currentShapes);
        dragSessionRef.current = {
          selectedId: hit.id,
          start: pt,
          originalShapes,
          latestShapes: originalShapes,
          moved: false,
        };
        setSelected(hit.id);
        setDragStart(pt);
      } else {
        dragSessionRef.current = null;
        setSelected(null);
      }
      return;
    }

    if (tool === "pan") {
      panStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        vbX: viewBox.x,
        vbY: viewBox.y,
      };
      setIsPanning(true);
      return;
    }

    if (tool === "text") {
      setTextPrompt({ x, y });
      setDrawing(false);
      return;
    }

    setDrawing(true);
    setDragStart({ x, y });
    setSelected(null);

    if (tool === "line" || tool === "arrow") {
      const shape: DrawShape = {
        ...defaultShape(tool),
        stroke,
        fill,
        strokeWidth,
        dashed,
        points: [
          [x, y],
          [x, y],
        ],
      };
      drawingShapeIdRef.current = shape.id;
      setShapes([...currentShapes, shape]);
      return;
    }

    if (tool === "freehand") {
      const shape: DrawShape = {
        ...defaultShape("freehand"),
        stroke,
        fill,
        strokeWidth,
        dashed,
        points: [[pt.x, pt.y]],
      };
      drawingShapeIdRef.current = shape.id;
      setShapes([...currentShapes, shape]);
      return;
    }

    // shape-based tools
    const shape: DrawShape = {
      ...defaultShape(tool as ShapeKind),
      x,
      y,
      w: 0,
      h: 0,
      stroke,
      fill,
      strokeWidth,
      dashed,
    };
    drawingShapeIdRef.current = shape.id;
    setShapes([...currentShapes, shape]);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const pt = getSvgPoint(e);
    const hit = shapeAtPoint(pt.x, pt.y);
    dragSessionRef.current = null;

    if (!hit) {
      setContextMenu(null);
      setSelected(null);
      return;
    }

    setSelected(hit.id);
    setTool("select");
    setContextMenu({
      shapeId: hit.id,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pt = getSvgPoint(e);

    // pan
    if (panStartRef.current) {
      const pan = panStartRef.current;
      const svg = svgRef.current!;
      const rect = svg.getBoundingClientRect();
      const vb = viewBoxRef.current;
      const sx = rect.width > 0 ? vb.w / rect.width : 1;
      const sy = rect.height > 0 ? vb.h / rect.height : 1;
      const dx = (e.clientX - pan.mouseX) * sx;
      const dy = (e.clientY - pan.mouseY) * sy;
      const next = { ...vb, x: pan.vbX - dx, y: pan.vbY - dy };
      setViewBox(next);
      viewBoxRef.current = next;
      return;
    }

    // dragging in select mode
    if (tool === "select" && dragSessionRef.current) {
      e.preventDefault();
      const drag = dragSessionRef.current;
      const dx = pt.x - drag.start.x;
      const dy = pt.y - drag.start.y;
      drag.moved = drag.moved || Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
      const next = drag.originalShapes.map((s) => {
        if (s.id !== drag.selectedId) return s;
        if (s.kind === "line" || s.kind === "arrow" || s.kind === "freehand") {
          return {
            ...s,
            points: s.points.map(([ox, oy]) => [ox + dx, oy + dy] as [number, number]),
          };
        }
        return { ...s, x: s.x + dx, y: s.y + dy };
      });
      drag.latestShapes = next;
      setShapes(next);
      return;
    }

    if (!drawing || !dragStart) return;

    const x = snap(pt.x);
    const y = snap(pt.y);

    if (tool === "line" || tool === "arrow") {
      updateShapes((prev) => {
        const last = prev[prev.length - 1];
        if (!last) return prev;
        const pts = [...last.points];
        pts[pts.length - 1] = [x, y];
        return [...prev.slice(0, -1), { ...last, points: pts }];
      });
      return;
    }

    if (tool === "freehand") {
      updateShapes((prev) => {
        const last = prev[prev.length - 1];
        if (!last) return prev;
        return [
          ...prev.slice(0, -1),
          { ...last, points: [...last.points, [pt.x, pt.y]] },
        ];
      });
      return;
    }

    // rect, circle, ellipse, diamond, triangle, parallelogram, cylinder, grid, axes
    updateShapes((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      const nx = Math.min(dragStart.x, x);
      const ny = Math.min(dragStart.y, y);
      const nw = Math.abs(x - dragStart.x);
      const nh = Math.abs(y - dragStart.y);
      return [...prev.slice(0, -1), { ...last, x: nx, y: ny, w: nw, h: nh }];
    });
  };

  const handleMouseUp = () => {
    if (panStartRef.current) {
      panStartRef.current = null;
      setIsPanning(false);
      setDragStart(null);
      return;
    }

    if (tool === "select" && dragSessionRef.current) {
      // commit drag
      const drag = dragSessionRef.current;
      if (drag.moved) {
        setShapes(drag.latestShapes);
        pushHistory(drag.latestShapes);
      }
      dragSessionRef.current = null;
      setDragStart(null);
      return;
    }

    if (!drawing) return;
    setDrawing(false);
    setDragStart(null);
    const drawnShapeId = drawingShapeIdRef.current;
    drawingShapeIdRef.current = null;
    let next = shapesRef.current;

    // simplify freehand: reduce points
    if (tool === "freehand" && drawnShapeId) {
      const last = next[next.length - 1];
      if (last?.id === drawnShapeId && last.points.length >= 3) {
        // Douglas-Peucker-like simplification: take every 3rd point
        const simplified = last.points.filter(
          (_, i) => i === 0 || i === last.points.length - 1 || i % 3 === 0,
        );
        next = [...next.slice(0, -1), { ...last, points: simplified }];
      }
    }

    // Remove shapes with zero size
    const last = next[next.length - 1];
    let keptDrawnShape = Boolean(last && last.id === drawnShapeId);
    if (last && last.id === drawnShapeId) {
      if (
        (last.kind === "rect" ||
          last.kind === "circle" ||
          last.kind === "ellipse" ||
          last.kind === "diamond" ||
          last.kind === "triangle" ||
          last.kind === "parallelogram" ||
          last.kind === "cylinder" ||
          last.kind === "grid" ||
          last.kind === "axes" ||
          last.kind === "pentagon" ||
          last.kind === "hexagon" ||
          last.kind === "star" ||
          last.kind === "cloud" ||
          last.kind === "trapezium") &&
        last.w < 4 &&
        last.h < 4
      ) {
        next = next.slice(0, -1);
        keptDrawnShape = false;
      }
      if ((last.kind === "line" || last.kind === "arrow") && last.points.length >= 2) {
        const [x1, y1] = last.points[0];
        const [x2, y2] = last.points[last.points.length - 1];
        if (Math.abs(x2 - x1) < 4 && Math.abs(y2 - y1) < 4) {
          next = next.slice(0, -1);
          keptDrawnShape = false;
        }
      }
      if (last.kind === "freehand" && last.points.length < 2) {
        next = next.slice(0, -1);
        keptDrawnShape = false;
      }
    }

    setShapes(next);
    if (keptDrawnShape && drawnShapeId) {
      pushHistory(next);
      setSelected(drawnShapeId);
    } else {
      setSelected(null);
    }
  };

  // -- sync code from canvas to editable textarea --
  useEffect(() => {
    if (!manualEditRef.current) {
      setEditableCode(tikzCode);
    }
  }, [tikzCode]);

  // -- parse edited code back to shapes --
  const handleApplyCode = () => {
    manualEditRef.current = false;
    try {
      const parsed = parseTikzCode(editableCode, canvasSize.width, canvasSize.height);
      if (parsed.length === 0 && editableCode.trim()) {
        setParseError("Could not parse any shapes from the code.");
        return;
      }
      setParseError(null);
      commitShape(parsed);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Failed to parse TikZ code.");
    }
  };

  // -- copy code --
  const handleCopy = async () => {
    await navigator.clipboard.writeText(tikzCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const fullDoc = generateFullDocument(shapes, canvasSize.width, canvasSize.height);
    const blob = new Blob([fullDoc], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tikz-drawing.tex";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    if (shapes.length && !confirm("Clear all shapes?")) return;
    commitShape([]);
    setSelected(null);
  };

  const handleDeleteSelected = () => {
    if (!selected) return;
    const next = shapes.filter((s) => s.id !== selected);
    commitShape(next);
    setSelected(null);
    setContextMenu(null);
  };

  // -- render SVG shapes --
  function renderShape(s: DrawShape) {
    const isSelected = s.id === selected;
    const base = {
      stroke: s.stroke,
      strokeWidth: s.strokeWidth,
      fill: s.fill === "none" || s.fill === "transparent" ? "none" : s.fill,
      strokeDasharray: s.dashed ? "8 4" : undefined,
      filter: isSelected ? "drop-shadow(0 0 6px rgba(114,155,240,0.5))" : undefined,
      cursor: tool === "select" ? "move" : undefined,
    };

    switch (s.kind) {
      case "rect":
        return (
          <g key={s.id}>
            <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={2} {...base} />
            {isSelected && (
              <rect
                x={s.x - 2}
                y={s.y - 2}
                width={s.w + 4}
                height={s.h + 4}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                rx={3}
              />
            )}
            {s.label && (
              <text
                x={s.x + s.w / 2}
                y={s.y + s.h / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill={s.stroke}
                fontSize={s.fontSize}
                style={{ pointerEvents: "none" }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      case "circle": {
        const cx = s.x + s.w / 2;
        const cy = s.y + s.h / 2;
        const r = Math.min(s.w, s.h) / 2;
        return (
          <g key={s.id}>
            <circle cx={cx} cy={cy} r={r} {...base} />
            {isSelected && (
              <circle
                cx={cx}
                cy={cy}
                r={r + 3}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            {s.label && (
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fill={s.stroke}
                fontSize={s.fontSize}
                style={{ pointerEvents: "none" }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      }
      case "ellipse": {
        const cx = s.x + s.w / 2;
        const cy = s.y + s.h / 2;
        return (
          <g key={s.id}>
            <ellipse cx={cx} cy={cy} rx={s.w / 2} ry={s.h / 2} {...base} />
            {isSelected && (
              <ellipse
                cx={cx}
                cy={cy}
                rx={s.w / 2 + 3}
                ry={s.h / 2 + 3}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            {s.label && (
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fill={s.stroke}
                fontSize={s.fontSize}
                style={{ pointerEvents: "none" }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      }
      case "line":
      case "freehand": {
        if (s.points.length < 2) return null;
        const d = s.points
          .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`)
          .join(" ");
        return (
          <g key={s.id}>
            <path d={d} {...base} fill="none" />
            {isSelected && (
              <path
                d={d}
                fill="none"
                stroke="#729bf0"
                strokeWidth={s.strokeWidth + 4}
                opacity={0.3}
              />
            )}
          </g>
        );
      }
      case "arrow": {
        if (s.points.length < 2) return null;
        const d = s.points
          .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`)
          .join(" ");
        return (
          <g key={s.id}>
            <defs>
              <marker
                id={`arrow-${s.id}`}
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L0,6 L9,3 z" fill={s.stroke} />
              </marker>
            </defs>
            <path d={d} {...base} fill="none" markerEnd={`url(#arrow-${s.id})`} />
            {isSelected && (
              <path
                d={d}
                fill="none"
                stroke="#729bf0"
                strokeWidth={s.strokeWidth + 4}
                opacity={0.3}
              />
            )}
          </g>
        );
      }
      case "text":
        return (
          <g key={s.id}>
            {isSelected && (
              <rect
                x={s.x - 4}
                y={s.y - s.fontSize}
                width={s.label.length * s.fontSize * 0.6 + 8}
                height={s.fontSize * 1.4}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                rx={3}
              />
            )}
            <text
              x={s.x}
              y={s.y}
              fill={s.stroke}
              fontSize={s.fontSize}
              dominantBaseline="auto"
              style={{ cursor: tool === "select" ? "move" : "text" }}
            >
              {s.label || "text"}
            </text>
          </g>
        );
      case "diamond": {
        const cx = s.x + s.w / 2;
        const cy = s.y + s.h / 2;
        const points = [
          `${cx},${s.y}`,
          `${s.x + s.w},${cy}`,
          `${cx},${s.y + s.h}`,
          `${s.x},${cy}`,
        ].join(" ");
        return (
          <g key={s.id}>
            <polygon points={points} {...base} />
            {isSelected && (
              <rect
                x={s.x - 2}
                y={s.y - 2}
                width={s.w + 4}
                height={s.h + 4}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            {s.label && (
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fill={s.stroke}
                fontSize={s.fontSize}
                style={{ pointerEvents: "none" }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      }
      case "triangle": {
        const points = [
          `${s.x + s.w / 2},${s.y}`,
          `${s.x},${s.y + s.h}`,
          `${s.x + s.w},${s.y + s.h}`,
        ].join(" ");
        return (
          <g key={s.id}>
            <polygon points={points} {...base} />
            {isSelected && (
              <rect
                x={s.x - 2}
                y={s.y - 2}
                width={s.w + 4}
                height={s.h + 4}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            {s.label && (
              <text
                x={s.x + s.w / 2}
                y={s.y + s.h * 0.6}
                textAnchor="middle"
                dominantBaseline="central"
                fill={s.stroke}
                fontSize={s.fontSize}
                style={{ pointerEvents: "none" }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      }
      case "parallelogram": {
        const points = [
          `${s.x + s.w * 0.2},${s.y}`,
          `${s.x + s.w},${s.y}`,
          `${s.x + s.w * 0.8},${s.y + s.h}`,
          `${s.x},${s.y + s.h}`,
        ].join(" ");
        return (
          <g key={s.id}>
            <polygon points={points} {...base} />
            {isSelected && (
              <rect
                x={s.x - 2}
                y={s.y - 2}
                width={s.w + 4}
                height={s.h + 4}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            {s.label && (
              <text
                x={s.x + s.w / 2}
                y={s.y + s.h / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill={s.stroke}
                fontSize={s.fontSize}
                style={{ pointerEvents: "none" }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      }
      case "cylinder": {
        const cx = s.x + s.w / 2;
        const topY = s.y + s.h * 0.15;
        const bottomY = s.y + s.h - s.h * 0.15;
        const rx = s.w / 2;
        const ry = Math.max(s.h * 0.15, 2);
        const d = `M ${s.x} ${topY} L ${s.x} ${bottomY} A ${rx} ${ry} 0 0 0 ${s.x + s.w} ${bottomY} L ${s.x + s.w} ${topY}`;
        return (
          <g key={s.id}>
            <ellipse cx={cx} cy={topY} rx={rx} ry={ry} {...base} />
            <path d={d} {...base} />
            {isSelected && (
              <rect
                x={s.x - 2}
                y={s.y - 2}
                width={s.w + 4}
                height={s.h + 4}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            {s.label && (
              <text
                x={cx}
                y={s.y + s.h / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill={s.stroke}
                fontSize={s.fontSize}
                style={{ pointerEvents: "none" }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      }
      case "grid": {
        const lines = [];
        const step = Math.max(25, s.w / 5);
        for (let x = 0; x <= s.w; x += step) {
          lines.push(
            <line
              key={`gx${x}`}
              x1={s.x + x}
              y1={s.y}
              x2={s.x + x}
              y2={s.y + s.h}
              stroke={s.stroke}
              strokeWidth={0.5}
            />,
          );
        }
        for (let y = 0; y <= s.h; y += step) {
          lines.push(
            <line
              key={`gy${y}`}
              x1={s.x}
              y1={s.y + y}
              x2={s.x + s.w}
              y2={s.y + y}
              stroke={s.stroke}
              strokeWidth={0.5}
            />,
          );
        }
        return (
          <g key={s.id} {...base} fill="none">
            {lines}
            {isSelected && (
              <rect
                x={s.x - 2}
                y={s.y - 2}
                width={s.w + 4}
                height={s.h + 4}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
          </g>
        );
      }
      case "pentagon":
      case "hexagon": {
        const sides = s.kind === "pentagon" ? 5 : 6;
        const pts: string[] = [];
        const pcx = s.x + s.w / 2;
        const pcy = s.y + s.h / 2;
        const prx = s.w / 2;
        const pry = s.h / 2;
        for (let i = 0; i < sides; i++) {
          const angle = (Math.PI / 2) * -1 + (i * 2 * Math.PI) / sides;
          pts.push(`${pcx + prx * Math.cos(angle)},${pcy + pry * Math.sin(angle)}`);
        }
        return (
          <g key={s.id}>
            <polygon points={pts.join(" ")} {...base} />
            {isSelected && (
              <rect
                x={s.x - 2}
                y={s.y - 2}
                width={s.w + 4}
                height={s.h + 4}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            {s.label && (
              <text
                x={pcx}
                y={pcy}
                textAnchor="middle"
                dominantBaseline="central"
                fill={s.stroke}
                fontSize={s.fontSize}
                style={{ pointerEvents: "none" }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      }
      case "star": {
        const scx = s.x + s.w / 2;
        const scy = s.y + s.h / 2;
        const outerR = Math.min(s.w, s.h) / 2;
        const innerR = outerR * 0.4;
        const spts: string[] = [];
        for (let i = 0; i < 10; i++) {
          const angle = (Math.PI / 2) * -1 + (i * Math.PI) / 5;
          const r = i % 2 === 0 ? outerR : innerR;
          spts.push(`${scx + r * Math.cos(angle)},${scy + r * Math.sin(angle)}`);
        }
        return (
          <g key={s.id}>
            <polygon points={spts.join(" ")} {...base} />
            {isSelected && (
              <rect
                x={s.x - 2}
                y={s.y - 2}
                width={s.w + 4}
                height={s.h + 4}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            {s.label && (
              <text
                x={scx}
                y={scy}
                textAnchor="middle"
                dominantBaseline="central"
                fill={s.stroke}
                fontSize={s.fontSize}
                style={{ pointerEvents: "none" }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      }
      case "cloud": {
        const ccx = s.x + s.w / 2;
        const ccy = s.y + s.h / 2;
        const crx = s.w / 2;
        const cry = s.h / 2;
        const cd = [
          `M ${ccx - crx * 0.5} ${ccy + cry * 0.8}`,
          `A ${crx * 0.35} ${cry * 0.35} 0 0 0 ${ccx - crx * 0.5 - 0.01} ${ccy + cry * 0.8}`,
          `A ${crx * 0.3} ${cry * 0.3} 0 0 1 ${ccx + crx * 0.25} ${ccy - cry * 0.25}`,
          `A ${crx * 0.35} ${cry * 0.35} 0 0 1 ${ccx + crx * 0.5} ${ccy - cry * 0.1}`,
          `A ${crx * 0.3} ${cry * 0.3} 0 0 1 ${ccx - crx * 0.2} ${ccy + cry * 0.6}`,
          "Z",
        ].join(" ");
        return (
          <g key={s.id}>
            <path d={cd} {...base} />
            {isSelected && (
              <rect
                x={s.x - 2}
                y={s.y - 2}
                width={s.w + 4}
                height={s.h + 4}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            {s.label && (
              <text
                x={ccx}
                y={ccy}
                textAnchor="middle"
                dominantBaseline="central"
                fill={s.stroke}
                fontSize={s.fontSize}
                style={{ pointerEvents: "none" }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      }
      case "trapezium": {
        const skew = s.w * 0.15;
        const tpts = [
          `${s.x + skew},${s.y}`,
          `${s.x + s.w - skew},${s.y}`,
          `${s.x + s.w},${s.y + s.h}`,
          `${s.x},${s.y + s.h}`,
        ].join(" ");
        return (
          <g key={s.id}>
            <polygon points={tpts} {...base} />
            {isSelected && (
              <rect
                x={s.x - 2}
                y={s.y - 2}
                width={s.w + 4}
                height={s.h + 4}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            {s.label && (
              <text
                x={s.x + s.w / 2}
                y={s.y + s.h / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill={s.stroke}
                fontSize={s.fontSize}
                style={{ pointerEvents: "none" }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      }
      case "axes": {
        return (
          <g key={s.id} {...base} fill="none">
            <defs>
              <marker
                id={`axes-arrow-${s.id}`}
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L0,6 L9,3 z" fill={s.stroke} />
              </marker>
            </defs>
            <path
              d={`M ${s.x} ${s.y + s.h} L ${s.x + s.w} ${s.y + s.h}`}
              markerEnd={`url(#axes-arrow-${s.id})`}
              stroke={s.stroke}
              strokeWidth={s.strokeWidth}
            />
            <path
              d={`M ${s.x} ${s.y + s.h} L ${s.x} ${s.y}`}
              markerEnd={`url(#axes-arrow-${s.id})`}
              stroke={s.stroke}
              strokeWidth={s.strokeWidth}
            />
            <text
              x={s.x + s.w + 8}
              y={s.y + s.h}
              fill={s.stroke}
              fontSize={12}
              dominantBaseline="central"
            >
              x
            </text>
            <text x={s.x} y={s.y - 8} fill={s.stroke} fontSize={12} textAnchor="middle">
              y
            </text>
            {isSelected && (
              <rect
                x={s.x - 2}
                y={s.y - 2}
                width={s.w + 4}
                height={s.h + 4}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
          </g>
        );
      }
    }
  }

  // -- grid pattern (covers visible area) --
  function renderGrid() {
    if (!showGrid) return null;
    const lines: ReactElement[] = [];
    const startX = Math.floor(viewBox.x / GRID_SIZE) * GRID_SIZE;
    const startY = Math.floor(viewBox.y / GRID_SIZE) * GRID_SIZE;
    const endX = viewBox.x + viewBox.w;
    const endY = viewBox.y + viewBox.h;
    const xCount = Math.ceil((endX - startX) / GRID_SIZE);
    const yCount = Math.ceil((endY - startY) / GRID_SIZE);
    const step = GRID_SIZE * Math.max(1, Math.ceil(Math.max(xCount, yCount) / 100));
    for (let x = startX; x <= endX; x += step) {
      lines.push(
        <line
          key={`gv${x}`}
          x1={x}
          y1={startY}
          x2={x}
          y2={endY}
          stroke="#252a34"
          strokeWidth={0.5}
        />,
      );
    }
    for (let y = startY; y <= endY; y += step) {
      lines.push(
        <line
          key={`gh${y}`}
          x1={startX}
          y1={y}
          x2={endX}
          y2={y}
          stroke="#252a34"
          strokeWidth={0.5}
        />,
      );
    }
    return <g className="tikz-grid">{lines}</g>;
  }

  // -- tool buttons --
  const tools: { id: ToolType; icon: ReactElement; label: string; key: string }[] = [
    { id: "select", icon: <MousePointer2 size={16} />, label: "Select", key: "V" },
    { id: "pan", icon: <Hand size={16} />, label: "Pan", key: "H" },
    { id: "rect", icon: <Square size={16} />, label: "Rectangle", key: "R" },
    { id: "circle", icon: <Circle size={16} />, label: "Circle", key: "C" },
    { id: "ellipse", icon: <MoveHorizontal size={16} />, label: "Ellipse", key: "E" },
    {
      id: "parallelogram",
      icon: <Hexagon size={16} />,
      label: "Parallelogram",
      key: "",
    },
    { id: "cylinder", icon: <Database size={16} />, label: "Cylinder", key: "" },
    { id: "line", icon: <Minus size={16} />, label: "Line", key: "L" },
    { id: "arrow", icon: <ArrowRight size={16} />, label: "Arrow", key: "A" },
    { id: "text", icon: <Type size={16} />, label: "Text", key: "T" },
    { id: "diamond", icon: <Diamond size={16} />, label: "Diamond", key: "D" },
    { id: "triangle", icon: <Triangle size={16} />, label: "Triangle", key: "" },
    { id: "freehand", icon: <Pen size={16} />, label: "Freehand", key: "P" },
    { id: "pentagon", icon: <Pentagon size={16} />, label: "Pentagon", key: "" },
    { id: "hexagon", icon: <Hexagon size={16} />, label: "Hexagon", key: "" },
    { id: "star", icon: <Star size={16} />, label: "Star", key: "" },
    { id: "cloud", icon: <Cloud size={16} />, label: "Cloud", key: "" },
    { id: "trapezium", icon: <CornerUpRight size={16} />, label: "Trapezium", key: "" },
    { id: "grid", icon: <Grid size={16} />, label: "Grid", key: "G" },
    { id: "axes", icon: <CornerUpRight size={16} />, label: "Axes", key: "X" },
  ];

  // -- selected shape for property editing --
  const selectedShape = shapes.find((s) => s.id === selected);
  const contextShapeIndex = contextMenu
    ? shapes.findIndex((shape) => shape.id === contextMenu.shapeId)
    : -1;

  const updateSelected = useCallback(
    (updates: Partial<DrawShape>) => {
      if (!selected) return;
      const next = shapesRef.current.map((s) =>
        s.id === selected ? { ...s, ...updates } : s,
      );
      setShapes(next);
      pushHistory(next);
    },
    [pushHistory, selected, setShapes],
  );

  const moveShapeLayer = useCallback(
    (shapeId: string, action: LayerAction) => {
      const currentShapes = shapesRef.current;
      const index = currentShapes.findIndex((shape) => shape.id === shapeId);
      if (index < 0) return;

      let nextIndex = index;
      if (action === "front") {
        nextIndex = currentShapes.length - 1;
      } else if (action === "forward") {
        nextIndex = Math.min(currentShapes.length - 1, index + 1);
      } else if (action === "backward") {
        nextIndex = Math.max(0, index - 1);
      } else {
        nextIndex = 0;
      }

      if (nextIndex === index) {
        setContextMenu(null);
        return;
      }

      const next = [...currentShapes];
      const [shape] = next.splice(index, 1);
      next.splice(nextIndex, 0, shape);
      setShapes(next);
      pushHistory(next);
      setSelected(shapeId);
      setContextMenu(null);
    },
    [pushHistory, setShapes],
  );

  const activeStroke = selectedShape?.stroke ?? stroke;
  const activeFill = selectedShape?.fill ?? fill;
  const activeStrokeWidth = selectedShape?.strokeWidth ?? strokeWidth;
  const activeDashed = selectedShape?.dashed ?? dashed;

  const applyStroke = (value: string) => {
    if (selectedShape) {
      updateSelected({ stroke: value });
      return;
    }
    setStroke(value);
  };

  const applyFill = (value: string) => {
    if (selectedShape) {
      updateSelected({ fill: value });
      return;
    }
    setFill(value);
  };

  const applyStrokeWidth = (value: number) => {
    if (selectedShape) {
      updateSelected({ strokeWidth: value });
      return;
    }
    setStrokeWidth(value);
  };

  const applyDashed = (value: boolean) => {
    if (selectedShape) {
      updateSelected({ dashed: value });
      return;
    }
    setDashed(value);
  };

  return (
    <div className="tikz-canvas-root">
      {/* ===== LEFT: Drawing Area ===== */}
      <div className="tikz-draw-area">
        {/* Toolbar */}
        <div className="tikz-toolbar">
          <div className="tikz-toolbar-tools">
            {tools.map((t) => (
              <button
                key={t.id}
                className={`tikz-tool-btn ${tool === t.id ? "active" : ""}`}
                onClick={() => setTool(t.id)}
                title={`${t.label}${t.key ? ` (${t.key})` : ""}`}
              >
                {t.icon}
              </button>
            ))}
          </div>

          <div className="tikz-toolbar-divider" />

          {/* Colors */}
          <div className="tikz-toolbar-colors">
            <span className="tikz-prop-label">Stroke</span>
            <div className="tikz-color-row">
              {COLORS.map((c) => (
                <button
                  key={`s-${c}`}
                  className={`tikz-color-swatch ${activeStroke === c ? "active" : ""}`}
                  style={{ background: c }}
                  onClick={() => applyStroke(c)}
                  title={c}
                />
              ))}
            </div>
          </div>

          <div className="tikz-toolbar-colors">
            <span className="tikz-prop-label">Fill</span>
            <div className="tikz-color-row">
              <button
                className={`tikz-color-swatch tikz-no-fill ${activeFill === "none" ? "active" : ""}`}
                onClick={() => applyFill("none")}
                title="No fill"
              >
                <Eraser size={10} />
              </button>
              {COLORS.map((c) => (
                <button
                  key={`f-${c}`}
                  className={`tikz-color-swatch ${activeFill === c ? "active" : ""}`}
                  style={{ background: c }}
                  onClick={() => applyFill(c)}
                  title={c}
                />
              ))}
            </div>
          </div>

          <div className="tikz-toolbar-divider" />

          <div className="tikz-toolbar-props">
            <label className="tikz-prop-group">
              <span className="tikz-prop-label">Width</span>
              <input
                type="range"
                min="0.5"
                max="5"
                step="0.5"
                value={activeStrokeWidth}
                onChange={(e) => applyStrokeWidth(Number(e.target.value))}
              />
              <span className="tikz-prop-value">{activeStrokeWidth}px</span>
            </label>
            <label className="tikz-prop-group tikz-checkbox-group">
              <input
                type="checkbox"
                checked={activeDashed}
                onChange={(e) => applyDashed(e.target.checked)}
              />
              <span className="tikz-prop-label">Dashed</span>
            </label>
            <label className="tikz-prop-group tikz-checkbox-group">
              <input
                type="checkbox"
                checked={snapEnabled}
                onChange={(e) => setSnapEnabled(e.target.checked)}
              />
              <span className="tikz-prop-label">Snap</span>
            </label>
            <label className="tikz-prop-group tikz-checkbox-group">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
              />
              <span className="tikz-prop-label">Grid</span>
            </label>
          </div>

          <div className="tikz-toolbar-divider" />

          <div className="tikz-toolbar-actions">
            <button
              className="tikz-action-btn"
              onClick={undo}
              disabled={historyIndex <= 0}
              title="Undo (Ctrl/⌘+Z)"
            >
              <Undo2 size={14} />
            </button>
            <button
              className="tikz-action-btn"
              onClick={redo}
              disabled={historyIndex >= history.length - 1}
              title="Redo (Ctrl/⌘+Shift+Z)"
            >
              <Redo2 size={14} />
            </button>
            <button
              className="tikz-action-btn tikz-delete-btn"
              onClick={handleDeleteSelected}
              disabled={!selected}
              title="Delete selected (Del)"
            >
              <Trash2 size={14} />
            </button>
            <button
              className="tikz-action-btn tikz-clear-btn"
              onClick={handleClear}
              title="Clear canvas"
            >
              <Eraser size={14} />
            </button>
          </div>
        </div>

        {/* SVG Canvas */}
        <div className="tikz-svg-container">
          <svg
            ref={svgRef}
            className="tikz-svg"
            width={1200}
            height={800}
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onContextMenu={handleContextMenu}
            style={{
              cursor:
                tool === "select"
                  ? "default"
                  : tool === "pan"
                    ? isPanning
                      ? "grabbing"
                      : "grab"
                    : tool === "text"
                      ? "text"
                      : "crosshair",
            }}
          >
            {/* Open-world background */}
            <rect
              x={viewBox.x}
              y={viewBox.y}
              width={viewBox.w}
              height={viewBox.h}
              fill="#15181e"
            />
            {/* Document area outline & dimension label */}
            <rect
              x={0}
              y={0}
              width={canvasSize.width}
              height={canvasSize.height}
              fill="none"
              stroke="#3a3f49"
              strokeWidth={1}
            />
            <text
              x={canvasSize.width}
              y={canvasSize.height}
              fill="#616870"
              fontSize={10}
              textAnchor="end"
              dominantBaseline="auto"
              dx={-4}
              dy={-4}
              style={{ pointerEvents: "none" }}
            >
              {canvasSize.width} × {canvasSize.height} px (
              {(canvasSize.width * 0.02).toFixed(1)}×
              {(canvasSize.height * 0.02).toFixed(1)} cm)
            </text>
            {renderGrid()}
            {shapes.map(renderShape)}
          </svg>
          {contextMenu && (
            <div
              className="tikz-context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              role="menu"
              aria-label="Shape order"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => moveShapeLayer(contextMenu.shapeId, "front")}
                disabled={contextShapeIndex >= shapes.length - 1}
              >
                <BringToFront size={14} />
                <span>Bring to front</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => moveShapeLayer(contextMenu.shapeId, "forward")}
                disabled={contextShapeIndex >= shapes.length - 1}
              >
                <ArrowUp size={14} />
                <span>Bring forward</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => moveShapeLayer(contextMenu.shapeId, "backward")}
                disabled={contextShapeIndex <= 0}
              >
                <ArrowDown size={14} />
                <span>Send backward</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => moveShapeLayer(contextMenu.shapeId, "back")}
                disabled={contextShapeIndex <= 0}
              >
                <SendToBack size={14} />
                <span>Send to back</span>
              </button>
            </div>
          )}
        </div>

        {/* Text prompt (replaces window.prompt which is blocked in sandboxed Electron) */}
        {textPrompt && (
          <div className="tikz-text-prompt">
            <span className="tikz-prop-label">Enter text:</span>
            <input
              ref={textInputRef}
              className="tikz-text-prompt-input"
              type="text"
              placeholder="Text…"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const label = e.currentTarget.value.trim();
                  if (label) {
                    commitShape([
                      ...shapesRef.current,
                      {
                        ...defaultShape("text"),
                        x: textPrompt.x,
                        y: textPrompt.y,
                        label,
                        stroke,
                        fontSize: DEFAULT_FONT_SIZE,
                      },
                    ]);
                    setTextPrompt(null);
                    setSelected(null);
                  }
                }
                if (e.key === "Escape") {
                  setTextPrompt(null);
                }
              }}
              onBlur={() => setTextPrompt(null)}
            />
          </div>
        )}
      </div>

      {/* ===== RIGHT: Code Panel ===== */}
      <div className="tikz-code-panel">
        <div className="tikz-code-header">
          <div className="tikz-code-title">
            <span className="tikz-code-icon">
              T<sub>i</sub>
              <em>k</em>Z
            </span>
            <span>Generated Code</span>
          </div>
          <div className="tikz-code-tabs">
            <button
              className={`tikz-code-tab ${codeMode === "tikz" ? "active" : ""}`}
              onClick={() => setCodeMode("tikz")}
            >
              TikZ only
            </button>
            <button
              className={`tikz-code-tab ${codeMode === "full" ? "active" : ""}`}
              onClick={() => setCodeMode("full")}
            >
              Full document
            </button>
          </div>
          <div className="tikz-code-actions">
            <button
              className="tikz-code-action-btn"
              onClick={() => void handleCopy()}
              title="Copy to clipboard"
            >
              <Copy size={13} />
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              className="tikz-code-action-btn"
              onClick={handleDownload}
              title="Download .tex file"
            >
              <Download size={13} />
              Download
            </button>
            {onInsertCode && (
              <button
                className="tikz-code-action-btn tikz-insert-btn"
                onClick={() => onInsertCode(tikzCode)}
                title="Insert into editor"
              >
                <Plus size={13} />
                Insert
              </button>
            )}
            <button
              className="tikz-code-action-btn tikz-apply-btn"
              onClick={handleApplyCode}
              title="Apply edited code to canvas"
            >
              &#9654; Apply
            </button>
          </div>
        </div>
        <div className="tikz-code-body">
          {parseError && <div className="tikz-parse-error">{parseError}</div>}
          <textarea
            className="tikz-code-textarea"
            value={editableCode}
            onChange={(e) => {
              manualEditRef.current = true;
              setEditableCode(e.target.value);
              setParseError(null);
            }}
            spellCheck={false}
            wrap="off"
          />
        </div>
        <div className="tikz-code-footer">
          <span>
            {shapes.length} shape{shapes.length !== 1 ? "s" : ""}
          </span>
          <span>
            Canvas: {canvasSize.width}×{canvasSize.height}px (
            {(canvasSize.width * 0.02).toFixed(1)}×
            {(canvasSize.height * 0.02).toFixed(1)}cm)
          </span>
          <select
            className="tikz-canvas-preset"
            value={`${canvasSize.width}x${canvasSize.height}`}
            onChange={(e) => {
              const [w, h] = e.target.value.split("x").map(Number);
              setCanvasSize({ width: w, height: h });
            }}
            title="Canvas dimensions preset"
          >
            {CANVAS_PRESETS.map((p) => (
              <option key={`${p.width}x${p.height}`} value={`${p.width}x${p.height}`}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="tikz-zoom-controls">
            <button
              className="tikz-zoom-btn"
              onClick={() => {
                const newW = Math.max(60, viewBox.w * (1 / 1.1));
                const newH = newW * (800 / 1200);
                const cx = viewBox.x + viewBox.w / 2;
                const cy = viewBox.y + viewBox.h / 2;
                const next = { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
                setViewBox(next);
                viewBoxRef.current = next;
              }}
              title="Zoom in"
            >
              <ZoomIn size={11} />
            </button>
            <span className="tikz-zoom-label">{zoomPercent}%</span>
            <button
              className="tikz-zoom-btn"
              onClick={() => {
                const newW = Math.min(24000, viewBox.w * 1.1);
                const newH = newW * (800 / 1200);
                const cx = viewBox.x + viewBox.w / 2;
                const cy = viewBox.y + viewBox.h / 2;
                const next = { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
                setViewBox(next);
                viewBoxRef.current = next;
              }}
              title="Zoom out"
            >
              <ZoomOut size={11} />
            </button>
            <button
              className="tikz-zoom-btn"
              onClick={() => {
                const next = { x: 0, y: 0, w: 1200, h: 800 };
                setViewBox(next);
                viewBoxRef.current = next;
              }}
              title="Reset zoom/pan (100%)"
            >
              &bull;
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
