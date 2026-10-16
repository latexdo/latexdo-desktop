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
