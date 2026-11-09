import { describe, expect, it } from "vitest";
import { computePixelDiff, defaultPixelDiffColors, type RgbaImage } from "./pixelDiff";

function image(
  width: number,
  height: number,
  ink: Array<[number, number]> = [],
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [x, y] of ink) {
    const offset = (y * width + x) * 4;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
  }
  return { width, height, data };
}

function pixel(result: RgbaImage, x: number, y: number): number[] {
  const offset = (y * result.width + x) * 4;
  return Array.from(result.data.slice(offset, offset + 3));
}

describe("computePixelDiff", () => {
  it("finds no change between identical pages", () => {
    const page = image(4, 4, [[1, 1]]);
    const result = computePixelDiff(page, page);
    expect(result.changedPixels).toBe(0);
    expect(result.bounds).toBeNull();
    // Unchanged ink is shown faded, not black.
    expect(pixel(result, 1, 1)[0]).toBeGreaterThan(150);
  });

  it("colours removed, added and recoloured ink", () => {
    const before = image(4, 2, [
      [0, 0],
      [2, 0],
    ]);
    const after = image(4, 2, [
      [1, 0],
      [2, 0],
    ]);
    const grey = after.data;
    const offset = (0 * 4 + 2) * 4;
    grey[offset] = 120;
    grey[offset + 1] = 0;
    grey[offset + 2] = 0;
    const result = computePixelDiff(before, after);
    expect(pixel(result, 0, 0)).toEqual(defaultPixelDiffColors.removed);
    expect(pixel(result, 1, 0)).toEqual(defaultPixelDiffColors.added);
    expect(pixel(result, 2, 0)).toEqual(defaultPixelDiffColors.changed);
    expect(result.changedPixels).toBe(3);
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 3, height: 1 });
    expect(result.changedRatio).toBeCloseTo(3 / 8);
  });

  it("pads pages of different sizes with white", () => {
    const result = computePixelDiff(image(2, 2), image(3, 2, [[2, 1]]));
    expect(result.width).toBe(3);
    expect(result.changedPixels).toBe(1);
    expect(pixel(result, 2, 1)).toEqual(defaultPixelDiffColors.added);
  });

  it("ignores anti-aliasing below the threshold", () => {
    const before = image(1, 1);
    const after = image(1, 1);
    after.data[0] = 230;
    expect(computePixelDiff(before, after).changedPixels).toBe(0);
  });
});
