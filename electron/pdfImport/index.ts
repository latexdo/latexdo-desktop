/**
 * PDF to LaTeX import.
 *
 * Runs the pipeline end to end: extract glyph geometry, recover the physical
 * layout, classify the logical structure, reconstruct formulas and tables, parse
 * the reference list into a `.bib` file, rewire citations and cross references, and
 * write out a document that compiles. Figures are reproduced by cropping the
 * original PDF page with `\includegraphics[trim,clip]`, which keeps vector artwork
 * pixel exact without needing Ghostscript or any other external tool.
 */

import { access, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PdfImportResult } from "../types.js";
import { analyzeStructure, type Block, type LabelMaps } from "./blocks.js";
import { parseBibliography, renderBibFile, type Reference } from "./bibliography.js";
import { extractDocument } from "./extract.js";
import type { InlineContext } from "./inline.js";
import { layoutPages, type DocumentStats, type PageLayout } from "./layout.js";
import type { MathContext } from "./math.js";
import { rewriteReferences, type RewriteStats } from "./references.js";
import { renderDocument, type PageGeometry } from "./render.js";

const maxPdfSize = 200 * 1024 * 1024;

interface ImportTargets {
  projectPath: string;
  sourcePath: string;
  sourceStem: string;
  texPath: string;
  texRelativePath: string;
  bibPath: string;
  bibRelativePath: string;
  assetDirectory: string;
  assetRelativeDirectory: string;
}

export async function importPdfIntoProject(
  projectPath: string,
  sourcePath: string,
): Promise<PdfImportResult> {
  await assertReadablePdf(sourcePath);
  const targets = await createImportTargets(projectPath, sourcePath);

  const data = new Uint8Array(await readFile(sourcePath));
  const document = await extractDocument(data);
  const warnings = [...document.warnings];

  const textGlyphs = document.pages.reduce(
    (total, page) => total + page.glyphs.filter((glyph) => !glyph.space).length,
    0,
  );
  if (textGlyphs < 20) {
    throw new Error(
      "This PDF has no extractable text layer, so it is a scan. Run it through OCR first, then import the searchable PDF.",
    );
  }

  const { layouts, stats, removedHeadFoot } = layoutPages(document.pages);
  const geometry = computeGeometry(layouts, stats);

  const mathContext: MathContext = {
    rules: [],
    baseSize: stats.bodySize,
    packages: new Set<string>(),
    warnings: [],
  };
  const context: InlineContext = {
    math: mathContext,
    bodySize: stats.bodySize,
    rulesByPage: document.pages.map((page) => page.rules),
  };

  const structure = analyzeStructure(document.pages, layouts, stats, context);

  const referenceBlock = structure.blocks.find(
    (block): block is Extract<Block, { kind: "references" }> =>
      block.kind === "references",
  );
  const references = referenceBlock ? parseBibliography(referenceBlock.lines) : [];

  const rewriteStats = rewriteBlocks(structure.blocks, structure.labels, references);

  const hasFigureArtwork = structure.blocks.some(
    (block) => block.kind === "figure" && block.region,
  );
  const mediaFiles: string[] = [];
  let sourceAssetPath: string | null = null;
  if (hasFigureArtwork) {
    await mkdir(targets.assetDirectory, { recursive: true });
    const assetName = `${targets.sourceStem}-source.pdf`;
    await copyFile(sourcePath, path.join(targets.assetDirectory, assetName));
    const relative = path.posix.join(targets.assetRelativeDirectory, assetName);
    mediaFiles.push(relative);
    // graphicx needs a forward slash path and no extension ambiguity.
    sourceAssetPath = relative;
  }

  const reportLines = buildReport(
    document.pages.length,
    stats,
    structure,
    references,
    rewriteStats,
    removedHeadFoot,
  );

  const tex = renderDocument({
    stats,
    geometry,
    structure,
    references,
    sourceAssetPath,
    bibStem: references.length
      ? path.posix.basename(targets.bibRelativePath, ".bib")
      : null,
    authorYearCitations: rewriteStats.authorYear,
    reportLines,
  });

  await mkdir(path.dirname(targets.texPath), { recursive: true });
  await writeFile(targets.texPath, tex, "utf8");
  if (references.length) {
    await writeFile(targets.bibPath, renderBibFile(references), "utf8");
  }

  warnings.push(...summariseWarnings(mathContext.warnings));
  warnings.push(
    "LatexDo rebuilt this source from the printed page, so wording is exact but structure is inferred. Compare it against the PDF before you submit.",
  );
  if (hasFigureArtwork) {
    warnings.push(
      "Figures are cropped out of a copy of the original PDF. Replace them with your own source files when you have them.",
    );
  }
  if (structure.lowConfidenceMath > 0) {
    warnings.push(
      `${structure.lowConfidenceMath} formula${structure.lowConfidenceMath === 1 ? "" : "s"} need a check; each one is marked with a TODO comment.`,
    );
  }
  if (references.length) {
    const unparsed = references.filter((reference) => !reference.parsed).length;
    if (unparsed) {
      warnings.push(
        `${unparsed} of ${references.length} bibliography entries kept only their raw text.`,
      );
    }
  }
  if (rewriteStats.unresolvedCitations) {
    warnings.push(
      `${rewriteStats.unresolvedCitations} citation marker${rewriteStats.unresolvedCitations === 1 ? "" : "s"} did not match a reference entry and were left as plain text.`,
    );
  }

  return {
    sourcePath,
    relativePath: targets.texRelativePath,
    bibRelativePath: references.length ? targets.bibRelativePath : null,
    assetDirectory: hasFigureArtwork ? targets.assetRelativeDirectory : null,
    mediaFiles,
    converter: "built-in",
    pageCount: document.pages.length,
    stats: {
      sections: structure.blocks.filter((block) => block.kind === "section").length,
      equations: structure.blocks.filter((block) => block.kind === "equation").length,
      figures: structure.figureCount,
      tables: structure.tableCount,
      references: references.length,
      citations: rewriteStats.citations,
      crossReferences: rewriteStats.crossReferences,
      lowConfidenceMath: structure.lowConfidenceMath,
    },
    warnings,
  };
}

/** Applies citation and cross reference rewriting to every text carrying block. */
function rewriteBlocks(
  blocks: Block[],
  labels: LabelMaps,
  references: Reference[],
): RewriteStats {
  const total: RewriteStats = {
    citations: 0,
    crossReferences: 0,
    unresolvedCitations: 0,
    authorYear: false,
  };

  const apply = (value: string): string => {
    const result = rewriteReferences(value, labels, references);
    total.citations += result.stats.citations;
    total.crossReferences += result.stats.crossReferences;
    total.unresolvedCitations += result.stats.unresolvedCitations;
    total.authorYear = total.authorYear || result.stats.authorYear;
    return result.latex;
  };

  for (const block of blocks) {
    switch (block.kind) {
      case "abstract":
      case "paragraph":
      case "section":
      case "theorem":
      case "footnote":
        block.latex = apply(block.latex);
        break;
      case "figure":
        block.caption = apply(block.caption);
        break;
      case "table":
        block.caption = apply(block.caption);
        if (block.body) {
          block.body = apply(block.body);
        }
        break;
      case "list":
        block.items = block.items.map(apply);
        break;
      default:
        break;
    }
  }

  return total;
}

function computeGeometry(layouts: PageLayout[], stats: DocumentStats): PageGeometry {
  const width = stats.pageWidth;
  const height = stats.pageHeight;
  const paper: PageGeometry["paper"] =
    Math.abs(width - 612) < 4 && Math.abs(height - 792) < 4
      ? "letterpaper"
      : Math.abs(width - 595) < 5 && Math.abs(height - 842) < 5
        ? "a4paper"
        : "custom";

  const bodyPages = layouts.filter((layout) => layout.lines.length > 4);
  const sample = bodyPages.length ? bodyPages : layouts;
  const pick = (values: number[], fallback: number): number => {
    if (!values.length) {
      return fallback;
    }
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  return {
    paper,
    widthPt: width,
    heightPt: height,
    left: pick(
      sample.map((layout) => layout.bodyLeft),
      72,
    ),
    right: pick(
      sample.map((layout) => width - layout.bodyRight),
      72,
    ),
    top: pick(
      sample.map((layout) => layout.bodyTop),
      72,
    ),
    bottom: pick(
      sample.map((layout) => height - layout.bodyBottom),
      72,
    ),
  };
}

function buildReport(
  pageCount: number,
  stats: DocumentStats,
  structure: ReturnType<typeof analyzeStructure>,
  references: Reference[],
  rewriteStats: RewriteStats,
  removedHeadFoot: number,
): string[] {
  const equations = structure.blocks.filter(
    (block) => block.kind === "equation",
  ).length;
  const sections = structure.blocks.filter((block) => block.kind === "section").length;
  return [
    `Source: ${pageCount} page${pageCount === 1 ? "" : "s"}, ${stats.columnCount} column${stats.columnCount === 1 ? "" : "s"}, body text at ${stats.bodySize.toFixed(1)}pt.`,
    `Recovered: ${sections} headings, ${equations} display equations, ${structure.figureCount} figures, ${structure.tableCount} tables, ${references.length} references.`,
    `Rewired: ${rewriteStats.citations} citations and ${rewriteStats.crossReferences} cross references.`,
    `Discarded ${removedHeadFoot} running header and footer lines.`,
    structure.lowConfidenceMath
      ? `${structure.lowConfidenceMath} formulas are marked with a TODO comment.`
      : "All formulas reconstructed with high confidence.",
  ];
}

/** Collapses repeated per glyph complaints into one line each. */
function summariseWarnings(warnings: string[]): string[] {
  const counts = new Map<string, number>();
  for (const warning of warnings) {
    counts.set(warning, (counts.get(warning) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([warning, count]) => (count > 1 ? `${warning} (${count} times)` : warning));
}

async function assertReadablePdf(sourcePath: string): Promise<void> {
  const sourceStats = await stat(sourcePath);
  if (!sourceStats.isFile()) {
    throw new Error("Select a PDF file to import.");
  }
  if (sourceStats.size > maxPdfSize) {
    throw new Error("PDF import supports files up to 200 MB.");
  }
  if (path.extname(sourcePath).toLowerCase() !== ".pdf") {
    throw new Error("Select a .pdf file to import.");
  }
}

async function createImportTargets(
  projectPath: string,
  sourcePath: string,
): Promise<ImportTargets> {
  const sourceStem = sanitizeFileStem(
    path.basename(sourcePath, path.extname(sourcePath)),
  );
  const texRelativePath = await uniqueRelativePath(projectPath, `${sourceStem}.tex`);
  const stem = path.posix.basename(texRelativePath, ".tex");
  const bibRelativePath = await uniqueRelativePath(projectPath, `${stem}.bib`);
  const assetRelativeDirectory = await uniqueRelativePath(
    projectPath,
    path.posix.join("assets", stem),
    false,
  );

  return {
    projectPath,
    sourcePath,
    sourceStem: stem,
    texPath: path.join(projectPath, texRelativePath),
    texRelativePath,
    bibPath: path.join(projectPath, bibRelativePath),
    bibRelativePath,
    assetDirectory: path.join(projectPath, assetRelativeDirectory),
    assetRelativeDirectory,
  };
}

async function uniqueRelativePath(
  projectPath: string,
  desiredRelativePath: string,
  includeExtension = true,
): Promise<string> {
  const parsed = path.posix.parse(desiredRelativePath.replace(/\\/g, "/"));
  const baseDirectory = parsed.dir;
  const extension = includeExtension ? parsed.ext : "";
  const stem = includeExtension ? parsed.name : parsed.base;
  for (let index = 1; index < 10_000; index += 1) {
    const candidateName =
      index === 1 ? `${stem}${extension}` : `${stem}-${index}${extension}`;
    const candidate = baseDirectory
      ? path.posix.join(baseDirectory, candidateName)
      : candidateName;
    try {
      await access(path.join(projectPath, candidate));
    } catch {
      return candidate;
    }
  }
  throw new Error("Could not choose a unique output path for the PDF import.");
}

function sanitizeFileStem(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/\.{2,}/g, ".")
      .toLowerCase() || "imported-document"
  );
}
