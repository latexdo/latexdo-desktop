import { describe, expect, it } from "vitest";
import {
  generateFullDocument,
  generateTikzCode,
  parseTikzCode,
  type DrawShape,
  type ShapeKind,
} from "./tikzGenerator";
const shape = (kind: ShapeKind, part: Partial<DrawShape> = {}): DrawShape => ({
  id: "shape",
  kind,
  x: 100,
  y: 100,
  w: 100,
  h: 100,
  label: "",
  points: [
    [100, 100],
    [200, 200],
  ],
  stroke: "#000000",
  fill: "none",
  strokeWidth: 1,
  dashed: false,
  fontSize: 14,
  rotation: 0,
  ...part,
});
const generate = (s: DrawShape) => generateTikzCode([s], 1200, 800);
describe("TikZ serialization", () => {
  it.each([
    ["rect", "(2,14) rectangle (4,12)"],
    ["circle", "(3,13) circle (1)"],
    ["ellipse", "(3,13) ellipse (1 and 1)"],
    ["line", "(2,14) -- (4,12)"],
    ["arrow", "->,>=stealth"],
    ["text", "at (2,14) {Label}"],
    ["diamond", "(3,14) -- (4,13) -- (3,12) -- (2,13) -- cycle"],
    ["triangle", "(3,14) -- (2,12) -- (4,12) -- cycle"],
    ["freehand", "(2,14) -- (4,12)"],
    ["parallelogram", "(2.4,14) -- (4,14) -- (3.6,12) -- (2,12) -- cycle"],
    ["cylinder", "arc (180:360:1 and 0.3)"],
    ["grid", "(2,12) grid (4,14)"],
    ["axes", "node[right] {$x$}"],
    ["pentagon", "-- cycle"],
    ["hexagon", "-- cycle"],
    ["star", "-- cycle"],
    ["cloud", "arc (180:120:"],
    ["trapezium", "(2.3,14) -- (3.7,14) -- (4,12) -- (2,12) -- cycle"],
  ] as const)("serializes %s with correct coordinates and label", (kind, expected) => {
    const result = generate(
      shape(kind, {
        label: "Label",
        points:
          kind === "line" || kind === "arrow" || kind === "freehand"
            ? [
                [100, 100],
                [200, 200],
              ]
            : [],
      }),
    );
    expect(result).toContain(expected);
    expect(result).toMatch(/^\\begin\{tikzpicture\}/);
    expect(result).toMatch(/\\end\{tikzpicture\}$/);
    if (!["line", "arrow", "freehand", "grid", "axes"].includes(kind))
      expect(result).toContain("{Label}");
  });
  it.each([
    [0.4, "ultra thin"],
    [0.6, "very thin"],
    [0.8, "thin"],
    [1.2, "semithick"],
    [1.6, "thick"],
    [2.4, "very thick"],
    [3.2, "ultra thick"],
  ])("preserves line width %s through parsing", (width, style) => {
    const code = generate(
      shape("rect", {
        strokeWidth: width as number,
        dashed: true,
        rotation: 30,
        fill: "#ff0000",
        points: [],
      }),
    );
    expect(code).toContain(style as string);
    expect(parseTikzCode(code, 1200, 800)[0]).toMatchObject({
      kind: "rect",
      x: 100,
      y: 100,
      w: 100,
      h: 100,
      strokeWidth: width,
      dashed: true,
      rotation: 30,
      fill: "#ff0000",
    });
  });
  it("emits custom colors, styled labels, filled cylinders and standalone preambles", () => {
    expect(generate(shape("rect", { stroke: "#123456", fill: "#ffffff" }))).toContain(
      "draw={rgb,255:red,18;green,52;blue,86}, fill=white",
    );
    expect(
      generate(
        shape("text", {
          stroke: "#ff0000",
          fontSize: 20,
          rotation: 45,
          label: "Equation",
        }),
      ),
    ).toContain("text=red, font=\\fontsize{15}{18}\\selectfont, rotate=45");
    expect(
      generate(shape("cylinder", { fill: "#ff0000", stroke: "#0000ff" })),
    ).toContain("\\fill[red]");
    expect(generateFullDocument([], 1200, 800)).toContain("\\usepackage{tikz}");
    expect(generate(shape("grid", { stroke: "#ff0000" }))).toContain("red");
    expect(generate(shape("axes", { stroke: "#ff0000" }))).toContain("red");
  });
  it.each(["line", "arrow", "freehand"] as const)(
    "omits incomplete %s strokes",
    (kind) => {
      expect(generate(shape(kind, { points: [[1, 1]] }))).not.toContain("\\draw");
    },
  );
  it.each([
    "rect",
    "diamond",
    "triangle",
    "parallelogram",
    "trapezium",
    "pentagon",
    "hexagon",
    "star",
    "circle",
    "ellipse",
    "grid",
    "line",
    "arrow",
    "text",
  ] as const)("round-trips the %s shape kind", (kind) => {
    const code = generate(
      shape(kind, {
        points: ["line", "arrow"].includes(kind)
          ? [
              [100, 100],
              [200, 200],
            ]
          : [],
      }),
    );
    const parsed = parseTikzCode(code, 1200, 800);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].kind).toBe(kind);
    expect(parsed[0].x).toBeGreaterThanOrEqual(99);
    expect(parsed[0].y).toBeGreaterThanOrEqual(99);
  });
  it("parses custom RGB styles and nested TeX labels without confusing font parameters for text", () => {
    const code = generate(
      shape("text", {
        stroke: "#123456",
        fontSize: 20,
        label: "$\\frac{a}{b}$",
        points: [],
      }),
    );
    expect(parseTikzCode(code, 1200, 800)[0]).toMatchObject({
      stroke: "#123456",
      fontSize: 20,
      label: "$\\frac{a}{b}$",
    });
  });
  it("ignores comments and unsupported commands", () => {
    expect(
      parseTikzCode(
        "% comment\n\\unknown{foo}\n\\node malformed;\n\\draw (0,0);",
        1200,
        800,
      ),
    ).toEqual([]);
  });
});
describe("TikZ generator and parser edge cases", () => {
  it("skips arrows without two points and comments unknown shapes", () => {
    expect(generate(shape("arrow", { points: [[1, 1]] }))).toBe(
      "\\begin{tikzpicture}\n\n\\end{tikzpicture}",
    );
    expect(generate(shape("bogus" as ShapeKind))).toContain("% Unknown shape: bogus");
    expect(generate(shape("cloud"))).not.toContain("\\node");
  });

  it("omits unnamed stroke widths and keeps fill, dashes and rotation", () => {
    const code = generate(
      shape("rect", {
        strokeWidth: 1.1,
        fill: "#ff0000",
        dashed: true,
        rotation: 12.345,
      }),
    );
    expect(code).toContain("[draw, fill=");
    expect(code).toContain("dashed, rotate=12.35");
    expect(code).not.toMatch(/thin|thick/);
  });

  it("parses option fallbacks: unknown colours, rgb colours, bad rotation and fonts", () => {
    const [rect] = parseTikzCode(
      "\\draw[draw=mystery, fill={rgb,255:red,1;green,2;blue,255}, rotate=abc, font=\\small] (0,16) rectangle (2,14);",
      1200,
      800,
    );
    expect(rect).toMatchObject({
      kind: "rect",
      stroke: "#d6dae2",
      fill: "#0102ff",
      rotation: 0,
      fontSize: 14,
    });
    const [text] = parseTikzCode(
      "\\node[text=red, font=\\fontsize{12}{14}\\selectfont] at (1,15) {Hi};",
      1200,
      800,
    );
    expect(text).toMatchObject({
      kind: "text",
      stroke: "#ff0000",
      fontSize: 16,
      label: "Hi",
    });
    const [unlabeled] = parseTikzCode("\\node at (1,15);", 1200, 800);
    expect(unlabeled.label).toBe("text");
  });

  it("returns nothing for incomplete draw commands", () => {
    const lines = [
      "\\draw;",
      "\\draw (0,0) rectangle;",
      "\\draw (0,0) circle;",
      "\\draw (0,0) ellipse (1);",
      "\\draw (0,0);",
      "\\draw (0,0) -- (1,0) -- (1,1) -- (0,1) -- (0,2) -- (0,3) -- (0,4) -- cycle;",
      "\\node[draw] {missing position};",
    ];
    expect(parseTikzCode(lines.join("\n"), 1200, 800)).toEqual([]);
  });

  it("parses axes, trapezia, parallelograms and polygons", () => {
    const code = [
      "\\draw[->] (0,0) -- (4,0) node[right] {$x$} (0,0) -- (0,3) node[above] {$y$};",
      "\\draw (1,4) -- (3,4) -- (4,0) -- (0,0) -- cycle;",
      "\\draw (1,4) -- (5,4) -- (4,0) -- (0,0) -- cycle;",
      "\\draw (0,0) -- (4,0) -- (4,4) -- (0,4) -- cycle;",
      "\\draw (0,0) -- (1,0) -- (2,1) -- (1,2) -- (0,1) -- cycle;",
      "\\draw (0,0) -- (1,0) -- (2,1) -- (1,2) -- (0,2) -- (-1,1) -- cycle;",
      "\\draw (0,0) -- (1,0) -- (2,1) -- (1,2) -- (0,2) -- (-1,1) -- (0,1) -- (1,1) -- cycle;",
      "\\draw[->] (0,0) -- (2,2);",
    ].join("\n");
    expect(parseTikzCode(code, 1200, 800).map((s) => s.kind)).toEqual([
      "axes",
      "trapezium",
      "parallelogram",
      "rect",
      "pentagon",
      "hexagon",
      "star",
      "arrow",
    ]);
  });

  it("attaches labels from following or standalone nodes", () => {
    const code = [
      "\\draw (0,16) rectangle (2,14);",
      "\\node at (1,15) {Inside};",
      "\\draw (4,16) circle (1);",
      "\\node {no position};",
      "\\node at (5,15) {Late label};",
      "\\node at (6,15) {Standalone};",
      "\\draw (0,0) -- (1,1);",
      "\\node at (9,9) {Line label};",
      "\\draw (0,0) -- (2,2);",
      "\\node at (9,9) {Free};",
    ].join("\n");
    const shapes = parseTikzCode(code, 1200, 800);
    expect(shapes.map((s) => [s.kind, s.label])).toEqual([
      ["rect", "Inside"],
      ["circle", "Late label"],
      ["text", "Standalone"],
      ["line", "Line label"],
      ["line", "Free"],
    ]);
    expect(
      parseTikzCode("\\node at (1,1) {A};\n\\node at (2,2) {B};", 1200, 800),
    ).toHaveLength(2);
  });
});
