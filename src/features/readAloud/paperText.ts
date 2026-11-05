// Turns the text of a compiled paper into sentences that sound natural when
// spoken: hyphenated line breaks are joined, page numbers and (optionally)
// equations, citation markers and the bibliography are skipped, and each
// sentence keeps the rectangles it covers so the preview can follow along.

/** The subset of a pdf.js text item that reading needs. */
export interface PaperTextItem {
  str: string;
  /** [a, b, c, d, e, f] — e/f is the baseline origin in PDF user space. */
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

export interface PaperPage {
  pageNumber: number;
  /** [x0, y0, x1, y1] of the page in PDF user space. */
  viewBox: [number, number, number, number];
  items: PaperTextItem[];
}

/** A rectangle as fractions (0–1) of the unrotated page, top-left origin. */
export interface PaperRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PaperSentenceKind = "heading" | "text";

export interface PaperSentence {
  page: number;
  /** The words as they appear on the page. */
  text: string;
  /** The words as they are spoken (citations removed, abbreviations expanded…). */
  spoken: string;
  kind: PaperSentenceKind;
  /** First sentence of a paragraph or section — a longer pause comes before it. */
  paragraphStart: boolean;
  rects: Array<PaperRect & { page: number }>;
}

export interface PaperTextOptions {
  skipCitations: boolean;
  skipReferences: boolean;
  skipEquations: boolean;
  expandAbbreviations: boolean;
}

export const defaultPaperTextOptions: PaperTextOptions = {
  skipCitations: true,
  skipReferences: true,
  skipEquations: true,
  expandAbbreviations: true,
};

interface Segment {
  start: number;
  end: number;
  item: PaperTextItem;
  lineId: number;
  page: PaperPage;
}

interface Line {
  id: number;
  page: PaperPage;
  text: string;
  segments: Segment[];
  y: number;
  size: number;
}

interface Block {
  text: string;
  segments: Segment[];
  kind: PaperSentenceKind;
}

const fontSize = (item: PaperTextItem) =>
  Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) || item.height || 10;

function buildLines(page: PaperPage, nextId: () => number): Line[] {
  const lines: Line[] = [];
  let line: Line | null = null;
  let lineWeight = 0;
  let previous: PaperTextItem | null = null;

  for (const item of page.items) {
    const size = fontSize(item);
    const y = item.transform[5] ?? 0;
    const x = item.transform[4] ?? 0;
    const breakLine =
      !line ||
      Boolean(previous?.hasEOL) ||
      Math.abs(y - line.y) > 0.6 * Math.max(size, line.size) ||
      // Moving far left on the same baseline means a new column.
      (previous !== null && x < (previous.transform[4] ?? 0) - size * 2);
    if (breakLine && line && line.text.trim()) lines.push(line);
    if (breakLine) {
      line = { id: nextId(), page, text: "", segments: [], y, size };
      lineWeight = 0;
      previous = null;
    }
    const current = line!;
    if (item.str) {
      if (
        previous &&
        current.text &&
        !/\s$/.test(current.text) &&
        !/^\s/.test(item.str) &&
        x > (previous.transform[4] ?? 0) + previous.width + size * 0.12
      ) {
        current.text += " ";
      }
      const start = current.text.length;
      current.text += item.str;
      current.segments.push({
        start,
        end: current.text.length,
        item,
        lineId: current.id,
        page,
      });
      // The line's size is the size of most of its characters.
      if (item.str.trim().length > lineWeight) {
        lineWeight = item.str.trim().length;
        current.size = size;
        current.y = y;
      }
    }
    if (item.str || item.hasEOL) previous = item;
  }
  if (line && line.text.trim()) lines.push(line);

  // Page numbers and "Page n of m" at the top or bottom of a page.
  const isFolio = (text: string) =>
    /^\s*(?:page\s+)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?\s*$/i.test(text);
  while (lines.length && isFolio(lines[lines.length - 1].text)) lines.pop();
  while (lines.length && isFolio(lines[0].text)) lines.shift();
  return lines;
}

const referencesHeading =
  /^\s*(?:\d+\.?|[IVX]+\.)?\s*(?:references|bibliography|works cited|literature cited)\s*$/i;

const sectionHeading =
  /^\s*(?:\d+(?:\.\d+)*\.?|[A-Z]\.|[IVX]+\.)\s+\p{Lu}[^.!?]{0,70}$/u;

const namedHeading =
  /^\s*(?:abstract|introduction|background|related work|method(?:s|ology)?|experiments?|results|discussion|conclusions?|acknowledge?ments?|appendix(?:\s+\p{Lu})?|limitations|future work)\s*$/iu;

function isHeadingLine(line: Line, bodySize: number): boolean {
  const text = line.text.trim();
  if (!text || text.length > 120) return false;
  if (referencesHeading.test(text) || namedHeading.test(text)) return true;
  if (/[.,;:]$/.test(text)) return false;
  if (sectionHeading.test(text) && text.split(/\s+/).length <= 10) return true;
  return line.size >= bodySize * 1.15 && /\p{L}{2,}/u.test(text);
}

const mathSymbols = /[=+−∑∫∏√≤≥≈∈∉∀∃∂∇∞→←↔⇒⇔×÷±∝⊂⊆∪∩^_|‖]/;

export function isEquationLine(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 2) return false;
  const letters = compact.match(/\p{L}/gu)?.length ?? 0;
  const words = text.match(/\b\p{Ll}{3,}\b/gu)?.length ?? 0;
  if (letters / compact.length < 0.5) return true;
  // Stray pieces of a display formula: "N", "X", "i=1" on their own lines.
  if (compact.length <= 6 && words === 0 && !/[.!?:]$/.test(compact)) return true;
  return words <= 1 && mathSymbols.test(text);
}

function median(values: number[]): number {
  if (!values.length) return 10;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function buildBlocks(pages: PaperPage[], options: PaperTextOptions): Block[] {
  let id = 0;
  const lines = pages.flatMap((page) => buildLines(page, () => id++));
  const bodySize = median(
    lines.flatMap((line) =>
      Array<number>(Math.min(40, Math.ceil(line.text.length / 10))).fill(line.size),
    ),
  );

  const blocks: Block[] = [];
  let block: Block | null = null;
  let previous: Line | null = null;
  let afterEquation = false;
  const flush = () => {
    if (block && block.text.trim()) blocks.push(block);
    block = null;
  };

  for (const line of lines) {
    const text = line.text.trim();
    if (options.skipReferences && referencesHeading.test(text)) break;
    const heading = isHeadingLine(line, bodySize);
    if (!heading && options.skipEquations && isEquationLine(text)) {
      // The text around a display equation is usually one sentence.
      previous = line;
      afterEquation = true;
      continue;
    }

    const samePage = previous?.page === line.page;
    const gap = previous && samePage ? previous.y - line.y : 0;
    // After a display equation only a capital letter starts a new paragraph.
    const paragraphGap = afterEquation
      ? /^\p{Lu}/u.test(text) && gap > 1.45 * Math.max(line.size, previous?.size ?? 0)
      : gap > 1.45 * Math.max(line.size, previous?.size ?? 0);
    const skippedEquation = afterEquation;
    afterEquation = false;
    const continuesHeading =
      heading &&
      (block as Block | null)?.kind === "heading" &&
      samePage &&
      Math.abs((previous?.size ?? 0) - line.size) < 0.5 &&
      gap < 1.6 * line.size;
    const kind: PaperSentenceKind = heading ? "heading" : "text";
    if (
      !block ||
      (block as Block).kind !== kind ||
      (paragraphGap && !continuesHeading) ||
      (heading && !continuesHeading)
    ) {
      flush();
      block = { text: "", segments: [], kind };
    }

    const current = block as Block;
    // "exam-" + "ple" → "example"; anything else gets a space between lines.
    if (/\p{L}-$/u.test(current.text) && /^\p{Ll}/u.test(text)) {
      current.text = current.text.slice(0, -1);
      const last = current.segments[current.segments.length - 1];
      if (last) last.end = Math.min(last.end, current.text.length);
    } else if (current.text && !/\s$/.test(current.text)) {
      // A brief pause where a skipped display equation stood.
      if (skippedEquation && /[\p{L}\d)]$/u.test(current.text)) current.text += ",";
      current.text += " ";
    }
    const offset = current.text.length;
    current.text += line.text;
    for (const segment of line.segments) {
      current.segments.push({
        ...segment,
        start: segment.start + offset,
        end: segment.end + offset,
      });
    }
    previous = line;
  }
  flush();
  return blocks;
}

const abbreviationEnd =
  /\b(?:e\.g|i\.e|et al|cf|vs|Fig|Figs|Eq|Eqs|Sec|Secs|Sect|Tab|Ref|Refs|No|Nos|Dr|Mr|Mrs|Ms|Prof|resp|approx|Ch|Chap|Thm|Def|Prop|Lem|Alg|App|Vol|pp|ca|al|St)\.\s*$/;

/** Sentence ranges in `text`, kept whole across "e.g.", "Fig. 3", "et al. (2020)". */
export function splitSentences(text: string): Array<[number, number]> {
  const raw: Array<[number, number]> = [];
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
    for (const part of segmenter.segment(text)) {
      raw.push([part.index, part.index + part.segment.length]);
    }
  } else {
    for (const match of text.matchAll(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g)) {
      raw.push([match.index, match.index + match[0].length]);
    }
  }

  const merged: Array<[number, number]> = [];
  for (const range of raw) {
    const last = merged[merged.length - 1];
    if (last) {
      const lastText = text.slice(last[0], last[1]);
      const nextText = text.slice(range[0], range[1]);
      if (
        abbreviationEnd.test(lastText) ||
        /^\s*[\p{Ll}\d([]/u.test(nextText) ||
        lastText.trim().length < 4
      ) {
        last[1] = range[1];
        continue;
      }
    }
    merged.push([range[0], range[1]]);
  }
  return merged
    .map(([start, end]): [number, number] => {
      const slice = text.slice(start, end);
      const lead = slice.length - slice.trimStart().length;
      return [start + lead, start + slice.trimEnd().length];
    })
    .filter(([start, end]) => end > start);
}

const abbreviations: Array<[RegExp, string]> = [
  [/\be\.\s?g\.(?:,)?/gi, "for example,"],
  [/\bi\.\s?e\.(?:,)?/gi, "that is,"],
  [/\bet al\./g, "et al"],
  [/\bcf\./gi, "compare"],
  [/\bvs\.?(?=\s)/gi, "versus"],
  [/\bw\.r\.t\./gi, "with respect to"],
  [/\bresp\./gi, "respectively"],
  [/\bapprox\./gi, "approximately"],
  [/\betc\.(?=\s+\p{Ll})/giu, "etc"],
  [/\bFigs\.(?=\s*\d)/g, "Figures"],
  [/\bFig\.(?=\s*\d)/g, "Figure"],
  [/\bEqs\.(?=\s*\(?\d)/g, "Equations"],
  [/\bEq\.(?=\s*\(?\d)/g, "Equation"],
  [/\bSecs?\.(?=\s*\d)/g, "Section"],
  [/\bSect\.(?=\s*\d)/g, "Section"],
  [/\bTab\.(?=\s*\d)/g, "Table"],
  [/\bRefs?\.(?=\s*\[?\d)/g, "Reference"],
  [/\bThm\.(?=\s*\d)/g, "Theorem"],
  [/\bDef\.(?=\s*\d)/g, "Definition"],
  [/\bAlg\.(?=\s*\d)/g, "Algorithm"],
  [/\bApp\.(?=\s*\p{Lu})/gu, "Appendix"],
  [/\bpp\.(?=\s*\d)/g, "pages"],
  [/\bNo\.(?=\s*\d)/g, "number"],
];

const symbols: Array<[RegExp, string]> = [
  [/≈/g, " approximately "],
  [/≤/g, " less than or equal to "],
  [/≥/g, " greater than or equal to "],
  [/≠/g, " not equal to "],
  [/±/g, " plus or minus "],
  [/×/g, " times "],
  [/→/g, " to "],
  [/∼|~(?=\s*\d)/g, " about "],
  [/°/g, " degrees "],
  [/&/g, " and "],
  [/[−–—](?=\s*\d)/g, "-"],
  [/\s[–—]\s/g, ", "],
  [/[•·▪◦]/g, " "],
];

/** The words a voice should say for a sentence of the paper. */
export function toSpokenText(
  text: string,
  options: PaperTextOptions,
  kind: PaperSentenceKind = "text",
): string {
  let spoken = text.normalize("NFKC").replace(/­/g, "");
  if (options.skipCitations) {
    spoken = spoken
      // [3], [3, 7], [3–7], [12,14-16]
      .replace(/\s?\[\s*\d+(?:\s*[,–—-]\s*\d+)*\s*\]/g, "")
      // (Smith et al., 2020; Doe, 2019a)
      .replace(
        /\s?\((?:see\s+)?(?:[\p{Lu}][\p{L}'’-]+(?:\s(?:et al\.?|and|&)\s?[\p{Lu}]?[\p{L}'’-]*)?,?\s(?:19|20)\d{2}[a-z]?(?:;\s*)?)+\)/gu,
        "",
      );
  }
  spoken = spoken
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, "")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "");
  if (options.expandAbbreviations) {
    for (const [pattern, replacement] of abbreviations) {
      spoken = spoken.replace(pattern, replacement);
    }
  }
  for (const [pattern, replacement] of symbols) {
    spoken = spoken.replace(pattern, replacement);
  }
  spoken = spoken
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!/[\p{L}\d]/u.test(spoken)) return "";
  // Headings end with a stop so every voice pauses after them.
  if (kind === "heading" && !/[.!?:]$/.test(spoken)) spoken += ".";
  return spoken;
}

function rectsFor(start: number, end: number, segments: Segment[]) {
  const byLine = new Map<
    number,
    { page: number; x0: number; x1: number; y0: number; y1: number }
  >();
  for (const segment of segments) {
    const from = Math.max(start, segment.start);
    const to = Math.min(end, segment.end);
    const length = segment.end - segment.start;
    const { item, page } = segment;
    // Rotated or vertical text has no simple box; it is still read aloud.
    if (to <= from || length <= 0 || Math.abs(item.transform[1] ?? 0) > 0.01) continue;
    const [vx0, , vx1, vy1] = page.viewBox;
    const width = vx1 - vx0 || 1;
    const height = page.viewBox[3] - page.viewBox[1] || 1;
    const size = fontSize(item);
    const left =
      (item.transform[4] ?? 0) + (item.width * (from - segment.start)) / length;
    const right =
      (item.transform[4] ?? 0) + (item.width * (to - segment.start)) / length;
    const baseline = item.transform[5] ?? 0;
    const box = {
      page: page.pageNumber,
      x0: (left - vx0) / width,
      x1: (right - vx0) / width,
      y0: (vy1 - (baseline + size * 0.9)) / height,
      y1: (vy1 - (baseline - size * 0.25)) / height,
    };
    const existing = byLine.get(segment.lineId);
    if (existing) {
      existing.x0 = Math.min(existing.x0, box.x0);
      existing.x1 = Math.max(existing.x1, box.x1);
      existing.y0 = Math.min(existing.y0, box.y0);
      existing.y1 = Math.max(existing.y1, box.y1);
    } else {
      byLine.set(segment.lineId, box);
    }
  }
  return [...byLine.values()].map((box) => ({
    page: box.page,
    x: Math.max(0, box.x0 - 0.003),
    y: Math.max(0, box.y0),
    width: Math.min(1, box.x1 - box.x0 + 0.006),
    height: Math.min(1, box.y1 - box.y0),
  }));
}

/** Every sentence of the paper, in reading order. */
export function paperSentences(
  pages: PaperPage[],
  options: PaperTextOptions = defaultPaperTextOptions,
): PaperSentence[] {
  const sentences: PaperSentence[] = [];
  for (const block of buildBlocks(pages, options)) {
    const ranges =
      block.kind === "heading"
        ? [[0, block.text.length] as [number, number]]
        : splitSentences(block.text);
    ranges.forEach(([start, end], index) => {
      const text = block.text.slice(start, end).replace(/\s+/g, " ").trim();
      const spoken = toSpokenText(text, options, block.kind);
      if (!spoken) return;
      const rects = rectsFor(start, end, block.segments);
      const firstSegment =
        block.segments.find((segment) => segment.end > start) ?? block.segments[0];
      sentences.push({
        page: rects[0]?.page ?? firstSegment?.page.pageNumber ?? 1,
        text,
        spoken,
        kind: block.kind,
        paragraphStart: index === 0,
        rects,
      });
    });
  }
  return sentences;
}

/** A rectangle of the unrotated page as it appears after rotating the page. */
export function rotateRect(rect: PaperRect, rotation: number): PaperRect {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return {
        x: 1 - rect.y - rect.height,
        y: rect.x,
        width: rect.height,
        height: rect.width,
      };
    case 180:
      return {
        x: 1 - rect.x - rect.width,
        y: 1 - rect.y - rect.height,
        width: rect.width,
        height: rect.height,
      };
    case 270:
      return {
        x: rect.y,
        y: 1 - rect.x - rect.width,
        width: rect.height,
        height: rect.width,
      };
    default:
      return rect;
  }
}
