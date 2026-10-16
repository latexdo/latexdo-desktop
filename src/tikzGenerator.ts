// ---------- shared types ----------

export type ShapeKind =
  | "rect"
  | "circle"
  | "ellipse"
  | "line"
  | "arrow"
  | "text"
  | "diamond"
  | "triangle"
  | "freehand"
  | "parallelogram"
  | "cylinder"
  | "grid"
  | "axes"
  | "pentagon"
  | "hexagon"
  | "star"
  | "cloud"
  | "trapezium";

export interface DrawShape {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** For text shapes */
  label: string;
  /** For line/arrow/freehand: list of [x, y] points */
  points: [number, number][];
  stroke: string;
  fill: string;
  strokeWidth: number;
  dashed: boolean;
  fontSize: number;
  rotation: number;
}

// ---------- helpers ----------

/** Coordinate scale: 1 canvas-px → tikz cm */
const SCALE = 1 / 50;

function round(value: number, precision = 2): number {
  return Math.round(value * 10 ** precision) / 10 ** precision;
}

function tikzPt(px: number, py: number, canvasHeight: number): string {
  // TikZ y-axis goes up while canvas y goes down
  const x = round(px * SCALE);
  const y = round((canvasHeight - py) * SCALE);
  return `(${x},${y})`;
}

function tikzColor(hex: string): string {
  const map: Record<string, string> = {
    "#000000": "black",
    "#ffffff": "white",
    "#ff0000": "red",
    "#00ff00": "green",
    "#0000ff": "blue",
    "#ffff00": "yellow",
    "#ff00ff": "magenta",
    "#00ffff": "cyan",
    "#808080": "gray",
    "#ffa500": "orange",
    "#800080": "purple",
    "#a0522d": "brown",
    "#ffc0cb": "pink",
    "#90ee90": "lime",
    "#008080": "teal",
    "#000080": "violet",
  };
  const lower = hex.toLowerCase();
  if (map[lower]) return map[lower];
  // Return a custom rgb color
  const r = parseInt(lower.slice(1, 3), 16);
  const g = parseInt(lower.slice(3, 5), 16);
  const b = parseInt(lower.slice(5, 7), 16);
  return `{rgb,255:red,${r};green,${g};blue,${b}}`;
}

function drawOptions(shape: DrawShape, includeStroke = true): string {
  const opts: string[] = [];

  if (includeStroke && shape.stroke && shape.stroke !== "#000000") {
    opts.push(`draw=${tikzColor(shape.stroke)}`);
  } else if (includeStroke) {
    opts.push("draw");
  }

  if (shape.fill && shape.fill !== "none" && shape.fill !== "transparent") {
    opts.push(`fill=${tikzColor(shape.fill)}`);
  }

  if (shape.strokeWidth !== 1) {
    if (shape.strokeWidth <= 0.4) opts.push("ultra thin");
    else if (shape.strokeWidth <= 0.6) opts.push("very thin");
    else if (shape.strokeWidth <= 0.8) opts.push("thin");
    else if (shape.strokeWidth >= 3.2) opts.push("ultra thick");
    else if (shape.strokeWidth >= 2.4) opts.push("very thick");
    else if (shape.strokeWidth >= 1.6) opts.push("thick");
    else if (shape.strokeWidth >= 1.2) opts.push("semithick");
  }

  if (shape.dashed) {
    opts.push("dashed");
  }

  if (shape.rotation !== 0) {
    opts.push(`rotate=${round(shape.rotation)}`);
  }

  return opts.length ? `[${opts.join(", ")}]` : "";
}

// ---------- per-shape generators ----------

function genRect(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const p1 = tikzPt(s.x, s.y, ch);
  const p2 = tikzPt(s.x + s.w, s.y + s.h, ch);
  let code = `  \\draw${opts} ${p1} rectangle ${p2};`;
  if (s.label) {
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genCircle(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const r = round((Math.min(s.w, s.h) / 2) * SCALE);
  let code = `  \\draw${opts} ${tikzPt(cx, cy, ch)} circle (${r});`;
  if (s.label) {
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genEllipse(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const rx = round((s.w / 2) * SCALE);
  const ry = round((s.h / 2) * SCALE);
  let code = `  \\draw${opts} ${tikzPt(cx, cy, ch)} ellipse (${rx} and ${ry});`;
  if (s.label) {
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genLine(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  if (s.points.length < 2) return "";
  const parts = s.points.map(([px, py]) => tikzPt(px, py, ch));
  return `  \\draw${opts} ${parts.join(" -- ")};`;
}

function genArrow(s: DrawShape, ch: number): string {
  const baseOpts = drawOptions(s);
  // Inject arrow tip before first option or after opening bracket
  let opts: string;
  if (baseOpts.startsWith("[")) {
    opts = `[->,>=stealth, ${baseOpts.slice(1)}`;
  } else {
    opts = "[->,>=stealth]";
  }
  if (s.points.length < 2) return "";
  const parts = s.points.map(([px, py]) => tikzPt(px, py, ch));
  return `  \\draw${opts} ${parts.join(" -- ")};`;
}

function genText(s: DrawShape, ch: number): string {
  const opts: string[] = [];
  if (s.stroke && s.stroke !== "#000000") {
    opts.push(`text=${tikzColor(s.stroke)}`);
  }
  if (s.fontSize && s.fontSize !== 14) {
    opts.push(
      `font=\\fontsize{${round(s.fontSize * 0.75)}}{${round(s.fontSize * 0.9)}}\\selectfont`,
    );
  }
  if (s.rotation !== 0) {
    opts.push(`rotate=${round(s.rotation)}`);
  }
  const optStr = opts.length ? `[${opts.join(", ")}]` : "";
  return `  \\node${optStr} at ${tikzPt(s.x, s.y, ch)} {${s.label || "text"}};`;
}

function genDiamond(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const top = tikzPt(cx, s.y, ch);
  const right = tikzPt(s.x + s.w, cy, ch);
  const bottom = tikzPt(cx, s.y + s.h, ch);
  const left = tikzPt(s.x, cy, ch);
  let code = `  \\draw${opts} ${top} -- ${right} -- ${bottom} -- ${left} -- cycle;`;
  if (s.label) {
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genTriangle(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const top = tikzPt(s.x + s.w / 2, s.y, ch);
  const bl = tikzPt(s.x, s.y + s.h, ch);
  const br = tikzPt(s.x + s.w, s.y + s.h, ch);
  let code = `  \\draw${opts} ${top} -- ${bl} -- ${br} -- cycle;`;
  if (s.label) {
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h * 0.6;
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genFreehand(s: DrawShape, ch: number): string {
  if (s.points.length < 2) return "";
  const opts = drawOptions(s);
  const parts = s.points.map(([px, py]) => tikzPt(px, py, ch));
  return `  \\draw${opts} ${parts.join(" -- ")};`;
}

function genParallelogram(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const tl = tikzPt(s.x + s.w * 0.2, s.y, ch);
  const tr = tikzPt(s.x + s.w, s.y, ch);
  const br = tikzPt(s.x + s.w * 0.8, s.y + s.h, ch);
  const bl = tikzPt(s.x, s.y + s.h, ch);
  let code = `  \\draw${opts} ${tl} -- ${tr} -- ${br} -- ${bl} -- cycle;`;
  if (s.label) {
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genCylinder(s: DrawShape, ch: number): string {
  const rx = round((s.w / 2) * SCALE);
  const ry = round(Math.max(s.h * 0.15, 2) * SCALE);

  const cx = s.x + s.w / 2;
  const topY = s.y + s.h * 0.15;
  const bottomY = s.y + s.h - s.h * 0.15;

  const topCenter = tikzPt(cx, topY, ch);
  const bottomLeft = tikzPt(s.x, bottomY, ch);
  const bottomRight = tikzPt(s.x + s.w, bottomY, ch);
  const topLeft = tikzPt(s.x, topY, ch);
  const topRight = tikzPt(s.x + s.w, topY, ch);

  let code = "";
  if (s.fill && s.fill !== "none" && s.fill !== "transparent") {
    code += `  \\fill[${tikzColor(s.fill)}] ${topLeft} -- ${bottomLeft} arc (180:360:${rx} and ${ry}) -- ${topRight} -- cycle;\n`;
    code += `  \\fill[${tikzColor(s.fill)}] ${topCenter} ellipse (${rx} and ${ry});\n`;
  }

  let drawOpt = "draw";
  if (s.stroke && s.stroke !== "#000000") drawOpt += `=${tikzColor(s.stroke)}`;

  code += `  \\draw[${drawOpt}] ${topCenter} ellipse (${rx} and ${ry});\n`;
  code += `  \\draw[${drawOpt}] ${topLeft} -- ${bottomLeft} arc (180:360:${rx} and ${ry}) -- ${topRight};`;

  if (s.label) {
    const cy = s.y + s.h / 2;
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genGrid(s: DrawShape, ch: number): string {
  let styleOpts = "step=0.5cm, gray, very thin";
  if (s.stroke && s.stroke !== "#000000") styleOpts += `, ${tikzColor(s.stroke)}`;
  const p1 = tikzPt(s.x, s.y + s.h, ch);
  const p2 = tikzPt(s.x + s.w, s.y, ch);
  return `  \\draw[${styleOpts}] ${p1} grid ${p2};`;
}

function genAxes(s: DrawShape, ch: number): string {
  const pOrigin = tikzPt(s.x, s.y + s.h, ch);
  const pX = tikzPt(s.x + s.w, s.y + s.h, ch);
  const pY = tikzPt(s.x, s.y, ch);
  let drawOpt = "draw, ->, >=stealth";
  if (s.stroke && s.stroke !== "#000000") drawOpt += `, ${tikzColor(s.stroke)}`;
  return `  \\draw[${drawOpt}] ${pOrigin} -- ${pX} node[right] {$x$};\n  \\draw[${drawOpt}] ${pOrigin} -- ${pY} node[above] {$y$};`;
}

function genPentagon(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const rx = s.w / 2;
  const ry = s.h / 2;
  const pts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const angle = (Math.PI / 2) * -1 + (i * 2 * Math.PI) / 5;
    pts.push(tikzPt(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle), ch));
  }
  let code = `  \\draw${opts} ${pts.join(" -- ")} -- cycle;`;
  if (s.label) {
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genHexagon(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const rx = s.w / 2;
  const ry = s.h / 2;
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 2) * -1 + (i * 2 * Math.PI) / 6;
    pts.push(tikzPt(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle), ch));
  }
  let code = `  \\draw${opts} ${pts.join(" -- ")} -- cycle;`;
  if (s.label) {
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genStar(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const outerR = Math.min(s.w, s.h) / 2;
  const innerR = outerR * 0.4;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 2) * -1 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push(tikzPt(cx + r * Math.cos(angle), cy + r * Math.sin(angle), ch));
  }
  let code = `  \\draw${opts} ${pts.join(" -- ")} -- cycle;`;
  if (s.label) {
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genCloud(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const rx = s.w / 2;
  const ry = s.h / 2;
  const cpx = round((cx - rx * 0.5) * SCALE);
  const cpy = round((ch - (cy + ry * 0.8)) * SCALE);
  const r1x = round(rx * 0.35 * SCALE);
  const r1y = round(ry * 0.35 * SCALE);
  const r2x = round(rx * 0.3 * SCALE);
  const r2y = round(ry * 0.3 * SCALE);
  const parts = [
    `(${cpx},${cpy})`,
    `arc (180:120:${r1x} and ${r1y})`,
    `arc (90:30:${r2x} and ${r2y})`,
    `arc (0:-60:${r1x} and ${r1y})`,
    `arc (-90:-150:${r2x} and ${r2y})`,
  ];
  let code = `  \\draw${opts} ${parts.join("\n    ")} -- cycle;`;
  if (s.label) {
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genTrapezium(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const skew = s.w * 0.15;
  const pts = [
    tikzPt(s.x + skew, s.y, ch),
    tikzPt(s.x + s.w - skew, s.y, ch),
    tikzPt(s.x + s.w, s.y + s.h, ch),
    tikzPt(s.x, s.y + s.h, ch),
  ];
  let code = `  \\draw${opts} ${pts.join(" -- ")} -- cycle;`;
  if (s.label) {
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

// ---------- main export ----------

const generators: Record<ShapeKind, (s: DrawShape, ch: number) => string> = {
  rect: genRect,
  circle: genCircle,
  ellipse: genEllipse,
  line: genLine,
  arrow: genArrow,
  text: genText,
  diamond: genDiamond,
  triangle: genTriangle,
  freehand: genFreehand,
  parallelogram: genParallelogram,
  cylinder: genCylinder,
  grid: genGrid,
  axes: genAxes,
  pentagon: genPentagon,
  hexagon: genHexagon,
  star: genStar,
  cloud: genCloud,
  trapezium: genTrapezium,
};

export function generateTikzCode(
  shapes: DrawShape[],
  canvasWidth: number,
  canvasHeight: number,
): string {
  if (!shapes.length) {
    return (
      "\\begin{tikzpicture}\n" +
      "  % Draw on the canvas — TikZ code appears here in real time\n" +
      "\\end{tikzpicture}"
    );
  }

  const lines = shapes
    .map((shape) => {
      const gen = generators[shape.kind];
      return gen ? gen(shape, canvasHeight) : `  % Unknown shape: ${shape.kind}`;
    })
    .filter(Boolean);

  return "\\begin{tikzpicture}\n" + lines.join("\n") + "\n\\end{tikzpicture}";
}

// ---------- TikZ parser (for round-tripping edits) ----------

const INV_SCALE = 1 / SCALE; // 50

const COLOR_TO_HEX: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#00ff00",
  blue: "#0000ff",
  yellow: "#ffff00",
  magenta: "#ff00ff",
  cyan: "#00ffff",
  gray: "#808080",
  orange: "#ffa500",
  purple: "#800080",
  brown: "#a0522d",
  pink: "#ffc0cb",
  lime: "#90ee90",
  teal: "#008080",
  violet: "#000080",
};

function parseHexColor(tikz: string): string {
  const named = COLOR_TO_HEX[tikz.toLowerCase()];
  if (named) return named;
  const rgb = tikz.match(/\{rgb,255:red,(\d+);green,(\d+);blue,(\d+)\}/);
  if (rgb) {
    return `#${[1, 2, 3].map((i) => parseInt(rgb[i], 10).toString(16).padStart(2, "0")).join("")}`;
  }
  return "#d6dae2";
}

function tikzPtToCanvas(tikzPt: string, ch: number): [number, number] | null {
  const m = tikzPt.match(/\(([-\d.]+),\s*([-\d.]+)\)/);
  if (!m) return null;
  return [parseFloat(m[1]) * INV_SCALE, ch - parseFloat(m[2]) * INV_SCALE];
}

function parseTikzOptions(optsStr: string): {
  stroke: string;
  fill: string;
  strokeWidth: number;
  dashed: boolean;
  rotation: number;
  fontSize: number;
} {
  let stroke = "#d6dae2";
  let fill = "none";
  let strokeWidth = 1.5;
  let dashed = false;
  let rotation = 0;
  let fontSize = 14;
  if (!optsStr) return { stroke, fill, strokeWidth, dashed, rotation, fontSize };
  const opts = optsStr
    .replace(/^\[|\]$/g, "")
    // RGB values contain commas inside braces; they belong to one option.
    .split(/,(?![^{}]*\})/)
    .map((s) => s.trim());
  for (const opt of opts) {
    if (opt === "dashed") dashed = true;
    else if (opt.startsWith("rotate=")) rotation = parseFloat(opt.slice(7)) || 0;
    else if (opt.startsWith("draw=")) stroke = parseHexColor(opt.slice(5));
    else if (opt.startsWith("fill=")) fill = parseHexColor(opt.slice(5));
    else if (opt.startsWith("text=")) stroke = parseHexColor(opt.slice(5));
    else if (opt.startsWith("font=")) {
      const fm = opt.match(/\\fontsize\{([\d.]+)\}/);
      if (fm) fontSize = Math.round(parseFloat(fm[1]) / 0.75);
    } else if (opt === "ultra thin") strokeWidth = 0.4;
    else if (opt === "very thin") strokeWidth = 0.6;
    else if (opt === "thin") strokeWidth = 0.8;
    else if (opt === "semithick") strokeWidth = 1.2;
    else if (opt === "thick") strokeWidth = 1.6;
    else if (opt === "very thick") strokeWidth = 2.4;
    else if (opt === "ultra thick") strokeWidth = 3.2;
  }
  return { stroke, fill, strokeWidth, dashed, rotation, fontSize };
}

let parseId = 0;
function nextParseId(): string {
  return `p${(++parseId).toString(36)}`;
}

function parseTikzDraw(line: string, ch: number): DrawShape | null {
  // Extract options
  const optMatch = line.match(/\\draw\s*\[([^\]]*)\]/);
  const opts = parseTikzOptions(optMatch ? optMatch[1] : "");
  const hasArrow = optMatch && optMatch[1].includes("->");

  // Extract coordinates list
  const coordMatches = [...line.matchAll(/\(([-\d.]+)\s*,\s*([-\d.]+)\)/g)];
  const coords: [number, number][] = coordMatches
    .map((m) => tikzPtToCanvas(m[0], ch))
    .filter((c): c is [number, number] => c !== null);

  if (coords.length < 1) return null;

  // rectangle
  if (line.includes("rectangle")) {
    if (coords.length < 2) return null;
    const p1 = coords[0];
    const p2 = coords[1];
    return {
      id: nextParseId(),
      kind: "rect",
      x: Math.min(p1[0], p2[0]),
      y: Math.min(p1[1], p2[1]),
      w: Math.abs(p2[0] - p1[0]),
      h: Math.abs(p2[1] - p1[1]),
      label: "",
      points: [],
      ...opts,
    };
  }

  // circle
  if (line.includes("circle")) {
    const [cx, cy] = coords[0];
    const radiusMatch = line.match(/circle\s*\(([-\d.]+)\)/);
    if (!radiusMatch) return null;
    const radius = parseFloat(radiusMatch[1]) * INV_SCALE;
    return {
      id: nextParseId(),
      kind: "circle",
      x: cx - radius,
      y: cy - radius,
      w: radius * 2,
      h: radius * 2,
      label: "",
      points: [],
      ...opts,
    };
  }

  // ellipse
  if (line.includes("ellipse")) {
    const [cx, cy] = coords[0];
    const andMatch = line.match(/ellipse\s*\(([-\d.]+)\s+and\s+([-\d.]+)\)/);
    if (!andMatch) return null;
    const rx = parseFloat(andMatch[1]) * INV_SCALE;
    const ry = parseFloat(andMatch[2]) * INV_SCALE;
    return {
      id: nextParseId(),
      kind: "ellipse",
      x: cx - rx,
      y: cy - ry,
      w: rx * 2,
      h: ry * 2,
      label: "",
      points: [],
      ...opts,
    };
  }

  if (coords.length < 2) return null;

  // grid
  if (line.includes("grid")) {
    return {
      id: nextParseId(),
      kind: "grid",
      x: Math.min(coords[0][0], coords[1][0]),
      y: Math.min(coords[0][1], coords[1][1]),
      w: Math.abs(coords[1][0] - coords[0][0]),
      h: Math.abs(coords[1][1] - coords[0][1]),
      label: "",
      points: [],
      ...opts,
    };
  }

  // axes
  if (hasArrow && line.includes("node")) {
    // Simplified: take bounding box from first and second points
    const origin = coords[0];
    // Find the furthest point in x and y
    let maxX = origin[0],
      maxY = origin[1];
    let minX = origin[0],
      minY = origin[1];
    for (const c of coords) {
      maxX = Math.max(maxX, c[0]);
      minX = Math.min(minX, c[0]);
      maxY = Math.max(maxY, c[1]);
      minY = Math.min(minY, c[1]);
    }
    return {
      id: nextParseId(),
      kind: "axes",
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      label: "",
      points: [],
      ...opts,
    };
  }

  // -- cycle polygon: diamond, triangle, parallelogram, pentagon, hexagon, star, trapezium
  if (line.includes("-- cycle")) {
    const n = coords.length;
    if (n === 3) {
      const xs = coords.map((c) => c[0]);
      const ys = coords.map((c) => c[1]);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      return {
        id: nextParseId(),
        kind: "triangle",
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        label: "",
        points: [],
        ...opts,
      };
    }
    if (n === 4) {
      const xs = coords.map((c) => c[0]);
      const ys = coords.map((c) => c[1]);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      // Detect parallelogram: check if top & bottom edges are same length and offset
      const topDx = coords[1][0] - coords[0][0];
      const bottomDx = coords[2][0] - coords[3][0];
      const isParallelogram =
        Math.abs(topDx - bottomDx) < 5 &&
        topDx > 0 &&
        bottomDx > 0 &&
        Math.abs(coords[0][0] - coords[3][0]) > 5;
      // Detect trapezium: top shorter than bottom
      const topLen = Math.abs(coords[1][0] - coords[0][0]);
      const botLen = Math.abs(coords[2][0] - coords[3][0]);
      const isTrapezium = topDx > 0 && bottomDx > 0 && Math.abs(topLen - botLen) > 10;
      // Detect diamond: all 4 points at midpoints of bounding box
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const isDiamond =
        coords.every(
          ([x, y]) =>
            (Math.abs(x - cx) < 5 ||
              Math.abs(x - minX) < 5 ||
              Math.abs(x - maxX) < 5) &&
            (Math.abs(y - cy) < 5 || Math.abs(y - minY) < 5 || Math.abs(y - maxY) < 5),
        ) &&
        coords.some(([x]) => Math.abs(x - cx) < 5) &&
        coords.some(([, y]) => Math.abs(y - cy) < 5);

      let kind: ShapeKind = "rect";
      if (isDiamond) kind = "diamond";
      else if (isTrapezium) kind = "trapezium";
      else if (isParallelogram) kind = "parallelogram";
      return {
        id: nextParseId(),
        kind,
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        label: "",
        points: [],
        ...opts,
      };
    }
    if (n === 5) {
      const xs = coords.map((c) => c[0]);
      const ys = coords.map((c) => c[1]);
      return {
        id: nextParseId(),
        kind: "pentagon",
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
        label: "",
        points: [],
        ...opts,
      };
    }
    if (n === 6) {
      const xs = coords.map((c) => c[0]);
      const ys = coords.map((c) => c[1]);
      return {
        id: nextParseId(),
        kind: "hexagon",
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
        label: "",
        points: [],
        ...opts,
      };
    }
    if (n >= 8) {
      // star-like (many points)
      const xs = coords.map((c) => c[0]);
      const ys = coords.map((c) => c[1]);
      return {
        id: nextParseId(),
        kind: "star",
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
        label: "",
        points: [],
        ...opts,
      };
    }
    return null;
  }

  // Plain polyline: line (or arrow if hasArrow)
  if (hasArrow) {
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      id: nextParseId(),
      kind: "arrow",
      x: minX,
      y: minY,
      w: Math.max(...xs) - minX,
      h: Math.max(...ys) - minY,
      label: "",
      points: coords,
      ...opts,
    };
  }

  // Plain line
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    id: nextParseId(),
    kind: "line",
    x: minX,
    y: minY,
    w: Math.max(...xs) - minX,
    h: Math.max(...ys) - minY,
    label: "",
    points: coords,
    ...opts,
  };
}

function parseTikzNode(line: string, ch: number): DrawShape | null {
  const optMatch = line.match(/\\node\s*\[([^\]]*)\]/);
  const opts = parseTikzOptions(optMatch ? optMatch[1] : "");
  const atMatch = line.match(/at\s*\(([-\d.]+),\s*([-\d.]+)\)/);
  if (!atMatch) return null;
  const pos = tikzPtToCanvas(`(${atMatch[1]},${atMatch[2]})`, ch);
  if (!pos) return null;
  const labelMatch = line
    .slice((atMatch.index ?? 0) + atMatch[0].length)
    .match(/^\s*\{([\s\S]*)\}\s*;?\s*$/);
  const label = labelMatch ? labelMatch[1] : "text";

  return {
    id: nextParseId(),
    kind: "text",
    x: pos[0],
    y: pos[1],
    w: 0,
    h: 0,
    label,
    points: [],
    ...opts,
  };
}

export function parseTikzCode(
  code: string,
  canvasWidth: number,
  canvasHeight: number,
): DrawShape[] {
  parseId = 0;
  const shapes: DrawShape[] = [];
  const lines = code
    .replace(/\\begin\{tikzpicture\}.*?\n/, "")
    .replace(/\\end\{tikzpicture\}/, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("%"));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Try to match \node command
    if (line.startsWith("\\node")) {
      const shape = parseTikzNode(line, canvasHeight);
      if (shape) {
        // If previous line is a \draw, attach this as label to the previous shape
        if (shapes.length > 0) {
          const prev = shapes[shapes.length - 1];
          if (prev.label === "" && !prev.points.length) {
            prev.label = shape.label;
            continue;
          }
        }
        shapes.push(shape);
      }
      continue;
    }

    // Try to match \draw command
    if (line.startsWith("\\draw") || line.startsWith("\\fill")) {
      const shape = parseTikzDraw(line, canvasHeight);
      if (shape) {
        // Check if next line is a \node for label
        if (i + 1 < lines.length && lines[i + 1].startsWith("\\node")) {
          const nextLine = lines[i + 1];
          const labelNode = parseTikzNode(nextLine, canvasHeight);
          if (labelNode) {
            shape.label = labelNode.label;
            i++; // skip the label line
          }
        }
        shapes.push(shape);
      }
      continue;
    }
  }

  return shapes;
}

/** Full document wrapper that can be compiled standalone */
export function generateFullDocument(
  shapes: DrawShape[],
  canvasWidth: number,
  canvasHeight: number,
): string {
  const tikz = generateTikzCode(shapes, canvasWidth, canvasHeight);
  return (
    "\\documentclass[border=10pt]{standalone}\n" +
    "\\usepackage{tikz}\n\n" +
    "\\begin{document}\n" +
    tikz +
    "\n\\end{document}\n"
  );
}
