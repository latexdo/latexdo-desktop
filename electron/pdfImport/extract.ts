/**
 * Turns a PDF into the geometric content model.
 *
 * `getTextContent` merges glyphs into word chunks and hides the PDF font name,
 * which loses exactly the information needed to recover maths. So we walk the raw
 * operator list and run the PDF text state machine ourselves, producing one record
 * per glyph with its baseline, advance width, effective point size and originating
 * font. The same pass collects the thin rectangles that fraction bars, radical
 * overbars and table rules are drawn as, plus the bounding boxes of images and
 * vector artwork so figures can be located.
 */

import { describeFont } from "./fonts.js";
import type {
  DocumentContent,
  FontDescriptor,
  Glyph,
  GraphicRegion,
  PageContent,
  RuleSegment,
} from "./model.js";
import { repairGlyphText } from "./symbols.js";

type Matrix = [number, number, number, number, number, number];

interface PdfGlyph {
  originalCharCode: number;
  unicode: string;
  width: number;
  isSpace: boolean;
}

interface PdfPageProxy {
  view: number[];
  rotate: number;
  getViewport(options: { scale: number }): {
    width: number;
    height: number;
    transform: number[];
  };
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  commonObjs: { has(key: string): boolean; get(key: string): unknown };
  objs: { has(key: string): boolean; get(key: string): unknown };
  cleanup(): void;
}

interface PdfDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageProxy>;
  getMetadata(): Promise<{ info?: Record<string, unknown> }>;
  destroy(): Promise<void>;
}

export interface ExtractOptions {
  maxPages?: number;
  /** Hard cap on retained glyphs, guarding against pathological documents. */
  maxGlyphs?: number;
}

const ops = {
  dependency: 1,
  setLineWidth: 2,
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  clip: 29,
  eoClip: 30,
  beginText: 31,
  endText: 32,
  setCharSpacing: 33,
  setWordSpacing: 34,
  setHScale: 35,
  setLeading: 36,
  setFont: 37,
  setTextRenderingMode: 38,
  setTextRise: 39,
  moveText: 40,
  setLeadingMoveText: 41,
  setTextMatrix: 42,
  nextLine: 43,
  showText: 44,
  showSpacedText: 45,
  nextLineShowText: 46,
  nextLineSetSpacingShowText: 47,
  shadingFill: 62,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  paintImageMaskXObject: 83,
  paintImageMaskXObjectGroup: 84,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintInlineImageXObjectGroup: 87,
  paintImageXObjectRepeat: 88,
  paintImageMaskXObjectRepeat: 89,
  paintSolidColorImageMask: 90,
  constructPath: 91,
} as const;

const identity: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

function applyMatrix(matrix: Matrix, x: number, y: number): [number, number] {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ];
}

function verticalScale(matrix: Matrix): number {
  return Math.hypot(matrix[2], matrix[3]);
}

function horizontalScale(matrix: Matrix): number {
  return Math.hypot(matrix[0], matrix[1]);
}

function asMatrix(value: unknown): Matrix {
  const array = Array.isArray(value) ? value : identity;
  return [
    Number(array[0]) || 0,
    Number(array[1]) || 0,
    Number(array[2]) || 0,
    Number(array[3]) || 0,
    Number(array[4]) || 0,
    Number(array[5]) || 0,
  ];
}

interface GraphicsState {
  ctm: Matrix;
  lineWidth: number;
  font: FontDescriptor | null;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
  rise: number;
  renderMode: number;
}

function cloneState(state: GraphicsState): GraphicsState {
  return { ...state, ctm: [...state.ctm] as Matrix };
}

interface PathPoint {
  x: number;
  y: number;
}

interface PathShape {
  points: PathPoint[];
  /** Rectangles are tracked separately so zero-area fills stay meaningful. */
  rectangles: Array<{ x: number; y: number; width: number; height: number }>;
  curved: boolean;
}

const maxRuleThickness = 2.4;
const minRuleLength = 1.5;

/**
 * Reads one page. Exported for tests, which feed it a synthetic page proxy rather
 * than a real PDF.
 */
export async function extractPage(
  page: PdfPageProxy,
  index: number,
  fonts: Map<string, FontDescriptor>,
  warnings: string[],
  glyphBudget: { remaining: number },
): Promise<PageContent> {
  const viewport = page.getViewport({ scale: 1 });
  const baseCtm = asMatrix(viewport.transform);
  const operatorList = await page.getOperatorList();

  const glyphs: Glyph[] = [];
  const rules: RuleSegment[] = [];
  const graphics: GraphicRegion[] = [];

  let state: GraphicsState = {
    ctm: baseCtm,
    lineWidth: 1,
    font: null,
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
    renderMode: 0,
  };
  const stack: GraphicsState[] = [];
  let textMatrix: Matrix = [...identity] as Matrix;
  let lineMatrix: Matrix = [...identity] as Matrix;
  let path: PathShape = { points: [], rectangles: [], curved: false };
  let rotatedTextSeen = false;
  let invisibleGlyphs = 0;

  const resolveFont = (key: string): FontDescriptor => {
    const cached = fonts.get(key);
    if (cached) {
      return cached;
    }
    let raw = key;
    let glyphScale = 0.001;
    const holder = page.commonObjs.has(key)
      ? page.commonObjs
      : page.objs.has(key)
        ? page.objs
        : null;
    if (holder) {
      const object = holder.get(key) as
        | { name?: string; fontMatrix?: number[] }
        | undefined;
      if (object?.name) {
        raw = object.name;
      }
      if (Array.isArray(object?.fontMatrix) && Number.isFinite(object.fontMatrix[0])) {
        glyphScale = Math.abs(object.fontMatrix[0]) || 0.001;
      }
    }
    const descriptor = describeFont(key, raw, glyphScale);
    fonts.set(key, descriptor);
    return descriptor;
  };

  const flushPath = (filled: boolean) => {
    const { points, rectangles, curved } = path;
    path = { points: [], rectangles: [], curved: false };

    const strokeWidth = Math.max(
      0.1,
      state.lineWidth * ((verticalScale(state.ctm) + horizontalScale(state.ctm)) / 2),
    );

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let ruleCount = 0;
    const note = (x: number, y: number) => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    };

    const pushRule = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      thickness: number,
    ) => {
      const width = Math.abs(x2 - x1);
      const height = Math.abs(y2 - y1);
      const horizontal = height <= maxRuleThickness && width >= minRuleLength;
      const vertical = width <= maxRuleThickness && height >= minRuleLength;
      if (!horizontal && !vertical) {
        return false;
      }
      rules.push({
        x1: Math.min(x1, x2),
        x2: Math.max(x1, x2),
        y1: Math.min(y1, y2),
        y2: Math.max(y1, y2),
        thickness: Math.max(thickness, horizontal ? height : width) || strokeWidth,
        pageIndex: index,
        horizontal,
        vertical: vertical && !horizontal,
      });
      ruleCount += 1;
      return true;
    };

    for (const rectangle of rectangles) {
      const [x1, y1] = applyMatrix(state.ctm, rectangle.x, rectangle.y);
      const [x2, y2] = applyMatrix(
        state.ctm,
        rectangle.x + rectangle.width,
        rectangle.y + rectangle.height,
      );
      note(x1, y1);
      note(x2, y2);
      if (filled) {
        pushRule(x1, y1, x2, y2, Math.abs(y2 - y1));
      } else {
        pushRule(x1, y1, x2, y1, strokeWidth);
        pushRule(x1, y2, x2, y2, strokeWidth);
        pushRule(x1, y1, x1, y2, strokeWidth);
        pushRule(x2, y1, x2, y2, strokeWidth);
      }
    }

    if (!curved) {
      for (let i = 1; i < points.length; i += 1) {
        const from = points[i - 1];
        const to = points[i];
        note(from.x, from.y);
        note(to.x, to.y);
        pushRule(from.x, from.y, to.x, to.y, strokeWidth);
      }
    } else {
      for (const point of points) {
        note(point.x, point.y);
      }
    }

    // Anything that was not a rule is artwork worth remembering for figures.
    const hasArea =
      Number.isFinite(minX) && maxX - minX > 4 && maxY - minY > 4 && !ruleCount;
    if (hasArea) {
      graphics.push({
        pageIndex: index,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        kind: "vector",
      });
    }
  };

  const showGlyphs = (items: unknown) => {
    const font = state.font;
    if (!font || !Array.isArray(items)) {
      return;
    }
    for (const item of items) {
      if (typeof item === "number") {
        // TJ number: a displacement in thousandths of the current font size.
        const shift = (-item / 1000) * state.fontSize * state.hScale;
        textMatrix = multiply([1, 0, 0, 1, shift, 0], textMatrix);
        continue;
      }
      if (!item || typeof item !== "object") {
        continue;
      }
      const glyph = item as PdfGlyph;
      const parameters: Matrix = [
        state.fontSize * state.hScale,
        0,
        0,
        state.fontSize,
        0,
        state.rise,
      ];
      const render = multiply(parameters, multiply(textMatrix, state.ctm));
      const advanceText =
        (glyph.width * font.glyphScale * state.fontSize +
          state.charSpacing +
          (glyph.isSpace ? state.wordSpacing : 0)) *
        state.hScale;
      const scaleX = horizontalScale(multiply(textMatrix, state.ctm));
      const size = verticalScale(render);

      if (glyphBudget.remaining > 0 && size > 0.4) {
        const skewed =
          Math.abs(render[1]) > Math.abs(render[0]) * 0.25 ||
          Math.abs(render[2]) > Math.abs(render[3]) * 0.6;
        if (skewed) {
          rotatedTextSeen = true;
        } else {
          const text = repairGlyphText(
            font,
            glyph.originalCharCode,
            glyph.unicode ?? "",
          );
          const isSpace = glyph.isSpace || text === " " || text === " ";
          if (text || isSpace) {
            if (state.renderMode === 3 || state.renderMode === 7) {
              invisibleGlyphs += 1;
            }
            glyphBudget.remaining -= 1;
            glyphs.push({
              text: isSpace ? " " : text,
              x: render[4],
              // Already in y-down page space, with any text rise folded in.
              y: render[5],
              width: Math.abs(advanceText * scaleX),
              size,
              font,
              rise: state.rise,
              space: isSpace,
              pageIndex: index,
            });
          }
        }
      }

      textMatrix = multiply([1, 0, 0, 1, advanceText, 0], textMatrix);
    }
  };

  const nextLine = () => {
    lineMatrix = multiply([1, 0, 0, 1, 0, -state.leading], lineMatrix);
    textMatrix = [...lineMatrix] as Matrix;
  };

  const noteImage = () => {
    const [x1, y1] = applyMatrix(state.ctm, 0, 0);
    const [x2, y2] = applyMatrix(state.ctm, 1, 1);
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    if (width > 4 && height > 4) {
      graphics.push({ pageIndex: index, x, y, width, height, kind: "image" });
    }
  };

  for (let i = 0; i < operatorList.fnArray.length; i += 1) {
    const fn = operatorList.fnArray[i];
    const args = operatorList.argsArray[i] ?? [];

    switch (fn) {
      case ops.save:
        stack.push(cloneState(state));
        break;
      case ops.restore: {
        const previous = stack.pop();
        if (previous) {
          state = previous;
        }
        break;
      }
      case ops.transform:
        state.ctm = multiply(asMatrix(args), state.ctm);
        break;
      case ops.paintFormXObjectBegin:
        stack.push(cloneState(state));
        state.ctm = multiply(asMatrix(args[0]), state.ctm);
        break;
      case ops.paintFormXObjectEnd: {
        const previous = stack.pop();
        if (previous) {
          state = previous;
        }
        break;
      }
      case ops.setLineWidth:
        state.lineWidth = Number(args[0]) || 0;
        break;
      case ops.beginText:
        textMatrix = [...identity] as Matrix;
        lineMatrix = [...identity] as Matrix;
        break;
      case ops.endText:
        break;
      case ops.setFont: {
        const key = String(args[0] ?? "");
        state.font = resolveFont(key);
        state.fontSize = Number(args[1]) || 0;
        break;
      }
      case ops.setCharSpacing:
        state.charSpacing = Number(args[0]) || 0;
        break;
      case ops.setWordSpacing:
        state.wordSpacing = Number(args[0]) || 0;
        break;
      case ops.setHScale:
        state.hScale = (Number(args[0]) || 100) / 100;
        break;
      case ops.setLeading:
        state.leading = Number(args[0]) || 0;
        break;
      case ops.setTextRise:
        state.rise = Number(args[0]) || 0;
        break;
      case ops.setTextRenderingMode:
        state.renderMode = Number(args[0]) || 0;
        break;
      case ops.setTextMatrix:
        textMatrix = asMatrix(args);
        lineMatrix = [...textMatrix] as Matrix;
        break;
      case ops.moveText: {
        lineMatrix = multiply(
          [1, 0, 0, 1, Number(args[0]) || 0, Number(args[1]) || 0],
          lineMatrix,
        );
        textMatrix = [...lineMatrix] as Matrix;
        break;
      }
      case ops.setLeadingMoveText: {
        state.leading = -(Number(args[1]) || 0);
        lineMatrix = multiply(
          [1, 0, 0, 1, Number(args[0]) || 0, Number(args[1]) || 0],
          lineMatrix,
        );
        textMatrix = [...lineMatrix] as Matrix;
        break;
      }
      case ops.nextLine:
        nextLine();
        break;
      case ops.showText:
      case ops.showSpacedText:
        showGlyphs(args[0]);
        break;
      case ops.nextLineShowText:
        nextLine();
        showGlyphs(args[0]);
        break;
      case ops.nextLineSetSpacingShowText:
        state.wordSpacing = Number(args[0]) || 0;
        state.charSpacing = Number(args[1]) || 0;
        nextLine();
        showGlyphs(args[2]);
        break;
      case ops.constructPath: {
        const pathOps = (args[0] as number[]) ?? [];
        const coordinates = (args[1] as number[]) ?? [];
        let cursor = 0;
        const take = (count: number): number[] => {
          const slice = coordinates.slice(cursor, cursor + count);
          cursor += count;
          return slice;
        };
        for (const pathOp of pathOps) {
          switch (pathOp) {
            case ops.moveTo:
            case ops.lineTo: {
              const [x, y] = take(2);
              const [tx, ty] = applyMatrix(state.ctm, x ?? 0, y ?? 0);
              if (pathOp === ops.moveTo && path.points.length) {
                // A new subpath: emit what we have so segments do not join across it.
                flushPathSegmentsOnly();
              }
              path.points.push({ x: tx, y: ty });
              break;
            }
            case ops.curveTo: {
              const values = take(6);
              path.curved = true;
              const [tx, ty] = applyMatrix(state.ctm, values[4] ?? 0, values[5] ?? 0);
              path.points.push({ x: tx, y: ty });
              break;
            }
            case ops.curveTo2:
            case ops.curveTo3: {
              const values = take(4);
              path.curved = true;
              const [tx, ty] = applyMatrix(state.ctm, values[2] ?? 0, values[3] ?? 0);
              path.points.push({ x: tx, y: ty });
              break;
            }
            case ops.rectangle: {
              const [x, y, width, height] = take(4);
              path.rectangles.push({
                x: x ?? 0,
                y: y ?? 0,
                width: width ?? 0,
                height: height ?? 0,
              });
              break;
            }
            case ops.closePath:
              if (path.points.length > 1) {
                path.points.push({ ...path.points[0] });
              }
              break;
            default:
              break;
          }
        }
        break;
      }
      case ops.fill:
      case ops.eoFill:
      case ops.fillStroke:
      case ops.eoFillStroke:
      case ops.closeFillStroke:
      case ops.closeEOFillStroke:
        flushPath(true);
        break;
      case ops.stroke:
      case ops.closeStroke:
        flushPath(false);
        break;
      case ops.endPath:
      case ops.clip:
      case ops.eoClip:
        path = { points: [], rectangles: [], curved: false };
        break;
      case ops.paintImageXObject:
      case ops.paintInlineImageXObject:
      case ops.paintImageMaskXObject:
      case ops.paintImageXObjectRepeat:
      case ops.paintImageMaskXObjectRepeat:
      case ops.paintImageMaskXObjectGroup:
      case ops.paintInlineImageXObjectGroup:
      case ops.paintSolidColorImageMask:
      case ops.shadingFill:
        noteImage();
        break;
      default:
        break;
    }
  }

  /** Emits the pending polyline without clearing rectangles or artwork state. */
  function flushPathSegmentsOnly(): void {
    const points = path.points;
    path.points = [];
    if (path.curved || points.length < 2) {
      return;
    }
    const strokeWidth = Math.max(
      0.1,
      state.lineWidth * ((verticalScale(state.ctm) + horizontalScale(state.ctm)) / 2),
    );
    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1];
      const to = points[i];
      const width = Math.abs(to.x - from.x);
      const height = Math.abs(to.y - from.y);
      const horizontal = height <= maxRuleThickness && width >= minRuleLength;
      const vertical = width <= maxRuleThickness && height >= minRuleLength;
      if (!horizontal && !vertical) {
        continue;
      }
      rules.push({
        x1: Math.min(from.x, to.x),
        x2: Math.max(from.x, to.x),
        y1: Math.min(from.y, to.y),
        y2: Math.max(from.y, to.y),
        thickness: strokeWidth,
        pageIndex: index,
        horizontal,
        vertical: vertical && !horizontal,
      });
    }
  }

  if (rotatedTextSeen) {
    warnings.push(
      `Page ${index + 1} contains rotated text, which was skipped. Check for sidebars or watermarks.`,
    );
  }
  if (glyphs.length > 0 && invisibleGlyphs / glyphs.length > 0.9) {
    warnings.push(
      `Page ${index + 1} looks like a scan with an invisible OCR text layer, so wording may be imperfect.`,
    );
  }

  page.cleanup();

  return {
    index,
    width: viewport.width,
    height: viewport.height,
    glyphs: glyphs.sort((a, b) => a.y - b.y || a.x - b.x),
    rules: dedupeRules(rules),
    graphics,
    scanned: glyphs.length === 0 && graphics.length > 0,
  };
}

function dedupeRules(rules: RuleSegment[]): RuleSegment[] {
  const seen = new Set<string>();
  const result: RuleSegment[] = [];
  for (const rule of rules) {
    const key = [
      rule.x1.toFixed(1),
      rule.y1.toFixed(1),
      rule.x2.toFixed(1),
      rule.y2.toFixed(1),
    ].join(":");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(rule);
  }
  return result;
}

export async function extractDocument(
  data: Uint8Array,
  options: ExtractOptions = {},
): Promise<DocumentContent> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
    getDocument(parameters: Record<string, unknown>): {
      promise: Promise<PdfDocumentProxy>;
    };
  };

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
    // Font programs still need parsing for glyph metrics, but no rendering happens.
    useWorkerFetch: false,
    stopAtErrors: false,
  });
  const document = await loadingTask.promise;
  const warnings: string[] = [];
  const fonts = new Map<string, FontDescriptor>();
  const pages: PageContent[] = [];
  const maxPages = options.maxPages ?? 120;
  const glyphBudget = { remaining: options.maxGlyphs ?? 1_500_000 };

  let title = "";
  let author = "";
  let producer = "";
  try {
    const metadata = await document.getMetadata();
    title = String(metadata.info?.Title ?? "").trim();
    author = String(metadata.info?.Author ?? "").trim();
    producer =
      `${metadata.info?.Producer ?? ""} ${metadata.info?.Creator ?? ""}`.trim();
  } catch {
    // Metadata is optional.
  }

  const pageCount = Math.min(document.numPages, maxPages);
  if (document.numPages > pageCount) {
    warnings.push(
      `Only the first ${pageCount} of ${document.numPages} pages were converted.`,
    );
  }

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    try {
      pages.push(await extractPage(page, pageNumber - 1, fonts, warnings, glyphBudget));
    } catch (error) {
      warnings.push(
        `Page ${pageNumber} could not be read: ${(error as Error).message ?? "unknown error"}`,
      );
    }
  }

  await document.destroy();

  return { pages, fonts, title, author, producer, warnings };
}
