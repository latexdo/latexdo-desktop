/**
 * Physical layout analysis: glyphs to lines, lines to columns, and removal of
 * running headers and footers.
 *
 * Lines are built from the full size glyphs first and the small ones are attached
 * afterwards, which keeps superscripts, subscripts and footnote marks on the line
 * they belong to instead of spawning phantom lines of their own. Column detection
 * looks for the vertical whitespace corridor that no line crosses, which is what
 * makes two column conference papers come out in reading order.
 */

import { isExtensionFont, isMathFont } from "./fonts.js";
import type { Glyph, PageContent, RuleSegment } from "./model.js";
import { median, mode } from "./model.js";

export interface TextLine {
  pageIndex: number;
  glyphs: Glyph[];
  baseline: number;
  /** Dominant point size on the line. */
  size: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  column: number;
  /** True when the line crosses a column boundary, as titles and wide tables do. */
  spanning: boolean;
}

export interface ColumnFrame {
  index: number;
  left: number;
  right: number;
}

export interface PageLayout {
  pageIndex: number;
  width: number;
  height: number;
  lines: TextLine[];
  columns: ColumnFrame[];
  bodyLeft: number;
  bodyRight: number;
  bodyTop: number;
  bodyBottom: number;
}

export interface DocumentStats {
  bodySize: number;
  bodyFontKey: string;
  /** Median baseline to baseline distance for consecutive body lines. */
  leading: number;
  columnCount: number;
  pageWidth: number;
  pageHeight: number;
  /** Median width of a text column, used to judge centring and indentation. */
  columnWidth: number;
}

function sizeOf(glyphs: Glyph[]): number {
  const sizes = glyphs
    .filter((glyph) => !glyph.space && !isExtensionFont(glyph.font))
    .map((glyph) => glyph.size);
  return sizes.length ? mode(sizes, 0.5) : 0;
}

function finalizeLine(pageIndex: number, glyphs: Glyph[]): TextLine {
  const sorted = [...glyphs].sort((a, b) => a.x - b.x);
  const dominantSize = sizeOf(sorted) || median(sorted.map((glyph) => glyph.size));
  const dominant = sorted.filter(
    (glyph) => !glyph.space && glyph.size >= dominantSize * 0.85,
  );
  const baselineSource = dominant.length ? dominant : sorted;
  return {
    pageIndex,
    glyphs: sorted,
    baseline: median(baselineSource.map((glyph) => glyph.y)),
    size: dominantSize,
    left: Math.min(...sorted.map((glyph) => glyph.x)),
    right: Math.max(...sorted.map((glyph) => glyph.x + glyph.width)),
    top: Math.min(...sorted.map((glyph) => glyph.y - glyph.size * 0.78)),
    bottom: Math.max(...sorted.map((glyph) => glyph.y + glyph.size * 0.26)),
    column: 0,
    spanning: false,
  };
}

/** Groups glyphs whose baselines are within `tolerance` of the running cluster. */
function clusterByBaseline(glyphs: Glyph[], tolerance: number): Glyph[][] {
  const sorted = [...glyphs].sort((a, b) => a.y - b.y || a.x - b.x);
  const clusters: Glyph[][] = [];
  let current: Glyph[] = [];
  let reference = 0;
  for (const glyph of sorted) {
    if (!current.length) {
      current = [glyph];
      reference = glyph.y;
      continue;
    }
    const localTolerance = tolerance > 0 ? tolerance : glyph.size * 0.35;
    if (Math.abs(glyph.y - reference) <= localTolerance) {
      current.push(glyph);
      // Track the cluster centre so a gently drifting baseline still coheres.
      reference = median(current.map((item) => item.y));
    } else {
      clusters.push(current);
      current = [glyph];
      reference = glyph.y;
    }
  }
  if (current.length) {
    clusters.push(current);
  }
  return clusters;
}

/** Share of a line's glyphs that come from a maths font. */
export function mathGlyphShare(line: TextLine): number {
  const glyphs = line.glyphs.filter((glyph) => !glyph.space && glyph.text);
  if (!glyphs.length) {
    return 0;
  }
  return glyphs.filter((glyph) => isMathFont(glyph.font)).length / glyphs.length;
}

/**
 * Rejoins the rows of a display formula.
 *
 * A summation's limits, a fraction's numerator and the contents of a radical are
 * all set far enough from the main baseline that ordinary line clustering treats
 * them as separate lines. Left alone they would be classified as separate
 * paragraphs and the formula would come out shredded. Two vertically adjacent
 * lines are rejoined when they overlap horizontally, at least one of them is
 * mostly maths, and either one of them is short or a drawn rule sits between them.
 * Full width prose never satisfies those conditions, even in a formula heavy
 * paragraph.
 */
export function mergeMathLines(
  lines: TextLine[],
  rules: RuleSegment[],
  bodySize: number,
  leading: number,
): TextLine[] {
  if (lines.length < 2) {
    return lines;
  }
  const textWidth = Math.max(
    bodySize * 10,
    ...lines.map((line) => line.right - line.left),
  );
  const horizontalRules = rules.filter((rule) => rule.horizontal);
  let current = [...lines].sort((a, b) => a.baseline - b.baseline);

  for (let pass = 0; pass < 6; pass += 1) {
    let merged = false;
    for (let index = 0; index < current.length - 1; index += 1) {
      const upper = current[index];
      const lower = current[index + 1];
      const overlap =
        Math.min(upper.right, lower.right) - Math.max(upper.left, lower.left);
      if (overlap <= 0) {
        continue;
      }
      const gap = lower.baseline - upper.baseline;
      const maxSize = Math.max(upper.size, lower.size);
      if (gap <= 0 || gap > maxSize * 1.9) {
        continue;
      }
      if (Math.max(mathGlyphShare(upper), mathGlyphShare(lower)) < 0.34) {
        continue;
      }
      const minWidth = Math.min(upper.right - upper.left, lower.right - lower.left);
      const ruleBetween = horizontalRules.some(
        (rule) =>
          rule.y1 > upper.baseline - upper.size * 0.9 &&
          rule.y1 < lower.baseline + lower.size * 0.1 &&
          Math.min(rule.x2, Math.min(upper.right, lower.right)) -
            Math.max(rule.x1, Math.max(upper.left, lower.left)) >
            0,
      );
      // Two successive lines of running text are a full leading apart. Parts of one
      // formula sit closer than that, unless a fraction bar separates them, which
      // is itself proof that they belong together.
      if (!ruleBetween && gap > leading * 0.94) {
        continue;
      }
      const shortEnough = minWidth < textWidth * 0.62;
      if (!ruleBetween && (!shortEnough || overlap < minWidth * 0.5)) {
        continue;
      }
      const combined = finalizeLine(upper.pageIndex, [
        ...upper.glyphs,
        ...lower.glyphs,
      ]);
      // Guard against a runaway merge swallowing a whole column.
      if (combined.bottom - combined.top > bodySize * 9) {
        continue;
      }
      current.splice(index, 2, combined);
      merged = true;
      index -= 1;
    }
    if (!merged) {
      break;
    }
    current = current.sort((a, b) => a.baseline - b.baseline);
  }

  return current;
}

/**
 * Builds text lines for one page. Small glyphs join the nearest line whose band
 * they fall inside, so scripts and footnote markers do not become their own lines.
 */
export function buildLines(page: PageContent, bodySize: number): TextLine[] {
  const glyphs = page.glyphs.filter((glyph) => glyph.text || glyph.space);
  if (!glyphs.length) {
    return [];
  }

  const pageSize = sizeOf(glyphs) || bodySize || 10;
  const dominantThreshold = pageSize * 0.78;
  const dominant = glyphs.filter(
    (glyph) => !glyph.space && glyph.size >= dominantThreshold,
  );
  const dominantSet = new Set(dominant);
  let remaining = glyphs.filter((glyph) => !dominantSet.has(glyph));

  let lines = clusterByBaseline(dominant, pageSize * 0.34).map((cluster) =>
    finalizeLine(page.index, cluster),
  );

  const attach = (candidates: Glyph[]): Glyph[] => {
    const leftovers: Glyph[] = [];
    for (const glyph of candidates) {
      let best: TextLine | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const line of lines) {
        // Scripts sit above or below the baseline; allow a generous band but
        // require horizontal proximity so unrelated columns never capture them.
        const withinBand =
          glyph.y >= line.baseline - line.size * 0.85 &&
          glyph.y <= line.baseline + line.size * 0.55;
        if (!withinBand) {
          continue;
        }
        const slack = line.size * 2.5;
        if (glyph.x + glyph.width < line.left - slack || glyph.x > line.right + slack) {
          continue;
        }
        const distance = Math.abs(glyph.y - line.baseline);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = line;
        }
      }
      if (best) {
        best.glyphs.push(glyph);
      } else {
        leftovers.push(glyph);
      }
    }
    return leftovers;
  };

  remaining = attach(remaining);

  // Whatever is left is genuinely small standalone text such as a footnote block.
  let guard = 0;
  while (remaining.length && guard < 4) {
    guard += 1;
    const smallLines = clusterByBaseline(
      remaining.filter((glyph) => !glyph.space),
      0,
    )
      .filter((cluster) => cluster.length > 0)
      .map((cluster) => finalizeLine(page.index, cluster));
    if (!smallLines.length) {
      break;
    }
    const known = new Set(smallLines.flatMap((line) => line.glyphs));
    lines = [...lines, ...smallLines];
    remaining = attach(remaining.filter((glyph) => !known.has(glyph)));
  }

  return lines
    .map((line) => finalizeLine(page.index, line.glyphs))
    .sort((a, b) => a.baseline - b.baseline || a.left - b.left);
}

/**
 * Finds vertical whitespace corridors that no line crosses. Returns the split
 * positions, so an empty result means a single column.
 */
export function detectColumnSplits(
  lines: TextLine[],
  pageWidth: number,
  bodySize: number,
): number[] {
  const candidates = lines.filter((line) => line.right - line.left > bodySize);
  if (candidates.length < 12) {
    return [];
  }

  const left = Math.min(...candidates.map((line) => line.left));
  const right = Math.max(...candidates.map((line) => line.right));
  const span = right - left;
  if (span < pageWidth * 0.4) {
    return [];
  }

  const binSize = 2;
  const binCount = Math.ceil(span / binSize) + 1;
  const coverage = new Array<number>(binCount).fill(0);
  for (const line of candidates) {
    const from = Math.max(0, Math.floor((line.left - left) / binSize));
    const to = Math.min(binCount - 1, Math.ceil((line.right - left) / binSize));
    for (let bin = from; bin <= to; bin += 1) {
      coverage[bin] += 1;
    }
  }

  // A gutter is a run of bins crossed by almost no line, wide enough to be a real
  // margin rather than inter-word space, and away from the outer margins.
  const crossingLimit = Math.max(1, Math.floor(candidates.length * 0.04));
  const minGutter = Math.max(8, bodySize * 0.9);
  const splits: number[] = [];
  let runStart = -1;
  for (let bin = 0; bin < binCount; bin += 1) {
    const empty = coverage[bin] <= crossingLimit;
    if (empty && runStart < 0) {
      runStart = bin;
    }
    if ((!empty || bin === binCount - 1) && runStart >= 0) {
      const runEnd = empty ? bin : bin - 1;
      const startX = left + runStart * binSize;
      const endX = left + (runEnd + 1) * binSize;
      const width = endX - startX;
      const centre = (startX + endX) / 2;
      const relative = (centre - left) / span;
      if (width >= minGutter && relative > 0.2 && relative < 0.8) {
        splits.push(centre);
      }
      runStart = -1;
    }
  }

  // Two and three column layouts are the only ones worth supporting; more usually
  // means a table was mistaken for a gutter.
  return splits.length <= 2 ? splits : [];
}

function assignColumns(lines: TextLine[], columns: ColumnFrame[]): void {
  for (const line of lines) {
    if (columns.length < 2) {
      line.column = 0;
      line.spanning = false;
      continue;
    }
    const overlapping = columns.filter(
      (column) =>
        Math.min(line.right, column.right) - Math.max(line.left, column.left) >
        (line.right - line.left) * 0.12,
    );
    if (overlapping.length > 1) {
      line.spanning = true;
      line.column = overlapping[0].index;
      continue;
    }
    const centre = (line.left + line.right) / 2;
    let best = columns[0];
    for (const column of columns) {
      const distance =
        centre < column.left
          ? column.left - centre
          : centre > column.right
            ? centre - column.right
            : 0;
      const bestDistance =
        centre < best.left
          ? best.left - centre
          : centre > best.right
            ? centre - best.right
            : 0;
      if (distance < bestDistance) {
        best = column;
      }
    }
    line.column = best.index;
    line.spanning = false;
  }
}

/**
 * Orders lines the way a reader would: spanning material in vertical order, and
 * the column content between two spanning elements read column by column.
 */
export function orderLines(lines: TextLine[], columnCount: number): TextLine[] {
  if (columnCount < 2) {
    return [...lines].sort((a, b) => a.baseline - b.baseline || a.left - b.left);
  }

  const sorted = [...lines].sort((a, b) => a.baseline - b.baseline || a.left - b.left);
  const result: TextLine[] = [];
  let band: TextLine[] = [];

  const flushBand = () => {
    if (!band.length) {
      return;
    }
    const byColumn = new Map<number, TextLine[]>();
    for (const line of band) {
      const bucket = byColumn.get(line.column);
      if (bucket) {
        bucket.push(line);
      } else {
        byColumn.set(line.column, [line]);
      }
    }
    for (const column of [...byColumn.keys()].sort((a, b) => a - b)) {
      result.push(
        ...byColumn
          .get(column)!
          .sort((a, b) => a.baseline - b.baseline || a.left - b.left),
      );
    }
    band = [];
  };

  for (const line of sorted) {
    if (line.spanning) {
      flushBand();
      result.push(line);
    } else {
      band.push(line);
    }
  }
  flushBand();
  return result;
}

export function computeDocumentStats(
  pages: PageContent[],
  pageLines: TextLine[][],
): DocumentStats {
  const sizes: number[] = [];
  const fontCounts = new Map<string, number>();
  for (const page of pages) {
    for (const glyph of page.glyphs) {
      if (glyph.space || isExtensionFont(glyph.font)) {
        continue;
      }
      sizes.push(glyph.size);
      fontCounts.set(glyph.font.key, (fontCounts.get(glyph.font.key) ?? 0) + 1);
    }
  }

  const bodySize = sizes.length ? mode(sizes, 0.25) : 10;
  let bodyFontKey = "";
  let bodyFontCount = 0;
  for (const [key, count] of fontCounts) {
    if (count > bodyFontCount) {
      bodyFontCount = count;
      bodyFontKey = key;
    }
  }

  const leadings: number[] = [];
  const columnWidths: number[] = [];
  for (const lines of pageLines) {
    const bodyLines = lines.filter(
      (line) => Math.abs(line.size - bodySize) < bodySize * 0.12,
    );
    for (let i = 1; i < bodyLines.length; i += 1) {
      const delta = bodyLines[i].baseline - bodyLines[i - 1].baseline;
      if (delta > bodySize * 0.6 && delta < bodySize * 2.6) {
        leadings.push(delta);
      }
    }
    for (const line of bodyLines) {
      columnWidths.push(line.right - line.left);
    }
  }

  const columnCounts = pageLines.map(
    (lines, index) =>
      detectColumnSplits(lines, pages[index]?.width ?? 612, bodySize).length + 1,
  );

  return {
    bodySize,
    bodyFontKey,
    leading: leadings.length ? median(leadings) : bodySize * 1.2,
    columnCount: columnCounts.length ? mode(columnCounts, 1) : 1,
    pageWidth: pages[0]?.width ?? 612,
    pageHeight: pages[0]?.height ?? 792,
    columnWidth: columnWidths.length
      ? Math.max(...quantiles(columnWidths, [0.9]))
      : 400,
  };
}

function quantiles(values: number[], points: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return points.map((point) => {
    const index = Math.min(sorted.length - 1, Math.floor(point * sorted.length));
    return sorted[index] ?? 0;
  });
}

/** Plain text of a line with inferred word spaces. Used only by classifiers. */
export function lineText(line: TextLine): string {
  let result = "";
  let previous: Glyph | null = null;
  for (const glyph of line.glyphs) {
    if (glyph.space) {
      if (result && !result.endsWith(" ")) {
        result += " ";
      }
      previous = glyph;
      continue;
    }
    if (previous && !previous.space) {
      const gap = glyph.x - (previous.x + previous.width);
      if (gap > Math.max(previous.size, glyph.size) * 0.2 && !result.endsWith(" ")) {
        result += " ";
      }
    }
    result += glyph.text;
    previous = glyph;
  }
  return result.trim();
}

/**
 * Drops running headers, footers and page numbers by finding text that recurs at
 * the same vertical position across pages.
 */
export function removeRunningHeadFoot(
  pageLines: TextLine[][],
  stats: DocumentStats,
): { pageLines: TextLine[][]; removed: number } {
  if (pageLines.length < 3) {
    return { pageLines, removed: 0 };
  }

  const signatures = new Map<string, Set<number>>();
  const zone = (line: TextLine, height: number): "head" | "foot" | null => {
    if (line.baseline < height * 0.09) {
      return "head";
    }
    if (line.baseline > height * 0.91) {
      return "foot";
    }
    return null;
  };

  pageLines.forEach((lines, pageIndex) => {
    for (const line of lines) {
      const where = zone(line, stats.pageHeight);
      if (!where) {
        continue;
      }
      const text = lineText(line);
      if (!text) {
        continue;
      }
      // Digits vary from page to page, so normalise them away.
      const signature = `${where}:${text.replace(/\d+/g, "#").toLowerCase()}`;
      const pages = signatures.get(signature);
      if (pages) {
        pages.add(pageIndex);
      } else {
        signatures.set(signature, new Set([pageIndex]));
      }
    }
  });

  const repeated = new Set(
    [...signatures.entries()]
      .filter(([, pages]) => pages.size >= Math.max(3, pageLines.length * 0.4))
      .map(([signature]) => signature),
  );

  let removed = 0;
  const result = pageLines.map((lines, pageIndex) =>
    lines.filter((line) => {
      const where = zone(line, stats.pageHeight);
      if (!where) {
        return true;
      }
      const text = lineText(line);
      if (!text) {
        return true;
      }
      const signature = `${where}:${text.replace(/\d+/g, "#").toLowerCase()}`;
      const bareNumber = /^[ivxlcdm]{1,7}$|^\d{1,4}$/i.test(text);
      // A bare page number is safe to drop from the first page too.
      if (repeated.has(signature) || (bareNumber && pageIndex >= 0)) {
        removed += 1;
        return false;
      }
      return true;
    }),
  );

  return { pageLines: result, removed };
}

export function layoutPages(pages: PageContent[]): {
  layouts: PageLayout[];
  stats: DocumentStats;
  removedHeadFoot: number;
} {
  const preliminarySizes: number[] = [];
  for (const page of pages) {
    for (const glyph of page.glyphs) {
      if (!glyph.space && !isExtensionFont(glyph.font)) {
        preliminarySizes.push(glyph.size);
      }
    }
  }
  const preliminaryBody = preliminarySizes.length ? mode(preliminarySizes, 0.25) : 10;

  const rawLines = pages.map((page) => buildLines(page, preliminaryBody));
  const preliminaryStats = computeDocumentStats(pages, rawLines);
  // Formula rows can only be rejoined once the normal leading is known, since that
  // is what distinguishes them from ordinary consecutive lines of text.
  const mergedLines = rawLines.map((lines, index) =>
    mergeMathLines(
      lines,
      pages[index].rules,
      preliminaryStats.bodySize,
      preliminaryStats.leading,
    ),
  );
  const stats = computeDocumentStats(pages, mergedLines);
  const cleaned = removeRunningHeadFoot(mergedLines, stats);

  const layouts = pages.map((page, index) => {
    const lines = cleaned.pageLines[index] ?? [];
    const splits = detectColumnSplits(lines, page.width, stats.bodySize);
    const bounds = lines.length
      ? {
          left: Math.min(...lines.map((line) => line.left)),
          right: Math.max(...lines.map((line) => line.right)),
          top: Math.min(...lines.map((line) => line.top)),
          bottom: Math.max(...lines.map((line) => line.bottom)),
        }
      : { left: 72, right: page.width - 72, top: 72, bottom: page.height - 72 };

    const edges = [bounds.left, ...splits, bounds.right];
    const columns: ColumnFrame[] = [];
    for (let i = 0; i < edges.length - 1; i += 1) {
      columns.push({ index: i, left: edges[i], right: edges[i + 1] });
    }
    assignColumns(lines, columns);

    return {
      pageIndex: page.index,
      width: page.width,
      height: page.height,
      lines: orderLines(lines, columns.length),
      columns,
      bodyLeft: bounds.left,
      bodyRight: bounds.right,
      bodyTop: bounds.top,
      bodyBottom: bounds.bottom,
    };
  });

  return { layouts, stats, removedHeadFoot: cleaned.removed };
}
