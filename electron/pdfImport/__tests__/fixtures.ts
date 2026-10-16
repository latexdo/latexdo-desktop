import { describeFont } from "../fonts.js";
import type { Glyph, PageContent } from "../model.js";
import { buildLines, type TextLine, type DocumentStats } from "../layout.js";
import type { InlineContext } from "../inline.js";

export function glyph(
  text: string,
  x = 50,
  y = 100,
  options: Partial<Glyph> = {},
): Glyph {
  return {
    text,
    x,
    y,
    width: 5,
    size: 10,
    font: describeFont("body", "CMR10", 0.001),
    rise: 0,
    space: text === " ",
    pageIndex: 0,
    ...options,
  };
}
export function glyphs(
  text: string,
  x = 50,
  y = 100,
  options: Partial<Glyph> = {},
): Glyph[] {
  return [...text].map((text, i) => glyph(text, x + i * 5, y, options));
}
export function page(
  items: Glyph[] = [],
  options: Partial<PageContent> = {},
): PageContent {
  return {
    index: 0,
    width: 612,
    height: 792,
    glyphs: items,
    rules: [],
    graphics: [],
    scanned: false,
    ...options,
  };
}
export function line(
  text: string,
  x = 50,
  y = 100,
  options: Partial<Glyph> = {},
): TextLine {
  return buildLines(page(glyphs(text, x, y, options)), options.size ?? 10)[0];
}
export function context(): InlineContext {
  return {
    bodySize: 10,
    rulesByPage: [[]],
    math: { rules: [], baseSize: 10, packages: new Set(), warnings: [] },
  };
}
export const stats: DocumentStats = {
  bodySize: 10,
  bodyFontKey: "body",
  leading: 12,
  columnCount: 1,
  pageWidth: 612,
  pageHeight: 792,
  columnWidth: 512,
};
