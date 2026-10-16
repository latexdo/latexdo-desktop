/**
 * Traces a raster image into editable TikZ (#119): boxes (outlined or
 * filled) and straight lines. Anything that cannot be traced, such as a
 * photo, is placed in the picture as an image to draw on.
 */

export interface TracedBox {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  filled: boolean;
}

export interface TracedLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

export interface ImageTrace {
  boxes: TracedBox[];
  lines: TracedLine[];
  /** Background colour the shapes were separated from. */
  background: string;
}

function hexColor(r: number, g: number, b: number): string {
  return (
    "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")
  );
}

function distance(
  data: ArrayLike<number>,
  index: number,
  rgb: readonly number[],
): number {
  return Math.hypot(
    data[index] - rgb[0],
    data[index + 1] - rgb[1],
    data[index + 2] - rgb[2],
  );
}

/** The commonest colour along the image border; transparent counts as white. */
function backgroundColor(
  data: ArrayLike<number>,
  width: number,
  height: number,
): number[] {
  const counts = new Map<string, { count: number; rgb: number[] }>();
  const sample = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    const rgb =
      data[index + 3] < 20
        ? [255, 255, 255]
        : [data[index], data[index + 1], data[index + 2]];
    const key = rgb.map((c) => c >> 4).join(",");
    const entry = counts.get(key) ?? { count: 0, rgb };
    entry.count += 1;
    counts.set(key, entry);
  };
  for (let x = 0; x < width; x += 1) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    sample(0, y);
    sample(width - 1, y);
  }
  let best = { count: 0, rgb: [255, 255, 255] };
  for (const entry of counts.values()) if (entry.count > best.count) best = entry;
  return best.rgb;
}

export function traceImage(
  data: ArrayLike<number>,
  width: number,
  height: number,
): ImageTrace {
  const background = backgroundColor(data, width, height);
  const isForeground = (index: number) =>
    data[index + 3] >= 20 && distance(data, index, background) > 60;
  const visited = new Uint8Array(width * height);
  const scale = Math.max(1, Math.min(width, height) / 400);
  const minSize = 8 * scale;
  const boxes: TracedBox[] = [];
  const lines: TracedLine[] = [];

  for (let start = 0; start < width * height; start += 1) {
    if (visited[start] || !isForeground(start * 4)) continue;
    // One shape: connected pixels of about the seed's colour.
    const seed = [data[start * 4], data[start * 4 + 1], data[start * 4 + 2]];
    const stack = [start];
    const pixels: number[] = [];
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    const sum = [0, 0, 0];
    visited[start] = 1;
    while (stack.length) {
      const pixel = stack.pop()!;
      pixels.push(pixel);
      const x = pixel % width;
      const y = (pixel - x) / width;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      sum[0] += data[pixel * 4];
      sum[1] += data[pixel * 4 + 1];
      sum[2] += data[pixel * 4 + 2];
      const neighbours = [
        x > 0 ? pixel - 1 : -1,
        x < width - 1 ? pixel + 1 : -1,
        y > 0 ? pixel - width : -1,
        y < height - 1 ? pixel + width : -1,
      ];
      for (const next of neighbours) {
        if (next < 0 || visited[next]) continue;
        if (!isForeground(next * 4) || distance(data, next * 4, seed) > 60) continue;
        visited[next] = 1;
        stack.push(next);
      }
    }

    const w = maxX - minX;
    const h = maxY - minY;
    if (w < minSize && h < minSize) continue; // Specks and letters.
    if (w > width * 0.95 && h > height * 0.95) continue; // A frame round everything.
    const color = hexColor(
      sum[0] / pixels.length,
      sum[1] / pixels.length,
      sum[2] / pixels.length,
    );
    const density = pixels.length / Math.max(1, (w + 1) * (h + 1));
    const aspect = w / Math.max(h, 1);

    // Straight lines: very thin, or long and mostly empty.
    if (Math.min(w, h) <= 3 || (density < 0.4 && (aspect > 5 || aspect < 0.2))) {
      if (aspect >= 1) {
        lines.push({
          x1: minX,
          y1: (minY + maxY) / 2,
          x2: maxX,
          y2: (minY + maxY) / 2,
          color,
        });
      } else {
        lines.push({
          x1: (minX + maxX) / 2,
          y1: minY,
          x2: (minX + maxX) / 2,
          y2: maxY,
          color,
        });
      }
      continue;
    }

    if (density >= 0.85) {
      boxes.push({ x: minX, y: minY, w, h, color, filled: true });
      continue;
    }

    // An outlined box: its pixels hug all four sides of the bounding box.
    const band = Math.max(2, Math.round(Math.min(w, h) * 0.08));
    const top = new Uint8Array(w + 1);
    const bottom = new Uint8Array(w + 1);
    const left = new Uint8Array(h + 1);
    const right = new Uint8Array(h + 1);
    let nearEdge = 0;
    for (const pixel of pixels) {
      const x = (pixel % width) - minX;
      const y = Math.floor(pixel / width) - minY;
      let edge = false;
      if (y <= band) {
        top[x] = 1;
        edge = true;
      }
      if (h - y <= band) {
        bottom[x] = 1;
        edge = true;
      }
      if (x <= band) {
        left[y] = 1;
        edge = true;
      }
      if (w - x <= band) {
        right[y] = 1;
        edge = true;
      }
      if (edge) nearEdge += 1;
    }
    const coverage = (side: Uint8Array) =>
      side.reduce((total, value) => total + value, 0) / side.length;
    if (
      nearEdge / pixels.length >= 0.8 &&
      [top, bottom, left, right].every((side) => coverage(side) >= 0.7)
    ) {
      boxes.push({ x: minX, y: minY, w, h, color, filled: false });
    }
  }

  return {
    boxes,
    lines,
    background: hexColor(background[0], background[1], background[2]),
  };
}

function tikzColor(hex: string): string {
  const named: Record<string, string> = {
    "#000000": "black",
    "#ffffff": "white",
    "#ff0000": "red",
    "#00ff00": "green",
    "#0000ff": "blue",
  };
  const lower = hex.toLowerCase();
  if (named[lower]) return named[lower];
  const r = parseInt(lower.slice(1, 3), 16);
  const g = parseInt(lower.slice(3, 5), 16);
  const b = parseInt(lower.slice(5, 7), 16);
  return `{rgb,255:red,${r};green,${g};blue,${b}}`;
}

/** Where a file name is expected to live in the project. */
export function figurePathForImage(name: string): string {
  const safe = (name || "image.png").replace(/[^A-Za-z0-9._-]+/g, "-");
  return `figures/${safe}`;
}

export function tikzFromTrace(
  trace: ImageTrace,
  width: number,
  height: number,
  imageName = "image.png",
): string {
  const scale = 1 / 50;
  const pt = (x: number, y: number) =>
    `(${(x * scale).toFixed(2)},${((height - y) * scale).toFixed(2)})`;
  const out = [
    "\\begin{tikzpicture}",
    `  % Auto-generated from image (${width}x${height}px)`,
  ];

  if (!trace.boxes.length && !trace.lines.length) {
    // Nothing to trace (a photo, a plot, a scan): keep the image and give a
    // frame to annotate it with coordinates from 0 to 1.
    out.push(
      "  % No boxes or lines could be traced, so the image is placed in the",
      "  % picture and you can draw on top of it. Save the image in your project",
      `  % as ${figurePathForImage(imageName)}.`,
      `  \\node[anchor=south west, inner sep=0] (image) at (0,0) {\\includegraphics[width=${(
        width * scale
      ).toFixed(2)}cm]{${figurePathForImage(imageName)}}};`,
      "  \\begin{scope}[x={(image.south east)}, y={(image.north west)}]",
      "    % Coordinates here run from (0,0) at the bottom left to (1,1) at the top right.",
      "    % \\draw[red, thick] (0.25,0.25) rectangle (0.5,0.5);",
      "  \\end{scope}",
      "\\end{tikzpicture}",
    );
    return out.join("\n");
  }

  for (const box of trace.boxes) {
    const color = tikzColor(box.color);
    const options = box.filled
      ? `[draw=${color}, fill=${color}]`
      : color !== "black"
        ? `[draw=${color}]`
        : "";
    out.push(
      `  \\draw${options} ${pt(box.x, box.y)} rectangle ${pt(box.x + box.w, box.y + box.h)};`,
    );
  }
  for (const line of trace.lines) {
    const color = tikzColor(line.color);
    const options = color !== "black" ? `[draw=${color}]` : "";
    out.push(`  \\draw${options} ${pt(line.x1, line.y1)} -- ${pt(line.x2, line.y2)};`);
  }
  out.push("\\end{tikzpicture}");
  return out.join("\n");
}

export function traceSummary(trace: ImageTrace): string {
  const parts = [
    trace.boxes.length
      ? `${trace.boxes.length} box${trace.boxes.length === 1 ? "" : "es"}`
      : "",
    trace.lines.length
      ? `${trace.lines.length} line${trace.lines.length === 1 ? "" : "s"}`
      : "",
  ].filter(Boolean);
  return parts.length
    ? `Traced ${parts.join(" and ")}.`
    : "No boxes or lines found, so the image is placed in the picture for you to draw on.";
}
