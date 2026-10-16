import type { CitationEntry } from "./latexIndex";
import { parseBibFile } from "./parseBib";

export type CitationUsage = {
  key: string;
  command: string;
  sourceFile: string;
  line: number;
};

export type CitationDuplicateGroup = {
  reason: "key" | "doi" | "title";
  value: string;
  entries: CitationEntry[];
};

export type CitationQualityIssue = {
  key: string;
  sourceFile: string;
  severity: "warning" | "info";
  message: string;
};

export type CitationLibraryAnalysis = {
  entries: CitationEntry[];
  usages: CitationUsage[];
  bibFiles: string[];
  texFiles: string[];
  citedKeys: string[];
  usedKeys: string[];
  unusedKeys: string[];
  missingKeys: string[];
  duplicateGroups: CitationDuplicateGroup[];
  qualityIssues: CitationQualityIssue[];
  staleEntries: CitationEntry[];
};

export type CitationProjectFile = {
  path: string;
  content: string;
};

const citationCommandRegex =
  /\\((?:cite|citep|citet|citealp|citeauthor|citeyear|citeyearpar|parencite|textcite|autocite|footcite|supercite)[a-zA-Z]*\*?)(?:\s*\[[^\]]*\])*\s*\{([^}]*)\}/g;

function lineForIndex(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function normalizeKeyList(value: string): string[] {
  return value
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

function normalizedText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}$\\]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeDoi(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "")
    .trim();
}

function venueFor(entry: CitationEntry): string | undefined {
  return (
    entry.journal ??
    entry.booktitle ??
    entry.publisher ??
    entry.school ??
    entry.institution ??
    entry.howpublished
  );
}

function parsedYear(entry: CitationEntry): number | null {
  const match = entry.year?.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

export function extractCitationUsages(
  content: string,
  sourceFile: string,
): CitationUsage[] {
  const usages: CitationUsage[] = [];
  let match: RegExpExecArray | null;
  citationCommandRegex.lastIndex = 0;

  while ((match = citationCommandRegex.exec(content)) !== null) {
    const command = match[1];
    for (const key of normalizeKeyList(match[2])) {
      usages.push({
        key,
        command,
        sourceFile,
        line: lineForIndex(content, match.index),
      });
    }
  }

  return usages;
}

export function citationKeysInText(content: string): string[] {
  return [
    ...new Set(extractCitationUsages(content, "__inline__").map((usage) => usage.key)),
  ];
}

function findDuplicateGroups(entries: CitationEntry[]): CitationDuplicateGroup[] {
  const groups: CitationDuplicateGroup[] = [];

  const byKey = new Map<string, CitationEntry[]>();
  const byDoi = new Map<string, CitationEntry[]>();
  const byTitle = new Map<string, CitationEntry[]>();

  for (const entry of entries) {
    const key = entry.key.toLowerCase();
    byKey.set(key, [...(byKey.get(key) ?? []), entry]);

    const doi = normalizeDoi(entry.doi);
    if (doi) {
      byDoi.set(doi, [...(byDoi.get(doi) ?? []), entry]);
    }

    const title = normalizedText(entry.title);
    const year = parsedYear(entry);
    if (title && title.length >= 12) {
      const titleKey = `${title} ${year ?? ""}`.trim();
      byTitle.set(titleKey, [...(byTitle.get(titleKey) ?? []), entry]);
    }
  }

  for (const [value, duplicateEntries] of byKey.entries()) {
    if (duplicateEntries.length > 1) {
      groups.push({ reason: "key", value, entries: duplicateEntries });
    }
  }

  for (const [value, duplicateEntries] of byDoi.entries()) {
    const uniqueKeys = new Set(duplicateEntries.map((entry) => entry.key));
    if (duplicateEntries.length > 1 && uniqueKeys.size > 1) {
      groups.push({ reason: "doi", value, entries: duplicateEntries });
    }
  }

  for (const [value, duplicateEntries] of byTitle.entries()) {
    const uniqueKeys = new Set(duplicateEntries.map((entry) => entry.key));
    if (duplicateEntries.length > 1 && uniqueKeys.size > 1) {
      groups.push({ reason: "title", value, entries: duplicateEntries });
    }
  }

  return groups;
}

function findQualityIssues(
  entries: CitationEntry[],
  currentYear: number,
): CitationQualityIssue[] {
  const issues: CitationQualityIssue[] = [];

  for (const entry of entries) {
    if (!entry.title) {
      issues.push({
        key: entry.key,
        sourceFile: entry.sourceFile,
        severity: "warning",
        message: "Missing title",
      });
    }
    if (!entry.author && !entry.editor) {
      issues.push({
        key: entry.key,
        sourceFile: entry.sourceFile,
        severity: "warning",
        message: "Missing author or editor",
      });
    }
    if (!entry.year) {
      issues.push({
        key: entry.key,
        sourceFile: entry.sourceFile,
        severity: "warning",
        message: "Missing year",
      });
    }
    if (!venueFor(entry)) {
      issues.push({
        key: entry.key,
        sourceFile: entry.sourceFile,
        severity: "info",
        message: "Missing venue or publisher",
      });
    }
    if (!entry.doi && !entry.url && !entry.eprint) {
      issues.push({
        key: entry.key,
        sourceFile: entry.sourceFile,
        severity: "info",
        message: "Missing DOI, URL, or eprint",
      });
    }

    const year = parsedYear(entry);
    if (year && currentYear - year >= 8) {
      issues.push({
        key: entry.key,
        sourceFile: entry.sourceFile,
        severity: "info",
        message: `Older source from ${year}`,
      });
    }
  }

  return issues;
}

export function citationVenue(entry: CitationEntry): string {
  return venueFor(entry) ?? "No venue";
}

export function citationQualityScore(entry: CitationEntry): number {
  let score = 0;
  if (entry.title) score += 20;
  if (entry.author || entry.editor) score += 20;
  if (entry.year) score += 18;
  if (venueFor(entry)) score += 16;
  if (entry.doi || entry.url || entry.eprint) score += 16;
  if (entry.type && entry.type !== "unknown") score += 10;
  return score;
}

export function createBibtexStub(key: string): string {
  return [
    `@article{${key},`,
    "  title = {},",
    "  author = {},",
    "  year = {},",
    "  journal = {},",
    "  doi = {}",
    "}",
  ].join("\n");
}

export function analyzeCitationLibrary(
  files: CitationProjectFile[],
  currentYear = new Date().getFullYear(),
): CitationLibraryAnalysis {
  const bibFiles = files
    .filter((file) => file.path.endsWith(".bib"))
    .map((file) => file.path);
  const texFiles = files
    .filter((file) => file.path.endsWith(".tex"))
    .map((file) => file.path);
  const entries = files
    .filter((file) => file.path.endsWith(".bib"))
    .flatMap((file) => parseBibFile(file.content, file.path));
  const usages = files
    .filter((file) => file.path.endsWith(".tex"))
    .flatMap((file) => extractCitationUsages(file.content, file.path));

  const entryKeys = new Set(entries.map((entry) => entry.key));
  const citedKeySet = new Set(usages.map((usage) => usage.key));
  const citedKeys = [...citedKeySet].sort((a, b) => a.localeCompare(b));
  const usedKeys = entries
    .filter((entry) => citedKeySet.has(entry.key))
    .map((entry) => entry.key)
    .sort((a, b) => a.localeCompare(b));
  const unusedKeys = entries
    .filter((entry) => !citedKeySet.has(entry.key))
    .map((entry) => entry.key)
    .sort((a, b) => a.localeCompare(b));
  const missingKeys = citedKeys
    .filter((key) => !entryKeys.has(key))
    .sort((a, b) => a.localeCompare(b));
  const staleEntries = entries
    .filter((entry) => {
      const year = parsedYear(entry);
      return year !== null && currentYear - year >= 8;
    })
    .sort((a, b) => (parsedYear(a) ?? 0) - (parsedYear(b) ?? 0));

  return {
    entries,
    usages,
    bibFiles,
    texFiles,
    citedKeys,
    usedKeys,
    unusedKeys,
    missingKeys,
    duplicateGroups: findDuplicateGroups(entries),
    qualityIssues: findQualityIssues(entries, currentYear),
    staleEntries,
  };
}
