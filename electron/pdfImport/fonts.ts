/**
 * Font name classification.
 *
 * The single most reliable signal for telling maths from prose in a PDF is the
 * font a glyph was set in: TeX puts variables in CMMI/LMMathItalic, operators and
 * relations in CMSY/MSAM, and stretched delimiters in CMEX. Word and InDesign
 * output leans on Cambria Math / STIX Math instead. This module turns a raw PDF
 * font name into the flags the rest of the pipeline reasons about.
 */

import type { FontDescriptor, MathFontRole } from "./model.js";

interface FamilyRule {
  pattern: RegExp;
  role: MathFontRole;
  bold?: boolean;
  italic?: boolean;
  monospace?: boolean;
  smallCaps?: boolean;
  serif?: boolean;
}

/** Ordered most specific first; the first match wins. */
const familyRules: FamilyRule[] = [
  // Computer Modern / Latin Modern maths.
  { pattern: /^CMMIB/, role: "variable", italic: true, bold: true },
  { pattern: /^CMMI/, role: "variable", italic: true },
  { pattern: /^CMBSY/, role: "symbol", bold: true },
  { pattern: /^CMSY/, role: "symbol" },
  { pattern: /^CMEX/, role: "extension" },
  { pattern: /^LMMATHITALIC/, role: "variable", italic: true },
  { pattern: /^LMMATHSYMBOLS/, role: "symbol" },
  { pattern: /^LMMATHEXTENSION/, role: "extension" },
  // AMS symbol fonts. MSBM holds the blackboard bold alphabet.
  { pattern: /^MSBM/, role: "blackboard" },
  { pattern: /^MSAM/, role: "symbol" },
  { pattern: /^(BBOLD|DSROM|BBM)/, role: "blackboard" },
  { pattern: /^(EUFM|EUFB)/, role: "fraktur" },
  { pattern: /^(EUSM|EUSB|RSFS)/, role: "calligraphic" },
  { pattern: /^(EURM|EURB)/, role: "variable", italic: true },
  // Commercial and OpenType maths.
  { pattern: /^MTMI/, role: "variable", italic: true },
  { pattern: /^(MTSY|MTEX|MATHEMATICALPI)/, role: "symbol" },
  { pattern: /MATH(EMATICAL)?(ITALIC)?$/, role: "variable", italic: true },
  { pattern: /(CAMBRIAMATH|STIXMATH|STIXTWOMATH|XITSMATH|ASANAMATH)/, role: "symbol" },
  {
    pattern: /(LATINMODERNMATH|TEXGYRE\w*MATH|LIBERTINUSMATH|FIRAMATH)/,
    role: "symbol",
  },
  { pattern: /^(SYMBOL|ZAPFDINGBATS|WINGDINGS)/, role: "symbol" },
  // Text families.
  { pattern: /^CM(CSC|FCSC)/, role: "text", smallCaps: true, serif: true },
  { pattern: /^CMBXTI/, role: "text", bold: true, italic: true, serif: true },
  { pattern: /^CMBXSL/, role: "text", bold: true, italic: true, serif: true },
  { pattern: /^CMBX/, role: "text", bold: true, serif: true },
  { pattern: /^CM(TI|SL|U)/, role: "text", italic: true, serif: true },
  { pattern: /^CMSSBX/, role: "sansMath", bold: true, serif: false },
  { pattern: /^CMSSI/, role: "sansMath", italic: true, serif: false },
  { pattern: /^CMSS/, role: "sansMath", serif: false },
  { pattern: /^CMTT/, role: "monoMath", monospace: true, serif: false },
  { pattern: /^CM(R|B)/, role: "text", serif: true },
  { pattern: /^LMMONO/, role: "monoMath", monospace: true, serif: false },
  { pattern: /^LMSANS/, role: "sansMath", serif: false },
  { pattern: /^LMROMAN/, role: "text", serif: true },
];

const boldPattern =
  /(BOLD|^.*-BD$|-BD[^A-Z]|SEMIBOLD|BLACK|HEAVY|DEMI|MEDI\b|-B$|BX\d)/;
const italicPattern = /(ITALIC|ITAL|OBLIQUE|-IT$|-IT[^A-Z]|SLANTED|CURSIVE)/;
const monoPattern = /(MONO|COURIER|CONSOLAS|TYPEWRITER|NIMBUSMON|MENLO|INCONSOLATA)/;
const sansPattern =
  /(HELVETICA|ARIAL|NIMBUSSAN|VERDANA|TAHOMA|CALIBRI|SANS|FIRA|LATO|ROBOTO|OPENSANS)/;
const smallCapsPattern = /(SMALLCAPS|SMCAPS|-SC$|CAPS$)/;

/** Strips the six-letter subset prefix PDF producers add, e.g. `GCXKZF+CMMI10`. */
function stripSubsetPrefix(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, "");
}

function parseDesignSize(name: string): number | null {
  // CMR10, LMRoman12-Regular, MSBM7 all encode the design size as trailing digits
  // on the family portion of the name.
  const match = /^([A-Za-z]+?)(\d{1,2})(?:[-.]|$)/.exec(name);
  if (!match) {
    return null;
  }
  const size = Number.parseInt(match[2], 10);
  return size >= 5 && size <= 24 ? size : null;
}

export function normalizeFontFamily(rawName: string): string {
  return stripSubsetPrefix(rawName)
    .replace(/\.(ttf|otf|pfb|pfa|type1)$/i, "")
    .replace(/[\s_]+/g, "")
    .toUpperCase();
}

export function describeFont(
  key: string,
  rawName: string,
  glyphScale: number,
): FontDescriptor {
  const normalized = normalizeFontFamily(rawName || key);
  const rule = familyRules.find((candidate) => candidate.pattern.test(normalized));

  const bold = rule?.bold ?? boldPattern.test(normalized);
  const italic = rule?.italic ?? italicPattern.test(normalized);
  const monospace = rule?.monospace ?? monoPattern.test(normalized);
  const smallCaps = rule?.smallCaps ?? smallCapsPattern.test(normalized);
  const serif = rule?.serif ?? !(sansPattern.test(normalized) || monospace);

  return {
    key,
    rawName: stripSubsetPrefix(rawName || key),
    family: normalized.replace(/\d+$/, "") || "UNKNOWN",
    bold,
    italic,
    monospace,
    smallCaps,
    serif,
    mathRole: rule?.role ?? "text",
    designSize: parseDesignSize(stripSubsetPrefix(rawName || key)),
    glyphScale: glyphScale || 0.001,
  };
}

/** True when glyphs from this font are almost certainly part of a formula. */
export function isMathFont(font: FontDescriptor): boolean {
  return (
    font.mathRole === "variable" ||
    font.mathRole === "symbol" ||
    font.mathRole === "extension" ||
    font.mathRole === "blackboard" ||
    font.mathRole === "calligraphic" ||
    font.mathRole === "fraktur"
  );
}

/** Fonts whose glyphs stretch vertically, so their size must not skew statistics. */
export function isExtensionFont(font: FontDescriptor): boolean {
  return font.mathRole === "extension";
}

/**
 * LaTeX alphabet command for a maths letter set in `font`, or null when the
 * default math italic is already correct.
 */
export function mathAlphabetCommand(font: FontDescriptor): string | null {
  switch (font.mathRole) {
    case "blackboard":
      return "mathbb";
    case "calligraphic":
      return "mathcal";
    case "fraktur":
      return "mathfrak";
    case "sansMath":
      return "mathsf";
    case "monoMath":
      return "mathtt";
    case "variable":
      return font.bold ? "bm" : null;
    case "text":
      return font.bold ? "mathbf" : font.italic ? null : "mathrm";
    default:
      return null;
  }
}
