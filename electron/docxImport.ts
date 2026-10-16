import { execFile } from "node:child_process";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";
import type { DocxImportResult } from "./types.js";

const execFileAsync = promisify(execFile);
const maxDocxSize = 80 * 1024 * 1024;
const maxZipEntries = 10_000;
const maxZipEntrySize = 120 * 1024 * 1024;

interface ImportTargets {
  projectPath: string;
  sourcePath: string;
  sourceStem: string;
  texPath: string;
  texRelativePath: string;
  assetDirectory: string;
  assetRelativeDirectory: string;
}

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

interface Relationship {
  id: string;
  type: string;
  target: string;
  targetMode?: string;
}

interface NumberingLevel {
  format: string;
  level: number;
}

interface NumberingContext {
  numToAbstract: Map<string, string>;
  levels: Map<string, NumberingLevel>;
}

interface FallbackContext {
  zip: DocxZip;
  relationships: Map<string, Relationship>;
  styles: Map<string, string>;
  numbering: NumberingContext;
  mediaFiles: string[];
  warnings: string[];
  mediaWrites: Promise<void>[];
  assetDirectory: string;
  assetRelativeDirectory: string;
  copiedMedia: Set<string>;
}

interface ConvertedParagraph {
  kind: "paragraph" | "heading" | "list" | "empty";
  text: string;
  headingLevel?: number;
  listKind?: "itemize" | "enumerate";
  listLevel?: number;
}

interface ConvertedBlock {
  kind: "paragraph" | "heading" | "list" | "raw" | "empty";
  text: string;
  headingLevel?: number;
  listKind?: "itemize" | "enumerate";
  listLevel?: number;
}

class DocxZip {
  private readonly entries = new Map<string, ZipEntry>();

  constructor(private readonly data: Buffer) {
    this.readCentralDirectory();
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  list(prefix = ""): string[] {
    return [...this.entries.keys()].filter((name) => name.startsWith(prefix));
  }

  read(name: string): Buffer | null {
    const entry = this.entries.get(name);
    if (!entry) {
      return null;
    }

    if (entry.uncompressedSize > maxZipEntrySize) {
      throw new Error(`DOCX entry is too large: ${entry.name}`);
    }

    const localOffset = entry.localHeaderOffset;
    if (this.data.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`DOCX local header is invalid: ${entry.name}`);
    }

    const fileNameLength = this.data.readUInt16LE(localOffset + 26);
    const extraLength = this.data.readUInt16LE(localOffset + 28);
    const contentOffset = localOffset + 30 + fileNameLength + extraLength;
    const compressed = this.data.subarray(
      contentOffset,
      contentOffset + entry.compressedSize,
    );

    if (entry.compressionMethod === 0) {
      return Buffer.from(compressed);
    }
    if (entry.compressionMethod === 8) {
      return inflateRawSync(compressed);
    }

    throw new Error(
      `DOCX entry uses unsupported compression method ${entry.compressionMethod}: ${entry.name}`,
    );
  }

  readText(name: string): string {
    const content = this.read(name);
    return content ? content.toString("utf8") : "";
  }

  private readCentralDirectory(): void {
    const eocdOffset = findEndOfCentralDirectory(this.data);
    if (eocdOffset < 0) {
      throw new Error("The selected file is not a valid DOCX archive.");
    }

    const totalEntries = this.data.readUInt16LE(eocdOffset + 10);
    const centralDirectorySize = this.data.readUInt32LE(eocdOffset + 12);
    let offset = this.data.readUInt32LE(eocdOffset + 16);
    const endOffset = offset + centralDirectorySize;

    if (totalEntries > maxZipEntries || endOffset > this.data.length) {
      throw new Error("The DOCX archive is too large or malformed.");
    }

    for (let index = 0; index < totalEntries; index += 1) {
      if (this.data.readUInt32LE(offset) !== 0x02014b50) {
        throw new Error("The DOCX central directory is malformed.");
      }

      const compressionMethod = this.data.readUInt16LE(offset + 10);
      const compressedSize = this.data.readUInt32LE(offset + 20);
      const uncompressedSize = this.data.readUInt32LE(offset + 24);
      const fileNameLength = this.data.readUInt16LE(offset + 28);
      const extraLength = this.data.readUInt16LE(offset + 30);
      const commentLength = this.data.readUInt16LE(offset + 32);
      const localHeaderOffset = this.data.readUInt32LE(offset + 42);
      const name = this.data
        .subarray(offset + 46, offset + 46 + fileNameLength)
        .toString("utf8")
        .replace(/\\/g, "/");

      this.entries.set(name, {
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });

      offset += 46 + fileNameLength + extraLength + commentLength;
    }
  }
}

export async function importDocxIntoProject(
  projectPath: string,
  sourcePath: string,
): Promise<DocxImportResult> {
  await assertReadableDocx(sourcePath);

  const targets = await createImportTargets(projectPath, sourcePath);
  await mkdir(path.dirname(targets.texPath), { recursive: true });
  await mkdir(targets.assetDirectory, { recursive: true });

  const pandocResult = await tryPandocImport(targets);
  if (pandocResult) {
    return pandocResult;
  }

  return builtInImport(targets);
}

async function assertReadableDocx(sourcePath: string): Promise<void> {
  const sourceStats = await stat(sourcePath);
  if (!sourceStats.isFile()) {
    throw new Error("Select a DOCX file to import.");
  }
  if (sourceStats.size > maxDocxSize) {
    throw new Error("DOCX import supports files up to 80 MB.");
  }
  if (path.extname(sourcePath).toLowerCase() !== ".docx") {
    throw new Error("Select a .docx file to import.");
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
  const assetRelativeDirectory = await uniqueRelativePath(
    projectPath,
    path.posix.join("assets", sourceStem),
    false,
  );

  return {
    projectPath,
    sourcePath,
    sourceStem,
    texPath: path.join(projectPath, texRelativePath),
    texRelativePath,
    assetDirectory: path.join(projectPath, assetRelativeDirectory),
    assetRelativeDirectory,
  };
}

async function tryPandocImport(
  targets: ImportTargets,
): Promise<DocxImportResult | null> {
  try {
    await execFileAsync(
      "pandoc",
      [
        targets.sourcePath,
        "--from=docx",
        "--to=latex",
        "--standalone",
        "--wrap=none",
        "--top-level-division=section",
        `--extract-media=${targets.assetDirectory}`,
        `--resource-path=${path.dirname(targets.sourcePath)}`,
        "--output",
        targets.texPath,
      ],
      {
        maxBuffer: 12 * 1024 * 1024,
        timeout: 120_000,
      },
    );

    const mediaFiles = await collectMediaFiles(
      targets.projectPath,
      targets.assetDirectory,
    );
    const warnings = [
      "Converted with Pandoc. Review the generated preamble before final submission.",
    ];

    return {
      sourcePath: targets.sourcePath,
      relativePath: targets.texRelativePath,
      assetDirectory: targets.assetRelativeDirectory,
      mediaFiles,
      converter: "pandoc",
      warnings,
    };
  } catch {
    return null;
  }
}

async function builtInImport(targets: ImportTargets): Promise<DocxImportResult> {
  const buffer = await readFile(targets.sourcePath);
  const zip = new DocxZip(buffer);
  const documentXml = zip.readText("word/document.xml");
  if (!documentXml) {
    throw new Error("The DOCX file does not contain a Word document body.");
  }

  const context: FallbackContext = {
    zip,
    relationships: parseRelationships(zip.readText("word/_rels/document.xml.rels")),
    styles: parseStyles(zip.readText("word/styles.xml")),
    numbering: parseNumbering(zip.readText("word/numbering.xml")),
    mediaFiles: [],
    warnings: [
      "Pandoc was not available, so LatexDo used its built-in DOCX importer.",
      "Review complex equations, tracked changes, SmartArt, footnotes, and custom Word styles.",
    ],
    mediaWrites: [],
    assetDirectory: targets.assetDirectory,
    assetRelativeDirectory: targets.assetRelativeDirectory,
    copiedMedia: new Set(),
  };

  const coreTitle = parseCoreTitle(zip.readText("docProps/core.xml"));
  const body = getTagContent(documentXml, "w:body") ?? documentXml;
  const blocks = convertBodyBlocks(body, context);
  const tex = renderLatexDocument(
    coreTitle || titleFromStem(targets.sourceStem),
    blocks,
    context.mediaFiles.length > 0,
  );

  await Promise.all(context.mediaWrites);
  await writeFile(targets.texPath, tex, "utf8");

  return {
    sourcePath: targets.sourcePath,
    relativePath: targets.texRelativePath,
    assetDirectory: targets.assetRelativeDirectory,
    mediaFiles: context.mediaFiles,
    converter: "built-in",
    warnings: context.warnings,
  };
}

function convertBodyBlocks(
  bodyXml: string,
  context: FallbackContext,
): ConvertedBlock[] {
  const blocks: ConvertedBlock[] = [];
  for (const block of extractTopLevelBlocks(bodyXml)) {
    if (block.startsWith("<w:p")) {
      const paragraph = convertParagraph(block, context);
      if (paragraph.kind !== "empty") {
        blocks.push(paragraph);
      }
      continue;
    }

    if (block.startsWith("<w:tbl")) {
      const table = convertTable(block, context);
      if (table) {
        blocks.push({ kind: "raw", text: table });
      }
    }
  }
  return blocks;
}

function convertParagraph(
  paragraphXml: string,
  context: FallbackContext,
): ConvertedParagraph {
  const pPr = getTagContent(paragraphXml, "w:pPr") ?? "";
  const styleId = getAttributeFromTag(pPr, "w:pStyle", "w:val");
  const styleName = styleId ? context.styles.get(styleId) : undefined;
  const headingLevel = headingLevelForStyle(styleId ?? undefined, styleName);
  const numPr = getTagContent(pPr, "w:numPr");
  const numId = numPr ? getAttributeFromTag(numPr, "w:numId", "w:val") : null;
  const ilvl = numPr ? getAttributeFromTag(numPr, "w:ilvl", "w:val") : null;
  const listLevel = Number.parseInt(ilvl ?? "0", 10) || 0;
  const listKind = numId
    ? listKindForNumbering(context.numbering, numId, listLevel)
    : null;
  const text = collapseLatexWhitespace(convertInlineContent(paragraphXml, context));

  if (!text.trim()) {
    return { kind: "empty", text: "" };
  }

  if (headingLevel) {
    return {
      kind: "heading",
      headingLevel,
      text: stripLatexCommands(text).trim(),
    };
  }

  if (listKind) {
    return {
      kind: "list",
      listKind,
      listLevel,
      text,
    };
  }

  return {
    kind: "paragraph",
    text,
  };
}

function convertInlineContent(xml: string, context: FallbackContext): string {
  let output = "";
  const inlinePattern =
    /<w:hyperlink\b[\s\S]*?<\/w:hyperlink>|<w:r\b[\s\S]*?<\/w:r>|<m:oMath(?:Para)?\b[\s\S]*?<\/m:oMath(?:Para)?>/g;
  for (const match of xml.matchAll(inlinePattern)) {
    const node = match[0];
    if (node.startsWith("<w:hyperlink")) {
      output += convertHyperlink(node, context);
    } else if (node.startsWith("<m:oMath")) {
      output += convertEquation(node, context);
    } else {
      output += convertRun(node, context);
    }
  }
  return output;
}

function convertRun(runXml: string, context: FallbackContext): string {
  const drawing = convertDrawing(runXml, context);
  if (drawing) {
    return drawing;
  }

  let text = "";
  for (const textMatch of runXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)) {
    text += escapeLatex(decodeXml(textMatch[1]));
  }
  text += (runXml.match(/<w:tab\b/g) ?? []).map(() => "\\quad ").join("");
  text += (runXml.match(/<w:br\b/g) ?? []).map(() => "\\\\\n").join("");

  if (!text) {
    return "";
  }

  const rPr = getTagContent(runXml, "w:rPr") ?? "";
  const verticalAlign = getAttributeFromTag(rPr, "w:vertAlign", "w:val");
  if (verticalAlign === "superscript") {
    text = `\\textsuperscript{${text}}`;
  } else if (verticalAlign === "subscript") {
    text = `\\textsubscript{${text}}`;
  }
  if (hasEnabledProperty(rPr, "w:u")) {
    text = `\\underline{${text}}`;
  }
  if (hasEnabledProperty(rPr, "w:i")) {
    text = `\\emph{${text}}`;
  }
  if (hasEnabledProperty(rPr, "w:b")) {
    text = `\\textbf{${text}}`;
  }
  if (hasEnabledProperty(rPr, "w:strike")) {
    text = `\\sout{${text}}`;
  }
  if (hasEnabledProperty(rPr, "w:highlight")) {
    text = `\\hl{${text}}`;
  }

  return text;
}

function convertHyperlink(xml: string, context: FallbackContext): string {
  const id = getAttribute(xml, "r:id");
  const relationship = id ? context.relationships.get(id) : undefined;
  const text = convertInlineContent(xml.replace(/^<w:hyperlink\b[^>]*>/, ""), context);
  if (!relationship?.target || !text.trim()) {
    return text;
  }
  if (relationship.targetMode === "External") {
    return `\\href{${escapeLatexUrl(relationship.target)}}{${text}}`;
  }
  return text;
}

function convertEquation(xml: string, context: FallbackContext): string {
  const terms = [...xml.matchAll(/<m:t\b[^>]*>([\s\S]*?)<\/m:t>/g)].map((match) =>
    escapeLatex(decodeXml(match[1])),
  );
  if (!terms.length) {
    context.warnings.push("Skipped a Word equation that could not be read.");
    return "";
  }
  context.warnings.push("Converted a Word equation as plain inline math.");
  return `$${terms.join(" ")}$`;
}

function convertDrawing(runXml: string, context: FallbackContext): string {
  const embedId =
    getAttributeFromTag(runXml, "a:blip", "r:embed") ??
    getAttributeFromTag(runXml, "asvg:svgBlip", "r:embed");
  if (!embedId) {
    return "";
  }

  const relationship = context.relationships.get(embedId);
  if (!relationship?.target) {
    return "";
  }

  const mediaPath = normalizeWordTarget(relationship.target);
  const media = context.zip.read(mediaPath);
  if (!media) {
    context.warnings.push(`Skipped missing DOCX media: ${mediaPath}`);
    return "";
  }

  const fileName = sanitizeAssetName(path.posix.basename(mediaPath));
  const relativePath = path.posix.join(context.assetRelativeDirectory, fileName);
  const outputPath = path.join(context.assetDirectory, fileName);
  if (!context.copiedMedia.has(relativePath)) {
    context.copiedMedia.add(relativePath);
    context.mediaFiles.push(relativePath);
    context.mediaWrites.push(
      mkdir(path.dirname(outputPath), { recursive: true }).then(() =>
        writeFile(outputPath, media),
      ),
    );
  }

  return `\n\\begin{figure}[ht]\n\\centering\n\\includegraphics[width=0.8\\linewidth]{${escapeLatexPath(relativePath)}}\n\\end{figure}\n`;
}

function convertTable(xml: string, context: FallbackContext): string {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)) {
      const paragraphs = [...cellMatch[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
        .map((match) =>
          stripLatexCommands(convertInlineContent(match[0], context)).trim(),
        )
        .filter(Boolean);
      cells.push(escapeLatex(paragraphs.join(" / ")));
    }
    if (cells.length) {
      rows.push(cells);
    }
  }

  if (!rows.length) {
    return "";
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const spec = Array.from({ length: columnCount }, () => "l").join("");
  const body = rows
    .map((row) =>
      Array.from({ length: columnCount }, (_, index) => row[index] ?? "").join(" & "),
    )
    .join(" \\\\\n");

  return `\\begin{center}\n\\begin{tabular}{${spec}}\n\\toprule\n${body} \\\\\n\\bottomrule\n\\end{tabular}\n\\end{center}`;
}

function renderLatexDocument(
  title: string,
  blocks: ConvertedBlock[],
  hasImages: boolean,
): string {
  const lines = [
    "\\documentclass[11pt]{article}",
    "\\usepackage[margin=1in]{geometry}",
    "\\usepackage[T1]{fontenc}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage{hyperref}",
    "\\usepackage{amsmath}",
    "\\usepackage{booktabs}",
    "\\usepackage[normalem]{ulem}",
    "\\usepackage{soul}",
  ];
  if (hasImages) {
    lines.push("\\usepackage{graphicx}");
  }
  lines.push(
    "",
    `\\title{${escapeLatex(title)}}`,
    "\\author{}",
    "\\date{\\today}",
    "",
    "\\begin{document}",
    "\\maketitle",
    "",
    renderBlocks(blocks),
    "",
    "\\end{document}",
    "",
  );
  return lines.join("\n");
}

function renderBlocks(blocks: ConvertedBlock[]): string {
  const lines: string[] = [];
  const listStack: Array<{ kind: "itemize" | "enumerate"; level: number }> = [];

  const closeListsToLevel = (level: number) => {
    while (listStack.length && listStack[listStack.length - 1].level >= level) {
      const current = listStack.pop()!;
      lines.push(`${indentFor(listStack.length)}\\end{${current.kind}}`);
    }
  };
  const closeListsAboveLevel = (level: number) => {
    while (listStack.length && listStack[listStack.length - 1].level > level) {
      const current = listStack.pop()!;
      lines.push(`${indentFor(listStack.length)}\\end{${current.kind}}`);
    }
  };

  for (const block of blocks) {
    if (block.kind !== "list") {
      closeListsToLevel(0);
    }

    if (block.kind === "heading") {
      lines.push(`${headingCommand(block.headingLevel ?? 1)}{${block.text}}`, "");
    } else if (block.kind === "paragraph") {
      lines.push(block.text, "");
    } else if (block.kind === "raw") {
      lines.push(block.text, "");
    } else if (block.kind === "list") {
      const level = Math.max(0, block.listLevel ?? 0);
      const kind = block.listKind ?? "itemize";
      closeListsAboveLevel(level);
      let current = listStack[listStack.length - 1];
      if (current?.level === level && current.kind !== kind) {
        closeListsToLevel(level);
        current = listStack[listStack.length - 1];
      }
      if (!current || current.level < level || current.level !== level) {
        lines.push(`${indentFor(listStack.length)}\\begin{${kind}}`);
        listStack.push({ kind, level });
      } else if (current.kind !== kind) {
        closeListsToLevel(level);
        lines.push(`${indentFor(listStack.length)}\\begin{${kind}}`);
        listStack.push({ kind, level });
      }
      lines.push(`${indentFor(listStack.length)}\\item ${block.text}`);
    }
  }

  closeListsToLevel(0);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function extractTopLevelBlocks(bodyXml: string): string[] {
  const blocks: string[] = [];
  let index = 0;
  while (index < bodyXml.length) {
    const paragraphIndex = bodyXml.indexOf("<w:p", index);
    const tableIndex = bodyXml.indexOf("<w:tbl", index);
    const candidates = [paragraphIndex, tableIndex].filter((value) => value >= 0);
    if (!candidates.length) {
      break;
    }

    const nextIndex = Math.min(...candidates);
    if (nextIndex === paragraphIndex) {
      const end = bodyXml.indexOf("</w:p>", nextIndex);
      if (end < 0) break;
      blocks.push(bodyXml.slice(nextIndex, end + "</w:p>".length));
      index = end + "</w:p>".length;
    } else {
      const end = findMatchingEnd(bodyXml, nextIndex, "w:tbl");
      if (end < 0) break;
      blocks.push(bodyXml.slice(nextIndex, end));
      index = end;
    }
  }
  return blocks;
}

function findMatchingEnd(xml: string, start: number, tag: string): number {
  const openPattern = new RegExp(`<${tag}\\b`, "g");
  const closePattern = new RegExp(`</${tag}>`, "g");
  let depth = 0;
  let index = start;
  while (index < xml.length) {
    openPattern.lastIndex = index;
    closePattern.lastIndex = index;
    const open = openPattern.exec(xml);
    const close = closePattern.exec(xml);
    if (open && (!close || open.index < close.index)) {
      depth += 1;
      index = open.index + open[0].length;
      continue;
    }
    if (!close) {
      return -1;
    }
    depth -= 1;
    index = close.index + close[0].length;
    if (depth === 0) {
      return index;
    }
  }
  return -1;
}

function parseRelationships(xml: string): Map<string, Relationship> {
  const relationships = new Map<string, Relationship>();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attributes = parseAttributes(match[1]);
    const id = attributes.get("Id");
    const target = attributes.get("Target");
    if (!id || !target) {
      continue;
    }
    relationships.set(id, {
      id,
      target,
      type: attributes.get("Type") ?? "",
      targetMode: attributes.get("TargetMode"),
    });
  }
  return relationships;
}

function parseStyles(xml: string): Map<string, string> {
  const styles = new Map<string, string>();
  for (const match of xml.matchAll(/<w:style\b([^>]*)>[\s\S]*?<\/w:style>/g)) {
    const styleId = parseAttributes(match[1]).get("w:styleId");
    const name = getAttributeFromTag(match[0], "w:name", "w:val");
    if (styleId && name) {
      styles.set(styleId, name);
    }
  }
  return styles;
}

function parseNumbering(xml: string): NumberingContext {
  const numToAbstract = new Map<string, string>();
  const levels = new Map<string, NumberingLevel>();

  for (const match of xml.matchAll(/<w:num\b([^>]*)>[\s\S]*?<\/w:num>/g)) {
    const numId = parseAttributes(match[1]).get("w:numId");
    const abstractNumId = getAttributeFromTag(match[0], "w:abstractNumId", "w:val");
    if (numId && abstractNumId) {
      numToAbstract.set(numId, abstractNumId);
    }
  }

  for (const match of xml.matchAll(
    /<w:abstractNum\b([^>]*)>[\s\S]*?<\/w:abstractNum>/g,
  )) {
    const abstractNumId = parseAttributes(match[1]).get("w:abstractNumId");
    if (!abstractNumId) {
      continue;
    }
    for (const levelMatch of match[0].matchAll(/<w:lvl\b([^>]*)>[\s\S]*?<\/w:lvl>/g)) {
      const level = Number.parseInt(
        parseAttributes(levelMatch[1]).get("w:ilvl") ?? "0",
        10,
      );
      const format =
        getAttributeFromTag(levelMatch[0], "w:numFmt", "w:val") ?? "bullet";
      levels.set(`${abstractNumId}:${level}`, { format, level });
    }
  }

  return { numToAbstract, levels };
}

function listKindForNumbering(
  numbering: NumberingContext,
  numId: string,
  level: number,
): "itemize" | "enumerate" {
  const abstractNumId = numbering.numToAbstract.get(numId);
  const levelInfo = abstractNumId
    ? numbering.levels.get(`${abstractNumId}:${level}`)
    : undefined;
  return levelInfo?.format === "decimal" ||
    levelInfo?.format === "upperRoman" ||
    levelInfo?.format === "lowerRoman" ||
    levelInfo?.format === "upperLetter" ||
    levelInfo?.format === "lowerLetter"
    ? "enumerate"
    : "itemize";
}

function parseCoreTitle(xml: string): string {
  const title = getTagContent(xml, "dc:title");
  return title ? decodeXml(title).trim() : "";
}

function headingLevelForStyle(styleId?: string, styleName?: string): number | null {
  const source = `${styleId ?? ""} ${styleName ?? ""}`
    .toLowerCase()
    .replace(/\s+/g, "");
  const match = source.match(/heading([1-6])/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function headingCommand(level: number): string {
  if (level <= 1) return "\\section";
  if (level === 2) return "\\subsection";
  if (level === 3) return "\\subsubsection";
  if (level === 4) return "\\paragraph";
  return "\\subparagraph";
}

function getTagContent(xml: string, tag: string): string | null {
  const pattern = new RegExp(
    `<${escapeRegExp(tag)}\\b[^>]*>([\\s\\S]*?)</${escapeRegExp(tag)}>`,
  );
  return pattern.exec(xml)?.[1] ?? null;
}

function getAttributeFromTag(
  xml: string,
  tag: string,
  attribute: string,
): string | null {
  const pattern = new RegExp(`<${escapeRegExp(tag)}\\b([^>]*)>`);
  const attributes = pattern.exec(xml)?.[1];
  return attributes ? (parseAttributes(attributes).get(attribute) ?? null) : null;
}

function getAttribute(xml: string, attribute: string): string | null {
  return parseAttributes(xml).get(attribute) ?? null;
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(/([A-Za-z0-9_:-]+)="([^"]*)"/g)) {
    attributes.set(match[1], decodeXml(match[2]));
  }
  return attributes;
}

function hasEnabledProperty(xml: string, tag: string): boolean {
  const pattern = new RegExp(
    `<${escapeRegExp(tag)}\\b([^>]*)/?>(?:</${escapeRegExp(tag)}>)?`,
  );
  const match = pattern.exec(xml);
  if (!match) {
    return false;
  }
  const value = parseAttributes(match[1]).get("w:val");
  return value !== "0" && value !== "false";
}

function normalizeWordTarget(target: string): string {
  const normalized = target.replace(/\\/g, "/").replace(/^\.\.\//, "");
  return normalized.startsWith("word/") ? normalized : `word/${normalized}`;
}

async function collectMediaFiles(
  projectPath: string,
  assetDirectory: string,
): Promise<string[]> {
  const files: string[] = [];
  await collectFiles(projectPath, assetDirectory, files).catch(() => {});
  return files.map((file) => file.replace(/\\/g, "/")).sort();
}

async function collectFiles(
  projectPath: string,
  currentDirectory: string,
  files: string[],
): Promise<void> {
  for (const entry of await readdir(currentDirectory, { withFileTypes: true })) {
    const fullPath = path.join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(projectPath, fullPath, files);
    } else if (entry.isFile()) {
      files.push(path.relative(projectPath, fullPath));
    }
  }
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
  throw new Error("Could not choose a unique output path for the DOCX import.");
}

function sanitizeFileStem(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/\.{2,}/g, ".")
      .toLowerCase() || "imported-document"
  );
}

function sanitizeAssetName(value: string): string {
  const extension = path.posix.extname(value).toLowerCase();
  const stem = sanitizeFileStem(path.posix.basename(value, extension));
  return `${stem}${extension || ".bin"}`;
}

function titleFromStem(stem: string): string {
  return stem
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

function collapseLatexWhitespace(value: string): string {
  return value
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function stripLatexCommands(value: string): string {
  return value
    .replace(
      /\\(?:textbf|emph|underline|sout|hl|textsuperscript|textsubscript)\{([^{}]*)\}/g,
      "$1",
    )
    .replace(/[{}]/g, "");
}

function escapeLatex(value: string): string {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/[“”]/g, "''")
    .replace(/[‘’]/g, "'");
}

function escapeLatexPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/([#%{}])/g, "\\$1");
}

function escapeLatexUrl(value: string): string {
  return value.replace(/[{}]/g, "");
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function indentFor(level: number): string {
  return "\t".repeat(level);
}

function findEndOfCentralDirectory(data: Buffer): number {
  const minimumOffset = Math.max(0, data.length - 65_557);
  for (let offset = data.length - 22; offset >= minimumOffset; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  return -1;
}
