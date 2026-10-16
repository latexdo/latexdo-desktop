/**
 * Character level translation between PDF glyphs and LaTeX.
 *
 * Two problems are solved here. First, mapping Unicode to the LaTeX command that
 * produces it, separately for text and maths mode. Second, repairing glyphs whose
 * Unicode value the PDF does not usefully carry: TeX's CMEX, CMSY and CMMI fonts
 * are indexed by their own encodings and subset fonts frequently ship without a
 * usable ToUnicode map, so we fall back to the original character code and the
 * published TeX encoding tables.
 */

import type { FontDescriptor } from "./model.js";

export type MathClass =
  | "ord"
  | "bin"
  | "rel"
  | "open"
  | "close"
  | "punct"
  | "bigop"
  | "accent"
  | "radical";

export interface MathSymbol {
  latex: string;
  mathClass: MathClass;
  /** Package required beyond amsmath, when any. */
  requires?: "amssymb" | "amsmath" | "textcomp" | "stmaryrd";
}

const symbol = (
  latex: string,
  mathClass: MathClass = "ord",
  requires?: MathSymbol["requires"],
): MathSymbol => ({ latex, mathClass, requires });

/** Unicode code point to maths mode LaTeX. */
export const mathSymbols = new Map<number, MathSymbol>([
  // Greek lower case.
  [0x03b1, symbol("\\alpha")],
  [0x03b2, symbol("\\beta")],
  [0x03b3, symbol("\\gamma")],
  [0x03b4, symbol("\\delta")],
  [0x03b5, symbol("\\epsilon")],
  [0x03f5, symbol("\\epsilon")],
  [0x03b6, symbol("\\zeta")],
  [0x03b7, symbol("\\eta")],
  [0x03b8, symbol("\\theta")],
  [0x03d1, symbol("\\vartheta")],
  [0x03b9, symbol("\\iota")],
  [0x03ba, symbol("\\kappa")],
  [0x03bb, symbol("\\lambda")],
  [0x03bc, symbol("\\mu")],
  [0x00b5, symbol("\\mu")],
  [0x03bd, symbol("\\nu")],
  [0x03be, symbol("\\xi")],
  [0x03c0, symbol("\\pi")],
  [0x03d6, symbol("\\varpi")],
  [0x03c1, symbol("\\rho")],
  [0x03f1, symbol("\\varrho")],
  [0x03c3, symbol("\\sigma")],
  [0x03c2, symbol("\\varsigma")],
  [0x03c4, symbol("\\tau")],
  [0x03c5, symbol("\\upsilon")],
  [0x03c6, symbol("\\varphi")],
  [0x03d5, symbol("\\phi")],
  [0x03c7, symbol("\\chi")],
  [0x03c8, symbol("\\psi")],
  [0x03c9, symbol("\\omega")],
  // Greek upper case.
  [0x0393, symbol("\\Gamma")],
  [0x0394, symbol("\\Delta")],
  [0x0398, symbol("\\Theta")],
  [0x039b, symbol("\\Lambda")],
  [0x039e, symbol("\\Xi")],
  [0x03a0, symbol("\\Pi")],
  [0x03a3, symbol("\\Sigma")],
  [0x03a5, symbol("\\Upsilon")],
  [0x03a6, symbol("\\Phi")],
  [0x03a8, symbol("\\Psi")],
  [0x03a9, symbol("\\Omega")],
  [0x2126, symbol("\\Omega")],
  // Binary operators.
  [0x2212, symbol("-", "bin")],
  [0x00b1, symbol("\\pm", "bin")],
  [0x2213, symbol("\\mp", "bin")],
  [0x00d7, symbol("\\times", "bin")],
  [0x00f7, symbol("\\div", "bin")],
  [0x22c5, symbol("\\cdot", "bin")],
  [0x00b7, symbol("\\cdot", "bin")],
  [0x2217, symbol("\\ast", "bin")],
  [0x2218, symbol("\\circ", "bin")],
  [0x2219, symbol("\\bullet", "bin")],
  [0x2022, symbol("\\bullet", "bin")],
  [0x2295, symbol("\\oplus", "bin")],
  [0x2296, symbol("\\ominus", "bin")],
  [0x2297, symbol("\\otimes", "bin")],
  [0x2298, symbol("\\oslash", "bin")],
  [0x2299, symbol("\\odot", "bin")],
  [0x2229, symbol("\\cap", "bin")],
  [0x222a, symbol("\\cup", "bin")],
  [0x228e, symbol("\\uplus", "bin")],
  [0x2293, symbol("\\sqcap", "bin")],
  [0x2294, symbol("\\sqcup", "bin")],
  [0x2227, symbol("\\wedge", "bin")],
  [0x2228, symbol("\\vee", "bin")],
  [0x2216, symbol("\\setminus", "bin")],
  [0x2240, symbol("\\wr", "bin")],
  [0x25b3, symbol("\\bigtriangleup", "bin")],
  [0x25bd, symbol("\\bigtriangledown", "bin")],
  [0x22b2, symbol("\\lhd", "bin", "amssymb")],
  [0x22b3, symbol("\\rhd", "bin", "amssymb")],
  [0x2020, symbol("\\dagger", "bin")],
  [0x2021, symbol("\\ddagger", "bin")],
  [0x2245, symbol("\\cong", "rel")],
  // Relations.
  [0x003d, symbol("=", "rel")],
  [0x2260, symbol("\\neq", "rel")],
  [0x2261, symbol("\\equiv", "rel")],
  [0x2264, symbol("\\leq", "rel")],
  [0x2265, symbol("\\geq", "rel")],
  [0x2266, symbol("\\leqq", "rel", "amssymb")],
  [0x2267, symbol("\\geqq", "rel", "amssymb")],
  [0x2a7d, symbol("\\leqslant", "rel", "amssymb")],
  [0x2a7e, symbol("\\geqslant", "rel", "amssymb")],
  [0x226a, symbol("\\ll", "rel")],
  [0x226b, symbol("\\gg", "rel")],
  [0x227a, symbol("\\prec", "rel")],
  [0x227b, symbol("\\succ", "rel")],
  [0x2aaf, symbol("\\preceq", "rel")],
  [0x2ab0, symbol("\\succeq", "rel")],
  [0x223c, symbol("\\sim", "rel")],
  [0x2243, symbol("\\simeq", "rel")],
  [0x2248, symbol("\\approx", "rel")],
  [0x224d, symbol("\\asymp", "rel")],
  [0x2250, symbol("\\doteq", "rel")],
  [0x221d, symbol("\\propto", "rel")],
  [0x2282, symbol("\\subset", "rel")],
  [0x2283, symbol("\\supset", "rel")],
  [0x2286, symbol("\\subseteq", "rel")],
  [0x2287, symbol("\\supseteq", "rel")],
  [0x228a, symbol("\\subsetneq", "rel", "amssymb")],
  [0x2291, symbol("\\sqsubseteq", "rel")],
  [0x2292, symbol("\\sqsupseteq", "rel")],
  [0x2208, symbol("\\in", "rel")],
  [0x2209, symbol("\\notin", "rel")],
  [0x220b, symbol("\\ni", "rel")],
  [0x22a2, symbol("\\vdash", "rel")],
  [0x22a3, symbol("\\dashv", "rel")],
  [0x22a8, symbol("\\models", "rel")],
  [0x2225, symbol("\\parallel", "rel")],
  [0x22a5, symbol("\\perp", "rel")],
  [0x2223, symbol("\\mid", "rel")],
  [0x2234, symbol("\\therefore", "rel", "amssymb")],
  [0x2235, symbol("\\because", "rel", "amssymb")],
  [0x224c, symbol("\\approx", "rel")],
  [0x2272, symbol("\\lesssim", "rel", "amssymb")],
  [0x2273, symbol("\\gtrsim", "rel", "amssymb")],
  // Arrows.
  [0x2190, symbol("\\leftarrow", "rel")],
  [0x2192, symbol("\\rightarrow", "rel")],
  [0x2191, symbol("\\uparrow", "rel")],
  [0x2193, symbol("\\downarrow", "rel")],
  [0x2194, symbol("\\leftrightarrow", "rel")],
  [0x2195, symbol("\\updownarrow", "rel")],
  [0x21d0, symbol("\\Leftarrow", "rel")],
  [0x21d2, symbol("\\Rightarrow", "rel")],
  [0x21d4, symbol("\\Leftrightarrow", "rel")],
  [0x21d1, symbol("\\Uparrow", "rel")],
  [0x21d3, symbol("\\Downarrow", "rel")],
  [0x2197, symbol("\\nearrow", "rel")],
  [0x2198, symbol("\\searrow", "rel")],
  [0x2196, symbol("\\nwarrow", "rel")],
  [0x2199, symbol("\\swarrow", "rel")],
  [0x21a6, symbol("\\mapsto", "rel")],
  [0x21aa, symbol("\\hookrightarrow", "rel")],
  [0x21a9, symbol("\\hookleftarrow", "rel")],
  [0x21c0, symbol("\\rightharpoonup", "rel")],
  [0x21c1, symbol("\\rightharpoondown", "rel")],
  [0x21bc, symbol("\\leftharpoonup", "rel")],
  [0x21bd, symbol("\\leftharpoondown", "rel")],
  [0x27f5, symbol("\\longleftarrow", "rel")],
  [0x27f6, symbol("\\longrightarrow", "rel")],
  [0x27f8, symbol("\\Longleftarrow", "rel")],
  [0x27f9, symbol("\\Longrightarrow", "rel")],
  [0x27fa, symbol("\\Longleftrightarrow", "rel")],
  [0x21d7, symbol("\\nearrow", "rel")],
  // Large operators.
  [0x2211, symbol("\\sum", "bigop")],
  [0x220f, symbol("\\prod", "bigop")],
  [0x2210, symbol("\\coprod", "bigop")],
  [0x222b, symbol("\\int", "bigop")],
  [0x222c, symbol("\\iint", "bigop", "amsmath")],
  [0x222d, symbol("\\iiint", "bigop", "amsmath")],
  [0x222e, symbol("\\oint", "bigop")],
  [0x22c2, symbol("\\bigcap", "bigop")],
  [0x22c3, symbol("\\bigcup", "bigop")],
  [0x22c0, symbol("\\bigwedge", "bigop")],
  [0x22c1, symbol("\\bigvee", "bigop")],
  [0x2a01, symbol("\\bigoplus", "bigop")],
  [0x2a02, symbol("\\bigotimes", "bigop")],
  [0x2a00, symbol("\\bigodot", "bigop")],
  [0x2a04, symbol("\\biguplus", "bigop")],
  [0x2a06, symbol("\\bigsqcup", "bigop")],
  // Delimiters.
  [0x0028, symbol("(", "open")],
  [0x0029, symbol(")", "close")],
  [0x005b, symbol("[", "open")],
  [0x005d, symbol("]", "close")],
  [0x007b, symbol("\\{", "open")],
  [0x007d, symbol("\\}", "close")],
  [0x2308, symbol("\\lceil", "open")],
  [0x2309, symbol("\\rceil", "close")],
  [0x230a, symbol("\\lfloor", "open")],
  [0x230b, symbol("\\rfloor", "close")],
  [0x27e8, symbol("\\langle", "open")],
  [0x27e9, symbol("\\rangle", "close")],
  [0x2329, symbol("\\langle", "open")],
  [0x232a, symbol("\\rangle", "close")],
  [0x2016, symbol("\\|", "ord")],
  [0x27e6, symbol("\\llbracket", "open", "stmaryrd")],
  [0x27e7, symbol("\\rrbracket", "close", "stmaryrd")],
  // Miscellaneous ordinary symbols.
  [0x221e, symbol("\\infty")],
  [0x2202, symbol("\\partial")],
  [0x2207, symbol("\\nabla")],
  [0x221a, symbol("\\surd", "radical")],
  [0x2205, symbol("\\emptyset")],
  [0x2200, symbol("\\forall")],
  [0x2203, symbol("\\exists")],
  [0x2204, symbol("\\nexists", "ord", "amssymb")],
  [0x00ac, symbol("\\neg")],
  [0x2135, symbol("\\aleph")],
  [0x2136, symbol("\\beth", "ord", "amssymb")],
  [0x210f, symbol("\\hbar")],
  [0x2113, symbol("\\ell")],
  [0x2118, symbol("\\wp")],
  [0x211c, symbol("\\Re")],
  [0x2111, symbol("\\Im")],
  [0x2127, symbol("\\mho", "ord", "amssymb")],
  [0x2032, symbol("'")],
  [0x2033, symbol("''")],
  [0x2034, symbol("'''")],
  [0x00b0, symbol("^\\circ")],
  [0x2220, symbol("\\angle")],
  [0x22a4, symbol("\\top")],
  [0x22a5, symbol("\\bot")],
  [0x2660, symbol("\\spadesuit")],
  [0x2661, symbol("\\heartsuit")],
  [0x2662, symbol("\\diamondsuit")],
  [0x2663, symbol("\\clubsuit")],
  [0x266d, symbol("\\flat")],
  [0x266e, symbol("\\natural")],
  [0x266f, symbol("\\sharp")],
  [0x25a0, symbol("\\blacksquare", "ord", "amssymb")],
  [0x25a1, symbol("\\square", "ord", "amssymb")],
  [0x25c7, symbol("\\Diamond", "ord", "amssymb")],
  [0x2032 + 0, symbol("'")],
  // Dots and punctuation.
  [0x2026, symbol("\\ldots", "punct")],
  [0x22ef, symbol("\\cdots", "punct")],
  [0x22ee, symbol("\\vdots", "punct")],
  [0x22f1, symbol("\\ddots", "punct")],
  [0x002c, symbol(",", "punct")],
  [0x003b, symbol(";", "punct")],
  [0x003a, symbol("\\colon", "punct")],
  // Spaces that carry meaning inside formulas.
  [0x2009, symbol("\\,")],
  [0x2002, symbol("\\;")],
  [0x2003, symbol("\\quad")],
]);

/** Combining or spacing accents that wrap the preceding maths atom. */
export const mathAccents = new Map<number, string>([
  [0x0302, "hat"],
  [0x005e, "hat"],
  [0x02c6, "hat"],
  [0x0303, "tilde"],
  [0x007e, "tilde"],
  [0x02dc, "tilde"],
  [0x0304, "bar"],
  [0x00af, "bar"],
  [0x0305, "overline"],
  [0x0307, "dot"],
  [0x0308, "ddot"],
  [0x030a, "mathring"],
  [0x030c, "check"],
  [0x02c7, "check"],
  [0x0300, "grave"],
  [0x0301, "acute"],
  [0x0306, "breve"],
  [0x20d7, "vec"],
  [0x2192, "vec"],
]);

/** Text mode replacements applied before escaping. */
const textNormalizations: Array<[RegExp, string]> = [
  [/ﬀ/g, "ff"],
  [/ﬁ/g, "fi"],
  [/ﬂ/g, "fl"],
  [/ﬃ/g, "ffi"],
  [/ﬄ/g, "ffl"],
  [/ﬅ/g, "st"],
  [/ﬆ/g, "st"],
  [/\u00a0/g, "~"],
  [/\u00ad/g, ""],
  [/\u200b/g, ""],
  [/\ufeff/g, ""],
];

const textSymbols = new Map<number, string>([
  [0x2013, "--"],
  [0x2014, "---"],
  [0x2010, "-"],
  [0x2011, "-"],
  [0x201c, "``"],
  [0x201d, "''"],
  [0x201e, ",,"],
  [0x2018, "`"],
  [0x2019, "'"],
  [0x2026, "\\ldots{}"],
  [0x2022, "\\textbullet{}"],
  [0x00b7, "\\textperiodcentered{}"],
  [0x2020, "\\dag{}"],
  [0x2021, "\\ddag{}"],
  [0x00a7, "\\S{}"],
  [0x00b6, "\\P{}"],
  [0x00a9, "\\copyright{}"],
  [0x00ae, "\\textregistered{}"],
  [0x2122, "\\texttrademark{}"],
  [0x00b0, "\\textdegree{}"],
  [0x2030, "\\textperthousand{}"],
  [0x00bd, "\\textonehalf{}"],
  [0x00bc, "\\textonequarter{}"],
  [0x00be, "\\textthreequarters{}"],
  [0x00d7, "$\\times$"],
  [0x00f7, "$\\div$"],
  [0x00b1, "$\\pm$"],
  [0x2212, "$-$"],
  [0x2192, "$\\rightarrow$"],
  [0x2190, "$\\leftarrow$"],
  [0x2264, "$\\leq$"],
  [0x2265, "$\\geq$"],
  [0x2260, "$\\neq$"],
  [0x2248, "$\\approx$"],
  [0x221e, "$\\infty$"],
  [0x00a2, "\\textcent{}"],
  [0x00a3, "\\pounds{}"],
  [0x00a5, "\\textyen{}"],
  [0x20ac, "\\texteuro{}"],
  [0x0141, "\\L{}"],
  [0x0142, "\\l{}"],
  [0x00d8, "\\O{}"],
  [0x00f8, "\\o{}"],
  [0x00c6, "\\AE{}"],
  [0x00e6, "\\ae{}"],
  [0x0152, "\\OE{}"],
  [0x0153, "\\oe{}"],
  [0x00df, "\\ss{}"],
  [0x00d0, "\\DH{}"],
  [0x00f0, "\\dh{}"],
  [0x00de, "\\TH{}"],
  [0x00fe, "\\th{}"],
  [0x0131, "\\i{}"],
  [0x0237, "\\j{}"],
  [0x2032, "$'$"],
  [0x02dd, "\\textacutedbl{}"],
  [0x2423, "\\textvisiblespace{}"],
]);

/**
 * OML, the Computer Modern math italic encoding used by CMMI. Values are Unicode
 * code points.
 */
const omlEncoding: Record<number, number> = {
  0x00: 0x0393,
  0x01: 0x0394,
  0x02: 0x0398,
  0x03: 0x039b,
  0x04: 0x039e,
  0x05: 0x03a0,
  0x06: 0x03a3,
  0x07: 0x03a5,
  0x08: 0x03a6,
  0x09: 0x03a8,
  0x0a: 0x03a9,
  0x0b: 0x03b1,
  0x0c: 0x03b2,
  0x0d: 0x03b3,
  0x0e: 0x03b4,
  0x0f: 0x03f5,
  0x10: 0x03b6,
  0x11: 0x03b7,
  0x12: 0x03b8,
  0x13: 0x03b9,
  0x14: 0x03ba,
  0x15: 0x03bb,
  0x16: 0x03bc,
  0x17: 0x03bd,
  0x18: 0x03be,
  0x19: 0x03c0,
  0x1a: 0x03c1,
  0x1b: 0x03c3,
  0x1c: 0x03c4,
  0x1d: 0x03c5,
  0x1e: 0x03d5,
  0x1f: 0x03c7,
  0x20: 0x03c8,
  0x21: 0x03c9,
  0x22: 0x03b5,
  0x23: 0x03d1,
  0x24: 0x03d6,
  0x25: 0x03f1,
  0x26: 0x03c2,
  0x27: 0x03c6,
  0x28: 0x21bc,
  0x29: 0x21bd,
  0x2a: 0x21c0,
  0x2b: 0x21c1,
  0x2c: 0x21a9,
  0x2d: 0x21aa,
  0x2e: 0x22b3,
  0x2f: 0x22b2,
  0x3a: 0x002e,
  0x3b: 0x002c,
  0x3c: 0x003c,
  0x3d: 0x002f,
  0x3e: 0x003e,
  0x3f: 0x22c6,
  0x40: 0x2202,
  0x5b: 0x266d,
  0x5c: 0x266e,
  0x5d: 0x266f,
  0x5e: 0x2323,
  0x5f: 0x2322,
  0x60: 0x2113,
  0x7b: 0x0131,
  0x7c: 0x0237,
  0x7d: 0x2118,
  0x7e: 0x20d7,
  0x7f: 0x0361,
};

/** OMS, the Computer Modern symbol encoding used by CMSY. */
const omsEncoding: Record<number, number> = {
  0x00: 0x2212,
  0x01: 0x22c5,
  0x02: 0x00d7,
  0x03: 0x2217,
  0x04: 0x00f7,
  0x05: 0x22c4,
  0x06: 0x00b1,
  0x07: 0x2213,
  0x08: 0x2295,
  0x09: 0x2296,
  0x0a: 0x2297,
  0x0b: 0x2298,
  0x0c: 0x2299,
  0x0d: 0x25cb,
  0x0e: 0x25e6,
  0x0f: 0x2022,
  0x10: 0x224d,
  0x11: 0x2261,
  0x12: 0x2286,
  0x13: 0x2287,
  0x14: 0x2264,
  0x15: 0x2265,
  0x16: 0x2aaf,
  0x17: 0x2ab0,
  0x18: 0x223c,
  0x19: 0x2248,
  0x1a: 0x2282,
  0x1b: 0x2283,
  0x1c: 0x226a,
  0x1d: 0x226b,
  0x1e: 0x227a,
  0x1f: 0x227b,
  0x20: 0x2190,
  0x21: 0x2192,
  0x22: 0x2191,
  0x23: 0x2193,
  0x24: 0x2194,
  0x25: 0x2197,
  0x26: 0x2198,
  0x27: 0x2243,
  0x28: 0x21d0,
  0x29: 0x21d2,
  0x2a: 0x21d1,
  0x2b: 0x21d3,
  0x2c: 0x21d4,
  0x2d: 0x2196,
  0x2e: 0x2199,
  0x2f: 0x221d,
  0x30: 0x2032,
  0x31: 0x221e,
  0x32: 0x2208,
  0x33: 0x220b,
  0x34: 0x25b3,
  0x35: 0x25bd,
  0x36: 0x0338,
  0x37: 0x21a6,
  0x38: 0x2200,
  0x39: 0x2203,
  0x3a: 0x00ac,
  0x3b: 0x2205,
  0x3c: 0x211c,
  0x3d: 0x2111,
  0x3e: 0x22a4,
  0x3f: 0x22a5,
  0x40: 0x2135,
  0x5b: 0x222a,
  0x5c: 0x2229,
  0x5d: 0x228e,
  0x5e: 0x2227,
  0x5f: 0x2228,
  0x60: 0x22a2,
  0x61: 0x22a3,
  0x62: 0x230a,
  0x63: 0x230b,
  0x64: 0x2308,
  0x65: 0x2309,
  0x66: 0x007b,
  0x67: 0x007d,
  0x68: 0x27e8,
  0x69: 0x27e9,
  0x6a: 0x2223,
  0x6b: 0x2225,
  0x6c: 0x2195,
  0x6d: 0x21d5,
  0x6e: 0x005c,
  0x6f: 0x2240,
  0x70: 0x221a,
  0x71: 0x2210,
  0x72: 0x2207,
  0x73: 0x222b,
  0x74: 0x2294,
  0x75: 0x2293,
  0x76: 0x2291,
  0x77: 0x2292,
  0x78: 0x00a7,
  0x79: 0x2020,
  0x7a: 0x2021,
  0x7b: 0x00b6,
  0x7c: 0x2663,
  0x7d: 0x2662,
  0x7e: 0x2661,
  0x7f: 0x2660,
};

/**
 * OMX, the Computer Modern extension encoding used by CMEX. Only the slots that
 * matter for reconstruction are listed: the single-piece delimiters, the large
 * operators, and the radicals. A value of 0 means the glyph is a vertical
 * extension piece of a delimiter that was already emitted, so it is dropped.
 */
const omxEncoding: Record<number, number> = {
  0x00: 0x0028,
  0x01: 0x0029,
  0x02: 0x005b,
  0x03: 0x005d,
  0x04: 0x230a,
  0x05: 0x230b,
  0x06: 0x2308,
  0x07: 0x2309,
  0x08: 0x007b,
  0x09: 0x007d,
  0x0a: 0x27e8,
  0x0b: 0x27e9,
  0x0c: 0x2223,
  0x0d: 0x2225,
  0x0e: 0x002f,
  0x0f: 0x005c,
  0x10: 0x0028,
  0x11: 0x0029,
  0x12: 0x0028,
  0x13: 0x0029,
  0x14: 0x005b,
  0x15: 0x005d,
  0x16: 0x230a,
  0x17: 0x230b,
  0x18: 0x2308,
  0x19: 0x2309,
  0x1a: 0x007b,
  0x1b: 0x007d,
  0x1c: 0x27e8,
  0x1d: 0x27e9,
  0x1e: 0x002f,
  0x1f: 0x005c,
  0x20: 0x0028,
  0x21: 0x0029,
  0x22: 0x0028,
  0x23: 0x0029,
  0x24: 0x005b,
  0x25: 0x005d,
  0x26: 0x0000,
  0x27: 0x0000,
  0x28: 0x0000,
  0x29: 0x0000,
  0x2a: 0x0000,
  0x2b: 0x0000,
  0x2c: 0x0000,
  0x2d: 0x0000,
  0x2e: 0x007b,
  0x2f: 0x007d,
  0x30: 0x0000,
  0x31: 0x0000,
  0x32: 0x0000,
  0x33: 0x0000,
  0x34: 0x0000,
  0x35: 0x0000,
  0x36: 0x0000,
  0x37: 0x0000,
  0x38: 0x0000,
  0x39: 0x0000,
  0x3a: 0x0000,
  0x3b: 0x0000,
  0x3c: 0x0000,
  0x3d: 0x0000,
  0x3e: 0x0000,
  0x3f: 0x0000,
  0x40: 0x0000,
  0x41: 0x0000,
  0x42: 0x0000,
  0x43: 0x0000,
  0x44: 0x0000,
  0x45: 0x0000,
  0x46: 0x0000,
  0x47: 0x0000,
  0x48: 0x221a,
  0x49: 0x0000,
  0x4a: 0x0000,
  0x4b: 0x0000,
  0x4c: 0x0000,
  0x4d: 0x0000,
  0x4e: 0x0000,
  0x4f: 0x0000,
  0x50: 0x2211,
  0x51: 0x220f,
  0x52: 0x222b,
  0x53: 0x22c3,
  0x54: 0x22c2,
  0x55: 0x2a04,
  0x56: 0x22c0,
  0x57: 0x22c1,
  0x58: 0x2211,
  0x59: 0x220f,
  0x5a: 0x222b,
  0x5b: 0x22c3,
  0x5c: 0x22c2,
  0x5d: 0x2a04,
  0x5e: 0x22c0,
  0x5f: 0x22c1,
  0x60: 0x2210,
  0x61: 0x2210,
  0x62: 0x0302,
  0x63: 0x0302,
  0x64: 0x0302,
  0x65: 0x0303,
  0x66: 0x0303,
  0x67: 0x0303,
  0x68: 0x005b,
  0x69: 0x005d,
  0x6a: 0x230a,
  0x6b: 0x230b,
  0x6c: 0x2308,
  0x6d: 0x2309,
  0x6e: 0x007b,
  0x6f: 0x007d,
  0x70: 0x221a,
  0x71: 0x221a,
  0x72: 0x221a,
  0x73: 0x221a,
  0x74: 0x0000,
  0x75: 0x0000,
  0x76: 0x0000,
  0x77: 0x0000,
  0x78: 0x0000,
  0x79: 0x0000,
  0x7a: 0x0000,
  0x7b: 0x0000,
  0x7c: 0x0000,
  0x7d: 0x0000,
  0x7e: 0x0000,
  0x7f: 0x0000,
};

function isUnusableUnicode(text: string): boolean {
  if (!text) {
    return true;
  }
  const code = text.codePointAt(0) ?? 0;
  return (
    code < 0x20 ||
    code === 0x7f ||
    code === 0xfffd ||
    // Private use areas, where pdf.js parks glyphs it could not identify.
    (code >= 0xe000 && code <= 0xf8ff) ||
    (code >= 0xf0000 && code <= 0x10ffff)
  );
}

function encodingForFont(
  font: FontDescriptor,
): { table: Record<number, number>; authoritative: boolean } | null {
  if (/^CM(MI|MIB)/.test(font.family) || /^LMMATHITALIC/.test(font.family)) {
    return { table: omlEncoding, authoritative: false };
  }
  if (/^CM(SY|BSY)/.test(font.family) || /^LMMATHSYMBOLS/.test(font.family)) {
    return { table: omsEncoding, authoritative: false };
  }
  // Nothing maps the extension font's glyph names to Unicode, so its encoding is
  // the only source of truth.
  if (/^CMEX/.test(font.family) || /^LMMATHEXTENSION/.test(font.family)) {
    return { table: omxEncoding, authoritative: true };
  }
  return null;
}

/**
 * Returns the text a glyph should contribute. Empty means the glyph carries no
 * content of its own, which happens for the vertical extension pieces of a tall
 * delimiter.
 */
export function repairGlyphText(
  font: FontDescriptor,
  charCode: number,
  unicode: string,
): string {
  const encoding = encodingForFont(font);
  const mapped = encoding?.table[charCode & 0xff];

  if (encoding?.authoritative && mapped !== undefined) {
    return mapped === 0 ? "" : String.fromCodePoint(mapped);
  }
  if (!isUnusableUnicode(unicode)) {
    return unicode;
  }
  if (mapped !== undefined) {
    return mapped === 0 ? "" : String.fromCodePoint(mapped);
  }
  return "";
}

export function normalizeTextRun(value: string): string {
  let result = value;
  for (const [pattern, replacement] of textNormalizations) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Escapes a run of prose for LaTeX text mode. */
export function escapeText(value: string): string {
  let result = "";
  for (const character of normalizeTextRun(value)) {
    const code = character.codePointAt(0) ?? 0;
    const mapped = textSymbols.get(code);
    if (mapped) {
      result += mapped;
      continue;
    }
    switch (character) {
      case "\\":
        result += "\\textbackslash{}";
        break;
      case "{":
        result += "\\{";
        break;
      case "}":
        result += "\\}";
        break;
      case "$":
      case "&":
      case "%":
      case "#":
      case "_":
        result += `\\${character}`;
        break;
      case "^":
        result += "\\textasciicircum{}";
        break;
      case "~":
        // Non-breaking space survived normalization as a tie, keep it.
        result += "~";
        break;
      case "<":
        result += "\\textless{}";
        break;
      case ">":
        result += "\\textgreater{}";
        break;
      case "|":
        result += "\\textbar{}";
        break;
      default:
        result += character;
    }
  }
  return result;
}

/** Maths mode translation for a single character. */
export function mathSymbolFor(character: string): MathSymbol | null {
  const code = character.codePointAt(0);
  if (code === undefined) {
    return null;
  }
  const mapped = mathSymbols.get(code);
  if (mapped) {
    return mapped;
  }
  if (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a)
  ) {
    return { latex: character, mathClass: "ord" };
  }
  switch (character) {
    case "+":
      return { latex: "+", mathClass: "bin" };
    case "-":
      return { latex: "-", mathClass: "bin" };
    case "*":
      return { latex: "*", mathClass: "bin" };
    case "/":
      return { latex: "/", mathClass: "ord" };
    case "<":
      return { latex: "<", mathClass: "rel" };
    case ">":
      return { latex: ">", mathClass: "rel" };
    case "!":
      return { latex: "!", mathClass: "close" };
    case "?":
      return { latex: "?", mathClass: "punct" };
    case ".":
      return { latex: ".", mathClass: "punct" };
    case "'":
      return { latex: "'", mathClass: "ord" };
    case "|":
      return { latex: "\\mid", mathClass: "rel" };
    case "%":
      return { latex: "\\%", mathClass: "ord" };
    case "&":
      return { latex: "\\&", mathClass: "ord" };
    case "#":
      return { latex: "\\#", mathClass: "ord" };
    case "$":
      return { latex: "\\$", mathClass: "ord" };
    case "_":
      return { latex: "\\_", mathClass: "ord" };
    case "@":
      return { latex: "@", mathClass: "ord" };
    case "=":
      return { latex: "=", mathClass: "rel" };
    case " ":
    case " ":
      return { latex: "\\,", mathClass: "ord" };
    default:
      return null;
  }
}

/** Function names that must be set upright with the matching LaTeX operator. */
export const mathOperatorNames = new Set([
  "arccos",
  "arcsin",
  "arctan",
  "arg",
  "cos",
  "cosh",
  "cot",
  "coth",
  "csc",
  "deg",
  "det",
  "dim",
  "exp",
  "gcd",
  "hom",
  "inf",
  "ker",
  "lg",
  "lim",
  "liminf",
  "limsup",
  "ln",
  "log",
  "max",
  "min",
  "Pr",
  "sec",
  "sin",
  "sinh",
  "sup",
  "tan",
  "tanh",
]);

/** Upright multi-letter identifiers that are not standard LaTeX operators. */
export const mathTextIdentifiers = new Set([
  "argmax",
  "argmin",
  "diag",
  "div",
  "grad",
  "id",
  "mod",
  "rank",
  "sgn",
  "sign",
  "span",
  "supp",
  "tr",
  "trace",
  "var",
  "cov",
  "softmax",
  "relu",
]);

export function packagesForSymbols(latexSnippets: string[]): Set<string> {
  const packages = new Set<string>();
  const joined = latexSnippets.join(" ");
  for (const entry of mathSymbols.values()) {
    if (
      entry.requires &&
      entry.requires !== "amsmath" &&
      joined.includes(entry.latex)
    ) {
      packages.add(entry.requires);
    }
  }
  return packages;
}
