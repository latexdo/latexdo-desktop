import { describe, expect, it } from "vitest";
import { tikzFromTrace, traceImage, traceSummary } from "./imageToTikz";

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
