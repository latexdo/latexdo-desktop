// Makes a TikZ snippet safe to drop into a LaTeX document: whatever produced it
// (the drawing canvas, the image tracer, the AI, a pasted standalone file), the
// result is a body that belongs after \begin{document} plus the preamble lines
// it needs, so the figure compiles on the first try.

export interface PreparedTikz {
  /** The figure itself, without \documentclass, \usepackage or a document wrapper. */
  body: string;
  /** Preamble lines the snippet brought along (\usepackage, \usetikzlibrary, …). */
  preambleLines: string[];
}

export interface TikzRequirements {
  packages: string[];
  libraries: string[];
  pgfplotsLibraries: string[];
  pgfplotsCompat: boolean;
}

const preambleCommand =
  /^\s*\\(?:usepackage|RequirePackage|usetikzlibrary|usepgfplotslibrary|pgfplotsset\s*\{\s*compat)\b/;

/** Removes % comments, keeping escaped \%. */
function stripComments(text: string): string {
  return text.replace(/(^|[^\\])%.*$/gm, "$1");
}

/** True when the text draws something with TikZ, pgfplots, tikz-cd or circuitikz. */
export function containsTikz(text: string): boolean {
  return /\\begin\{(?:tikzpicture|tikzcd|circuitikz|axis)\}|\\tikz\b/.test(
    stripComments(text),
  );
}

/** Reads the end of a balanced {…} group that starts at `open`. */
function groupEnd(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * Turns any TikZ source into a body and the preamble lines it declared. A full
 * standalone document keeps only what is between \begin{document} and
 * \end{document}; Markdown code fences from a chat answer are dropped.
 */
export function prepareTikzSnippet(source: string): PreparedTikz {
  let text = source.replace(/\r\n?/g, "\n").trim();
  const fenced = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  if (fenced) text = fenced[1];

  let head = "";
  const begin = text.indexOf("\\begin{document}");
  if (begin >= 0) {
    head = text.slice(0, begin);
    const end = text.indexOf("\\end{document}", begin);
    text = text.slice(begin + "\\begin{document}".length, end >= 0 ? end : undefined);
  }

  const preambleLines: string[] = [];
  const keep: string[] = [];
  const collect = (block: string, keepRest: boolean) => {
    const lines = block.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      let line = lines[index];
      if (/^\s*\\documentclass\b/.test(line)) continue;
      if (preambleCommand.test(line)) {
        // A \pgfplotsset{compat=…} or option list may continue on later lines.
        while (
          (line.match(/\{/g)?.length ?? 0) > (line.match(/\}/g)?.length ?? 0) &&
          index + 1 < lines.length
        ) {
          index += 1;
          line += `\n${lines[index]}`;
        }
        preambleLines.push(line.trim());
        continue;
      }
      if (keepRest) keep.push(line);
    }
  };
  collect(head, false);
  collect(text, true);

  const body = keep
    .join("\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .trimEnd();
  return { body, preambleLines };
}

/** Matches one whole option, such as `diamond` or `shape=diamond`. */
const optionWord = (words: string) => new RegExp(`^(?:shape\\s*=\\s*)?(?:${words})$`);

const libraryRules: [string, RegExp][] = [
  [
    "arrows.meta",
    /(?:-|>\s*=\s*\{?|\{)\s*(?:Stealth|Latex|Kite|Straight Barb|Arc Barb|Tee Barb|Hooks|Rays|Triangle|Circle|Square|Diamond|Bar)\b/,
  ],
  [
    "arrows",
    /(?:-|>\s*=\s*)\s*(?:triangle|angle) (?:45|60|90)\b|\bopen triangle (?:45|60|90)\b/,
  ],
  [
    "positioning",
    /\b(?:above|below|left|right)(?:\s+(?:left|right))?\s*=\s*(?:[-+\d.]+\s*(?:cm|mm|pt|em|ex|in)?(?:\s+and\s+[-+\d.]+\s*(?:cm|mm|pt|em|ex|in)?)?\s+)?of\b/,
  ],
  ["calc", /\(\s*\$/],
  ["fit", /\bfit\s*=/],
  [
    "backgrounds",
    /\bon background layer\b|\bshow background rectangle\b|\bbackground rectangle\b/,
  ],
  ["matrix", /\bmatrix of (?:math )?nodes\b/],
  ["patterns", /\bpattern\s*=|\bpattern color\b/],
  ["shadows", /\b(?:drop shadow|copy shadow|circular drop shadow|circular glow)\b/],
  [
    "decorations.pathmorphing",
    /\bdecoration\s*=\s*\{?\s*(?:snake|zigzag|coil|random steps|bumps|saw|bent|straight zigzag)\b/,
  ],
  [
    "decorations.pathreplacing",
    /\bdecoration\s*=\s*\{?\s*(?:brace|calligraphic brace|ticks|border|waves|expanding waves|show path construction)\b/,
  ],
  ["decorations.markings", /\bmark\s*=\s*at position\b/],
  ["decorations.text", /\btext along path\b/],
  ["intersections", /\bname path\b|\bname intersections\b/],
  ["angles", /\bpic\s*(?:\[[^\]]*\])?\s*\{\s*(?:right\s+)?angle\s*=/],
  ["quotes", /\bpic\s*\[\s*"|\bedge\s*\[\s*"|\bto\s*\[\s*"/],
  ["mindmap", /\bmindmap\b/],
  ["3d", /\bcanvas is (?:xy|yx|yz|zy|xz|zx) plane at\b/],
  [
    "shapes.geometric",
    optionWord(
      "diamond|ellipse|trapezium|regular polygon|star|cylinder|isosceles triangle|kite|dart|circular sector|semicircle",
    ),
  ],
  [
    "shapes.symbols",
    optionWord(
      "cloud|starburst|signal|tape|magnetic tape|forbidden sign|correct forbidden sign",
    ),
  ],
  [
    "shapes.misc",
    optionWord("rounded rectangle|chamfered rectangle|cross out|strike out"),
  ],
  ["shapes.arrows", optionWord("single arrow|double arrow|arrow box")],
  [
    "shapes.multipart",
    /\b(?:rectangle split|circle split|circle solidus|ellipse split)\b|\\nodepart\b/,
  ],
  ["automata", optionWord("state|initial|accepting|initial text\\s*=.*")],
];

/** What a TikZ body needs in the preamble to compile. */
export function tikzRequirements(body: string): TikzRequirements {
  const text = stripComments(body);
  const packages: string[] = [];
  const pgfplotsLibraries: string[] = [];
  const usesPlots =
    /\\begin\{(?:axis|semilogxaxis|semilogyaxis|loglogaxis|polaraxis|groupplot)\}|\\addplot\b/.test(
      text,
    );
  if (/\\begin\{tikzcd\}/.test(text)) packages.push("tikz-cd");
  if (/\\begin\{circuitikz\}/.test(text)) packages.push("circuitikz");
  if (usesPlots) packages.push("pgfplots");
  if (/\\begin\{tikzpicture\}|\\tikz\b/.test(text) && !usesPlots) packages.push("tikz");
  if (/\\begin\{polaraxis\}/.test(text)) pgfplotsLibraries.push("polar");
  if (/\\begin\{groupplot\}/.test(text)) pgfplotsLibraries.push("groupplots");
  if (/\bfill between\b/.test(text)) pgfplotsLibraries.push("fillbetween");

  const optionLists = [...text.matchAll(/\[([^[\]]*)\]/g)].map((match) => match[1]);
  const libraries = libraryRules
    .filter(([name, rule]) =>
      name.startsWith("shapes.") || name === "automata"
        ? optionLists.some((options) =>
            options.split(",").some((option) => rule.test(option.trim())),
          )
        : rule.test(text),
    )
    .map(([name]) => name);

  return { packages, libraries, pgfplotsLibraries, pgfplotsCompat: usesPlots };
}

function listArgument(line: string, command: string): string[] {
  const match = line.match(
    new RegExp(`\\\\${command}\\s*(?:\\[[^\\]]*\\])?\\s*\\{([^}]*)\\}`),
  );
  return match
    ? match[1]
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    : [];
}

function declared(preamble: string, command: string): Set<string> {
  const names = new Set<string>();
  const pattern = new RegExp(
    `\\\\${command}\\s*(?:\\[[^\\]]*\\])?\\s*\\{([^}]*)\\}`,
    "g",
  );
  for (const match of stripComments(preamble).matchAll(pattern)) {
    for (const name of match[1].split(",")) {
      if (name.trim()) names.add(name.trim());
    }
  }
  return names;
}

/** Packages that load TikZ themselves. */
const loadsTikz = [
  "tikz",
  "pgfplots",
  "tikz-cd",
  "circuitikz",
  "tkz-euclide",
  "forest",
  "smartdiagram",
];

/**
 * Lines missing from `preamble` for a body with these requirements and the
 * lines it brought along. Package options from the snippet are kept.
 */
export function missingPreambleLines(
  preamble: string,
  requirements: TikzRequirements,
  snippetLines: string[] = [],
): string[] {
  const packages = new Set([
    ...declared(preamble, "usepackage"),
    ...declared(preamble, "RequirePackage"),
  ]);
  const libraries = declared(preamble, "usetikzlibrary");
  const plotLibraries = declared(preamble, "usepgfplotslibrary");
  const lines: string[] = [];

  const wantedPackages = new Map<string, string>();
  for (const line of snippetLines) {
    for (const name of listArgument(line, "usepackage")) {
      wantedPackages.set(
        name,
        listArgument(line, "usepackage").length === 1 ? line : `\\usepackage{${name}}`,
      );
    }
  }
  for (const name of requirements.packages) {
    if (!wantedPackages.has(name)) wantedPackages.set(name, `\\usepackage{${name}}`);
  }
  for (const [name, line] of wantedPackages) {
    if (packages.has(name)) continue;
    if (name === "tikz" && loadsTikz.some((other) => packages.has(other))) continue;
    // xcolor after tikz would clash on options; tikz brings xcolor already.
    if (name === "xcolor" && packages.has("tikz")) continue;
    packages.add(name);
    lines.push(line);
  }

  const wantedLibraries = [
    ...requirements.libraries,
    ...snippetLines.flatMap((line) => listArgument(line, "usetikzlibrary")),
  ].filter((name, index, all) => all.indexOf(name) === index && !libraries.has(name));
  if (wantedLibraries.length)
    lines.push(`\\usetikzlibrary{${wantedLibraries.join(",")}}`);

  const wantedPlotLibraries = [
    ...requirements.pgfplotsLibraries,
    ...snippetLines.flatMap((line) => listArgument(line, "usepgfplotslibrary")),
  ].filter(
    (name, index, all) => all.indexOf(name) === index && !plotLibraries.has(name),
  );
  if (wantedPlotLibraries.length) {
    lines.push(`\\usepgfplotslibrary{${wantedPlotLibraries.join(",")}}`);
  }

  if (
    (requirements.pgfplotsCompat || wantedPackages.has("pgfplots")) &&
    !/\\pgfplotsset\s*\{[^}]*compat/.test(stripComments(preamble))
  ) {
    // "newest" never fails on an older TeX installation, unlike a fixed number.
    lines.push("\\pgfplotsset{compat=newest}");
  }
  return lines;
}

/** Offset just after `\documentclass[…]{…}`, or -1. */
function documentClassEnd(text: string): number {
  const match = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{/.exec(text);
  if (!match) return -1;
  const end = groupEnd(text, match.index + match[0].length - 1);
  return end < 0 ? -1 : end + 1;
}

export interface PreambleEdit {
  /** Where the lines go, as an offset into the document. */
  offset: number;
  /** Text to insert, starting with a newline. */
  text: string;
  lines: string[];
}

/**
 * Where and what to add to a document's preamble. Null when the document has
 * no preamble of its own (a chapter pulled in with \input) — the caller then
 * patches the root file instead.
 */
export function preambleEditFor(
  document: string,
  requirements: TikzRequirements,
  snippetLines: string[] = [],
): PreambleEdit | null {
  const classEnd = documentClassEnd(document);
  if (classEnd < 0) return null;
  const beginDocument = document.indexOf("\\begin{document}", classEnd);
  const preambleEnd = beginDocument >= 0 ? beginDocument : document.length;
  const preamble = document.slice(0, preambleEnd);
  const lines = missingPreambleLines(preamble, requirements, snippetLines);
  if (!lines.length) return { offset: classEnd, text: "", lines: [] };

  // After the last package or library line, so options and load order hold —
  // but before hyperref and the packages that must follow it.
  let anchor = classEnd;
  const loader =
    /^[ \t]*\\(?:usepackage|RequirePackage|usetikzlibrary|usepgfplotslibrary|pgfplotsset)\b.*$/gm;
  for (const match of preamble.matchAll(loader)) {
    const start = match.index ?? 0;
    if (start < classEnd || /^\s*%/.test(match[0])) continue;
    if (
      /\\usepackage\s*(?:\[[^\]]*\])?\s*\{(?:hyperref|cleveref|bookmark)\}/.test(
        match[0],
      )
    ) {
      // Insert above this line: the end of the line before it.
      const previousLineEnd = document.lastIndexOf("\n", start - 1);
      const offset = Math.max(classEnd, previousLineEnd);
      return { offset, text: `\n${lines.join("\n")}`, lines };
    }
    anchor = start + match[0].length;
  }
  const lineEnd = document.indexOf("\n", anchor);
  const offset = lineEnd >= 0 && lineEnd < preambleEnd ? lineEnd : anchor;
  return { offset, text: `\n${lines.join("\n")}`, lines };
}

/** Applies a preamble edit to the text. */
export function withPreambleEdit(document: string, edit: PreambleEdit | null): string {
  if (!edit || !edit.text) return document;
  return document.slice(0, edit.offset) + edit.text + document.slice(edit.offset);
}

/**
 * The offset where a figure can go without breaking the document: inside the
 * body. A cursor in the preamble or after \end{document} moves to just before
 * \end{document}.
 */
export function safeFigureOffset(document: string, offset: number): number {
  const begin = document.indexOf("\\begin{document}");
  const end = document.lastIndexOf("\\end{document}");
  if (begin < 0) return Math.max(0, Math.min(offset, document.length));
  const bodyStart = begin + "\\begin{document}".length;
  if (offset >= bodyStart && (end < 0 || offset <= end)) return offset;
  if (end < 0) return document.length;
  return end;
}

/** Puts the body on lines of its own at `offset`. */
export function figureInsertionText(
  document: string,
  offset: number,
  body: string,
): string {
  const before = document.slice(0, offset);
  const after = document.slice(offset);
  const lead = before === "" || before.endsWith("\n") ? "" : "\n";
  const trail = after.startsWith("\n") ? "" : "\n";
  return `${lead}${body}${trail}`;
}
