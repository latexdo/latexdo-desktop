// Builds the text the paper checks run on: the root file with every
// \input/\include expanded and LaTeX comments removed, plus a line map so each
// finding points back at the file and line it came from.

export interface PaperLineOrigin {
  file: string;
  line: number;
}

export interface PaperSource {
  text: string;
  origins: PaperLineOrigin[];
}

const includePattern = /\\(?:input|include|subfile|InputIfFileExists)\s*\{([^}]+)\}/g;
const maxIncludedFiles = 80;

/** Removes `%` comments (not `\%`) while keeping every line in place. */
export function stripLatexComment(line: string): string {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "\\") {
      index += 1;
      continue;
    }
    if (line[index] === "%") return line.slice(0, index);
  }
  return line;
}

export function stripLatexComments(text: string): string {
  return text.split("\n").map(stripLatexComment).join("\n");
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function includeTarget(raw: string): string {
  const path = normalizePath(raw.trim());
  return /\.[A-Za-z0-9]+$/.test(path) ? path : `${path}.tex`;
}

export async function loadPaperSource(
  rootFile: string,
  readFile: (relativePath: string) => Promise<string | null>,
): Promise<PaperSource> {
  const text: string[] = [];
  const origins: PaperLineOrigin[] = [];
  const visited = new Set<string>();

  const visit = async (file: string, content: string) => {
    visited.add(file);
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = stripLatexComment(lines[index]!.replace(/\r$/, ""));
      text.push(line);
      origins.push({ file, line: index + 1 });
      for (const match of line.matchAll(includePattern)) {
        const target = includeTarget(match[1]!);
        if (visited.has(target) || visited.size >= maxIncludedFiles) continue;
        const child = await readFile(target);
        if (child !== null) await visit(target, child);
      }
    }
  };

  const root = normalizePath(rootFile);
  const rootContent = await readFile(root);
  if (rootContent !== null) await visit(root, rootContent);
  return { text: text.join("\n"), origins };
}

/** Maps a 1-based line in the expanded paper back to its source file. */
export function paperLineOrigin(
  source: PaperSource,
  line: number,
): PaperLineOrigin | null {
  return source.origins[Math.max(0, line - 1)] ?? null;
}
