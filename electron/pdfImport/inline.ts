/**
 * Inline reconstruction: a run of lines becomes a paragraph of LaTeX.
 *
 * The hard part is deciding where prose stops and maths begins. Glyphs set in a
 * maths font are unambiguous seeds, but a formula such as `x^2 + 1` draws its digits
 * and operators from the ordinary text font, so each seed run is grown outwards
 * across the characters that only make sense as part of a formula: digits,
 * operators, brackets, and anything sitting off the baseline. Punctuation is then
 * pushed back out of the span, because a full stop after a formula belongs to the
 * sentence.
 */

import { isMathFont } from "./fonts.js";
import type { Glyph, RuleSegment } from "./model.js";
import { median } from "./model.js";
import { reconstructMath, isSafeMath, type MathContext } from "./math.js";
import type { TextLine } from "./layout.js";
import { escapeText } from "./symbols.js";

export interface InlineContext {
  math: MathContext;
  bodySize: number;
  /** Rules indexed by page, so an inline fraction finds its own bar. */
  rulesByPage: RuleSegment[][];
}

export interface InlineResult {
  latex: string;
  /** Plain reading text, used by the block classifiers. */
  text: string;
  mathSpans: number;
  lowConfidenceSpans: number;
}

const absorbable = new Set([
  "+",
  "-",
  "−",
  "=",
  "(",
  ")",
  "[",
  "]",
  "/",
  "<",
  ">",
  "|",
  "*",
  "'",
  "^",
  "_",
]);

const interiorPunctuation = new Set([",", ".", ";", ":"]);

function isMathSeed(glyph: Glyph): boolean {
  if (glyph.space || !glyph.text) {
    return false;
  }
  if (isMathFont(glyph.font)) {
    return true;
  }
  const code = glyph.text.codePointAt(0) ?? 0;
  // Greek, letterlike symbols, and the operator and arrow blocks are maths even
  // when a text font happens to supply them.
  return (
    (code >= 0x0370 && code <= 0x03ff) ||
    (code >= 0x2100 && code <= 0x214f) ||
    (code >= 0x2190 && code <= 0x22ff) ||
    (code >= 0x27e6 && code <= 0x27ff) ||
    (code >= 0x2a00 && code <= 0x2aff)
  );
}

interface Span {
  kind: "text" | "math";
  glyphs: Glyph[];
}

/** Splits one line's glyphs into alternating prose and formula spans. */
export function segmentLine(line: TextLine, bodySize: number): Span[] {
  const glyphs = line.glyphs;
  const isMath = new Array<boolean>(glyphs.length).fill(false);
  let seen = false;
  for (let index = 0; index < glyphs.length; index += 1) {
    if (isMathSeed(glyphs[index])) {
      isMath[index] = true;
      seen = true;
    }
  }
  if (!seen) {
    return glyphs.length ? [{ kind: "text", glyphs }] : [];
  }

  const scriptOffset = (glyph: Glyph): boolean =>
    Math.abs(glyph.y - line.baseline) > Math.max(line.size, bodySize) * 0.16;

  const absorbableGlyph = (glyph: Glyph): boolean => {
    if (glyph.space || !glyph.text) {
      return false;
    }
    if (/^\d$/.test(glyph.text) || absorbable.has(glyph.text)) {
      return true;
    }
    if (interiorPunctuation.has(glyph.text)) {
      return true;
    }
    // A lone letter raised or lowered off the baseline is a script.
    return /^[A-Za-z]$/.test(glyph.text) && scriptOffset(glyph);
  };

  const gapBetween = (left: Glyph, right: Glyph): number =>
    right.x - (left.x + left.width);

  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < glyphs.length; index += 1) {
      if (!isMath[index]) {
        continue;
      }
      for (const direction of [-1, 1] as const) {
        let cursor = index + direction;
        // Step across an intervening thin space once.
        if (
          cursor >= 0 &&
          cursor < glyphs.length &&
          glyphs[cursor].space &&
          glyphs[cursor].width < Math.max(line.size, bodySize) * 0.4
        ) {
          cursor += direction;
        }
        if (cursor < 0 || cursor >= glyphs.length || isMath[cursor]) {
          continue;
        }
        const candidate = glyphs[cursor];
        if (!absorbableGlyph(candidate)) {
          continue;
        }
        const [left, right] =
          direction === 1 ? [glyphs[index], candidate] : [candidate, glyphs[index]];
        if (gapBetween(left, right) > Math.max(line.size, bodySize) * 0.45) {
          continue;
        }
        isMath[cursor] = true;
        for (
          let fill = Math.min(index, cursor) + 1;
          fill < Math.max(index, cursor);
          fill += 1
        ) {
          isMath[fill] = true;
        }
        changed = true;
      }
    }
  }

  // Punctuation that terminates a span belongs to the sentence, and an unmatched
  // bracket at an edge was almost certainly prose.
  for (const bounds of [0, 1]) {
    void bounds;
    for (let index = 0; index < glyphs.length; index += 1) {
      if (!isMath[index]) {
        continue;
      }
      const isLast = index + 1 >= glyphs.length || !isMath[index + 1];
      const isFirst = index === 0 || !isMath[index - 1];
      const text = glyphs[index].text;
      if (isLast && (interiorPunctuation.has(text) || text === "'")) {
        isMath[index] = false;
      } else if (isFirst && interiorPunctuation.has(text)) {
        isMath[index] = false;
      }
    }
  }

  // Balance brackets inside each span by evicting the unmatched edge.
  let index = 0;
  while (index < glyphs.length) {
    if (!isMath[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < glyphs.length && isMath[end + 1]) {
      end += 1;
    }
    let depth = 0;
    for (let cursor = index; cursor <= end; cursor += 1) {
      const text = glyphs[cursor].text;
      if (text === "(" || text === "[") {
        depth += 1;
      } else if (text === ")" || text === "]") {
        depth -= 1;
        if (depth < 0) {
          isMath[cursor] = false;
          depth = 0;
        }
      }
    }
    for (let cursor = end; cursor >= index && depth > 0; cursor -= 1) {
      const text = glyphs[cursor].text;
      if (text === "(" || text === "[") {
        isMath[cursor] = false;
        depth -= 1;
      }
    }
    index = end + 1;
  }

  // A space at either end of a formula belongs to the surrounding sentence.
  for (let cursor = 0; cursor < glyphs.length; cursor += 1) {
    if (!isMath[cursor] || !glyphs[cursor].space) {
      continue;
    }
    const atStart = cursor === 0 || !isMath[cursor - 1];
    const atEnd = cursor + 1 >= glyphs.length || !isMath[cursor + 1];
    if (atStart || atEnd) {
      isMath[cursor] = false;
    }
  }

  const spans: Span[] = [];
  for (let cursor = 0; cursor < glyphs.length; cursor += 1) {
    const kind: Span["kind"] = isMath[cursor] ? "math" : "text";
    const last = spans[spans.length - 1];
    if (last && last.kind === kind) {
      last.glyphs.push(glyphs[cursor]);
    } else {
      spans.push({ kind, glyphs: [glyphs[cursor]] });
    }
  }
  return spans.filter((span) => span.glyphs.length > 0);
}

interface StyleState {
  bold: boolean;
  italic: boolean;
  monospace: boolean;
  smallCaps: boolean;
  script: "none" | "super" | "sub";
}

function styleOf(glyph: Glyph, line: TextLine, bodySize: number): StyleState {
  const reference = Math.max(line.size, bodySize);
  const offset = glyph.y - line.baseline;
  const smaller = glyph.size < line.size * 0.9;
  return {
    bold: glyph.font.bold,
    italic: glyph.font.italic && glyph.font.mathRole === "text",
    monospace: glyph.font.monospace,
    smallCaps: glyph.font.smallCaps,
    script:
      smaller && offset < -reference * 0.18
        ? "super"
        : smaller && offset > reference * 0.12
          ? "sub"
          : "none",
  };
}

function sameStyle(a: StyleState, b: StyleState): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.monospace === b.monospace &&
    a.smallCaps === b.smallCaps &&
    a.script === b.script
  );
}

function wrapStyle(style: StyleState, body: string): string {
  if (!body.trim()) {
    return body;
  }
  // Preserve edge spaces outside the command so words do not fuse.
  const leading = /^\s*/.exec(body)?.[0] ?? "";
  const trailing = /\s*$/.exec(body)?.[0] ?? "";
  let inner = body.slice(leading.length, body.length - trailing.length);

  if (style.monospace) {
    inner = `\\texttt{${inner}}`;
  }
  if (style.smallCaps) {
    inner = `\\textsc{${inner}}`;
  }
  if (style.italic) {
    inner = `\\emph{${inner}}`;
  }
  if (style.bold) {
    inner = `\\textbf{${inner}}`;
  }
  if (style.script === "super") {
    inner = `\\textsuperscript{${inner}}`;
  } else if (style.script === "sub") {
    inner = `\\textsubscript{${inner}}`;
  }
  return `${leading}${inner}${trailing}`;
}

function renderTextSpan(
  glyphs: Glyph[],
  line: TextLine,
  bodySize: number,
): { latex: string; text: string } {
  let latex = "";
  let plain = "";
  let runGlyphs: Glyph[] = [];
  let runStyle: StyleState | null = null;

  const flush = () => {
    if (!runGlyphs.length || !runStyle) {
      runGlyphs = [];
      return;
    }
    let raw = "";
    let previous: Glyph | null = null;
    for (const glyph of runGlyphs) {
      if (glyph.space) {
        if (raw && !raw.endsWith(" ")) {
          raw += " ";
        }
        previous = glyph;
        continue;
      }
      if (previous && !previous.space) {
        const gap = glyph.x - (previous.x + previous.width);
        if (gap > Math.max(previous.size, glyph.size) * 0.2 && !raw.endsWith(" ")) {
          raw += " ";
        }
      }
      raw += glyph.text;
      previous = glyph;
    }
    plain += raw;
    latex += wrapStyle(runStyle, escapeText(raw));
    runGlyphs = [];
  };

  for (const glyph of glyphs) {
    if (glyph.space) {
      runGlyphs.push(glyph);
      continue;
    }
    const style = styleOf(glyph, line, bodySize);
    if (!runStyle || !sameStyle(runStyle, style)) {
      flush();
      runStyle = style;
    }
    runGlyphs.push(glyph);
  }
  flush();
  return { latex, text: plain };
}

/**
 * Recognises the TeX family logos, which are drawn as ordinary letters on shifted
 * baselines and would otherwise be reconstructed as nonsense maths.
 */
function logoCommand(glyphs: Glyph[], line: TextLine): string | null {
  const visible = glyphs.filter((glyph) => !glyph.space && glyph.text);
  const word = visible.map((glyph) => glyph.text).join("");
  if (word !== "LATEX" && word !== "TEX") {
    return null;
  }
  const eIndex = word.length - 2;
  const lowered = visible[eIndex].y > line.baseline + visible[eIndex].size * 0.05;
  if (!lowered) {
    return null;
  }
  if (word === "TEX") {
    return "\\TeX{}";
  }
  const raised = visible[1].y < line.baseline - visible[1].size * 0.05;
  return raised ? "\\LaTeX{}" : null;
}

/**
 * Renders a paragraph. Lines are joined with a space, and a word broken by a
 * hyphen at a line end is put back together.
 */
export function renderInline(lines: TextLine[], context: InlineContext): InlineResult {
  let latex = "";
  let text = "";
  let mathSpans = 0;
  let lowConfidenceSpans = 0;
  let previousGlyph: Glyph | null = null;

  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      const hyphenated = /[-­‐]$/.test(text.trimEnd());
      const nextGlyph = line.glyphs.find((glyph) => !glyph.space && glyph.text);
      const continues = hyphenated && /^[a-z]/.test(nextGlyph?.text ?? "");
      if (continues) {
        latex = latex.replace(/[-­‐]\s*$/, "");
        text = text.replace(/[-­‐]\s*$/, "");
      } else {
        latex += "\n";
        text += " ";
      }
    }

    for (const span of segmentLine(line, context.bodySize)) {
      // A gap across a span boundary is a word space that neither side records.
      const firstVisible = span.glyphs.find((glyph) => !glyph.space && glyph.text);
      if (previousGlyph && firstVisible && latex && !/\s$/.test(latex)) {
        const gap = firstVisible.x - (previousGlyph.x + previousGlyph.width);
        if (gap > Math.max(previousGlyph.size, firstVisible.size) * 0.2) {
          latex += " ";
          text += " ";
        }
      }
      const lastVisible = [...span.glyphs]
        .reverse()
        .find((glyph) => !glyph.space && glyph.text);
      if (lastVisible) {
        previousGlyph = lastVisible;
      }

      if (span.kind === "text") {
        const rendered = renderTextSpan(span.glyphs, line, context.bodySize);
        latex += rendered.latex;
        text += rendered.text;
        continue;
      }

      const logo = logoCommand(span.glyphs, line);
      if (logo) {
        latex += logo;
        text += logo === "\\TeX{}" ? "TeX" : "LaTeX";
        continue;
      }

      const sizes = span.glyphs
        .filter((glyph) => !glyph.space)
        .map((glyph) => glyph.size);
      const spanContext: MathContext = {
        ...context.math,
        rules: context.rulesByPage[line.pageIndex] ?? [],
        baseSize: median(sizes) || context.bodySize,
      };
      const result = reconstructMath(span.glyphs, spanContext, { display: false });
      mathSpans += 1;
      if (!result.latex) {
        continue;
      }
      if (!isSafeMath(result.latex)) {
        // Fall back to the readable characters rather than emit something that
        // will not compile.
        const rendered = renderTextSpan(span.glyphs, line, context.bodySize);
        latex += rendered.latex;
        text += rendered.text;
        lowConfidenceSpans += 1;
        continue;
      }
      if (result.confidence < 0.65) {
        lowConfidenceSpans += 1;
      }
      const needsSpaceBefore = /[A-Za-z0-9)]$/.test(latex) && !/\s$/.test(latex);
      latex += `${needsSpaceBefore ? " " : ""}$${result.latex}$`;
      text += ` ${result.latex} `;
    }
  });

  return {
    latex: latex.replace(/[ \t]+\n/g, "\n").replace(/\n{2,}/g, "\n"),
    text: text.replace(/\s+/g, " ").trim(),
    mathSpans,
    lowConfidenceSpans,
  };
}
