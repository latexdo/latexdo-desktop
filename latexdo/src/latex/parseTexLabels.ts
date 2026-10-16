import type { LabelEntry } from "./latexIndex";

function inferLabelKind(key: string): LabelEntry["kind"] {
  if (key.startsWith("fig:")) return "figure";
  if (key.startsWith("tab:")) return "table";
  if (key.startsWith("eq:")) return "equation";
  if (key.startsWith("sec:")) return "section";
  if (key.startsWith("subsec:")) return "subsection";
  if (key.startsWith("thm:")) return "theorem";
  return "unknown";
}

function findNearestCaption(
  lines: string[],
  labelLineIndex: number,
): string | undefined {
  const start = Math.max(0, labelLineIndex - 8);
  const end = Math.min(lines.length - 1, labelLineIndex + 3);
  for (let i = labelLineIndex; i >= start; i--) {
    const match = lines[i].match(/\\caption(?:\[[^\]]*\])?\{([^}]*)\}/);
    if (match) return match[1].trim();
  }
  for (let i = labelLineIndex; i <= end; i++) {
    const match = lines[i].match(/\\caption(?:\[[^\]]*\])?\{([^}]*)\}/);
    if (match) return match[1].trim();
  }
  return undefined;
}

function findNearestSectionTitle(
  lines: string[],
  labelLineIndex: number,
): string | undefined {
  for (let i = labelLineIndex; i >= Math.max(0, labelLineIndex - 20); i--) {
    const match = lines[i].match(
      /\\(?:section|subsection|subsubsection)\*?\{([^}]*)\}/,
    );
    if (match) return match[1].trim();
  }
  return undefined;
}

function inferEnvironment(lines: string[], labelLineIndex: number): LabelEntry["kind"] {
  for (let i = labelLineIndex; i >= Math.max(0, labelLineIndex - 30); i--) {
    if (/\\begin\{figure\}/.test(lines[i])) return "figure";
    if (/\\begin\{table\}/.test(lines[i])) return "table";
    if (/\\begin\{equation\}/.test(lines[i])) return "equation";
    if (/\\begin\{align\}/.test(lines[i])) return "equation";
    if (/\\begin\{theorem\}/.test(lines[i])) return "theorem";
  }
  return "unknown";
}

export function parseTexLabels(content: string, sourceFile: string): LabelEntry[] {
  const lines = content.split(/\r?\n/);
  const labels: LabelEntry[] = [];
  lines.forEach((line, index) => {
    const matches = line.matchAll(/\\label\{([^}]+)\}/g);
    for (const match of matches) {
      const key = match[1];
      const envKind = inferEnvironment(lines, index);
      const kindFromLabel = inferLabelKind(key);
      const kind = envKind === "unknown" ? kindFromLabel : envKind;
      labels.push({
        key,
        kind,
        caption: findNearestCaption(lines, index),
        title: findNearestSectionTitle(lines, index),
        line: index + 1,
        sourceFile,
      });
    }
  });
  return labels;
}
