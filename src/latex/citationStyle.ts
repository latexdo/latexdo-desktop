export const citationCommands = [
  "cite",
  "citep",
  "citet",
  "citealp",
  "citeauthor",
  "citeyear",
  "citeyearpar",
  "parencite",
  "textcite",
  "autocite",
  "footcite",
  "supercite",
] as const;

export type CitationCommand = (typeof citationCommands)[number];

export interface CitationStyleContext {
  command: CitationCommand;
  source: "nearby" | "selection" | "active-file" | "project" | "package" | "fallback";
  confidence: number;
}

export interface CitationUsageLike {
  key?: string;
  command: string;
  sourceFile?: string;
  line?: number;
}

export interface ResolveCitationStyleInput {
  selectedText?: string;
  nearbyText?: string;
  activeFilePath?: string | null;
  activeDocumentText?: string;
  usages?: CitationUsageLike[];
}

export const supportedCommands = new Set<CitationCommand>(citationCommands);

const citationCommandPattern = new RegExp(
  String.raw`\\(${citationCommands.join("|")})\*?(?:\s*\[[^\]]*\])*\s*\{`,
  "g",
);

function toCitationCommand(command: string | undefined): CitationCommand | null {
  const normalized = (command ?? "").replace(/\*$/, "");
  return supportedCommands.has(normalized as CitationCommand)
    ? (normalized as CitationCommand)
    : null;
}

function normalizePath(value: string | null | undefined): string {
  return (value ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
}

export function commandCounts(
  usages: Iterable<CitationUsageLike>,
): Map<CitationCommand, number> {
  const counts = new Map<CitationCommand, number>();
  for (const usage of usages) {
    const command = toCitationCommand(usage.command);
    if (!command) continue;
    counts.set(command, (counts.get(command) ?? 0) + 1);
  }
  return counts;
}

export function mostCommonCommand(
  usages: Iterable<CitationUsageLike>,
): CitationCommand | null {
  const counts = commandCounts(usages);
  let best: CitationCommand | null = null;
  let bestCount = 0;
  for (const command of citationCommands) {
    const count = counts.get(command) ?? 0;
    if (count > bestCount) {
      best = command;
      bestCount = count;
    }
  }
  return best;
}

export function citationCommandsInText(text: string): CitationCommand[] {
  const commands: CitationCommand[] = [];
  citationCommandPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = citationCommandPattern.exec(text)) !== null) {
    const command = toCitationCommand(match[1]);
    if (command) commands.push(command);
  }
  return commands;
}

export function mostCommonTextCommand(text: string): CitationCommand | null {
  return mostCommonCommand(
    citationCommandsInText(text).map((command) => ({ command })),
  );
}

export function commandFromPackages(documentText: string): CitationCommand | null {
  const packages = new Set<string>();
  const packagePattern = /\\usepackage(?:\s*\[[^\]]*\])?\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = packagePattern.exec(documentText)) !== null) {
    for (const name of match[1].split(",")) {
      packages.add(name.trim().toLowerCase());
    }
  }

  if (packages.has("natbib")) return "citep";
  if (packages.has("biblatex") || /\\addbibresource\s*\{/i.test(documentText)) {
    return "parencite";
  }
  return null;
}

export function resolveCitationStyle({
  selectedText = "",
  nearbyText = "",
  activeFilePath = null,
  activeDocumentText = "",
  usages = [],
}: ResolveCitationStyleInput): CitationStyleContext {
  const nearbyCommand = mostCommonTextCommand(nearbyText);
  if (nearbyCommand) {
    return { command: nearbyCommand, source: "nearby", confidence: 0.95 };
  }

  const selectionCommand = mostCommonTextCommand(selectedText);
  if (selectionCommand) {
    return { command: selectionCommand, source: "selection", confidence: 0.9 };
  }

  const activeTextCommand = mostCommonTextCommand(activeDocumentText);
  if (activeTextCommand) {
    return {
      command: activeTextCommand,
      source: "active-file",
      confidence: 0.84,
    };
  }

  const activePath = normalizePath(activeFilePath);
  if (activePath) {
    const activeFileCommand = mostCommonCommand(
      usages.filter((usage) => normalizePath(usage.sourceFile) === activePath),
    );
    if (activeFileCommand) {
      return {
        command: activeFileCommand,
        source: "active-file",
        confidence: 0.82,
      };
    }
  }

  const projectCommand = mostCommonCommand(usages);
  if (projectCommand) {
    return { command: projectCommand, source: "project", confidence: 0.74 };
  }

  const packageCommand = commandFromPackages(activeDocumentText);
  if (packageCommand) {
    return { command: packageCommand, source: "package", confidence: 0.58 };
  }

  return { command: "cite", source: "fallback", confidence: 0.4 };
}

export function formatCitation(
  command: CitationCommand,
  keys: Iterable<string>,
): string {
  const cleanKeys: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const cleaned = key.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    cleanKeys.push(cleaned);
  }
  return `\\${command}{${cleanKeys.join(",")}}`;
}
