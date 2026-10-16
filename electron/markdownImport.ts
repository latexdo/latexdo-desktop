import { execFile } from "child_process";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface MarkdownImportResult {
  sourcePath: string;
  relativePath: string;
  converter: "pandoc" | "built-in";
  warnings: string[];
}

async function tryPandocImport(
  sourcePath: string,
  texPath: string,
): Promise<MarkdownImportResult> {
  const sourceDir = path.dirname(sourcePath);
  const basename = path.basename(sourcePath, path.extname(sourcePath));
  await execFileAsync("pandoc", [
    sourcePath,
    "--from=markdown",
    "--to=latex",
    "--standalone",
    "--wrap=none",
    `--resource-path=${sourceDir}`,
    "--output",
    texPath,
  ]);
  return {
    sourcePath,
    relativePath: `${basename}.tex`,
    converter: "pandoc",
    warnings: [],
  };
}

function inlineFormatting(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "\\textbf{$1}")
    .replace(/\*(.+?)\*/g, "\\textit{$1}")
    .replace(/`([^`]+)`/g, "\\texttt{$1}")
    .replace(/~~(.+?)~~/g, "\\sout{$1}")
    .replace(/!\[(.*?)\]\((.+?)\)/g, "\\includegraphics{$2}")
    .replace(/\[(.+?)\]\((.+?)\)/g, "\\href{$2}{$1}");
}

function builtInImport(mdContent: string): string {
  const lines = mdContent.split("\n");
  const latexLines: string[] = [];
  let inCodeBlock = false;
  let inParagraph = false;
  let inItemize = false;
  let inEnumerate = false;

  function closeParagraph() {
    if (inParagraph) {
      latexLines.push("");
      inParagraph = false;
    }
  }

  function closeList() {
    if (inItemize) {
      latexLines.push("\\end{itemize}");
      inItemize = false;
    }
    if (inEnumerate) {
      latexLines.push("\\end{enumerate}");
      inEnumerate = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith("```")) {
      closeParagraph();
      closeList();
      if (inCodeBlock) {
        latexLines.push("\\end{verbatim}");
        inCodeBlock = false;
      } else {
        latexLines.push("\\begin{verbatim}");
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      latexLines.push(line);
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(line.trim())) {
      closeParagraph();
      closeList();
      latexLines.push("\\hline");
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      closeParagraph();
      closeList();
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeParagraph();
      closeList();
      const level = headingMatch[1].length;
      const text = inlineFormatting(headingMatch[2]);
      const cmd = [
        "\\section",
        "\\subsection",
        "\\subsubsection",
        "\\paragraph",
        "\\subparagraph",
        "\\textbf",
      ][level - 1];
      latexLines.push(`${cmd}{${text}}`);
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      closeParagraph();
      if (!inItemize) {
        closeList();
        latexLines.push("\\begin{itemize}");
        inItemize = true;
      }
      latexLines.push(`  \\item ${inlineFormatting(ulMatch[2])}`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (olMatch) {
      closeParagraph();
      if (!inEnumerate) {
        closeList();
        latexLines.push("\\begin{enumerate}");
        inEnumerate = true;
      }
      latexLines.push(`  \\item ${inlineFormatting(olMatch[2])}`);
      continue;
    }

    // Regular paragraph
    closeList();
    if (!inParagraph) {
      latexLines.push(inlineFormatting(line));
      inParagraph = true;
    } else {
      latexLines.push(inlineFormatting(line));
    }
  }

  closeParagraph();
  closeList();
  if (inCodeBlock) {
    latexLines.push("\\end{verbatim}");
  }

  const body = latexLines.join("\n");
  return [
    "\\documentclass{article}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage{hyperref}",
    "\\usepackage{graphicx}",
    "\\usepackage{amsmath}",
    "\\usepackage{ulem}",
    "",
    "\\title{Converted from Markdown}",
    "\\date{}",
    "",
    "\\begin{document}",
    "\\maketitle",
    "",
    body,
    "",
    "\\end{document}",
    "",
  ].join("\n");
}

export async function importMarkdown(
  projectRoot: string,
  sourcePath: string,
): Promise<MarkdownImportResult> {
  const basename = path.basename(sourcePath, path.extname(sourcePath));
  const texPath = path.join(projectRoot, `${basename}.tex`);
  const warnings: string[] = [];
  let converter: "pandoc" | "built-in" = "built-in";

  try {
    const result = await tryPandocImport(sourcePath, texPath);
    converter = "pandoc";
    return result;
  } catch {
    warnings.push("Pandoc not available. Using built-in Markdown converter.");
    const mdContent = await readFile(sourcePath, "utf-8");
    const latexContent = builtInImport(mdContent);
    await writeFile(texPath, latexContent, "utf-8");
  }

  return {
    sourcePath,
    relativePath: `${basename}.tex`,
    converter,
    warnings,
  };
}
