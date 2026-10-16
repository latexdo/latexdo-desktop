import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
// Load TeX extensions explicitly instead of AllPackages: the full bundle
// includes loader machinery that evaluates code at import time, which the
// renderer CSP (script-src 'self') forbids.
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";
import "mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js";
import "mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "mathjax-full/js/input/tex/color/ColorConfiguration.js";
import "mathjax-full/js/input/tex/cancel/CancelConfiguration.js";
import "mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js";
import "mathjax-full/js/input/tex/textmacros/TextMacrosConfiguration.js";

const texPackages = [
  "base",
  "ams",
  "newcommand",
  "noundefined",
  "boldsymbol",
  "color",
  "cancel",
  "mathtools",
  "textmacros",
];

export interface MathAtPosition {
  /** TeX body without the delimiters. */
  tex: string;
  display: boolean;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

const displayEnvironments = [
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "eqnarray",
  "eqnarray*",
];

interface OffsetRange {
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
  display: boolean;
}

function isEscapedAt(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function findDelimitedRanges(text: string): OffsetRange[] {
  const ranges: OffsetRange[] = [];

  const pairs: Array<{ open: string; close: string; display: boolean }> = [
    { open: "\\[", close: "\\]", display: true },
    { open: "\\(", close: "\\)", display: false },
  ];
  for (const { open, close, display } of pairs) {
    let cursor = 0;
    while (cursor < text.length) {
      const start = text.indexOf(open, cursor);
      if (start === -1) break;
      const end = text.indexOf(close, start + open.length);
      if (end === -1) break;
      ranges.push({
        start,
        end: end + close.length,
        bodyStart: start + open.length,
        bodyEnd: end,
        display,
      });
      cursor = end + close.length;
    }
  }

  for (const environment of displayEnvironments) {
    const open = `\\begin{${environment}}`;
    const close = `\\end{${environment}}`;
    let cursor = 0;
    while (cursor < text.length) {
      const start = text.indexOf(open, cursor);
      if (start === -1) break;
      const end = text.indexOf(close, start + open.length);
      if (end === -1) break;
      ranges.push({
        start,
        end: end + close.length,
        bodyStart: start + open.length,
        bodyEnd: end,
        display: true,
      });
      cursor = end + close.length;
    }
  }

  // Inline/display dollar math, skipping escaped \$ occurrences.
  const dollarPositions: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "$" && !isEscapedAt(text, index)) {
      dollarPositions.push(index);
    }
  }
  let cursor = 0;
  while (cursor < dollarPositions.length - 1) {
    const start = dollarPositions[cursor];
    const doubled = dollarPositions[cursor + 1] === start + 1;
    if (doubled) {
      // $$ ... $$
      const closeIndex = dollarPositions.findIndex(
        (position, index) =>
          index > cursor + 1 && dollarPositions[index + 1] === position + 1,
      );
      if (closeIndex === -1) break;
      ranges.push({
        start,
        end: dollarPositions[closeIndex + 1] + 1,
        bodyStart: start + 2,
        bodyEnd: dollarPositions[closeIndex],
        display: true,
      });
      cursor = closeIndex + 2;
      continue;
    }
    ranges.push({
      start,
      end: dollarPositions[cursor + 1] + 1,
      bodyStart: start + 1,
      bodyEnd: dollarPositions[cursor + 1],
      display: false,
    });
    cursor += 2;
  }

  return ranges;
}

function offsetOf(lines: string[], line: number, column: number): number {
  let offset = 0;
  for (let index = 0; index < line - 1 && index < lines.length; index += 1) {
    offset += lines[index].length + 1;
  }
  return offset + column - 1;
}

function positionOf(lines: string[], offset: number): { line: number; column: number } {
  let remaining = offset;
  for (let index = 0; index < lines.length; index += 1) {
    if (remaining <= lines[index].length) {
      return { line: index + 1, column: remaining + 1 };
    }
    remaining -= lines[index].length + 1;
  }
  const lastLine = Math.max(1, lines.length);
  return { line: lastLine, column: (lines[lastLine - 1]?.length ?? 0) + 1 };
}

/**
 * Finds the math expression (inline or display) containing the given
 * 1-based line and column, or null when the position is not inside math.
 */
export function parseMathAtPosition(
  text: string,
  line: number,
  column: number,
): MathAtPosition | null {
  const lines = text.split("\n");
  const offset = offsetOf(lines, line, column);
  const candidates = findDelimitedRanges(text)
    .filter((range) => offset >= range.start && offset <= range.end)
    .sort((a, b) => a.end - a.start - (b.end - b.start));

  const range = candidates[0];
  if (!range) return null;

  const tex = text.slice(range.bodyStart, range.bodyEnd).trim();
  if (!tex) return null;

  const startPosition = positionOf(lines, range.start);
  const endPosition = positionOf(lines, range.end);
  return {
    tex,
    display: range.display,
    startLine: startPosition.line,
    startColumn: startPosition.column,
    endLine: endPosition.line,
    endColumn: endPosition.column,
  };
}

let renderer: {
  convert: (tex: string, display: boolean) => string;
} | null = null;

function ensureRenderer() {
  if (renderer) return renderer;

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({
    packages: texPackages,
    formatError: (_jax: unknown, error: { message: string }) => {
      throw new Error(error.message);
    },
  });
  const svg = new SVG({ fontCache: "local" });
  const document = mathjax.document("", { InputJax: tex, OutputJax: svg });

  renderer = {
    convert: (texSource: string, display: boolean) => {
      const node = document.convert(texSource, { display });
      return adaptor.innerHTML(node as Parameters<typeof adaptor.innerHTML>[0]);
    },
  };
  return renderer;
}

/**
 * Renders TeX math to an SVG data URI with a transparent background and the
 * given foreground color, ready to embed in a Markdown hover. Returns null
 * when the expression cannot be rendered.
 */
export function mathPreviewDataUri(
  tex: string,
  display: boolean,
  color: string,
): string | null {
  try {
    const svgMarkup = ensureRenderer().convert(tex, display);
    if (!svgMarkup.includes("<svg") || svgMarkup.includes("data-mjx-error")) {
      return null;
    }
    // MathJax paints glyphs with currentColor; pin it to the theme foreground.
    // The background stays transparent so the preview always matches the
    // surrounding UI.
    const themed = svgMarkup.replace(/^<svg /, `<svg style="color:${color};" `);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(themed)}`;
  } catch {
    return null;
  }
}
