export interface MathSymbolPaletteEntry {
  latex: string;
  display: string;
  search: string;
}

type RawSymbol = Omit<MathSymbolPaletteEntry, "search"> & { search?: string };

const BASE_SYMBOLS: RawSymbol[] = [
  { latex: "\\alpha", display: "α" },
  { latex: "\\beta", display: "β" },
  { latex: "\\gamma", display: "γ" },
  { latex: "\\delta", display: "δ" },
  { latex: "\\epsilon", display: "ε" },
  { latex: "\\varepsilon", display: "ε" },
  { latex: "\\zeta", display: "ζ" },
  { latex: "\\eta", display: "η" },
  { latex: "\\theta", display: "θ" },
  { latex: "\\vartheta", display: "ϑ" },
  { latex: "\\iota", display: "ι" },
  { latex: "\\kappa", display: "κ" },
  { latex: "\\lambda", display: "λ" },
  { latex: "\\mu", display: "μ" },
  { latex: "\\nu", display: "ν" },
  { latex: "\\xi", display: "ξ" },
  { latex: "\\pi", display: "π" },
  { latex: "\\varpi", display: "ϖ" },
  { latex: "\\rho", display: "ρ" },
  { latex: "\\varrho", display: "ϱ" },
  { latex: "\\sigma", display: "σ" },
  { latex: "\\varsigma", display: "ς" },
  { latex: "\\tau", display: "τ" },
  { latex: "\\upsilon", display: "υ" },
  { latex: "\\phi", display: "φ" },
  { latex: "\\varphi", display: "φ" },
  { latex: "\\chi", display: "χ" },
  { latex: "\\psi", display: "ψ" },
  { latex: "\\omega", display: "ω" },
  { latex: "\\Gamma", display: "Γ" },
  { latex: "\\Delta", display: "Δ" },
  { latex: "\\Theta", display: "Θ" },
  { latex: "\\Lambda", display: "Λ" },
  { latex: "\\Xi", display: "Ξ" },
  { latex: "\\Pi", display: "Π" },
  { latex: "\\Sigma", display: "Σ" },
  { latex: "\\Upsilon", display: "Υ" },
  { latex: "\\Phi", display: "Φ" },
  { latex: "\\Psi", display: "Ψ" },
  { latex: "\\Omega", display: "Ω" },
  { latex: "\\mathcal{A}", display: "𝒜" },
  { latex: "\\mathcal{B}", display: "ℬ" },
  { latex: "\\mathcal{C}", display: "𝒞" },
  { latex: "\\mathcal{D}", display: "𝒟" },
  { latex: "\\mathcal{L}", display: "ℒ" },
  { latex: "\\mathcal{M}", display: "ℳ" },
  { latex: "\\mathcal{N}", display: "𝒩" },
  { latex: "\\mathcal{R}", display: "ℛ" },
  { latex: "\\mathbb{R}", display: "ℝ" },
  { latex: "\\mathbb{N}", display: "ℕ" },
  { latex: "\\mathbb{Z}", display: "ℤ" },
  { latex: "\\mathbb{Q}", display: "ℚ" },
  { latex: "\\mathbb{C}", display: "ℂ" },
  { latex: "\\mathbf{x}", display: "𝐱" },
  { latex: "\\mathbf{w}", display: "𝐰" },
  { latex: "\\mathbf{y}", display: "𝐲" },
  { latex: "\\infty", display: "∞" },
  { latex: "\\partial", display: "∂" },
  { latex: "\\nabla", display: "∇" },
  { latex: "\\sum", display: "∑" },
  { latex: "\\prod", display: "∏" },
  { latex: "\\coprod", display: "∐" },
  { latex: "\\int", display: "∫" },
  { latex: "\\iint", display: "∬" },
  { latex: "\\iiint", display: "∭" },
  { latex: "\\oint", display: "∮" },
  { latex: "\\bigcup", display: "⋃" },
  { latex: "\\bigcap", display: "⋂" },
  { latex: "\\bigoplus", display: "⨁" },
  { latex: "\\bigotimes", display: "⨂" },
  { latex: "\\to", display: "→" },
  { latex: "\\mapsto", display: "↦" },
  { latex: "\\rightarrow", display: "→" },
  { latex: "\\leftarrow", display: "←" },
  { latex: "\\leftrightarrow", display: "↔" },
  { latex: "\\Rightarrow", display: "⇒" },
  { latex: "\\Leftarrow", display: "⇐" },
  { latex: "\\Leftrightarrow", display: "⇔" },
  { latex: "\\uparrow", display: "↑" },
  { latex: "\\downarrow", display: "↓" },
  { latex: "\\updownarrow", display: "↕" },
  { latex: "\\longrightarrow", display: "⟶" },
  { latex: "\\longleftarrow", display: "⟵" },
  { latex: "\\longleftrightarrow", display: "⟷" },
  { latex: "\\Longrightarrow", display: "⟹" },
  { latex: "\\Longleftarrow", display: "⟸" },
  { latex: "\\Longleftrightarrow", display: "⟺" },
  { latex: "\\approx", display: "≈" },
  { latex: "\\sim", display: "∼" },
  { latex: "\\simeq", display: "≃" },
  { latex: "\\cong", display: "≅" },
  { latex: "\\equiv", display: "≡" },
  { latex: "\\propto", display: "∝" },
  { latex: "\\neq", display: "≠" },
  { latex: "\\leq", display: "≤" },
  { latex: "\\geq", display: "≥" },
  { latex: "\\ll", display: "≪" },
  { latex: "\\gg", display: "≫" },
  { latex: "\\subset", display: "⊂" },
  { latex: "\\supset", display: "⊃" },
  { latex: "\\subseteq", display: "⊆" },
  { latex: "\\supseteq", display: "⊇" },
  { latex: "\\nsubseteq", display: "⊈" },
  { latex: "\\nsupseteq", display: "⊉" },
  { latex: "\\in", display: "∈" },
  { latex: "\\notin", display: "∉" },
  { latex: "\\ni", display: "∋" },
  { latex: "\\forall", display: "∀" },
  { latex: "\\exists", display: "∃" },
  { latex: "\\nexists", display: "∄" },
  { latex: "\\neg", display: "¬" },
  { latex: "\\land", display: "∧" },
  { latex: "\\lor", display: "∨" },
  { latex: "\\top", display: "⊤" },
  { latex: "\\bot", display: "⊥" },
  { latex: "\\vdash", display: "⊢" },
  { latex: "\\models", display: "⊨" },
  { latex: "\\emptyset", display: "∅" },
  { latex: "\\varnothing", display: "∅" },
  { latex: "\\cup", display: "∪" },
  { latex: "\\cap", display: "∩" },
  { latex: "\\setminus", display: "∖" },
  { latex: "\\oplus", display: "⊕" },
  { latex: "\\ominus", display: "⊖" },
  { latex: "\\otimes", display: "⊗" },
  { latex: "\\oslash", display: "⊘" },
  { latex: "\\odot", display: "⊙" },
  { latex: "\\pm", display: "±" },
  { latex: "\\mp", display: "∓" },
  { latex: "\\times", display: "×" },
  { latex: "\\div", display: "÷" },
  { latex: "\\cdot", display: "·" },
  { latex: "\\circ", display: "∘" },
  { latex: "\\bullet", display: "•" },
  { latex: "\\star", display: "⋆" },
  { latex: "\\ast", display: "∗" },
  { latex: "\\diamond", display: "⋄" },
  { latex: "\\triangle", display: "△" },
  { latex: "\\angle", display: "∠" },
  { latex: "\\perp", display: "⊥" },
  { latex: "\\parallel", display: "∥" },
  { latex: "\\ldots", display: "…" },
  { latex: "\\cdots", display: "⋯" },
  { latex: "\\vdots", display: "⋮" },
  { latex: "\\ddots", display: "⋱" },
  { latex: "\\aleph", display: "ℵ" },
  { latex: "\\ell", display: "ℓ" },
  { latex: "\\Re", display: "ℜ" },
  { latex: "\\Im", display: "ℑ" },
  { latex: "\\wp", display: "℘" },
];

const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const LOWERCASE = "abcdefghijklmnopqrstuvwxyz".split("");
const DIGITS = "0123456789".split("");

const GREEK_LATEX = new Set([
  "\\alpha",
  "\\beta",
  "\\gamma",
  "\\delta",
  "\\epsilon",
  "\\varepsilon",
  "\\zeta",
  "\\eta",
  "\\theta",
  "\\vartheta",
  "\\iota",
  "\\kappa",
  "\\lambda",
  "\\mu",
  "\\nu",
  "\\xi",
  "\\pi",
  "\\varpi",
  "\\rho",
  "\\varrho",
  "\\sigma",
  "\\varsigma",
  "\\tau",
  "\\upsilon",
  "\\phi",
  "\\varphi",
  "\\chi",
  "\\psi",
  "\\omega",
  "\\Gamma",
  "\\Delta",
  "\\Theta",
  "\\Lambda",
  "\\Xi",
  "\\Pi",
  "\\Sigma",
  "\\Upsilon",
  "\\Phi",
  "\\Psi",
  "\\Omega",
]);

const GREEK_TARGETS = BASE_SYMBOLS.filter((symbol) => GREEK_LATEX.has(symbol.latex));

const LETTER_TARGETS: RawSymbol[] = [
  ...LOWERCASE.map((letter) => ({ latex: letter, display: letter })),
  ...UPPERCASE.map((letter) => ({ latex: letter, display: letter })),
];

const ACCENT_COMMANDS = [
  { command: "\\hat", name: "hat", mark: "\u0302" },
  { command: "\\widehat", name: "wide hat", mark: "\u0302" },
  { command: "\\bar", name: "bar", mark: "\u0304" },
  { command: "\\overline", name: "overline", mark: "\u0305" },
  { command: "\\tilde", name: "tilde", mark: "\u0303" },
  { command: "\\widetilde", name: "wide tilde", mark: "\u0303" },
  { command: "\\vec", name: "vector", mark: "\u20d7" },
  { command: "\\dot", name: "dot", mark: "\u0307" },
  { command: "\\ddot", name: "double dot", mark: "\u0308" },
  { command: "\\breve", name: "breve", mark: "\u0306" },
  { command: "\\check", name: "check", mark: "\u030c" },
  { command: "\\acute", name: "acute", mark: "\u0301" },
  { command: "\\grave", name: "grave", mark: "\u0300" },
  { command: "\\mathring", name: "ring", mark: "\u030a" },
  { command: "\\underline", name: "underline", mark: "\u0332" },
];

const MATH_ALPHABETS = [
  { command: "\\mathrm", name: "roman" },
  { command: "\\mathbf", name: "bold" },
  { command: "\\mathit", name: "italic" },
  { command: "\\mathsf", name: "sans serif" },
  { command: "\\mathtt", name: "typewriter" },
  { command: "\\mathcal", name: "calligraphic" },
  { command: "\\mathbb", name: "blackboard" },
  { command: "\\mathfrak", name: "fraktur" },
];

const SCRIPT_BUILDERS = [
  {
    prefix: "\\operatorname",
    labels: ["argmin", "argmax", "softmax", "rank", "diag", "tr"],
  },
  { prefix: "\\mathrm", labels: ["d", "e", "i", "Var", "Cov", "KL", "Pr"] },
];

function withSearch(symbol: RawSymbol): MathSymbolPaletteEntry {
  return {
    latex: symbol.latex,
    display: symbol.display,
    search: `${symbol.latex} ${symbol.display} ${symbol.search ?? ""}`.toLowerCase(),
  };
}

function buildAlphabetSymbols(): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  for (const alphabet of MATH_ALPHABETS) {
    const letters =
      alphabet.command === "\\mathcal" || alphabet.command === "\\mathbb"
        ? UPPERCASE
        : [...UPPERCASE, ...LOWERCASE];
    for (const letter of letters) {
      symbols.push({
        latex: `${alphabet.command}{${letter}}`,
        display: letter,
        search: `${alphabet.name} alphabet ${letter}`,
      });
    }
  }
  for (const digit of DIGITS) {
    symbols.push(
      { latex: `\\mathbf{${digit}}`, display: digit, search: `bold digit ${digit}` },
      { latex: `\\mathrm{${digit}}`, display: digit, search: `roman digit ${digit}` },
    );
  }
  return symbols;
}

function buildAccentSymbols(): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  const targets = [...LETTER_TARGETS, ...GREEK_TARGETS];
  for (const accent of ACCENT_COMMANDS) {
    for (const target of targets) {
      symbols.push({
        latex: `${accent.command}{${target.latex}}`,
        display: `${target.display}${accent.mark}`,
        search: `${accent.name} accent ${target.latex} ${target.display}`,
      });
    }
  }
  return symbols;
}

function buildScriptSymbols(): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  for (const builder of SCRIPT_BUILDERS) {
    for (const label of builder.labels) {
      symbols.push({
        latex: `${builder.prefix}{${label}}`,
        display: label,
        search: `${label} operator`,
      });
    }
  }
  return symbols;
}

function buildIndexedSymbols(): RawSymbol[] {
  const targets = [...LOWERCASE.slice(0, 12), ...GREEK_TARGETS.slice(0, 18)];
  const suffixes = ["_i", "_j", "_n", "^{2}", "^{*}", "_{0}", "_{t}", "_{k}"];
  return targets.flatMap((target) =>
    suffixes.map((suffix) => ({
      latex: `${typeof target === "string" ? target : target.latex}${suffix}`,
      display: `${typeof target === "string" ? target : target.display}${suffix}`,
      search: `indexed superscript subscript ${typeof target === "string" ? target : target.latex}`,
    })),
  );
}

function uniqueSymbols(symbols: RawSymbol[]): MathSymbolPaletteEntry[] {
  const deduped = new Map<string, MathSymbolPaletteEntry>();
  for (const symbol of symbols.map(withSearch)) {
    if (!deduped.has(symbol.latex)) {
      deduped.set(symbol.latex, symbol);
    }
  }
  return [...deduped.values()];
}

export const SYMBOL_PALETTE = uniqueSymbols([
  ...BASE_SYMBOLS,
  ...buildAlphabetSymbols(),
  ...buildAccentSymbols(),
  ...buildScriptSymbols(),
  ...buildIndexedSymbols(),
]);
