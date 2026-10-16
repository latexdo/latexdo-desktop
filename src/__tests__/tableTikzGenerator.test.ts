import { describe, it, expect } from "vitest";
import { generateTabularCode } from "../tableGenerator";
import type { TableData } from "../tableGenerator";
import { generateTikzCode, generateFullDocument } from "../tikzGenerator";
import type { DrawShape } from "../tikzGenerator";

function shape(kind: DrawShape["kind"], overrides: Partial<DrawShape> = {}): DrawShape {
  return {
    id: "s1",
    kind,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    label: "",
    points: [],
    stroke: "#000000",
    fill: "none",
    strokeWidth: 1,
    dashed: false,
    fontSize: 14,
    rotation: 0,
    ...overrides,
  };
}

// ── TABLE: basic variants ────────────────────────────────────────────────
const tableVariants: [string, TableData][] = [
  ["1x1 empty", { rows: 1, cols: 1, cells: [[""]], alignment: "c" }],
  ["1x1 with value", { rows: 1, cols: 1, cells: [["Hello"]], alignment: "c" }],
  [
    "2x2 simple",
    {
      rows: 2,
      cols: 2,
      cells: [
        ["a", "b"],
        ["c", "d"],
      ],
      alignment: "cc",
    },
  ],
  [
    "3x3 grid",
    {
      rows: 3,
      cols: 3,
      cells: [
        ["1", "2", "3"],
        ["4", "5", "6"],
        ["7", "8", "9"],
      ],
      alignment: "|c|c|c|",
    },
  ],
  [
    "1x5 row",
    { rows: 1, cols: 5, cells: [["A", "B", "C", "D", "E"]], alignment: "ccccc" },
  ],
  [
    "5x1 column",
    { rows: 5, cols: 1, cells: [["A"], ["B"], ["C"], ["D"], ["E"]], alignment: "c" },
  ],
  [
    "empty cells",
    {
      rows: 2,
      cols: 3,
      cells: [
        ["", "", ""],
        ["", "", ""],
      ],
      alignment: "ccc",
    },
  ],
  [
    "mixed alignment",
    {
      rows: 2,
      cols: 3,
      cells: [
        ["L", "C", "R"],
        ["1", "2", "3"],
      ],
      alignment: "l|c|r",
    },
  ],
  [
    "spec chars",
    {
      rows: 1,
      cols: 3,
      cells: [["$\\alpha$", "$\\beta$", "$\\gamma$"]],
      alignment: "ccc",
    },
  ],
  [
    "numbers",
    {
      rows: 3,
      cols: 2,
      cells: [
        ["1", "2"],
        ["3", "4"],
        ["5", "6"],
      ],
      alignment: "cc",
    },
  ],
];
describe("Table variants", () => {
  it.each(tableVariants)("%s", (name, data) => {
    const code = generateTabularCode(data);
    expect(code).toContain("tabular");
    expect(code).toContain("\\hline");
  });
});

// ── TABLE: edge cases ───────────────────────────────────────────────────
const tableEdgeCases: [string, TableData][] = [
  [
    "no alignment",
    {
      rows: 2,
      cols: 2,
      cells: [
        ["a", "b"],
        ["c", "d"],
      ],
      alignment: "",
    },
  ],
  ["partial row", { rows: 2, cols: 3, cells: [["a", "b"], ["c"]], alignment: "ccc" }],
  [
    "extra cells",
    {
      rows: 2,
      cols: 2,
      cells: [
        ["a", "b", "x"],
        ["c", "d"],
      ],
      alignment: "cc",
    },
  ],
  [
    "long cell",
    { rows: 1, cols: 1, cells: [[Array(100).fill("w").join(" ")]], alignment: "c" },
  ],
  ["unicode", { rows: 1, cols: 2, cells: [["∀x", "∃y"]], alignment: "cc" }],
  [
    "single row",
    { rows: 1, cols: 4, cells: [["a", "b", "c", "d"]], alignment: "cccc" },
  ],
  [
    "single col",
    { rows: 4, cols: 1, cells: [["a"], ["b"], ["c"], ["d"]], alignment: "c" },
  ],
  ["default align 1col", { rows: 1, cols: 1, cells: [["x"]], alignment: "" }],
  [
    "default align 5col",
    { rows: 1, cols: 5, cells: [["1", "2", "3", "4", "5"]], alignment: "" },
  ],
];
describe("Table edge cases", () => {
  it.each(tableEdgeCases)("%s", (name, data) => {
    const code = generateTabularCode(data);
    expect(code).toContain("tabular");
  });
});

// ── TIKZ: per-shape ─────────────────────────────────────────────────────
const tikzShapes: [string, DrawShape][] = [
  ["rect", shape("rect")],
  ["rect-labeled", shape("rect", { label: "Box" })],
  ["rect-fill", shape("rect", { fill: "#ff0000" })],
  ["rect-thick", shape("rect", { strokeWidth: 3 })],
  ["rect-rotated", shape("rect", { rotation: 45 })],
  ["rect-dashed", shape("rect", { dashed: true })],
  ["circle", shape("circle")],
  ["circle-labeled", shape("circle", { label: "O" })],
  ["ellipse", shape("ellipse")],
  ["diamond", shape("diamond")],
  ["triangle", shape("triangle")],
  ["triangle-fill", shape("triangle", { fill: "#0f0" })],
  ["parallelogram", shape("parallelogram")],
  ["cylinder", shape("cylinder")],
  ["grid", shape("grid")],
  ["axes", shape("axes")],
  ["text", shape("text", { label: "Hello" })],
  ["text-color", shape("text", { label: "Red", stroke: "#ff0000" })],
  ["text-fontsize", shape("text", { label: "Big", fontSize: 24 })],
];
describe("TikZ per-shape", () => {
  it.each(tikzShapes)("%s", (name, s) => {
    const code = generateTikzCode([s], 500, 500);
    expect(code).toContain("\\begin{tikzpicture}");
  });
});

// ── TIKZ: line/arrow/freehand with valid points ─────────────────────────
const lineShapes: [string, DrawShape][] = [
  [
    "line 2pts",
    shape("line", {
      points: [
        [0, 0],
        [100, 100],
      ],
    }),
  ],
  [
    "line 3pts",
    shape("line", {
      points: [
        [0, 0],
        [50, 50],
        [100, 0],
      ],
    }),
  ],
  [
    "arrow 2pts",
    shape("arrow", {
      points: [
        [0, 0],
        [100, 100],
      ],
    }),
  ],
  [
    "arrow colored",
    shape("arrow", {
      points: [
        [0, 0],
        [100, 100],
      ],
      stroke: "#ff0000",
    }),
  ],
  [
    "freehand 4pts",
    shape("freehand", {
      points: [
        [0, 0],
        [10, 20],
        [30, 15],
        [50, 30],
      ],
    }),
  ],
  [
    "freehand 2pts",
    shape("freehand", {
      points: [
        [0, 0],
        [100, 100],
      ],
    }),
  ],
];
describe("TikZ line/arrow/freehand", () => {
  it.each(lineShapes)("%s", (name, s) => {
    const code = generateTikzCode([s], 500, 500);
    expect(code).toContain("tikzpicture");
  });
});

// ── TIKZ: multiple shapes ───────────────────────────────────────────────
const multiShapes: [string, DrawShape[]][] = [
  ["empty", []],
  ["two rects", [shape("rect"), shape("rect", { x: 200, y: 200, fill: "#00f" })]],
  [
    "rect+circle+text",
    [
      shape("rect"),
      shape("circle", { x: 200 }),
      shape("text", { x: 100, y: 100, label: "Hi" }),
    ],
  ],
  [
    "line+arrow+diamond",
    [
      shape("line", {
        points: [
          [0, 0],
          [100, 100],
        ],
      }),
      shape("arrow", {
        points: [
          [200, 0],
          [300, 100],
        ],
      }),
      shape("diamond", { x: 400 }),
    ],
  ],
  ["grid+axes", [shape("grid"), shape("axes", { x: 200 })]],
  [
    "10 rects",
    Array(10)
      .fill(null)
      .map((_, i) => shape("rect", { id: `r${i}`, x: i * 50, y: i * 30 })),
  ],
  [
    "20 circles",
    Array(20)
      .fill(null)
      .map((_, i) =>
        shape("circle", {
          id: `c${i}`,
          x: (i % 5) * 100,
          y: Math.floor(i / 5) * 100,
          w: 40,
          h: 40,
        }),
      ),
  ],
];
describe("TikZ multi-shape", () => {
  it.each(multiShapes)("%s", (name, shapes) => {
    const code = generateTikzCode(shapes, 500, 500);
    expect(code).toContain("\\begin{tikzpicture}");
  });
});

// ── TIKZ: full document ─────────────────────────────────────────────────
const fullDocs: [string, DrawShape[]][] = [
  ["empty", []],
  ["single rect", [shape("rect")]],
  [
    "complex",
    [
      shape("rect", { fill: "#eee", strokeWidth: 2 }),
      shape("text", { x: 50, y: 50, label: "Start" }),
      shape("arrow", {
        points: [
          [100, 50],
          [200, 50],
        ],
      }),
      shape("diamond", { x: 200, y: 0, label: "?" }),
    ],
  ],
];
describe("TikZ full document", () => {
  it.each(fullDocs)("%s", (name, shapes) => {
    const code = generateFullDocument(shapes, 500, 500);
    expect(code).toContain("\\documentclass");
    expect(code).toContain("\\usepackage{tikz}");
  });
});

// ── TIKZ: shape properties ──────────────────────────────────────────────
const props: Partial<DrawShape>[] = [
  { stroke: "#ff0000" },
  { stroke: "#abc123" },
  { fill: "#ff0000" },
  { fill: "transparent" },
  { fill: "none" },
  { strokeWidth: 0.3 },
  { strokeWidth: 2 },
  { strokeWidth: 3.5 },
  { rotation: 90 },
  { rotation: -45 },
  { stroke: "#ff00ff", fill: "#ffff00", strokeWidth: 2, dashed: true, rotation: 30 },
];
describe("TikZ shape properties on rect", () => {
  it.each(props)("prop=%j", (p) => {
    expect(generateTikzCode([shape("rect", p)], 500, 500)).toContain("tikzpicture");
  });
});

// ── TIKZ: canvas sizes ──────────────────────────────────────────────────
const sizes: [number, number][] = [
  [100, 100],
  [800, 400],
  [400, 800],
  [1000, 1000],
  [10, 10],
];
describe("TikZ canvas sizes", () => {
  it.each(sizes)("%dx%d", (w, h) => {
    expect(generateTikzCode([shape("rect")], w, h)).toContain("tikzpicture");
  });
});

// ── TIKZ: edge cases ────────────────────────────────────────────────────
const edgeTikzCases: [string, DrawShape[]][] = [
  ["line 1pt only", [shape("line", { points: [[0, 0]] })]],
  ["arrow 1pt only", [shape("arrow", { points: [[0, 0]] })]],
  ["freehand 0pts", [shape("freehand", { points: [] })]],
  ["negative coords", [shape("rect", { x: -100, y: -100 })]],
  ["huge coords", [shape("rect", { x: 10000, y: 10000 })]],
  ["zero dims", [shape("rect", { w: 0, h: 0 })]],
  ["text empty", [shape("text", { label: "" })]],
  ["grid colored", [shape("grid", { stroke: "#f00" })]],
  ["axes colored", [shape("axes", { stroke: "#0f0" })]],
];
describe("TikZ edge cases", () => {
  it.each(edgeTikzCases)("%s", (name, shapes) => {
    const code = generateTikzCode(shapes, 500, 500);
    expect(typeof code).toBe("string");
    expect(code.length).toBeGreaterThan(0);
  });
});
