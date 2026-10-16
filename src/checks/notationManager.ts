import type { Diagnostic, NotationManagerSettings, NotedSymbol } from "../types";

function findLine(content: string, index: number): number {
  return content.substring(0, index).split("\n").length;
}

function findSection(content: string, pos: number): string {
  const before = content.substring(0, pos);
  const matches = [...before.matchAll(/\\section\s*\*?\s*\{([^}]*)\}/g)];
  if (matches.length) return matches[matches.length - 1][1];
  const chMatches = [...before.matchAll(/\\chapter\s*\*?\s*\{([^}]*)\}/g)];
  if (chMatches.length) return chMatches[chMatches.length - 1][1];
  return "(preamble)";
}

function makeDiagnostic(
  line: number,
  message: string,
  detail: string,
  suggestion: string,
  severity: "warning" | "error" = "warning",
): Diagnostic {
  return {
    file: "check",
    line,
    column: 1,
    severity,
    source: "latex" as Diagnostic["source"],
    message,
    detail,
    suggestion,
  };
}

const MATH_PATTERNS = [
  /(\$[^$]+\$)/g,
  /(\\\[[\s\S]*?\\\])/g,
  /(\\begin\s*\{equation[\s\S]*?\\end\s*\{equation\})/g,
  /(\\begin\s*\{align[\s\S]*?\\end\s*\{align\})/g,
  /(\\begin\s*\{gather[\s\S]*?\\end\s*\{gather\})/g,
  /(\\begin\s*\{multiline[\s\S]*?\\end\s*\{multiline\})/g,
  /(\\\([\s\S]*?\\\))/g,
];

function extractMathExpressions(content: string): { expr: string; start: number }[] {
  const results: { expr: string; start: number }[] = [];
  for (const pattern of MATH_PATTERNS) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      results.push({ expr: m[1], start: m.index });
    }
  }
  results.sort((a, b) => a.start - b.start);
  return results;
}

const NOTATION_PATTERNS = [
  /\\(?:mathcal|mathrm|mathbf|mathit|mathbb|mathsf|mathtt|mathscr|mathfrak)\{(\w)\}/g,
  /\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|omicron|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Phi|Psi|Omega)/g,
  /\\[a-zA-Z]+/g,
  /\b([a-zA-Z])(?:\s*_\s*\{?[a-zA-Z0-9]+\}?)?(?:\s*\^\s*\{?[a-zA-Z0-9]+\}?)?\b/g,
];

function extractSymbols(expr: string): Set<string> {
  const symbols = new Set<string>();

  const calPattern =
    /\\(?:mathcal|mathrm|mathbf|mathit|mathbb|mathsf|mathtt|mathscr|mathfrak)\{(\w)\}/g;
  let m: RegExpExecArray | null;
  while ((m = calPattern.exec(expr)) !== null) {
    symbols.add(`\\mathcal{${m[1]}}`);
  }

  const greekPattern =
    /\\(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|omicron|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Phi|Psi|Omega)/g;
  while ((m = greekPattern.exec(expr)) !== null) {
    symbols.add(`\\${m[1]}`);
  }

  const cmdPattern = /\\([a-zA-Z]+)/g;
  while ((m = cmdPattern.exec(expr)) !== null) {
    const cmd = m[1];
    if (
      cmd.length > 1 &&
      !/^(?:mathcal|mathrm|mathbf|mathit|mathbb|mathsf|mathtt|mathscr|mathfrak|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|omicron|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Phi|Psi|Omega|begin|end|label|ref|cite|text|quad|qquad|left|right|big|bigg|Big|Bigg|displaystyle|textstyle|scriptstyle|scriptscriptstyle|over|frac|sqrt|sum|prod|int|iint|iiint|oint|otimes|oplus|otimes|wedge|vee|cap|cup|subset|supset|subseteq|supseteq|in|notin|to|rightarrow|leftarrow|Rightarrow|Leftarrow|mapsto|approx|sim|simeq|cong|equiv|propto|infty|partial|nabla|times|div|cdo|ast|star|circ|bullet|cdot|ldots|cdots|vdots|ddots|forall|exists|neg|emptyset|varnothing|Re|Im|log|ln|exp|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|coth|max|min|sup|inf|lim|det|dim|hom|ker|tr|Pr|E|Var|Cov|Corr|operatorname)/.test(
        cmd,
      )
    ) {
      symbols.add(`\\${cmd}`);
    }
  }

  const varPattern =
    /(?<![\\a-zA-Z])([a-zA-Z])(?![a-zA-Z])(?:(\s*_\s*\{?[a-zA-Z0-9]+\}?)(\s*\^\s*\{?[a-zA-Z0-9]+\}?)?|\s*\^\s*\{?[a-zA-Z0-9]+\}?)?/g;
  while ((m = varPattern.exec(expr)) !== null) {
    const base = m[1];
    const sub = m[2] || "";
    const sup = m[3] || "";
    const full = base + sub + sup;
    if (
      /^[a-zA-Z]$/.test(base) &&
      !/^[a-zA-Z]{2,}$/.test(expr.slice(m.index, m.index + full.length).trim())
    ) {
      symbols.add(full.trim());
    }
  }

  return symbols;
}

function isDefinedContext(precedingText: string): boolean {
  const defPatterns = [
    /\\newcommand\s*\{[^}]*\}/,
    /\b(?:let|:=|=)\s*$/m,
    /\\def\s+\\/,
    /\\DeclareMathOperator\s*\{[^}]*\}/,
    /\\setlength\s*\{[^}]*\}/,
    /:\\s*=\s*$/m,
    /\\text\{[^}]*\}\s*:?\s*=\s*/,
    /\\begin\s*\{definition\}/,
    /\\begin\s*\{notation\}/,
  ];
  return defPatterns.some((p) => p.test(precedingText));
}

function findSimilarSymbols(a: string, b: string): boolean {
  const normA = a.replace(/\\/g, "").replace(/[_{}]/g, "").toLowerCase();
  const normB = b.replace(/\\/g, "").replace(/[_{}]/g, "").toLowerCase();
  return normA === normB || normA.includes(normB) || normB.includes(normA);
}

export function analyzeNotation(content: string): NotedSymbol[] {
  const symbolMap = new Map<string, NotedSymbol>();

  const mathExprs = extractMathExpressions(content);

  for (const { expr, start } of mathExprs) {
    const line = findLine(content, start);
    const section = findSection(content, start);
    const symbols = extractSymbols(expr);
    const precedingText = content.substring(Math.max(0, start - 100), start);
    const defined = isDefinedContext(precedingText);

    for (const sym of symbols) {
      if (symbolMap.has(sym)) {
        const existing = symbolMap.get(sym)!;
        existing.usageCount++;
        if (!existing.environments.includes("math")) existing.environments.push("math");
        if (defined && !existing.defined) {
          existing.defined = true;
          existing.definitionLine = line;
        }
      } else {
        symbolMap.set(sym, {
          symbol: sym,
          latex: sym,
          firstUseLine: line,
          firstUseSection: section,
          defined,
          definitionLine: defined ? line : null,
          usageCount: 1,
          environments: ["math"],
          similarSymbols: [],
        });
      }
    }
  }

  const symbols = [...symbolMap.values()];

  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      if (findSimilarSymbols(symbols[i].symbol, symbols[j].symbol)) {
        if (!symbols[i].similarSymbols.includes(symbols[j].symbol))
          symbols[i].similarSymbols.push(symbols[j].symbol);
        if (!symbols[j].similarSymbols.includes(symbols[i].symbol))
          symbols[j].similarSymbols.push(symbols[i].symbol);
      }
    }
  }

  symbols.sort((a, b) => a.firstUseLine - b.firstUseLine);
  return symbols;
}

export function runNotationChecks(
  content: string,
  settings: NotationManagerSettings,
): { diagnostics: Diagnostic[]; symbols: NotedSymbol[] } {
  const result = { diagnostics: [] as Diagnostic[], symbols: [] as NotedSymbol[] };

  if (!settings.enabled || !content) return result;

  const symbols = analyzeNotation(content);
  result.symbols = symbols;

  if (settings.detectUndefinedNotation) {
    for (const sym of symbols) {
      if (!sym.defined && sym.usageCount >= 1) {
        result.diagnostics.push(
          makeDiagnostic(
            sym.firstUseLine,
            `Symbol "${sym.symbol}" used without explicit definition`,
            `First used in "${sym.firstUseSection}", "${sym.symbol}" appears ${sym.usageCount} time(s) but is never explicitly defined (no \\newcommand, :=, or definition context)`,
            `Add a definition: e.g., \\newcommand{\\${sym.symbol.replace(/^\\/, "")}}{${sym.symbol}} or a sentence like "Let ${sym.symbol} denote..."`,
            "warning",
          ),
        );
      }
    }
  }

  if (settings.detectConflicts) {
    for (const sym of symbols) {
      if (sym.similarSymbols.length > 0) {
        result.diagnostics.push(
          makeDiagnostic(
            sym.firstUseLine,
            `Potential notation conflict: "${sym.symbol}"`,
            `"${sym.symbol}" has similar notation: ${sym.similarSymbols.join(", ")}. This may confuse readers if they represent different concepts.`,
            `Consider renaming one of the symbols to avoid confusion between: ${[sym.symbol, ...sym.similarSymbols].join(", ")}`,
            "warning",
          ),
        );
      }
    }
  }

  return result;
}
