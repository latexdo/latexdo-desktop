export interface DrawioToTikzConversion {
  code: string;
  pageName: string;
  shapeCount: number;
  connectorCount: number;
  labelCount: number;
}

interface DrawioPoint {
  x: number;
  y: number;
}

interface DrawioVertex {
  id: string;
  label: string;
  style: Map<string, string>;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DrawioEdge {
  label: string;
  style: Map<string, string>;
  source?: string;
  target?: string;
  sourcePoint?: DrawioPoint;
  targetPoint?: DrawioPoint;
  waypoints: DrawioPoint[];
}

interface DrawioModel {
  pageName: string;
  width: number;
  height: number;
  vertices: DrawioVertex[];
  edges: DrawioEdge[];
}

interface ModelXml {
  xml: string;
  pageName: string;
}

const coordinateScale = 1 / 50;
const defaultPageWidth = 850;
const defaultPageHeight = 1100;

function parseXml(xml: string, errorMessage: string): XMLDocument {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) {
    throw new Error(errorMessage);
  }
  return document;
}

function serializeElement(element: Element): string {
  return new XMLSerializer().serializeToString(element);
}

function numberAttribute(element: Element | null, name: string, fallback = 0): number {
  if (!element) {
    return fallback;
  }
  const value = Number.parseFloat(element.getAttribute(name) ?? "");
  return Number.isFinite(value) ? value : fallback;
}

function directChild(element: Element, tagName: string): Element | null {
  return (
    Array.from(element.children).find((child) => child.tagName === tagName) ?? null
  );
}

function parseStyle(style: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const part of style.split(";")) {
    const item = part.trim();
    if (!item) {
      continue;
    }
    const separatorIndex = item.indexOf("=");
    if (separatorIndex === -1) {
      entries.set(item, "1");
      continue;
    }
    entries.set(item.slice(0, separatorIndex), item.slice(separatorIndex + 1));
  }
  return entries;
}

function plainTextFromDrawioValue(value: string): string {
  if (!value.trim()) {
    return "";
  }
  const normalized = value.replace(/<br\s*\/?>/gi, "\n");
  const document = new DOMParser().parseFromString(normalized, "text/html");
  return (document.body.textContent ?? value).trim();
}

function escapeTikzText(value: string): string {
  const replacements: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    $: "\\$",
    "&": "\\&",
    "%": "\\%",
    "#": "\\#",
    _: "\\_",
    "^": "\\textasciicircum{}",
    "~": "\\textasciitilde{}",
  };
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/[\\{}$&%#_^~]/g, (char) => replacements[char]))
    .join(" \\\\ ");
}

function normalizeHexColor(value: string | undefined): string | null {
  if (!value || value === "none" || value === "default") {
    return null;
  }
  const hex = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) {
    return hex;
  }
  return null;
}

function colorName(hex: string, prefix: string, colors: Map<string, string>): string {
  if (hex === "#000000") {
    return "black";
  }
  if (hex === "#ffffff") {
    return "white";
  }
  const existing = colors.get(hex);
  if (existing) {
    return existing;
  }
  const name = `${prefix}${hex.slice(1)}`;
  colors.set(hex, name);
  return name;
}

function optionList(options: string[]): string {
  return options.length ? `[${options.join(",")}]` : "";
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Object.is(rounded, -0)) {
    return "0";
  }
  return String(rounded)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

function formatDimension(value: number): string {
  return `${formatNumber(value * coordinateScale)}cm`;
}

function parseMxPoint(element: Element | null): DrawioPoint | undefined {
  if (!element) {
    return undefined;
  }
  return {
    x: numberAttribute(element, "x"),
    y: numberAttribute(element, "y"),
  };
}

function parseModel(modelXml: string, pageName: string): DrawioModel {
  const document = parseXml(modelXml, "Draw.io diagram content is not valid XML.");
  const model = document.querySelector("mxGraphModel");
  if (!model) {
    throw new Error("Draw.io file does not contain an mxGraphModel.");
  }

  const vertices: DrawioVertex[] = [];
  const edges: DrawioEdge[] = [];
  const cells = Array.from(document.querySelectorAll("mxCell"));

  for (const cell of cells) {
    const geometry = directChild(cell, "mxGeometry");
    if (cell.getAttribute("vertex") === "1" && geometry) {
      const width = numberAttribute(geometry, "width");
      const height = numberAttribute(geometry, "height");
      if (width <= 0 || height <= 0) {
        continue;
      }
      vertices.push({
        id: cell.getAttribute("id") ?? "",
        label: plainTextFromDrawioValue(cell.getAttribute("value") ?? ""),
        style: parseStyle(cell.getAttribute("style") ?? ""),
        x: numberAttribute(geometry, "x"),
        y: numberAttribute(geometry, "y"),
        width,
        height,
      });
      continue;
    }

    if (cell.getAttribute("edge") === "1") {
      const pointArray = geometry?.querySelector('Array[as="points"]');
      edges.push({
        label: plainTextFromDrawioValue(cell.getAttribute("value") ?? ""),
        style: parseStyle(cell.getAttribute("style") ?? ""),
        source: cell.getAttribute("source") ?? undefined,
        target: cell.getAttribute("target") ?? undefined,
        sourcePoint: parseMxPoint(
          geometry?.querySelector('mxPoint[as="sourcePoint"]') ?? null,
        ),
        targetPoint: parseMxPoint(
          geometry?.querySelector('mxPoint[as="targetPoint"]') ?? null,
        ),
        waypoints: pointArray
          ? Array.from(pointArray.querySelectorAll("mxPoint")).map((point) => ({
              x: numberAttribute(point, "x"),
              y: numberAttribute(point, "y"),
            }))
          : [],
      });
    }
  }

  return {
    pageName,
    width: numberAttribute(model, "pageWidth", defaultPageWidth),
    height: numberAttribute(model, "pageHeight", defaultPageHeight),
    vertices,
    edges,
  };
}

function decodeDiagramXmlText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("<mxGraphModel")) {
    return trimmed;
  }
  try {
    const decoded = decodeURIComponent(trimmed);
    return decoded.trim().startsWith("<mxGraphModel") ? decoded : null;
  } catch {
    return null;
  }
}

async function inflateDrawioDiagram(text: string): Promise<string> {
  const decompressionStream = (
    globalThis as typeof globalThis & {
      DecompressionStream?: new (
        format: string,
      ) => TransformStream<Uint8Array, Uint8Array>;
    }
  ).DecompressionStream;

  if (typeof atob !== "function" || !decompressionStream) {
    throw new Error(
      "This compressed draw.io file cannot be decoded in this browser. Save it as uncompressed XML and try again.",
    );
  }

  const binary = atob(text.replace(/\s+/g, ""));
  const compressed = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const errors: unknown[] = [];

  for (const format of ["deflate-raw", "deflate"]) {
    try {
      const stream = new Blob([compressed])
        .stream()
        .pipeThrough(new decompressionStream(format));
      const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
      const decoded = new TextDecoder().decode(inflated);
      try {
        return decodeURIComponent(decoded);
      } catch {
        return decoded;
      }
    } catch (error) {
      errors.push(error);
    }
  }

  throw new Error(
    errors.length
      ? "Could not decode the compressed draw.io diagram."
      : "This draw.io file does not contain decodable diagram XML.",
  );
}

async function extractModelXml(drawioXml: string): Promise<ModelXml> {
  const document = parseXml(drawioXml, "Draw.io file is not valid XML.");
  const directModel = document.querySelector("mxGraphModel");
  if (directModel) {
    const parentDiagram = directModel.closest("diagram");
    return {
      xml: serializeElement(directModel),
      pageName: parentDiagram?.getAttribute("name") || "Page-1",
    };
  }

  const diagram = document.querySelector("diagram");
  if (!diagram) {
    throw new Error("Draw.io file does not contain a diagram.");
  }

  const pageName = diagram.getAttribute("name") || "Page-1";
  const encoded = diagram.textContent ?? "";
  const uncompressed = decodeDiagramXmlText(encoded);
  if (uncompressed) {
    return { xml: uncompressed, pageName };
  }

  return {
    xml: await inflateDrawioDiagram(encoded),
    pageName,
  };
}

function center(vertex: DrawioVertex): DrawioPoint {
  return {
    x: vertex.x + vertex.width / 2,
    y: vertex.y + vertex.height / 2,
  };
}

function modelBounds(model: DrawioModel): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const points: DrawioPoint[] = [];

  for (const vertex of model.vertices) {
    points.push({ x: vertex.x, y: vertex.y });
    points.push({ x: vertex.x + vertex.width, y: vertex.y + vertex.height });
  }
  for (const edge of model.edges) {
    if (edge.sourcePoint) points.push(edge.sourcePoint);
    if (edge.targetPoint) points.push(edge.targetPoint);
    points.push(...edge.waypoints);
  }

  if (!points.length) {
    points.push({ x: 0, y: 0 });
    points.push({ x: model.width, y: model.height });
  }

  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function shapeKind(
  style: Map<string, string>,
): "ellipse" | "rhombus" | "text" | "rect" {
  const shape = style.get("shape");
  if (style.has("ellipse") || shape === "ellipse") {
    return "ellipse";
  }
  if (style.has("rhombus") || shape === "rhombus") {
    return "rhombus";
  }
  if (style.has("text") || shape === "text") {
    return "text";
  }
  return "rect";
}

function vertexDrawOptions(
  vertex: DrawioVertex,
  colors: Map<string, string>,
): string[] {
  const options: string[] = [];
  const stroke = normalizeHexColor(vertex.style.get("strokeColor"));
  const fill = normalizeHexColor(vertex.style.get("fillColor"));
  if (stroke) {
    options.push(`draw=${colorName(stroke, "drawioStroke", colors)}`);
  } else if (vertex.style.get("strokeColor") !== "none") {
    options.push("draw");
  }
  if (fill) {
    options.push(`fill=${colorName(fill, "drawioFill", colors)}`);
  }
  if (vertex.style.get("dashed") === "1") {
    options.push("dashed");
  }
  return options;
}

function edgeDrawOptions(edge: DrawioEdge, colors: Map<string, string>): string[] {
  const options: string[] = [];
  const startArrow = edge.style.get("startArrow");
  const endArrow = edge.style.get("endArrow");
  if (startArrow && startArrow !== "none" && endArrow && endArrow !== "none") {
    options.push("<->");
  } else if (startArrow && startArrow !== "none") {
    options.push("<-");
  } else if (endArrow && endArrow !== "none") {
    options.push("->");
  }

  const stroke = normalizeHexColor(edge.style.get("strokeColor"));
  if (stroke) {
    options.push(`draw=${colorName(stroke, "drawioStroke", colors)}`);
  }
  const strokeWidth = Number.parseFloat(edge.style.get("strokeWidth") ?? "");
  if (Number.isFinite(strokeWidth) && strokeWidth > 0) {
    options.push(`line width=${formatNumber(strokeWidth * 0.75)}pt`);
  }
  if (edge.style.get("dashed") === "1") {
    options.push("dashed");
  }
  if (options.some((option) => option.includes("->"))) {
    options.push(">=stealth");
  }
  return options;
}

export async function convertDrawioToTikz(
  drawioXml: string,
): Promise<DrawioToTikzConversion> {
  const modelXml = await extractModelXml(drawioXml);
  const model = parseModel(modelXml.xml, modelXml.pageName);
  const verticesById = new Map(model.vertices.map((vertex) => [vertex.id, vertex]));
  const bounds = modelBounds(model);
  const colors = new Map<string, string>();
  const body: string[] = [];
  let labelCount = 0;

  const point = (x: number, y: number): string =>
    `(${formatNumber((x - bounds.minX) * coordinateScale)},${formatNumber(
      (bounds.maxY - y) * coordinateScale,
    )})`;

  for (const vertex of model.vertices) {
    const kind = shapeKind(vertex.style);
    const label = escapeTikzText(vertex.label);
    if (label) {
      labelCount += 1;
    }
    const centerPoint = center(vertex);
    const centerCoordinate = point(centerPoint.x, centerPoint.y);
    const options = vertexDrawOptions(vertex, colors);

    if (kind === "text") {
      body.push(
        `  \\node[align=center] at ${centerCoordinate} {${label || "\\strut"}};`,
      );
      continue;
    }

    if (kind === "ellipse") {
      body.push(
        `  \\draw${optionList(options)} ${centerCoordinate} ellipse [x radius=${formatDimension(
          vertex.width / 2,
        )}, y radius=${formatDimension(vertex.height / 2)}];`,
      );
      if (label) {
        body.push(`  \\node[align=center] at ${centerCoordinate} {${label}};`);
      }
      continue;
    }

    if (kind === "rhombus") {
      const top = point(vertex.x + vertex.width / 2, vertex.y);
      const right = point(vertex.x + vertex.width, vertex.y + vertex.height / 2);
      const bottom = point(vertex.x + vertex.width / 2, vertex.y + vertex.height);
      const left = point(vertex.x, vertex.y + vertex.height / 2);
      body.push(
        `  \\draw${optionList(options)} ${top} -- ${right} -- ${bottom} -- ${left} -- cycle;`,
      );
      if (label) {
        body.push(`  \\node[align=center] at ${centerCoordinate} {${label}};`);
      }
      continue;
    }

    const nodeOptions = [
      ...options,
      "rectangle",
      "align=center",
      `minimum width=${formatDimension(vertex.width)}`,
      `minimum height=${formatDimension(vertex.height)}`,
    ];
    if (vertex.style.get("rounded") === "1") {
      nodeOptions.push("rounded corners=2pt");
    }
    body.push(
      `  \\node${optionList(nodeOptions)} at ${centerCoordinate} {${label || "\\strut"}};`,
    );
  }

  for (const edge of model.edges) {
    const sourceVertex = edge.source ? verticesById.get(edge.source) : undefined;
    const targetVertex = edge.target ? verticesById.get(edge.target) : undefined;
    const sourcePoint =
      edge.sourcePoint ?? (sourceVertex ? center(sourceVertex) : undefined);
    const targetPoint =
      edge.targetPoint ?? (targetVertex ? center(targetVertex) : undefined);
    if (!sourcePoint || !targetPoint) {
      continue;
    }

    const pathPoints = [sourcePoint, ...edge.waypoints, targetPoint];
    body.push(
      `  \\draw${optionList(edgeDrawOptions(edge, colors))} ${pathPoints
        .map((pathPoint) => point(pathPoint.x, pathPoint.y))
        .join(" -- ")};`,
    );
    if (edge.label) {
      labelCount += 1;
      const midpoint = pathPoints[Math.floor(pathPoints.length / 2)];
      body.push(
        `  \\node[fill=white,inner sep=1pt] at ${point(midpoint.x, midpoint.y)} {${escapeTikzText(
          edge.label,
        )}};`,
      );
    }
  }

  const colorDefinitions = Array.from(colors, ([hex, name]) => {
    const value = hex.slice(1).toUpperCase();
    return `  \\definecolor{${name}}{HTML}{${value}}`;
  });
  const lines = [
    "\\begin{tikzpicture}[x=1cm,y=1cm]",
    `  % Auto-generated from draw.io page "${escapeTikzText(model.pageName)}"`,
    ...colorDefinitions,
    ...body,
    "\\end{tikzpicture}",
  ];

  return {
    code: lines.join("\n"),
    pageName: model.pageName,
    shapeCount: model.vertices.length,
    connectorCount: model.edges.length,
    labelCount,
  };
}
