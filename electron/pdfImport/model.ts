/**
 * Geometry and content model shared by every stage of the PDF to LaTeX pipeline.
 *
 * All coordinates use a top-left origin with y increasing downwards and units of
 * PostScript points, so lines sort naturally in reading order. Glyph `y` is the
 * baseline, which is the anchor the layout and math stages compare against.
 */

export type MathFontRole =
  | "text"
  | "variable"
  | "symbol"
  | "extension"
  | "blackboard"
  | "calligraphic"
  | "fraktur"
  | "sansMath"
  | "monoMath";

export interface FontDescriptor {
  /** pdf.js loaded name, unique per document. */
  key: string;
  /** Raw PDF font name including any subset prefix. */
  rawName: string;
  /** Subset prefix and design size stripped, upper-cased. */
  family: string;
  bold: boolean;
  italic: boolean;
  monospace: boolean;
  smallCaps: boolean;
  serif: boolean;
  mathRole: MathFontRole;
  /** Design size parsed from Computer Modern style names (CMR10 -> 10). */
  designSize: number | null;
  /** Glyph space to text space scale, 0.001 for most fonts. */
  glyphScale: number;
}

export interface Glyph {
  /** Unicode text for the glyph, already repaired and de-ligatured. */
  text: string;
  x: number;
  /** Baseline position, text rise already applied. */
  y: number;
  width: number;
  /** Effective font size after the text matrix and CTM. */
  size: number;
  font: FontDescriptor;
  /** Text rise in points, positive is up. Non-zero marks explicit scripts. */
  rise: number;
  space: boolean;
  pageIndex: number;
}

export interface RuleSegment {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  thickness: number;
  pageIndex: number;
  horizontal: boolean;
  vertical: boolean;
}

export interface GraphicRegion {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "image" | "vector";
}

export interface PageContent {
  index: number;
  width: number;
  height: number;
  glyphs: Glyph[];
  rules: RuleSegment[];
  graphics: GraphicRegion[];
  /** True when the page carries drawing operations but no extractable text. */
  scanned: boolean;
}

export interface DocumentContent {
  pages: PageContent[];
  fonts: Map<string, FontDescriptor>;
  title: string;
  author: string;
  /** Producer string, used to detect TeX-generated PDFs. */
  producer: string;
  warnings: string[];
}

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function glyphTop(glyph: Glyph): number {
  return glyph.y - glyph.size * 0.75;
}

export function glyphBottom(glyph: Glyph): number {
  return glyph.y + glyph.size * 0.25;
}

export function glyphBox(glyph: Glyph): Box {
  return {
    left: glyph.x,
    right: glyph.x + glyph.width,
    top: glyphTop(glyph),
    bottom: glyphBottom(glyph),
  };
}

export function unionBox(boxes: Box[]): Box {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    left = Math.min(left, box.left);
    right = Math.max(right, box.right);
    top = Math.min(top, box.top);
    bottom = Math.max(bottom, box.bottom);
  }
  return { left, right, top, bottom };
}

export function glyphsBox(glyphs: Glyph[]): Box {
  return unionBox(glyphs.map(glyphBox));
}

export function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Most frequent value after rounding to `precision`, falling back to the median
 * when the distribution is flat. Used for body font size and leading.
 */
export function mode(values: number[], precision = 1): number {
  if (!values.length) {
    return 0;
  }
  const counts = new Map<number, number>();
  for (const value of values) {
    const bucket = Math.round(value / precision) * precision;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [bucket, count] of counts) {
    if (count > bestCount || (count === bestCount && bucket > best)) {
      best = bucket;
      bestCount = count;
    }
  }
  return bestCount > 1 ? best : median(values);
}
