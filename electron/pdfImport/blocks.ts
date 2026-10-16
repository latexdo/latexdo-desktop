/**
 * Logical structure recovery: from ordered lines to a document outline.
 *
 * Floats are resolved first. A caption such as "Figure 3:" tells us artwork or a
 * grid sits next to it, and every line inside that artwork is an axis label rather
 * than prose, so those lines have to be claimed before paragraph grouping runs or
 * they turn into nonsense sentences. What is left is grouped into paragraphs using
 * vertical gaps, indentation, and the classic rule that a line stopping well short
 * of the column edge ends a paragraph. Each group is then classified.
 */

import type { InlineContext } from "./inline.js";
import { renderInline } from "./inline.js";
import type { DocumentStats, PageLayout, TextLine } from "./layout.js";
import { lineText } from "./layout.js";
import { isMathFont } from "./fonts.js";
import { reconstructMath, isSafeMath } from "./math.js";
import type { Glyph, GraphicRegion, PageContent, RuleSegment } from "./model.js";
import { median } from "./model.js";
import { reconstructTable, tableLikelihood } from "./tables.js";

export interface FigureRegion {
  pageIndex: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Block =
  | { kind: "title"; latex: string }
  | { kind: "authors"; latex: string }
  | { kind: "abstract"; latex: string }
  | {
      kind: "section";
      level: number;
      latex: string;
      numbering: string | null;
      label: string | null;
      starred: boolean;
    }
  | { kind: "paragraph"; latex: string }
  | {
      kind: "equation";
      latex: string;
      numbering: string | null;
      label: string | null;
      multiline: boolean;
      confident: boolean;
    }
  | { kind: "list"; ordered: boolean; items: string[]; level: number }
  | {
      kind: "figure";
      caption: string;
      label: string | null;
      numbering: string | null;
      region: FigureRegion | null;
      spanning: boolean;
    }
  | {
      kind: "table";
      caption: string;
      label: string | null;
      numbering: string | null;
      body: string | null;
      spanning: boolean;
    }
  | { kind: "theorem"; environment: string; title: string; latex: string }
  | { kind: "verbatim"; lines: string[] }
  | { kind: "footnote"; marker: string; latex: string }
  | { kind: "references"; lines: TextLine[] };

export interface LabelMaps {
  sections: Map<string, string>;
  figures: Map<string, string>;
  tables: Map<string, string>;
  equations: Map<string, string>;
}

export interface StructureResult {
  blocks: Block[];
  labels: LabelMaps;
  title: string;
  authors: string;
  /** Formulas whose reconstruction the user should double check. */
  lowConfidenceMath: number;
  figureCount: number;
  tableCount: number;
  usedPackages: Set<string>;
}

const figureCaptionPattern =
  /^(?:fig(?:ure)?|abb(?:ildung)?)\.?\s*(\d+(?:[.:]\d+)*|[ivxlcdm]+)\s*[.:)\-–—]?\s*/i;
const tableCaptionPattern =
  /^(?:tab(?:le|elle)?)\.?\s*(\d+(?:[.:]\d+)*|[ivxlcdm]+)\s*[.:)\-–—]?\s*/i;
const sectionNumberPattern = /^(\d+(?:\.\d+)*)\.?\s+(\S.*)$/;
const datePattern =
  /^(?:\d{1,2}\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}$|^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$|^(?:19|20)\d{2}$/i;
const theoremPattern =
  /^(theorem|lemma|proposition|corollary|definition|remark|example|claim|conjecture|proof|assumption|observation|problem|exercise)\s*(\d+(?:\.\d+)*)?\s*[.:)]?\s*/i;
const unnumberedHeadings = new Set([
  "abstract",
  "acknowledgment",
  "acknowledgments",
  "acknowledgement",
  "acknowledgements",
  "references",
  "bibliography",
  "appendix",
  "appendices",
  "keywords",
  "index terms",
  "supplementary material",
]);
const bulletCharacters = new Set([
  "•",
  "◦",
  "‣",
  "▪",
  "▫",
  "–",
  "—",
  "-",
  "∗",
  "*",
  "·",
  "",
  "",
]);

function sanitizeLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9.:-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Removes a font command that wraps the whole string. Headings and titles are
 * already bold by virtue of being headings, so repeating it in the source is noise.
 */
function stripOuterStyle(latex: string): string {
  let result = latex.trim();
  for (let pass = 0; pass < 4; pass += 1) {
    const match = /^\\(textbf|textit|emph|textsc|textrm|texttt)\{([\s\S]*)\}$/.exec(
      result,
    );
    if (!match) {
      break;
    }
    // Only unwrap when the opening brace really closes at the very end.
    let depth = 0;
    let balanced = true;
    const body = match[2];
    for (let index = 0; index < body.length; index += 1) {
      if (body[index] === "\\") {
        index += 1;
        continue;
      }
      if (body[index] === "{") {
        depth += 1;
      } else if (body[index] === "}") {
        depth -= 1;
        if (depth < 0) {
          balanced = false;
          break;
        }
      }
    }
    if (!balanced || depth !== 0) {
      break;
    }
    result = body.trim();
  }
  return result;
}

function romanToArabic(value: string): string {
  const numerals: Record<string, number> = {
    i: 1,
    v: 5,
    x: 10,
    l: 50,
    c: 100,
    d: 500,
    m: 1000,
  };
  const lower = value.toLowerCase();
  if (!/^[ivxlcdm]+$/.test(lower)) {
    return value;
  }
  let total = 0;
  for (let index = 0; index < lower.length; index += 1) {
    const current = numerals[lower[index]];
    const next = numerals[lower[index + 1]] ?? 0;
    total += current < next ? -current : current;
  }
  return String(total);
}

function mathShare(line: TextLine): number {
  const glyphs = line.glyphs.filter((glyph) => !glyph.space && glyph.text);
  if (!glyphs.length) {
    return 0;
  }
  const math = glyphs.filter((glyph) => isMathFont(glyph.font)).length;
  return math / glyphs.length;
}

function monospaceShare(line: TextLine): number {
  const glyphs = line.glyphs.filter((glyph) => !glyph.space && glyph.text);
  if (!glyphs.length) {
    return 0;
  }
  return glyphs.filter((glyph) => glyph.font.monospace).length / glyphs.length;
}

function boldShare(line: TextLine): number {
  const glyphs = line.glyphs.filter((glyph) => !glyph.space && glyph.text);
  if (!glyphs.length) {
    return 0;
  }
  return glyphs.filter((glyph) => glyph.font.bold).length / glyphs.length;
}

function columnOf(layout: PageLayout, line: TextLine): { left: number; right: number } {
  const column = layout.columns[line.column] ?? {
    left: layout.bodyLeft,
    right: layout.bodyRight,
  };
  return line.spanning
    ? { left: layout.bodyLeft, right: layout.bodyRight }
    : { left: column.left, right: column.right };
}

/**
 * Locates the artwork that belongs to a caption and returns its box, or null when
 * the caption has no artwork next to it.
 */
function findFigureRegion(
  caption: TextLine,
  layout: PageLayout,
  page: PageContent,
  stats: DocumentStats,
): FigureRegion | null {
  const column = columnOf(layout, caption);
  const horizontallyRelevant = (region: GraphicRegion): boolean =>
    Math.min(region.x + region.width, column.right) - Math.max(region.x, column.left) >
    Math.min(region.width, column.right - column.left) * 0.25;

  const above = page.graphics.filter(
    (region) =>
      horizontallyRelevant(region) &&
      region.y + region.height <= caption.top + stats.bodySize * 0.6 &&
      region.y > caption.top - stats.pageHeight * 0.85,
  );
  const below = page.graphics.filter(
    (region) =>
      horizontallyRelevant(region) &&
      region.y >= caption.bottom - stats.bodySize * 0.6 &&
      region.y < caption.bottom + stats.pageHeight * 0.85,
  );

  const chosen = above.length >= below.length ? above : below;
  if (!chosen.length) {
    return null;
  }

  // Keep the artwork nearest the caption and everything that touches it, so a plot
  // built from many small paths becomes one region.
  const sorted = [...chosen].sort(
    (a, b) => Math.abs(a.y - caption.baseline) - Math.abs(b.y - caption.baseline),
  );
  let box = {
    left: sorted[0].x,
    top: sorted[0].y,
    right: sorted[0].x + sorted[0].width,
    bottom: sorted[0].y + sorted[0].height,
  };
  let grew = true;
  while (grew) {
    grew = false;
    for (const region of sorted) {
      const overlaps =
        region.x < box.right + stats.bodySize * 2 &&
        region.x + region.width > box.left - stats.bodySize * 2 &&
        region.y < box.bottom + stats.bodySize * 2.5 &&
        region.y + region.height > box.top - stats.bodySize * 2.5;
      if (!overlaps) {
        continue;
      }
      const next = {
        left: Math.min(box.left, region.x),
        top: Math.min(box.top, region.y),
        right: Math.max(box.right, region.x + region.width),
        bottom: Math.max(box.bottom, region.y + region.height),
      };
      if (
        next.left !== box.left ||
        next.top !== box.top ||
        next.right !== box.right ||
        next.bottom !== box.bottom
      ) {
        box = next;
        grew = true;
      }
    }
  }

  // Include text that sits inside the artwork, such as axis tick labels.
  for (const line of layout.lines) {
    if (line === caption) {
      continue;
    }
    const inside =
      line.left > box.left - stats.bodySize * 1.5 &&
      line.right < box.right + stats.bodySize * 1.5 &&
      line.baseline > box.top - stats.bodySize * 0.8 &&
      line.baseline < box.bottom + stats.bodySize * 0.8;
    if (inside) {
      box = {
        left: Math.min(box.left, line.left),
        top: Math.min(box.top, line.top),
        right: Math.max(box.right, line.right),
        bottom: Math.max(box.bottom, line.bottom),
      };
    }
  }

  const width = box.right - box.left;
  const height = box.bottom - box.top;
  if (width < stats.bodySize * 2 || height < stats.bodySize * 1.5) {
    return null;
  }

  const pad = 2;
  return {
    pageIndex: page.index,
    left: Math.max(0, box.left - pad),
    top: Math.max(0, box.top - pad),
    right: Math.min(layout.width, box.right + pad),
    bottom: Math.min(layout.height, box.bottom + pad),
  };
}

/**
 * Returns the lines bracketed by the horizontal rules nearest a table caption.
 * Empty when the table is unruled, in which case the caller falls back to
 * whitespace analysis.
 */
function collectRuledTableBody(
  caption: TextLine,
  layout: PageLayout,
  page: PageContent,
  stats: DocumentStats,
  claimed: Set<TextLine>,
): TextLine[] {
  const column = columnOf(layout, caption);
  const columnWidth = column.right - column.left;
  const candidates = page.rules.filter(
    (rule) =>
      rule.horizontal &&
      rule.x2 - rule.x1 > columnWidth * 0.35 &&
      Math.min(rule.x2, column.right) - Math.max(rule.x1, column.left) >
        (rule.x2 - rule.x1) * 0.6 &&
      Math.abs(rule.y1 - caption.baseline) < stats.pageHeight * 0.6,
  );
  if (candidates.length < 2) {
    return [];
  }

  // Take the run of rules adjacent to the caption: consecutive rules belonging to
  // one table are never further apart than a few lines of the table itself.
  const sorted = [...candidates].sort((a, b) => a.y1 - b.y1);
  const nearest = sorted.reduce((best, rule) =>
    Math.abs(rule.y1 - caption.baseline) < Math.abs(best.y1 - caption.baseline)
      ? rule
      : best,
  );
  let firstIndex = sorted.indexOf(nearest);
  let lastIndex = firstIndex;
  const maxRuleGap = Math.max(stats.leading * 14, stats.pageHeight * 0.35);
  while (
    firstIndex > 0 &&
    sorted[firstIndex].y1 - sorted[firstIndex - 1].y1 < maxRuleGap
  ) {
    firstIndex -= 1;
  }
  while (
    lastIndex < sorted.length - 1 &&
    sorted[lastIndex + 1].y1 - sorted[lastIndex].y1 < maxRuleGap
  ) {
    lastIndex += 1;
  }
  const top = sorted[firstIndex].y1;
  const bottom = sorted[lastIndex].y1;
  if (bottom - top < stats.bodySize) {
    return [];
  }

  return layout.lines.filter(
    (line) =>
      !claimed.has(line) &&
      line.baseline > top - stats.bodySize * 0.3 &&
      line.baseline < bottom + stats.bodySize * 0.3 &&
      line.right > column.left &&
      line.left < column.right,
  );
}

/** Groups consecutive lines into paragraph sized units. */
function groupLines(
  layout: PageLayout,
  lines: TextLine[],
  stats: DocumentStats,
): TextLine[][] {
  const groups: TextLine[][] = [];
  let current: TextLine[] = [];

  const flush = () => {
    if (current.length) {
      groups.push(current);
      current = [];
    }
  };

  for (const line of lines) {
    if (!current.length) {
      current = [line];
      continue;
    }
    const previous = current[current.length - 1];
    const column = columnOf(layout, line);
    const previousColumn = columnOf(layout, previous);
    const gap = line.baseline - previous.baseline;
    const leading = Math.max(stats.leading, line.size * 1.05);

    let split = false;
    if (line.column !== previous.column || line.spanning !== previous.spanning) {
      split = true;
    } else if (listMarker(line)) {
      // Every bullet or number starts its own item.
      split = true;
    } else if (gap > leading * 1.42 || gap < 0) {
      split = true;
    } else if (
      Math.abs(line.size - previous.size) >
      Math.max(previous.size, 1) * 0.09
    ) {
      split = true;
    } else if (
      // A short previous line followed by a line starting at the margin closes the
      // paragraph. This is what makes justified text split correctly.
      previous.right < previousColumn.right - previous.size * 1.8 &&
      line.left < column.left + line.size * 0.6
    ) {
      split = true;
    } else if (line.left > column.left + line.size * 0.8 && current.length > 1) {
      // An indent partway through a block starts a new paragraph.
      const bodyLeft = median(current.map((item) => item.left));
      if (line.left > bodyLeft + line.size * 0.8) {
        split = true;
      }
    }

    if (split) {
      flush();
      current = [line];
    } else {
      current.push(line);
    }
  }
  flush();
  return groups;
}

interface HeadingCandidate {
  group: TextLine[];
  size: number;
  bold: boolean;
  numbering: string | null;
  text: string;
}

function headingCandidate(
  group: TextLine[],
  stats: DocumentStats,
  layout: PageLayout,
): HeadingCandidate | null {
  if (group.length > 3) {
    return null;
  }
  const text = group.map(lineText).join(" ").trim();
  if (!text || text.length > 140) {
    return null;
  }
  const size = median(group.map((line) => line.size));
  // Numbered footnotes resemble section numbers, but their smaller type and
  // position at the foot of the column distinguish them from headings.
  if (
    size < stats.bodySize * 0.92 &&
    group[0].baseline > layout.height * 0.72 &&
    /^[\d*†‡§¶]/.test(text)
  ) {
    return null;
  }
  const bold = boldShare(group[0]) > 0.6;
  const larger = size > stats.bodySize * 1.06;
  const numbered = sectionNumberPattern.exec(text);
  const known = unnumberedHeadings.has(text.toLowerCase().replace(/[.:]$/, ""));
  const allCaps = /^[^a-z]{3,}$/.test(text) && /[A-Z]{2,}/.test(text);
  const column = columnOf(layout, group[0]);
  const shortLine =
    group[group.length - 1].right < column.right - stats.bodySize * 2 ||
    group.length === 1;
  const endsLikeSentence = /[.;,]$/.test(text) && !numbered;

  if (mathShare(group[0]) > 0.5) {
    return null;
  }
  const looksLikeHeading =
    (numbered && (bold || larger || shortLine)) ||
    known ||
    (larger && shortLine && !endsLikeSentence) ||
    (bold && shortLine && !endsLikeSentence && text.length < 80) ||
    (allCaps && shortLine && text.length < 80);

  if (!looksLikeHeading) {
    return null;
  }

  return {
    group,
    size,
    bold,
    numbering: numbered ? numbered[1] : null,
    text: numbered ? numbered[2] : text,
  };
}

/** Detects a display equation tag such as `(3)` at the outer edge of the column. */
function extractEquationTag(
  group: TextLine[],
  layout: PageLayout,
  stats: DocumentStats,
): { numbering: string | null; glyphs: Glyph[] } {
  const glyphs = group.flatMap((line) => line.glyphs);
  const last = group[group.length - 1];
  const column = columnOf(layout, last);
  const tagGlyphs: Glyph[] = [];

  for (const line of group) {
    const trailing: Glyph[] = [];
    const meaningful = line.glyphs.filter((glyph) => !glyph.space && glyph.text);
    for (let index = meaningful.length - 1; index >= 0; index -= 1) {
      trailing.unshift(meaningful[index]);
      if (meaningful[index].text === "(") {
        break;
      }
      if (trailing.length > 12) {
        break;
      }
    }
    const text = trailing.map((glyph) => glyph.text).join("");
    const matches = /^\((\d+(?:\.\d+)*[a-z]?|[A-Z]?\.?\d+[a-z]?)\)$/.test(text);
    const atEdge =
      trailing.length > 0 &&
      trailing[trailing.length - 1].x + trailing[trailing.length - 1].width >
        column.right - stats.bodySize * 2.2;
    const separated =
      trailing.length > 0 &&
      meaningful.length > trailing.length &&
      trailing[0].x -
        (meaningful[meaningful.length - trailing.length - 1].x +
          meaningful[meaningful.length - trailing.length - 1].width) >
        stats.bodySize * 1.2;
    if (matches && atEdge && separated) {
      tagGlyphs.push(...trailing);
    }
  }

  if (!tagGlyphs.length) {
    return { numbering: null, glyphs };
  }
  const tagSet = new Set(tagGlyphs);
  const numbering = tagGlyphs
    .map((glyph) => glyph.text)
    .join("")
    .replace(/[()]/g, "");
  return {
    numbering,
    glyphs: glyphs.filter((glyph) => !tagSet.has(glyph)),
  };
}

function listMarker(
  line: TextLine,
): { ordered: boolean; markerGlyphs: number; label: string } | null {
  const meaningful = line.glyphs.filter((glyph) => !glyph.space && glyph.text);
  if (!meaningful.length) {
    return null;
  }
  if (bulletCharacters.has(meaningful[0].text) && meaningful.length > 1) {
    const gap = meaningful[1].x - (meaningful[0].x + meaningful[0].width);
    if (gap > meaningful[0].size * 0.12) {
      return { ordered: false, markerGlyphs: 1, label: meaningful[0].text };
    }
  }

  // Enumerations: 1. / 1) / (1) / a) / (a) / i.
  let consumed = 0;
  let label = "";
  const limit = Math.min(6, meaningful.length);
  for (let index = 0; index < limit; index += 1) {
    label += meaningful[index].text;
    consumed = index + 1;
    if (/^\(?(\d{1,3}|[a-z]{1,3}|[A-Z]{1,3}|[ivxlcdm]{1,4})[.)\]]$/.test(label)) {
      break;
    }
    if (label.length > 6) {
      return null;
    }
  }
  if (!/^\(?(\d{1,3}|[a-z]{1,3}|[A-Z]{1,3}|[ivxlcdm]{1,4})[.)\]]$/.test(label)) {
    return null;
  }
  if (consumed >= meaningful.length) {
    return null;
  }
  const gap =
    meaningful[consumed].x -
    (meaningful[consumed - 1].x + meaningful[consumed - 1].width);
  if (gap < meaningful[0].size * 0.12) {
    return null;
  }
  return { ordered: true, markerGlyphs: consumed, label };
}

function stripMarker(line: TextLine, markerGlyphs: number): TextLine {
  let removed = 0;
  const glyphs: Glyph[] = [];
  for (const glyph of line.glyphs) {
    if (removed < markerGlyphs) {
      if (!glyph.space && glyph.text) {
        removed += 1;
      }
      continue;
    }
    glyphs.push(glyph);
  }
  return { ...line, glyphs: glyphs.length ? glyphs : line.glyphs };
}

export function analyzeStructure(
  pages: PageContent[],
  layouts: PageLayout[],
  stats: DocumentStats,
  context: InlineContext,
): StructureResult {
  const blocks: Block[] = [];
  const labels: LabelMaps = {
    sections: new Map(),
    figures: new Map(),
    tables: new Map(),
    equations: new Map(),
  };
  let lowConfidenceMath = 0;
  let figureCount = 0;
  let tableCount = 0;
  let title = "";
  let authors = "";

  // Pass one: claim caption driven floats so their internals never reach prose.
  interface Float {
    kind: "figure" | "table";
    caption: TextLine[];
    numbering: string | null;
    region: FigureRegion | null;
    bodyLines: TextLine[];
  }
  const floats: Float[] = [];
  const claimed = new Set<TextLine>();

  layouts.forEach((layout, pageIndex) => {
    const page = pages[pageIndex];
    for (const line of layout.lines) {
      if (claimed.has(line)) {
        continue;
      }
      const text = lineText(line);
      const figureMatch = figureCaptionPattern.exec(text);
      const tableMatch = tableCaptionPattern.exec(text);
      if (!figureMatch && !tableMatch) {
        continue;
      }
      // A caption starts a paragraph of its own; collect its continuation lines.
      const captionLines = [line];
      const index = layout.lines.indexOf(line);
      const column = columnOf(layout, line);
      for (let next = index + 1; next < layout.lines.length; next += 1) {
        const candidate = layout.lines[next];
        if (claimed.has(candidate) || candidate.column !== line.column) {
          break;
        }
        const gap = candidate.baseline - captionLines[captionLines.length - 1].baseline;
        if (gap > Math.max(stats.leading, candidate.size) * 1.4 || gap <= 0) {
          break;
        }
        if (Math.abs(candidate.size - line.size) > line.size * 0.1) {
          break;
        }
        if (candidate.left > column.left + candidate.size * 1.5) {
          break;
        }
        captionLines.push(candidate);
        if (
          captionLines[captionLines.length - 1].right <
          column.right - candidate.size * 2
        ) {
          break;
        }
      }

      const numbering = figureMatch
        ? romanToArabic(figureMatch[1])
        : romanToArabic(tableMatch![1]);

      if (figureMatch) {
        const region = findFigureRegion(line, layout, page, stats);
        const bodyLines: TextLine[] = [];
        if (region) {
          for (const candidate of layout.lines) {
            if (
              !captionLines.includes(candidate) &&
              candidate.left >= region.left - 2 &&
              candidate.right <= region.right + 2 &&
              candidate.baseline >= region.top &&
              candidate.baseline <= region.bottom
            ) {
              bodyLines.push(candidate);
            }
          }
        }
        floats.push({
          kind: "figure",
          caption: captionLines,
          numbering,
          region,
          bodyLines,
        });
        for (const consumed of [...captionLines, ...bodyLines]) {
          claimed.add(consumed);
        }
        continue;
      }

      // Tables: prefer the drawn rules. A ruled or booktabs table brackets its body
      // between a top and a bottom rule, which pins the extent exactly; walking
      // vertical gaps instead would run off into the surrounding text.
      const ruledBody = collectRuledTableBody(line, layout, page, stats, claimed);
      if (ruledBody.length >= 2) {
        floats.push({
          kind: "table",
          caption: captionLines,
          numbering,
          region: null,
          bodyLines: ruledBody,
        });
        for (const consumed of [...captionLines, ...ruledBody]) {
          claimed.add(consumed);
        }
        continue;
      }

      // Otherwise the grid is usually directly above the caption in the ACM and
      // IEEE styles and directly below in others. Take whichever side scores higher.
      const collectRun = (direction: -1 | 1): TextLine[] => {
        const run: TextLine[] = [];
        let cursor = index + direction;
        let reference = direction === -1 ? line : captionLines[captionLines.length - 1];
        while (cursor >= 0 && cursor < layout.lines.length) {
          const candidate = layout.lines[cursor];
          if (claimed.has(candidate) || captionLines.includes(candidate)) {
            break;
          }
          if (
            candidate.column !== line.column ||
            candidate.spanning !== line.spanning
          ) {
            break;
          }
          const gap = Math.abs(candidate.baseline - reference.baseline);
          if (gap > Math.max(stats.leading, candidate.size) * 3.2) {
            break;
          }
          if (
            figureCaptionPattern.test(lineText(candidate)) ||
            tableCaptionPattern.test(lineText(candidate))
          ) {
            break;
          }
          run.push(candidate);
          reference = candidate;
          cursor += direction;
          if (run.length > 60) {
            break;
          }
        }
        return direction === -1 ? run.reverse() : run;
      };

      const aboveRun = collectRun(-1);
      const belowRun = collectRun(1);
      const aboveScore = tableLikelihood(aboveRun, stats.bodySize);
      const belowScore = tableLikelihood(belowRun, stats.bodySize);
      const bodyLines = aboveScore >= belowScore ? aboveRun : belowRun;
      const useBody = Math.max(aboveScore, belowScore) > 0.45 ? bodyLines : [];
      floats.push({
        kind: "table",
        caption: captionLines,
        numbering,
        region: null,
        bodyLines: useBody,
      });
      for (const consumed of [...captionLines, ...useBody]) {
        claimed.add(consumed);
      }
    }
  });

  const floatByFirstLine = new Map<TextLine, Float>();
  for (const float of floats) {
    floatByFirstLine.set(float.caption[0], float);
  }
  const floatByBodyLine = new Map<TextLine, Float>();
  for (const float of floats) {
    for (const line of float.bodyLines) {
      floatByBodyLine.set(line, float);
    }
  }

  // Pass two: everything else, page by page and in reading order.
  const headingSizes = new Set<number>();
  const emittedFloats = new Set<Float>();
  let referencesFrom: TextLine[] | null = null;
  const pendingFootnotes: Block[] = [];

  interface PreparedGroup {
    layout: PageLayout;
    lines: TextLine[];
    heading: HeadingCandidate | null;
  }
  const prepared: PreparedGroup[] = [];

  layouts.forEach((layout) => {
    const remaining = layout.lines.filter(
      (line) => !claimed.has(line) || floatByFirstLine.has(line),
    );
    for (const group of groupLines(layout, remaining, stats)) {
      const heading = headingCandidate(group, stats, layout);
      if (heading && !heading.numbering && group.length === 1) {
        headingSizes.add(Math.round(heading.size * 4) / 4);
      } else if (heading) {
        headingSizes.add(Math.round(heading.size * 4) / 4);
      }
      prepared.push({ layout, lines: group, heading });
    }
  });

  const rankedHeadingSizes = [...headingSizes].sort((a, b) => b - a);
  const levelForSize = (size: number): number => {
    const rounded = Math.round(size * 4) / 4;
    const index = rankedHeadingSizes.indexOf(rounded);
    if (index < 0) {
      return 1;
    }
    return Math.min(3, index + 1);
  };

  const renderGroup = (lines: TextLine[]): { latex: string; text: string } => {
    const rendered = renderInline(lines, context);
    lowConfidenceMath += rendered.lowConfidenceSpans;
    return { latex: rendered.latex, text: rendered.text };
  };

  const emitFloat = (float: Float): void => {
    if (emittedFloats.has(float)) {
      return;
    }
    emittedFloats.add(float);
    const captionText = float.caption.map(lineText).join(" ");
    const pattern =
      float.kind === "figure" ? figureCaptionPattern : tableCaptionPattern;
    const stripped = captionText.replace(pattern, "").trim();
    const captionLines = float.caption.map((line, index) =>
      index === 0
        ? {
            ...line,
            glyphs: dropLeadingCharacters(
              line,
              captionText.length - captionText.replace(pattern, "").length,
            ),
          }
        : line,
    );
    const rendered = renderGroup(captionLines);
    const numbering = float.numbering;
    const label = numbering
      ? `${float.kind === "figure" ? "fig" : "tab"}:${sanitizeLabel(numbering)}`
      : null;
    const spanning = float.caption[0].spanning;

    if (float.kind === "figure") {
      figureCount += 1;
      if (numbering && label) {
        labels.figures.set(numbering, label);
      }
      blocks.push({
        kind: "figure",
        caption: rendered.latex.trim() || stripped,
        label,
        numbering,
        region: float.region,
        spanning,
      });
      return;
    }

    tableCount += 1;
    if (numbering && label) {
      labels.tables.set(numbering, label);
    }
    let body: string | null = null;
    if (float.bodyLines.length) {
      const pageRules = pages[float.bodyLines[0].pageIndex]?.rules ?? [];
      const box = {
        left: Math.min(...float.bodyLines.map((line) => line.left)) - stats.bodySize,
        right: Math.max(...float.bodyLines.map((line) => line.right)) + stats.bodySize,
        top: Math.min(...float.bodyLines.map((line) => line.top)) - stats.bodySize,
        bottom:
          Math.max(...float.bodyLines.map((line) => line.bottom)) + stats.bodySize,
      };
      const relevantRules = pageRules.filter(
        (rule) =>
          rule.x2 >= box.left &&
          rule.x1 <= box.right &&
          rule.y1 >= box.top &&
          rule.y2 <= box.bottom,
      );
      body = reconstructTable(float.bodyLines, relevantRules, context)?.latex ?? null;
    }
    blocks.push({
      kind: "table",
      caption: rendered.latex.trim() || stripped,
      label,
      numbering,
      body,
      spanning,
    });
  };

  let seenAbstract = false;
  let seenBody = false;
  /** Set while the paragraphs after a standalone "Abstract" heading belong to it. */
  let abstractBlock: Extract<Block, { kind: "abstract" }> | null = null;

  for (let index = 0; index < prepared.length; index += 1) {
    const { layout, lines, heading } = prepared[index];
    const first = lines[0];

    if (referencesFrom) {
      referencesFrom.push(...lines);
      continue;
    }

    const float = floatByFirstLine.get(first);
    if (float) {
      emitFloat(float);
      continue;
    }
    if (lines.every((line) => claimed.has(line))) {
      continue;
    }

    const text = lines.map(lineText).join(" ").trim();
    if (!text) {
      continue;
    }

    // Front matter, recognised only above the abstract on page one.
    const inFrontMatter = !seenBody && !seenAbstract && first.pageIndex === 0;
    if (inFrontMatter && !title) {
      const isTitle =
        median(lines.map((line) => line.size)) > stats.bodySize * 1.22 &&
        index <= 3 &&
        !unnumberedHeadings.has(text.toLowerCase()) &&
        !sectionNumberPattern.test(text);
      if (isTitle) {
        title = text;
        blocks.push({
          kind: "title",
          latex: stripOuterStyle(renderGroup(lines).latex.replace(/\n/g, " ")),
        });
        continue;
      }
    }
    if (inFrontMatter && title) {
      // `\date{\today}` output carries no information worth keeping.
      if (datePattern.test(text)) {
        continue;
      }
      const isHeadingName = unnumberedHeadings.has(
        text.toLowerCase().replace(/[.:]$/, ""),
      );
      const authorish =
        !isHeadingName &&
        !sectionNumberPattern.test(text) &&
        lines.length <= 8 &&
        text.length < 500 &&
        // Author and affiliation lines are name-like, not prose.
        !/[.!?]\s+[A-Z]/.test(text);
      if (authorish) {
        const rendered = renderGroup(lines).latex.replace(/\n/g, " \\\\ ").trim();
        const existing = blocks.find(
          (block): block is Extract<Block, { kind: "authors" }> =>
            block.kind === "authors",
        );
        authors = authors ? `${authors} \\\\ ${text}` : text;
        if (existing) {
          existing.latex = `${existing.latex} \\\\ ${rendered}`;
        } else {
          blocks.push({ kind: "authors", latex: rendered });
        }
        continue;
      }
    }

    if (heading) {
      const normalized = heading.text.toLowerCase().replace(/[.:]$/, "");
      if (normalized === "references" || normalized === "bibliography") {
        referencesFrom = [];
        blocks.push({ kind: "references", lines: referencesFrom });
        continue;
      }
      if (normalized === "abstract" && !seenAbstract) {
        seenAbstract = true;
        // A run-in abstract keeps its text on the same line as the word Abstract;
        // otherwise the body is in the blocks that follow.
        const remainder = text.replace(/^abstract[\s.:—–-]*/i, "").trim();
        const block: Extract<Block, { kind: "abstract" }> = {
          kind: "abstract",
          latex: "",
        };
        if (remainder) {
          const stripped = lines.map((line, lineIndex) =>
            lineIndex === 0
              ? {
                  ...line,
                  glyphs: dropLeadingCharacters(line, text.length - remainder.length),
                }
              : line,
          );
          block.latex = renderGroup(stripped).latex.trim();
        } else {
          abstractBlock = block;
        }
        blocks.push(block);
        continue;
      }
      abstractBlock = null;

      seenBody = true;
      const level = heading.numbering
        ? Math.min(3, heading.numbering.split(".").length)
        : levelForSize(heading.size);
      const label = heading.numbering
        ? `sec:${sanitizeLabel(heading.numbering)}`
        : null;
      if (heading.numbering && label) {
        labels.sections.set(heading.numbering, label);
      }
      const headingLines = heading.numbering
        ? lines.map((line, lineIndex) =>
            lineIndex === 0
              ? {
                  ...line,
                  glyphs: dropLeadingCharacters(
                    line,
                    text.length - heading.text.length,
                  ),
                }
              : line,
          )
        : lines;
      blocks.push({
        kind: "section",
        level,
        latex: stripOuterStyle(renderGroup(headingLines).latex.replace(/\n/g, " ")),
        numbering: heading.numbering,
        label,
        starred: unnumberedHeadings.has(normalized),
      });
      continue;
    }

    // Paragraphs directly under a standalone "Abstract" heading are its body.
    if (abstractBlock) {
      const rendered = renderGroup(lines).latex.trim();
      abstractBlock.latex = abstractBlock.latex
        ? `${abstractBlock.latex}\n\n${rendered}`
        : rendered;
      continue;
    }

    seenBody = seenBody || Boolean(title);

    // Verbatim: a block that is predominantly monospace keeps its own layout.
    if (lines.every((line) => monospaceShare(line) > 0.75)) {
      blocks.push({ kind: "verbatim", lines: lines.map(lineText) });
      continue;
    }

    // Display equation: mostly maths, and set apart from the running text.
    const column = columnOf(layout, first);
    const columnWidth = column.right - column.left;
    const averageMath = median(lines.map(mathShare));
    const indentedOrCentred =
      first.left > column.left + stats.bodySize * 0.9 ||
      Math.abs((first.left + first.right) / 2 - (column.left + column.right) / 2) <
        columnWidth * 0.16;
    const narrow =
      Math.max(...lines.map((line) => line.right)) <
      column.right - stats.bodySize * 0.5;
    if (averageMath > 0.32 && (indentedOrCentred || narrow) && text.length < 600) {
      const { numbering, glyphs } = extractEquationTag(lines, layout, stats);
      const sizes = glyphs.filter((glyph) => !glyph.space).map((glyph) => glyph.size);
      const pageRules = pages[first.pageIndex]?.rules ?? [];
      const result = reconstructMath(
        glyphs,
        {
          ...context.math,
          rules: pageRules,
          baseSize: median(sizes) || stats.bodySize,
        },
        { display: true },
      );
      if (result.latex && isSafeMath(result.latex)) {
        const label = numbering ? `eq:${sanitizeLabel(numbering)}` : null;
        if (numbering && label) {
          labels.equations.set(numbering, label);
        }
        if (result.confidence < 0.65) {
          lowConfidenceMath += 1;
        }
        blocks.push({
          kind: "equation",
          latex: result.latex,
          numbering,
          label,
          multiline: result.multiline,
          confident: result.confidence >= 0.65,
        });
        continue;
      }
      lowConfidenceMath += 1;
    }

    // Footnotes sit at the foot of a column in a smaller size.
    const isFootnote =
      median(lines.map((line) => line.size)) < stats.bodySize * 0.92 &&
      first.baseline > layout.height * 0.72 &&
      /^[\d*†‡§¶]/.test(text);
    if (isFootnote) {
      const marker = /^[\d*†‡§¶]+/.exec(text)?.[0] ?? "";
      const stripped = lines.map((line, lineIndex) =>
        lineIndex === 0
          ? { ...line, glyphs: dropLeadingCharacters(line, marker.length) }
          : line,
      );
      pendingFootnotes.push({
        kind: "footnote",
        marker,
        latex: renderGroup(stripped).latex.trim(),
      });
      continue;
    }

    // Theorem-like environments.
    const theorem = theoremPattern.exec(text);
    if (
      theorem &&
      (boldShare(first) > 0.2 ||
        first.glyphs.find((glyph) => !glyph.space && glyph.text)?.font.bold ||
        first.glyphs.some((g) => g.font.smallCaps))
    ) {
      const environment = theorem[1].toLowerCase();
      const consumed = theorem[0].length;
      const stripped = lines.map((line, lineIndex) =>
        lineIndex === 0
          ? { ...line, glyphs: dropLeadingCharacters(line, consumed) }
          : line,
      );
      blocks.push({
        kind: "theorem",
        environment,
        title: theorem[2] ?? "",
        latex: renderGroup(stripped).latex.trim(),
      });
      continue;
    }

    // Lists.
    const marker = listMarker(first);
    if (marker) {
      const items: string[] = [];
      let cursor = index;
      const ordered = marker.ordered;
      while (cursor < prepared.length) {
        const candidate = prepared[cursor];
        const candidateMarker = listMarker(candidate.lines[0]);
        if (!candidateMarker || candidateMarker.ordered !== ordered) {
          break;
        }
        const itemLines = [
          stripMarker(candidate.lines[0], candidateMarker.markerGlyphs),
          ...candidate.lines.slice(1),
        ];
        items.push(renderGroup(itemLines).latex.trim());
        cursor += 1;
      }
      if (items.length) {
        blocks.push({ kind: "list", ordered, items, level: 0 });
        index = cursor - 1;
        continue;
      }
    }

    blocks.push({ kind: "paragraph", latex: renderGroup(lines).latex.trim() });
  }

  blocks.push(...pendingFootnotes);

  return {
    blocks,
    labels,
    title,
    authors,
    lowConfidenceMath,
    figureCount,
    tableCount,
    usedPackages: context.math.packages,
  };
}

/**
 * Removes the first `count` characters of a line's reading text, used to strip list
 * markers, caption prefixes and section numbers while keeping the geometry of what
 * remains intact. Counting has to mirror `lineText`, which infers a space from a
 * wide gap rather than from a space glyph, or the offsets drift.
 */
function dropLeadingCharacters(line: TextLine, count: number): Glyph[] {
  if (count <= 0) {
    return line.glyphs;
  }
  let consumed = 0;
  let previous: Glyph | null = null;
  let index = 0;
  for (; index < line.glyphs.length; index += 1) {
    const glyph = line.glyphs[index];
    if (glyph.space) {
      if (consumed > 0) {
        consumed += 1;
      }
      previous = glyph;
      if (consumed >= count) {
        index += 1;
        break;
      }
      continue;
    }
    if (previous && !previous.space) {
      const gap = glyph.x - (previous.x + previous.width);
      // The inferred space is consumed before the glyph that implied it, so a
      // prefix ending at that space must not take the glyph with it.
      if (gap > Math.max(previous.size, glyph.size) * 0.2) {
        consumed += 1;
        if (consumed >= count) {
          break;
        }
      }
    }
    consumed += glyph.text.length;
    previous = glyph;
    if (consumed >= count) {
      index += 1;
      break;
    }
  }
  const rest = line.glyphs.slice(index);
  return rest.length ? rest : line.glyphs;
}

export type { RuleSegment };
