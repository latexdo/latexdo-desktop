import { describe, expect, it } from "vitest";
import {
  figurePathForImage,
  tikzFromTrace,
  traceImage,
  traceSummary,
} from "./imageToTikz";

function canvas(width: number, height: number, background: number[]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set([...background, 255], i * 4);
  const fill = (x: number, y: number, w: number, h: number, color: number[]) => {
    for (let py = y; py <= y + h; py += 1)
      for (let px = x; px <= x + w; px += 1)
        data.set([...color, 255], (py * width + px) * 4);
  };
  const outline = (
    x: number,
    y: number,
    w: number,
    h: number,
    color: number[],
    t = 1,
  ) => {
    fill(x, y, w, t - 1, color);
    fill(x, y + h - t + 1, w, t - 1, color);
    fill(x, y, t - 1, h, color);
    fill(x + w - t + 1, y, t - 1, h, color);
  };
  return { data, fill, outline };
}

describe("traceImage (#119)", () => {
  it("finds a large box with a thin outline, which used to be ignored", () => {
    const image = canvas(400, 300, [255, 255, 255]);
    image.outline(40, 40, 200, 120, [0, 0, 0]);
    const trace = traceImage(image.data, 400, 300);
    expect(trace.boxes).toEqual([
      { x: 40, y: 40, w: 200, h: 120, color: "#000000", filled: false },
    ]);
  });

  it("finds filled coloured boxes on a coloured background", () => {
    const image = canvas(400, 300, [240, 240, 250]);
    image.fill(30, 30, 80, 50, [40, 120, 200]);
    image.fill(200, 150, 60, 60, [220, 80, 60]);
    const trace = traceImage(image.data, 400, 300);
    expect(trace.background).toBe("#f0f0fa");
    expect(trace.boxes.map((box) => [box.x, box.filled, box.color])).toEqual([
      [30, true, "#2878c8"],
      [200, true, "#dc503c"],
    ]);
    expect(tikzFromTrace(trace, 400, 300)).toContain(
      "fill={rgb,255:red,40;green,120;blue,200}",
    );
  });

  it("finds thin straight lines", () => {
    const image = canvas(400, 300, [255, 255, 255]);
    image.fill(50, 200, 250, 1, [0, 0, 0]);
    image.fill(350, 20, 1, 200, [0, 0, 0]);
    const trace = traceImage(image.data, 400, 300);
    expect(trace.lines).toHaveLength(2);
    expect(trace.boxes).toHaveLength(0);
  });

  it("ignores a frame around the whole image and small specks", () => {
    const image = canvas(200, 200, [255, 255, 255]);
    image.outline(0, 0, 199, 199, [0, 0, 0]);
    image.fill(100, 100, 2, 2, [0, 0, 0]);
    const trace = traceImage(image.data, 200, 200);
    expect(trace.boxes).toHaveLength(0);
    expect(trace.lines).toHaveLength(0);
  });

  it("keeps a photo as an image to draw on instead of an empty picture", () => {
    const width = 120;
    const height = 80;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      // Smooth gradient, like a photo: no shape stands out from its neighbours.
      data.set([(i % width) * 2, Math.floor(i / width) * 3, 128, 255], i * 4);
    }
    const trace = traceImage(data, width, height);
    const code = tikzFromTrace(trace, width, height, "my photo.jpg");
    expect(code).toContain("\\includegraphics[width=2.40cm]{figures/my-photo.jpg}");
    expect(code).toContain(
      "\\begin{scope}[x={(image.south east)}, y={(image.north west)}]",
    );
    expect(traceSummary({ boxes: [], lines: [], background: "#ffffff" })).toMatch(
      /No boxes or lines found/,
    );
  });
});

describe("TikZ output details", () => {
  it("names basic colours, writes others as RGB and styles lines", () => {
    const tikz = tikzFromTrace(
      {
        background: "#ffffff",
        boxes: [
          { x: 0, y: 0, w: 50, h: 50, color: "#FF0000", filled: false },
          { x: 0, y: 0, w: 50, h: 50, color: "#000000", filled: false },
          { x: 0, y: 0, w: 50, h: 50, color: "#123456", filled: true },
        ],
        lines: [
          { x1: 0, y1: 0, x2: 50, y2: 0, color: "#0000ff" },
          { x1: 0, y1: 0, x2: 0, y2: 50, color: "#000000" },
        ],
      },
      100,
      100,
    );
    expect(tikz).toContain("\\draw[draw=red] (0.00,2.00) rectangle (1.00,1.00);");
    expect(tikz).toContain("\\draw (0.00,2.00) rectangle (1.00,1.00);");
    expect(tikz).toContain(
      "[draw={rgb,255:red,18;green,52;blue,86}, fill={rgb,255:red,18;green,52;blue,86}]",
    );
    expect(tikz).toContain("\\draw[draw=blue] (0.00,2.00) -- (1.00,2.00);");
    expect(tikz).toContain("\\draw (0.00,2.00) -- (0.00,1.00);");
  });

  it("summarises single and plural shapes", () => {
    const box = { x: 0, y: 0, w: 1, h: 1, color: "#000000", filled: false };
    const line = { x1: 0, y1: 0, x2: 1, y2: 1, color: "#000000" };
    expect(traceSummary({ background: "#ffffff", boxes: [box], lines: [line] })).toBe("Traced 1 box and 1 line.");
    expect(traceSummary({ background: "#ffffff", boxes: [box, box], lines: [] })).toBe("Traced 2 boxes.");
    expect(traceSummary({ background: "#ffffff", boxes: [], lines: [line, line] })).toBe("Traced 2 lines.");
  });

  it("makes safe figure paths and defaults the image name", () => {
    expect(figurePathForImage("my figure (1).png")).toBe("figures/my-figure-1-.png");
    expect(figurePathForImage("")).toBe("figures/image.png");
  });

  it("treats transparent pixels as a white background", () => {
    const width = 120;
    const height = 120;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 20; y <= 80; y += 1)
      for (let x = 20; x <= 90; x += 1) data.set([200, 30, 30, 255], (y * width + x) * 4);
    const trace = traceImage(data, width, height);
    expect(trace.boxes).toEqual([
      expect.objectContaining({ x: 20, y: 20, filled: true }),
    ]);
  });
});
