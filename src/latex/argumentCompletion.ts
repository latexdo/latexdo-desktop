/**
 * Completion inside command arguments other than citations and references
 * (#227, #234): environments, packages, document classes, project files, and
 * the macros a project defines itself.
 */

export type LatexArgumentKind =
  | "environment"
  | "endEnvironment"
  | "package"
  | "documentClass"
  | "texFile"
  | "graphicsFile"
  | "bibFile";

export interface LatexArgumentContext {
  kind: LatexArgumentKind;
  currentText: string;
  rangeStartColumn: number;
  rangeEndColumn: number;
  /** Text on the line after the caret, to decide whether to close a block. */
  rest: string;
}

const argumentCommands: Record<string, LatexArgumentKind> = {
  begin: "environment",
  end: "endEnvironment",
  usepackage: "package",
  RequirePackage: "package",
  documentclass: "documentClass",
  input: "texFile",
  include: "texFile",
  subfile: "texFile",
  includeonly: "texFile",
  includegraphics: "graphicsFile",
  includesvg: "graphicsFile",
  bibliography: "bibFile",
  addbibresource: "bibFile",
};

/** Lists that take several comma-separated values. */
const listKinds = new Set<LatexArgumentKind>(["package", "bibFile", "texFile"]);

export function getLatexArgumentContext(
  lineText: string,
  cursorColumn: number,
): LatexArgumentContext | null {
  const beforeCursor = lineText.slice(0, cursorColumn - 1);
  const match = /\\([A-Za-z]+)\*?(?:\[[^\]]*\])*\{([^{}]*)$/.exec(beforeCursor);
  if (!match) return null;
  const kind = argumentCommands[match[1]];
  if (!kind) return null;
  const argument = match[2];
  let start = listKinds.has(kind) ? argument.lastIndexOf(",") + 1 : 0;
  while (argument[start] === " ") start += 1;
  return {
    kind,
    currentText: argument.slice(start),
    rangeStartColumn: cursorColumn - argument.length + start,
    rangeEndColumn: cursorColumn,
    rest: lineText.slice(cursorColumn - 1),
  };
}

export const latexEnvironments: Array<[name: string, description: string]> = [
  ["document", "The document body"],
  ["abstract", "Abstract"],
  ["figure", "Floating figure"],
  ["figure*", "Figure across both columns"],
  ["table", "Floating table"],
  ["table*", "Table across both columns"],
  ["tabular", "Table body"],
  ["tabularx", "Table with stretching columns (tabularx)"],
  ["longtable", "Table across pages (longtable)"],
  ["itemize", "Bulleted list"],
  ["enumerate", "Numbered list"],
  ["description", "Description list"],
  ["equation", "Numbered equation"],
  ["equation*", "Unnumbered equation"],
  ["align", "Aligned equations (amsmath)"],
  ["align*", "Unnumbered aligned equations"],
  ["gather", "Centred equations (amsmath)"],
  ["gather*", "Unnumbered centred equations"],
  ["multline", "Equation over several lines"],
  ["split", "Split one equation (inside equation)"],
  ["cases", "Piecewise definition"],
  ["matrix", "Matrix without brackets"],
  ["pmatrix", "Matrix in parentheses"],
  ["bmatrix", "Matrix in brackets"],
  ["vmatrix", "Determinant"],
  ["array", "Math array"],
  ["center", "Centred block"],
  ["flushleft", "Left-aligned block"],
  ["flushright", "Right-aligned block"],
  ["minipage", "Box with its own width"],
  ["subfigure", "Sub-figure (subcaption)"],
  ["quote", "Short quotation"],
  ["quotation", "Long quotation"],
  ["verbatim", "Text exactly as typed"],
  ["lstlisting", "Code listing (listings)"],
  ["minted", "Highlighted code (minted)"],
  ["algorithm", "Floating algorithm"],
  ["algorithmic", "Algorithm steps"],
  ["theorem", "Theorem"],
  ["lemma", "Lemma"],
  ["proposition", "Proposition"],
  ["corollary", "Corollary"],
  ["definition", "Definition"],
  ["remark", "Remark"],
  ["example", "Example"],
  ["proof", "Proof (amsthm)"],
  ["tikzpicture", "TikZ drawing"],
  ["axis", "pgfplots axis"],
  ["frame", "Beamer slide"],
  ["block", "Beamer block"],
  ["columns", "Beamer columns"],
  ["column", "Beamer column"],
  ["thebibliography", "Hand-written bibliography"],
  ["appendices", "Appendices (appendix package)"],
];

const environmentPattern = /\\(begin|end)\{([^{}]+)\}/g;

/** Environments the project defines or already uses, beyond the built-in list. */
export function documentEnvironments(texts: readonly string[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(
      /\\(?:newenvironment|newtheorem)\*?\{([^{}]+)\}/g,
    )) {
      found.add(match[1]);
    }
    for (const match of text.matchAll(environmentPattern)) found.add(match[2]);
  }
  return [...found];
}

/** The innermost environment still open at `offset`, which \end{ should close. */
export function openEnvironmentAt(text: string, offset: number): string | null {
  const stack: string[] = [];
  for (const match of text.slice(0, offset).matchAll(environmentPattern)) {
    if (match[1] === "begin") stack.push(match[2]);
    else {
      const index = stack.lastIndexOf(match[2]);
      if (index !== -1) stack.splice(index);
    }
  }
  return stack[stack.length - 1] ?? null;
}

export const latexPackages: Array<[name: string, description: string]> = [
  ["amsmath", "Equations, align, cases"],
  ["amssymb", "Extra math symbols"],
  ["amsthm", "Theorems and proofs"],
  ["mathtools", "Fixes and extras for amsmath"],
  ["graphicx", "\\includegraphics"],
  ["xcolor", "Colours"],
  ["hyperref", "Clickable links and PDF metadata"],
  ["cleveref", "\\cref with automatic names"],
  ["geometry", "Page margins and size"],
  ["booktabs", "Professional table rules"],
  ["tabularx", "Tables with stretching columns"],
  ["multirow", "Cells across rows"],
  ["longtable", "Tables across pages"],
  ["array", "More column types"],
  ["caption", "Caption formatting"],
  ["subcaption", "Sub-figures and sub-tables"],
  ["float", "[H] float placement"],
  ["siunitx", "Numbers and units"],
  ["microtype", "Better spacing and line breaks"],
  ["babel", "Language rules"],
  ["inputenc", "Input encoding (pdfLaTeX)"],
  ["fontenc", "Font encoding"],
  ["lmodern", "Latin Modern fonts"],
  ["fontspec", "System fonts (XeLaTeX/LuaLaTeX)"],
  ["natbib", "Author-year citations"],
  ["biblatex", "Modern bibliographies"],
  ["csquotes", "Context-aware quotes"],
  ["enumitem", "List formatting"],
  ["listings", "Code listings"],
  ["minted", "Highlighted code"],
  ["algorithm", "Algorithm floats"],
  ["algpseudocode", "Pseudocode"],
  ["algorithm2e", "Algorithms"],
  ["tikz", "Drawings"],
  ["pgfplots", "Plots"],
  ["url", "\\url"],
  ["xspace", "Smart spaces after macros"],
  ["setspace", "Line spacing"],
  ["fancyhdr", "Headers and footers"],
  ["titlesec", "Section heading formats"],
  ["appendix", "Appendix environments"],
  ["todonotes", "\\todo notes"],
  ["soul", "Highlight and strike out"],
  ["ulem", "Underlining"],
  ["bm", "Bold math"],
  ["dsfont", "Double-struck letters"],
  ["physics", "Physics notation"],
  ["mhchem", "Chemical formulas"],
  ["glossaries", "Glossaries and acronyms"],
  ["acronym", "Acronyms"],
  ["wrapfig", "Text around figures"],
  ["placeins", "\\FloatBarrier"],
  ["multicol", "Several columns"],
  ["lipsum", "Placeholder text"],
  ["comment", "Comment environment"],
  ["xparse", "Define commands"],
  ["etoolbox", "Programming tools"],
  ["standalone", "Include standalone documents"],
  ["subfiles", "Compile parts on their own"],
  ["svg", "\\includesvg"],
  ["threeparttable", "Table notes"],
  ["makecell", "Line breaks in cells"],
  ["diagbox", "Diagonal header cells"],
  ["colortbl", "Coloured table cells"],
];

export const latexDocumentClasses: Array<[name: string, description: string]> = [
  ["article", "Articles and short reports"],
  ["report", "Longer reports with chapters"],
  ["book", "Books"],
  ["memoir", "Flexible books and theses"],
  ["beamer", "Slides"],
  ["letter", "Letters"],
  ["standalone", "A single figure or table"],
  ["amsart", "AMS articles"],
  ["scrartcl", "KOMA-Script article"],
  ["scrreprt", "KOMA-Script report"],
  ["scrbook", "KOMA-Script book"],
  ["IEEEtran", "IEEE papers"],
  ["acmart", "ACM papers"],
  ["llncs", "Springer LNCS"],
  ["elsarticle", "Elsevier journals"],
  ["revtex4-2", "APS and AIP journals"],
];

/**
 * Macros the project defines: \newcommand, \renewcommand, \DeclareMathOperator,
 * \def and \let, with their argument count when given.
 */
export function documentMacros(
  texts: readonly string[],
): Array<{ name: string; argumentCount: number }> {
  const macros = new Map<string, number>();
  const definition =
    /\\(?:(?:re)?newcommand\*?|providecommand\*?|DeclareMathOperator\*?|DeclareRobustCommand\*?)\s*\{?\\([A-Za-z@]+)\}?(?:\s*\[(\d)\])?|\\(?:def|let)\s*\\([A-Za-z@]+)/g;
  for (const text of texts) {
    for (const match of text.matchAll(definition)) {
      const name = match[1] ?? match[3];
      if (name && !name.includes("@")) {
        macros.set(name, Number(match[2] ?? 0));
      }
    }
  }
  return [...macros].map(([name, argumentCount]) => ({ name, argumentCount }));
}

/** \name{$1}{$2}… snippet text for a macro with arguments. */
export function macroSnippet(name: string, argumentCount: number): string {
  let text = name;
  for (let index = 1; index <= argumentCount; index += 1) text += `{$${index}}`;
  return argumentCount ? `${text}$0` : text;
}

/** Path to write in the argument: \input and \bibliography drop the extension. */
export function projectFileArgument(
  kind: LatexArgumentKind,
  relativePath: string,
): string {
  const path = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return kind === "texFile" || kind === "bibFile"
    ? path.replace(/\.(tex|bib)$/i, "")
    : path;
}

export function projectFileMatchesKind(
  kind: LatexArgumentKind,
  relativePath: string,
): boolean {
  const extension = relativePath.split(".").pop()?.toLowerCase() ?? "";
  if (kind === "texFile") return extension === "tex";
  if (kind === "bibFile") return extension === "bib";
  if (kind === "graphicsFile") {
    return ["png", "jpg", "jpeg", "pdf", "eps", "svg", "gif", "tif", "tiff"].includes(
      extension,
    );
  }
  return false;
}

/** Everyday commands beyond the built-in snippets: [name, arguments, description]. */
export const latexEverydayCommands: Array<
  [name: string, args: number, description: string]
> = [
  ["textsc", 1, "Small capitals"],
  ["texttt", 1, "Typewriter text"],
  ["textsf", 1, "Sans-serif text"],
  ["textrm", 1, "Roman text"],
  ["textup", 1, "Upright text"],
  ["textsuperscript", 1, "Superscript text"],
  ["textsubscript", 1, "Subscript text"],
  ["mathrm", 1, "Upright math"],
  ["mathbf", 1, "Bold math"],
  ["mathcal", 1, "Calligraphic math"],
  ["mathbb", 1, "Blackboard bold (amssymb)"],
  ["mathit", 1, "Italic math"],
  ["boldsymbol", 1, "Bold symbol (amsmath)"],
  ["operatorname", 1, "Operator name (amsmath)"],
  ["text", 1, "Text inside math (amsmath)"],
  ["overline", 1, "Line over"],
  ["underbrace", 1, "Brace under"],
  ["hat", 1, "Hat accent"],
  ["tilde", 1, "Tilde accent"],
  ["bar", 1, "Bar accent"],
  ["vec", 1, "Vector arrow"],
  ["dot", 1, "Dot accent"],
  ["left", 0, "Growing left delimiter"],
  ["right", 0, "Growing right delimiter"],
  ["quad", 0, "Wide space"],
  ["qquad", 0, "Wider space"],
  ["hspace", 1, "Horizontal space"],
  ["vspace", 1, "Vertical space"],
  ["newpage", 0, "New page"],
  ["clearpage", 0, "New page after floats"],
  ["centering", 0, "Centre the following content"],
  ["caption", 1, "Caption"],
  ["item", 0, "List item"],
  ["cref", 1, "Smart reference (cleveref)"],
  ["Cref", 1, "Smart reference, capitalised"],
  ["autoref", 1, "Reference with its name (hyperref)"],
  ["pageref", 1, "Page of a label"],
  ["today", 0, "Today's date"],
  ["LaTeX", 0, "The LaTeX logo"],
  ["ldots", 0, "…"],
  ["cdots", 0, "Centred dots"],
  ["vdots", 0, "Vertical dots"],
  ["hline", 0, "Horizontal table rule"],
  ["toprule", 0, "Top rule (booktabs)"],
  ["midrule", 0, "Middle rule (booktabs)"],
  ["bottomrule", 0, "Bottom rule (booktabs)"],
  ["cmidrule", 1, "Partial rule (booktabs)"],
  ["multicolumn", 3, "Cell across columns"],
  ["multirow", 3, "Cell across rows (multirow)"],
  ["small", 0, "Small text"],
  ["footnotesize", 0, "Footnote-size text"],
  ["large", 0, "Large text"],
  ["Large", 0, "Larger text"],
  ["noindent", 0, "No paragraph indent"],
  ["linewidth", 0, "Width of the current line"],
  ["textwidth", 0, "Width of the text block"],
  ["columnwidth", 0, "Width of a column"],
  ["tableofcontents", 0, "Table of contents"],
  ["listoffigures", 0, "List of figures"],
  ["listoftables", 0, "List of tables"],
  ["appendix", 0, "Start the appendix"],
  ["chapter", 1, "Chapter heading"],
  ["part", 1, "Part heading"],
  ["author", 1, "Author"],
  ["title", 1, "Title"],
  ["date", 1, "Date"],
  ["thanks", 1, "Title footnote"],
  ["todo", 1, "Note to self (todonotes)"],
  ["SI", 2, "Number with unit (siunitx)"],
  ["si", 1, "Unit (siunitx)"],
  ["num", 1, "Formatted number (siunitx)"],
];
