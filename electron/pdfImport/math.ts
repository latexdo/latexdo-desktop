/**
 * Formula reconstruction.
 *
 * A rendered formula is a two dimensional arrangement of glyphs, so recovering the
 * source means recovering that structure rather than reading characters in order.
 * The approach is a baseline structure tree: composite constructions that are
 * delimited by drawn rules (fractions, radicals) are extracted first and collapsed
 * into single units, then the remaining units are walked left to right against a
 * dominant baseline, and anything sitting measurably above or below that baseline
 * with a smaller point size becomes a superscript, a subscript, or the limit of a
 * large operator. Scripts recurse through the same procedure.
 */

import { isExtensionFont, mathAlphabetCommand } from "./fonts.js";
import type { Glyph, RuleSegment } from "./model.js";
import { median } from "./model.js";
import {
  mathAccents,
  mathOperatorNames,
  mathSymbolFor,
  mathTextIdentifiers,
  type MathClass,
} from "./symbols.js";

export interface MathContext {
  /** Horizontal rules on the page, used to find fraction bars and radicals. */
  rules: RuleSegment[];
  /** Nominal point size of running maths, used for relative size judgements. */
  baseSize: number;
  packages: Set<string>;
  warnings: string[];
}

export interface MathResult {
  latex: string;
  /** 0 to 1. Below about 0.6 the caller should flag the formula for review. */
  confidence: number;
  /** True when the region is laid out as several aligned lines. */
  multiline: boolean;
}

interface Unit {
  latex: string;
  mathClass: MathClass;
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Baseline the unit sits on, or the visual centre for composite units. */
  baseline: number;
  size: number;
  /** Single letter contents, so adjacent letters can be merged into words. */
  letter?: string;
  upright?: boolean;
  /** Delimiters drawn from an extension font, or otherwise oversized. */
  stretchy?: boolean;
  /** Marks units that already carry their own scripts. */
  closed?: boolean;
  penalty: number;
}

const openDelimiters = new Set([
  "(",
  "[",
  "\\{",
  "\\langle",
  "\\lceil",
  "\\lfloor",
  "\\llbracket",
]);
const closeDelimiters = new Set([
  ")",
  "]",
  "\\}",
  "\\rangle",
  "\\rceil",
  "\\rfloor",
  "\\rrbracket",
]);
const delimiterPairs = new Map<string, string>([
  ["(", ")"],
  ["[", "]"],
  ["\\{", "\\}"],
  ["\\langle", "\\rangle"],
  ["\\lceil", "\\rceil"],
  ["\\lfloor", "\\rfloor"],
  ["\\llbracket", "\\rrbracket"],
]);

const bigOperators = new Set([
  "\\sum",
  "\\prod",
  "\\coprod",
  "\\int",
  "\\iint",
  "\\iiint",
  "\\oint",
  "\\bigcap",
  "\\bigcup",
  "\\bigwedge",
  "\\bigvee",
  "\\bigoplus",
  "\\bigotimes",
  "\\bigodot",
  "\\biguplus",
  "\\bigsqcup",
  "\\lim",
  "\\limsup",
  "\\liminf",
  "\\max",
  "\\min",
  "\\sup",
  "\\inf",
]);

function glyphHeight(glyph: Glyph): number {
  return glyph.size;
}

/** Wraps `body` in braces. Always explicit, so the generated source reads clearly. */
function brace(body: string): string {
  return `{${body.trim()}}`;
}

function isHorizontalRule(rule: RuleSegment): boolean {
  return rule.horizontal && rule.x2 - rule.x1 > 1.5;
}

function unitFromGlyph(glyph: Glyph, context: MathContext): Unit | null {
  if (glyph.space) {
    return null;
  }
  const character = glyph.text;
  if (!character) {
    return null;
  }

  const alphabet = mathAlphabetCommand(glyph.font);
  const height = glyphHeight(glyph);
  const base: Omit<Unit, "latex" | "mathClass"> = {
    left: glyph.x,
    right: glyph.x + glyph.width,
    top: glyph.y - height * 0.75,
    bottom: glyph.y + height * 0.25,
    baseline: glyph.y,
    size: height,
    penalty: 0,
  };

  // A letter: the maths alphabet of the font decides how it must be written.
  if (/^[A-Za-z]$/.test(character)) {
    const upright = !glyph.font.italic;
    let latex = character;
    if (alphabet && alphabet !== "mathrm") {
      latex = `\\${alphabet}{${character}}`;
    }
    return {
      ...base,
      latex,
      mathClass: "ord",
      letter: character,
      upright: upright && (!alphabet || alphabet === "mathrm"),
      closed: Boolean(alphabet && alphabet !== "mathrm"),
    };
  }

  const accent = mathAccents.get(character.codePointAt(0) ?? 0);
  if (accent && glyph.width < height * 0.55) {
    return { ...base, latex: `\\${accent}`, mathClass: "accent" };
  }

  const symbol = mathSymbolFor(character);
  if (!symbol) {
    context.warnings.push(
      `No LaTeX equivalent for "${character}" (U+${(character.codePointAt(0) ?? 0)
        .toString(16)
        .toUpperCase()
        .padStart(4, "0")}) in a formula.`,
    );
    return { ...base, latex: `\\text{${character}}`, mathClass: "ord", penalty: 1 };
  }
  const requires = symbol.requires;
  if (requires && requires !== "amsmath") {
    context.packages.add(requires);
  }

  const stretchy = isExtensionFont(glyph.font) || height > context.baseSize * 1.3;
  return {
    ...base,
    latex: symbol.latex,
    mathClass: symbol.mathClass,
    stretchy:
      stretchy &&
      (openDelimiters.has(symbol.latex) ||
        closeDelimiters.has(symbol.latex) ||
        symbol.latex === "\\mid" ||
        symbol.latex === "\\|"),
    // An extension font glyph is drawn much taller than its nominal size, so
    // report a height that reflects what the reader sees.
    top: isExtensionFont(glyph.font) ? glyph.y - height * 1.6 : base.top,
  };
}

interface Extraction {
  units: Unit[];
  consumed: Set<Glyph>;
}

/**
 * Collapses fractions and radicals into single units, innermost last: the widest
 * bar is taken first so nested fractions resolve in the right order.
 */
function extractComposites(
  glyphs: Glyph[],
  rules: RuleSegment[],
  context: MathContext,
  depth: number,
): Extraction {
  const consumed = new Set<Glyph>();
  const units: Unit[] = [];
  if (depth > 8) {
    return { units, consumed };
  }

  const available = glyphs.filter((glyph) => !glyph.space && glyph.text);
  const usedRules = new Set<RuleSegment>();

  const radicalGlyphs = available.filter((glyph) => glyph.text === "√");
  const bars = rules
    .filter(isHorizontalRule)
    .sort((a, b) => b.x2 - b.x1 - (a.x2 - a.x1));

  // Radicals first: their overbar would otherwise look like a fraction bar.
  for (const radical of radicalGlyphs) {
    if (consumed.has(radical)) {
      continue;
    }
    const bar = bars.find(
      (candidate) =>
        !usedRules.has(candidate) &&
        candidate.x1 >= radical.x - radical.size * 0.2 &&
        candidate.x1 <= radical.x + radical.width + radical.size * 0.6 &&
        candidate.y1 < radical.y - radical.size * 0.2,
    );
    if (!bar) {
      continue;
    }
    const inside = available.filter(
      (glyph) =>
        !consumed.has(glyph) &&
        glyph !== radical &&
        glyph.x + glyph.width * 0.5 > bar.x1 - 0.5 &&
        glyph.x + glyph.width * 0.5 < bar.x2 + 0.5 &&
        glyph.y > bar.y1,
    );
    // An index sits above and to the left of the sign, as in a cube root.
    const index = available.filter(
      (glyph) =>
        !consumed.has(glyph) &&
        glyph !== radical &&
        glyph.x + glyph.width <= radical.x + radical.width * 0.7 &&
        glyph.x + glyph.width > radical.x - radical.size &&
        glyph.y < radical.y - radical.size * 0.35,
    );
    if (!inside.length) {
      continue;
    }
    usedRules.add(bar);
    consumed.add(radical);
    for (const glyph of [...inside, ...index]) {
      consumed.add(glyph);
    }
    const body = parseUnits(inside, rules, context, depth + 1);
    const degree = index.length ? parseUnits(index, rules, context, depth + 1) : null;
    const baseline = Math.max(...inside.map((glyph) => glyph.y));
    units.push({
      latex: degree
        ? `\\sqrt[${degree.latex}]${brace(body.latex)}`
        : `\\sqrt${brace(body.latex)}`,
      mathClass: "ord",
      left: radical.x,
      right: bar.x2,
      top: bar.y1,
      bottom: Math.max(...inside.map((glyph) => glyph.y + glyph.size * 0.25)),
      baseline,
      size: median(inside.map((glyph) => glyph.size)) || radical.size,
      closed: false,
      penalty: body.penalty,
    });
  }

  for (const bar of bars) {
    if (usedRules.has(bar)) {
      continue;
    }
    const width = bar.x2 - bar.x1;
    const span = (glyph: Glyph) => {
      const centre = glyph.x + glyph.width * 0.5;
      return centre > bar.x1 - 1 && centre < bar.x2 + 1;
    };
    const above = available.filter(
      (glyph) => !consumed.has(glyph) && span(glyph) && glyph.y < bar.y1,
    );
    const below = available.filter(
      (glyph) => !consumed.has(glyph) && span(glyph) && glyph.y > bar.y1,
    );
    if (!above.length || !below.length) {
      continue;
    }
    // A fraction bar is only as wide as its widest part; a rule that extends well
    // past its content is a table rule or an underline.
    const contentLeft = Math.min(...[...above, ...below].map((glyph) => glyph.x));
    const contentRight = Math.max(
      ...[...above, ...below].map((glyph) => glyph.x + glyph.width),
    );
    if (contentRight - contentLeft < width * 0.55) {
      continue;
    }
    const nearest = Math.min(
      ...[...above, ...below].map((glyph) => Math.abs(glyph.y - bar.y1)),
    );
    const scale =
      median([...above, ...below].map((glyph) => glyph.size)) || context.baseSize;
    if (nearest > scale * 1.6) {
      continue;
    }

    usedRules.add(bar);
    for (const glyph of [...above, ...below]) {
      consumed.add(glyph);
    }
    const innerRules = rules.filter(
      (rule) => rule !== bar && rule.x1 >= bar.x1 - 1 && rule.x2 <= bar.x2 + 1,
    );
    const numerator = parseUnits(above, innerRules, context, depth + 1);
    const denominator = parseUnits(below, innerRules, context, depth + 1);
    units.push({
      latex: `\\frac${brace(numerator.latex)}${brace(denominator.latex)}`,
      mathClass: "ord",
      left: bar.x1,
      right: bar.x2,
      top: Math.min(...above.map((glyph) => glyph.y - glyph.size * 0.75)),
      bottom: Math.max(...below.map((glyph) => glyph.y + glyph.size * 0.25)),
      // The bar sits on the maths axis, a quarter em above the text baseline.
      baseline: bar.y1 + scale * 0.25,
      size: scale,
      penalty: numerator.penalty + denominator.penalty,
    });
  }

  for (const glyph of available) {
    if (consumed.has(glyph)) {
      continue;
    }
    const unit = unitFromGlyph(glyph, context);
    if (unit) {
      units.push(unit);
      consumed.add(glyph);
    }
  }

  return { units: units.sort((a, b) => a.left - b.left), consumed };
}

interface ParsedUnits {
  latex: string;
  penalty: number;
}

function parseUnits(
  glyphs: Glyph[],
  rules: RuleSegment[],
  context: MathContext,
  depth: number,
): ParsedUnits {
  const { units } = extractComposites(glyphs, rules, context, depth);
  return structure(units, context, depth);
}

/**
 * Walks units against the dominant baseline, folding anything raised or lowered
 * into scripts. Returns LaTeX for the whole run.
 */
function structure(units: Unit[], context: MathContext, depth: number): ParsedUnits {
  if (!units.length) {
    return { latex: "", penalty: 0 };
  }
  if (depth > 10) {
    return { latex: units.map((unit) => unit.latex).join(""), penalty: 1 };
  }

  const sorted = [...units].sort((a, b) => a.left - b.left);
  const sizes = sorted.map((unit) => unit.size);
  const mainSize = Math.max(...sizes);
  const fullSize = sorted.filter((unit) => unit.size >= mainSize * 0.82);
  const baselineY = median(
    (fullSize.length ? fullSize : sorted).map((unit) => unit.baseline),
  );
  const referenceSize = median(
    (fullSize.length ? fullSize : sorted).map((u) => u.size),
  );

  type Relation = "base" | "sup" | "sub";
  const relationOf = (unit: Unit, previous: Unit | null): Relation => {
    const delta = unit.baseline - baselineY;
    const smaller = unit.size < referenceSize * 0.86;
    const raised = delta < -referenceSize * 0.17;
    const lowered = delta > referenceSize * 0.14;

    if (previous && bigOperators.has(previous.latex)) {
      // Limits are centred on the operator rather than offset to its right, and
      // their own baselines are the reliable signal: the glyph box of a stretched
      // operator says little about where TeX actually placed it.
      const previousCentre = (previous.left + previous.right) / 2;
      const unitCentre = (unit.left + unit.right) / 2;
      const aligned =
        Math.abs(unitCentre - previousCentre) <
        Math.max(previous.right - previous.left, referenceSize) * 0.85;
      if (aligned) {
        const offset = unit.baseline - previous.baseline;
        if (offset < -referenceSize * 0.22) {
          return "sup";
        }
        if (offset > referenceSize * 0.12) {
          return "sub";
        }
      }
    }

    if (!smaller) {
      // Same size text far off the baseline is still a script when it follows a
      // closed atom, which is how oversized exponents are typeset.
      if (raised && delta < -referenceSize * 0.45) {
        return "sup";
      }
      if (lowered && delta > referenceSize * 0.35) {
        return "sub";
      }
      return "base";
    }
    if (raised) {
      return "sup";
    }
    if (lowered) {
      return "sub";
    }
    return "base";
  };

  interface Pending {
    relation: Relation;
    units: Unit[];
  }

  const pieces: Unit[] = [];
  let index = 0;
  let penalty = 0;

  while (index < sorted.length) {
    const unit = sorted[index];
    const previous = pieces.length ? pieces[pieces.length - 1] : null;
    const relation = relationOf(unit, previous);

    if (relation === "base" || !previous) {
      pieces.push({ ...unit });
      index += 1;
      continue;
    }

    // Gather the whole script run: every following unit at the same relation.
    const group: Pending = { relation, units: [unit] };
    let lookahead = index + 1;
    while (lookahead < sorted.length) {
      const next = sorted[lookahead];
      if (relationOf(next, previous) !== relation) {
        break;
      }
      // A script run must stay close to its predecessors horizontally.
      const last = group.units[group.units.length - 1];
      if (next.left > last.right + referenceSize * 0.6) {
        break;
      }
      group.units.push(next);
      lookahead += 1;
    }
    index = lookahead;

    const inner = structure(group.units, context, depth + 1);
    penalty += inner.penalty;
    const isPrime = /^(?:'|''|''')$/.test(inner.latex.trim());
    const scriptMarker = group.relation === "sup" ? "^" : "_";
    const target = pieces[pieces.length - 1];

    if (isPrime && group.relation === "sup") {
      target.latex += inner.latex.trim();
    } else if (
      target.latex.includes(scriptMarker) &&
      !target.latex.endsWith("}") &&
      target.closed !== true
    ) {
      // Two scripts of the same kind on one atom cannot be expressed; keep both
      // but brace them so the output still compiles.
      target.latex = `{${target.latex}}${scriptMarker}${brace(inner.latex)}`;
      penalty += 1;
    } else {
      target.latex += `${scriptMarker}${brace(inner.latex)}`;
    }
    target.closed = true;
    target.right = Math.max(target.right, ...group.units.map((item) => item.right));
    target.top = Math.min(target.top, ...group.units.map((item) => item.top));
    target.bottom = Math.max(target.bottom, ...group.units.map((item) => item.bottom));
  }

  const merged = mergeWords(pieces, context);
  const withAccents = applyAccents(merged);
  const withDelimiters = pairDelimiters(withAccents, context);
  return {
    latex: joinUnits(withDelimiters, referenceSize),
    penalty: penalty + withDelimiters.reduce((total, unit) => total + unit.penalty, 0),
  };
}

/** Joins runs of upright letters into operator names or upright identifiers. */
function mergeWords(units: Unit[], context: MathContext): Unit[] {
  const result: Unit[] = [];
  let index = 0;
  while (index < units.length) {
    const unit = units[index];
    if (!unit.letter || !unit.upright || unit.closed) {
      result.push(unit);
      index += 1;
      continue;
    }
    const run = [unit];
    let cursor = index + 1;
    while (cursor < units.length) {
      const next = units[cursor];
      if (!next.letter || !next.upright || next.closed) {
        break;
      }
      const gap = next.left - run[run.length - 1].right;
      if (gap > next.size * 0.28) {
        break;
      }
      run.push(next);
      cursor += 1;
    }
    if (run.length < 2) {
      result.push(unit);
      index += 1;
      continue;
    }

    const word = run.map((item) => item.letter).join("");
    let latex: string;
    if (mathOperatorNames.has(word)) {
      latex = `\\${word}`;
    } else if (mathTextIdentifiers.has(word.toLowerCase())) {
      latex = `\\operatorname{${word}}`;
      context.packages.add("amsmath");
    } else {
      latex = `\\mathrm{${word}}`;
    }
    result.push({
      ...run[0],
      latex,
      letter: undefined,
      mathClass:
        mathOperatorNames.has(word) && bigOperators.has(`\\${word}`) ? "bigop" : "ord",
      right: run[run.length - 1].right,
      closed: false,
      penalty: 0,
    });
    index = cursor;
  }
  return result;
}

/** Folds accent units onto the atom they sit above. */
function applyAccents(units: Unit[]): Unit[] {
  const result: Unit[] = [];
  for (const unit of units) {
    if (unit.mathClass !== "accent") {
      result.push(unit);
      continue;
    }
    // The accent is emitted after its base when the base was wider, and before it
    // when the PDF drew the accent first.
    const previous = result[result.length - 1];
    if (
      previous &&
      previous.mathClass !== "accent" &&
      unit.left < previous.right &&
      unit.right > previous.left
    ) {
      previous.latex = `${unit.latex}${brace(previous.latex)}`;
      previous.closed = true;
      continue;
    }
    result.push({ ...unit, latex: `${unit.latex}{}`, penalty: unit.penalty + 0.5 });
  }
  return result;
}

/** Turns oversized delimiter pairs into `\left` and `\right`. */
function pairDelimiters(units: Unit[], context: MathContext): Unit[] {
  const stack: number[] = [];
  const openIndex = new Map<number, number>();
  units.forEach((unit, index) => {
    if (unit.stretchy && openDelimiters.has(unit.latex)) {
      stack.push(index);
      return;
    }
    if (unit.stretchy && closeDelimiters.has(unit.latex)) {
      for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
        const candidate = stack[depth];
        if (delimiterPairs.get(units[candidate].latex) === unit.latex) {
          openIndex.set(candidate, index);
          stack.length = depth;
          return;
        }
      }
    }
  });

  if (!openIndex.size) {
    return units;
  }
  context.packages.add("amsmath");
  const closers = new Set(openIndex.values());
  return units.map((unit, index) => {
    if (openIndex.has(index)) {
      return { ...unit, latex: `\\left${unit.latex}` };
    }
    if (closers.has(index)) {
      return { ...unit, latex: `\\right${unit.latex}` };
    }
    return unit;
  });
}

function joinUnits(units: Unit[], referenceSize: number): string {
  let result = "";
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (index > 0) {
      const previous = units[index - 1];
      const gap = unit.left - previous.right;
      const spacedClass =
        previous.mathClass === "bin" ||
        previous.mathClass === "rel" ||
        unit.mathClass === "bin" ||
        unit.mathClass === "rel" ||
        previous.mathClass === "punct";
      if (gap > referenceSize * 1.1) {
        result += " \\quad ";
      } else if (!spacedClass && gap > referenceSize * 0.32) {
        result += "\\,";
      } else if (
        // Keep control words from running into the next token.
        /\\[A-Za-z]+$/.test(result) &&
        /^[A-Za-z]/.test(unit.latex)
      ) {
        result += " ";
      }
    }
    result += unit.latex;
  }
  return result.trim();
}

/**
 * Splits a region into the rows of a multi-line construction. Returns a single row
 * when the region is an ordinary one line formula.
 */
function splitRows(units: Unit[], referenceSize: number): Unit[][] {
  if (units.length < 2) {
    return [units];
  }
  const mainSize = Math.max(...units.map((unit) => unit.size));
  const fullSize = units.filter((unit) => unit.size >= mainSize * 0.82);
  if (fullSize.length < 2) {
    return [units];
  }

  const sorted = [...fullSize].sort((a, b) => a.baseline - b.baseline);
  const boundaries: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const delta = sorted[index].baseline - sorted[index - 1].baseline;
    if (delta > referenceSize * 1.35) {
      boundaries.push((sorted[index].baseline + sorted[index - 1].baseline) / 2);
    }
  }
  if (!boundaries.length) {
    return [units];
  }

  const rows: Unit[][] = Array.from({ length: boundaries.length + 1 }, () => []);
  for (const unit of units) {
    let row = 0;
    while (row < boundaries.length && unit.baseline > boundaries[row]) {
      row += 1;
    }
    rows[row].push(unit);
  }
  return rows.filter((row) => row.length > 0);
}

/**
 * Reconstructs a formula from its glyphs. `display` selects between a single
 * expression and a possibly multi-line aligned block.
 */
export function reconstructMath(
  glyphs: Glyph[],
  context: MathContext,
  options: { display: boolean } = { display: false },
): MathResult {
  const meaningful = glyphs.filter((glyph) => !glyph.space && glyph.text);
  if (!meaningful.length) {
    return { latex: "", confidence: 1, multiline: false };
  }

  const box = {
    left: Math.min(...meaningful.map((glyph) => glyph.x)),
    right: Math.max(...meaningful.map((glyph) => glyph.x + glyph.width)),
    top: Math.min(...meaningful.map((glyph) => glyph.y - glyph.size * 2)),
    bottom: Math.max(...meaningful.map((glyph) => glyph.y + glyph.size)),
  };
  const rules = context.rules.filter(
    (rule) =>
      isHorizontalRule(rule) &&
      rule.x1 >= box.left - 2 &&
      rule.x2 <= box.right + 2 &&
      rule.y1 >= box.top &&
      rule.y1 <= box.bottom,
  );

  const { units } = extractComposites(meaningful, rules, context, 0);
  const referenceSize =
    median(
      units
        .filter((unit) => unit.size >= Math.max(...units.map((u) => u.size)) * 0.82)
        .map((unit) => unit.size),
    ) || context.baseSize;

  const rows = options.display ? splitRows(units, referenceSize) : [units];
  const rendered = rows.map((row) => structure(row, context, 0));
  const totalPenalty = rendered.reduce((sum, row) => sum + row.penalty, 0);
  const confidence = Math.max(
    0,
    Math.min(1, 1 - totalPenalty / Math.max(4, meaningful.length / 3)),
  );

  if (rows.length > 1) {
    context.packages.add("amsmath");
    // Align on the first relation symbol of each row, which is what authors do.
    const aligned = rendered.map((row) => alignOnRelation(row.latex));
    return {
      latex: aligned.join(" \\\\\n"),
      confidence,
      multiline: true,
    };
  }

  return { latex: rendered[0]?.latex ?? "", confidence, multiline: false };
}

const relationPattern =
  /(\\leq|\\geq|\\neq|\\equiv|\\approx|\\simeq|\\sim|\\subseteq|\\supseteq|\\subset|\\supset|\\in|\\to|\\rightarrow|\\Rightarrow|\\leftarrow|\\le|\\ge|=|<|>)/;

function alignOnRelation(latex: string): string {
  if (latex.includes("&")) {
    return latex;
  }
  const match = relationPattern.exec(latex);
  if (!match || match.index === 0) {
    return `& ${latex}`;
  }
  const before = latex.slice(0, match.index).trimEnd();
  const rest = latex.slice(match.index);
  return `${before} &${rest}`;
}

/** Verifies a snippet is brace balanced and free of constructs that break builds. */
export function isSafeMath(latex: string): boolean {
  let depth = 0;
  for (let index = 0; index < latex.length; index += 1) {
    const character = latex[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }
  if (depth !== 0) {
    return false;
  }
  const leftCount = (latex.match(/\\left/g) ?? []).length;
  const rightCount = (latex.match(/\\right/g) ?? []).length;
  return leftCount === rightCount && !latex.includes("$");
}
