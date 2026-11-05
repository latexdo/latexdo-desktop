/**
 * Pixel comparison of two rendered pages, for changes text cannot show:
 * figures, tables, spacing and layout.
 */

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface PixelDiffResult extends RgbaImage {
  changedPixels: number;
  /** Share of the page's pixels that differ (0–1). */
  changedRatio: number;
  /** Smallest box holding every changed pixel, in pixels, or null. */
  bounds: { x: number; y: number; width: number; height: number } | null;
}

export interface PixelDiffColors {
  removed: [number, number, number];
  added: [number, number, number];
  changed: [number, number, number];
}

export const defaultPixelDiffColors: PixelDiffColors = {
  removed: [220, 38, 38],
  added: [22, 163, 74],
  changed: [217, 119, 6],
};

function luminance(data: Uint8ClampedArray, offset: number): number {
  // Transparent pixels are the white page.
  const alpha = data[offset + 3] / 255;
  const r = data[offset] * alpha + 255 * (1 - alpha);
  const g = data[offset + 1] * alpha + 255 * (1 - alpha);
  const b = data[offset + 2] * alpha + 255 * (1 - alpha);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function readPixel(image: RgbaImage, x: number, y: number): number {
  if (x >= image.width || y >= image.height) return 255;
  return luminance(image.data, (y * image.width + x) * 4);
}

function colorDistance(a: RgbaImage, b: RgbaImage, x: number, y: number): number {
  const inA = x < a.width && y < a.height;
  const inB = x < b.width && y < b.height;
  if (!inA && !inB) return 0;
  const pa = inA ? (y * a.width + x) * 4 : -1;
  const pb = inB ? (y * b.width + x) * 4 : -1;
  let distance = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    const va = pa === -1 ? 255 : a.data[pa + channel];
    const vb = pb === -1 ? 255 : b.data[pb + channel];
    distance = Math.max(distance, Math.abs(va - vb));
  }
  return distance;
}

/**
 * A composite of the two pages: unchanged ink is faded grey, ink only in the
 * original is red, ink only in the modified version is green, and ink in both
 * that changed colour is amber. Pages of different sizes are compared on the
 * larger canvas with white padding.
 */
export function computePixelDiff(
  original: RgbaImage,
  modified: RgbaImage,
  options: { threshold?: number; colors?: PixelDiffColors } = {},
): PixelDiffResult {
  const threshold = options.threshold ?? 48;
  const colors = options.colors ?? defaultPixelDiffColors;
  const width = Math.max(original.width, modified.width);
  const height = Math.max(original.height, modified.height);
  const data = new Uint8ClampedArray(width * height * 4);
  let changedPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const before = readPixel(original, x, y);
      const after = readPixel(modified, x, y);
      const distance = colorDistance(original, modified, x, y);
      if (distance <= threshold) {
        // Unchanged: a light grey rendering of the page for orientation.
        const shade = 255 - (255 - after) * 0.28;
        data[offset] = shade;
        data[offset + 1] = shade;
        data[offset + 2] = shade;
        data[offset + 3] = 255;
        continue;
      }
      changedPixels += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      const inkBefore = before < 200;
      const inkAfter = after < 200;
      const color =
        inkBefore && !inkAfter
          ? colors.removed
          : inkAfter && !inkBefore
            ? colors.added
            : colors.changed;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }

  return {
    width,
    height,
    data,
    changedPixels,
    changedRatio: width * height ? changedPixels / (width * height) : 0,
    bounds:
      maxX === -1
        ? null
        : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}
