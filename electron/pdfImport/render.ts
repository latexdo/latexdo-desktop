/**
 * Document assembly: blocks become a compilable `.tex` file.
 *
 * The preamble is synthesised from what the reconstruction actually used rather
 * than from a fixed template, and the page geometry is copied from the source so
 * line breaks land in roughly the same places. Anything the earlier stages were
 * unsure about is marked with a comment at the point of the problem, so review work
 * is local instead of a hunt through the whole file.
 */

import type { Block, StructureResult } from "./blocks.js";
import type { Reference } from "./bibliography.js";
import type { DocumentStats } from "./layout.js";

export interface PageGeometry {
  paper: "letterpaper" | "a4paper" | "custom";
  widthPt: number;
  heightPt: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface RenderOptions {
  stats: DocumentStats;
  geometry: PageGeometry;
  structure: StructureResult;
  references: Reference[];
  /** Relative path of the copied source PDF, used for figure extraction. */
  sourceAssetPath: string | null;
  bibStem: string | null;
  authorYearCitations: boolean;
  reportLines: string[];
}

const theoremTitles: Record<string, string> = {
  theorem: "Theorem",
  lemma: "Lemma",
  proposition: "Proposition",
  corollary: "Corollary",
  definition: "Definition",
  remark: "Remark",
  example: "Example",
  claim: "Claim",
  conjecture: "Conjecture",
  assumption: "Assumption",
  observation: "Observation",
  problem: "Problem",
  exercise: "Exercise",
};

function baseFontSize(bodySize: number): "10pt" | "11pt" | "12pt" {
  if (bodySize < 10.45) {
    return "10pt";
  }
  return bodySize < 11.45 ? "11pt" : "12pt";
}

function formatLength(value: number): string {
  return `${Math.max(0, Math.round(value * 10) / 10)}pt`;
}

function escapeForComment(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

/** Renders `\includegraphics` that crops the original page down to the artwork. */
function figureGraphic(
  block: Extract<Block, { kind: "figure" }>,
  options: RenderOptions,
): string[] {
  if (!block.region || !options.sourceAssetPath) {
    return [
      "  % No artwork could be located for this caption. Insert the figure here.",
      "  % \\includegraphics[width=\\linewidth]{figure-file}",
    ];
  }
  const { region } = block;
  const trim = [
    region.left,
    options.geometry.heightPt - region.bottom,
    options.geometry.widthPt - region.right,
    region.top,
  ]
    .map(formatLength)
    .join(" ");
  const width = region.right - region.left;
  const columnWidth =
    options.stats.columnCount > 1 && !block.spanning
      ? options.stats.columnWidth
      : options.geometry.widthPt - options.geometry.left - options.geometry.right;
  // Scale to the text width only when the artwork was about that wide to begin
  // with, so small inline diagrams keep their original size.
  const sizing = width > columnWidth * 0.85 ? ",width=\\linewidth" : "";
  return [
    `  \\includegraphics[page=${region.pageIndex + 1},trim=${trim},clip${sizing}]{${options.sourceAssetPath}}`,
  ];
}

function renderBlock(block: Block, options: RenderOptions): string[] {
  switch (block.kind) {
    case "title":
    case "authors":
      // Emitted in the preamble instead.
      return [];

    case "abstract":
      return ["\\begin{abstract}", block.latex, "\\end{abstract}", ""];

    case "section": {
      const command =
        block.level <= 1
          ? "section"
          : block.level === 2
            ? "subsection"
            : "subsubsection";
      const star = block.starred ? "*" : "";
      const lines = [`\\${command}${star}{${block.latex}}`];
      if (block.label && !block.starred) {
        lines.push(`\\label{${block.label}}`);
      }
      lines.push("");
      return lines;
    }

    case "paragraph":
      return [block.latex, ""];

    case "equation": {
      const lines: string[] = [];
      if (!block.confident) {
        lines.push("% TODO(pdf import): check this formula against the original page.");
      }
      if (block.multiline) {
        const environment = block.numbering ? "align" : "align*";
        lines.push(`\\begin{${environment}}`);
        if (block.label) {
          lines.push(`  \\label{${block.label}}`);
        }
        lines.push(block.latex.replace(/^/gm, "  "));
        lines.push(`\\end{${environment}}`, "");
        return lines;
      }
      if (block.numbering) {
        lines.push("\\begin{equation}");
        if (block.label) {
          lines.push(`  \\label{${block.label}}`);
        }
        lines.push(`  ${block.latex}`);
        lines.push("\\end{equation}", "");
        return lines;
      }
      lines.push("\\[", `  ${block.latex}`, "\\]", "");
      return lines;
    }

    case "list": {
      const environment = block.ordered ? "enumerate" : "itemize";
      return [
        `\\begin{${environment}}`,
        ...block.items.map((item) => `  \\item ${item.replace(/\n/g, "\n  ")}`),
        `\\end{${environment}}`,
        "",
      ];
    }

    case "figure": {
      const starred = block.spanning && options.stats.columnCount > 1 ? "*" : "";
      return [
        `\\begin{figure${starred}}[tb]`,
        "  \\centering",
        ...figureGraphic(block, options),
        `  \\caption{${block.caption}}`,
        ...(block.label ? [`  \\label{${block.label}}`] : []),
        `\\end{figure${starred}}`,
        "",
      ];
    }

    case "table": {
      const starred = block.spanning && options.stats.columnCount > 1 ? "*" : "";
      return [
        `\\begin{table${starred}}[tb]`,
        "  \\centering",
        `  \\caption{${block.caption}}`,
        ...(block.label ? [`  \\label{${block.label}}`] : []),
        ...(block.body
          ? block.body.split("\n").map((line) => `  ${line}`)
          : [
              "  % The table grid could not be recovered. Rebuild it from the original page.",
            ]),
        `\\end{table${starred}}`,
        "",
      ];
    }

    case "theorem": {
      if (block.environment === "proof") {
        return ["\\begin{proof}", block.latex, "\\end{proof}", ""];
      }
      const title = block.title ? `[${block.title}]` : "";
      return [
        `\\begin{${block.environment}}${title}`,
        block.latex,
        `\\end{${block.environment}}`,
        "",
      ];
    }

    case "verbatim":
      return ["\\begin{verbatim}", ...block.lines, "\\end{verbatim}", ""];

    case "footnote": {
      const numeric = /^\d+$/.test(block.marker);
      return [
        numeric
          ? `\\footnotetext[${block.marker}]{${block.latex}}`
          : `\\footnotetext{${block.latex}}`,
        "",
      ];
    }

    case "references":
      return [];

    default:
      return [];
  }
}

function renderBibliography(options: RenderOptions): string[] {
  const { references, bibStem } = options;
  if (!references.length) {
    return [];
  }
  if (bibStem) {
    return [
      options.authorYearCitations
        ? "\\bibliographystyle{plainnat}"
        : "\\bibliographystyle{plain}",
      `\\bibliography{${bibStem}}`,
      "",
    ];
  }
  return [
    `\\begin{thebibliography}{${references.length}}`,
    ...references.flatMap((reference) => [
      `\\bibitem{${reference.key}} ${reference.raw}`,
    ]),
    "\\end{thebibliography}",
    "",
  ];
}

export function renderDocument(options: RenderOptions): string {
  const { structure, stats, geometry } = options;
  const blocks = structure.blocks;

  const usesFigures = blocks.some((block) => block.kind === "figure");
  const usesTables = blocks.some((block) => block.kind === "table" && block.body);
  const usesBooktabs = blocks.some(
    (block) => block.kind === "table" && block.body?.includes("rule"),
  );
  const usesVerbatim = blocks.some((block) => block.kind === "verbatim");
  const usesFootnotes = blocks.some((block) => block.kind === "footnote");
  const theoremEnvironments = [
    ...new Set(
      blocks
        .filter(
          (block): block is Extract<Block, { kind: "theorem" }> =>
            block.kind === "theorem" && block.environment !== "proof",
        )
        .map((block) => block.environment),
    ),
  ];
  const usesProof = blocks.some(
    (block) => block.kind === "theorem" && block.environment === "proof",
  );

  const classOptions: string[] = [baseFontSize(stats.bodySize)];
  if (stats.columnCount >= 2) {
    classOptions.push("twocolumn");
  }
  if (geometry.paper !== "custom") {
    classOptions.push(geometry.paper);
  }

  const preamble: string[] = [];
  preamble.push(
    "% Reconstructed from a PDF by LatexDo.",
    "%",
    ...options.reportLines.map((line) => `% ${escapeForComment(line)}`),
    "%",
    "% Every heading, formula, table and reference below was inferred from the",
    "% geometry of the rendered page. Review the file before you rely on it.",
    "",
    `\\documentclass[${classOptions.join(",")}]{article}`,
    "",
    "\\usepackage[T1]{fontenc}",
    "\\usepackage[utf8]{inputenc}",
  );

  const geometryOptions = [
    geometry.paper === "custom"
      ? `paperwidth=${formatLength(geometry.widthPt)},paperheight=${formatLength(geometry.heightPt)}`
      : "",
    `left=${formatLength(geometry.left)}`,
    `right=${formatLength(geometry.right)}`,
    `top=${formatLength(geometry.top)}`,
    `bottom=${formatLength(geometry.bottom)}`,
  ].filter(Boolean);
  preamble.push(`\\usepackage[${geometryOptions.join(",")}]{geometry}`);

  preamble.push("\\usepackage{amsmath}", "\\usepackage{amssymb}");
  for (const extra of [...structure.usedPackages].sort()) {
    if (extra === "amsmath" || extra === "amssymb") {
      continue;
    }
    preamble.push(`\\usepackage{${extra}}`);
  }
  if (theoremEnvironments.length || usesProof) {
    preamble.push("\\usepackage{amsthm}");
  }
  if (usesFigures) {
    preamble.push("\\usepackage{graphicx}");
  }
  if (usesTables) {
    preamble.push("\\usepackage{array}");
  }
  if (usesBooktabs) {
    preamble.push("\\usepackage{booktabs}");
  }
  if (usesVerbatim) {
    preamble.push("\\usepackage{verbatim}");
  }
  if (options.authorYearCitations) {
    preamble.push("\\usepackage[round]{natbib}");
  }
  preamble.push("\\usepackage[hidelinks]{hyperref}");

  if (theoremEnvironments.length) {
    preamble.push("");
    for (const environment of theoremEnvironments) {
      const title = theoremTitles[environment] ?? environment;
      preamble.push(`\\newtheorem{${environment}}{${title}}`);
    }
  }

  const titleBlock = blocks.find(
    (block): block is Extract<Block, { kind: "title" }> => block.kind === "title",
  );
  const authorBlock = blocks.find(
    (block): block is Extract<Block, { kind: "authors" }> => block.kind === "authors",
  );

  preamble.push(
    "",
    `\\title{${titleBlock?.latex || structure.title || "Untitled document"}}`,
    `\\author{${authorBlock?.latex || structure.authors || ""}}`,
    "\\date{}",
  );

  const body: string[] = ["", "\\begin{document}", "\\maketitle", ""];
  for (const block of blocks) {
    body.push(...renderBlock(block, options));
  }
  if (usesFootnotes) {
    body.push(
      "% Footnotes were recovered without their anchors, so they are printed here.",
    );
  }
  body.push(...renderBibliography(options));
  body.push("\\end{document}", "");

  return [...preamble, ...body]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "");
}
