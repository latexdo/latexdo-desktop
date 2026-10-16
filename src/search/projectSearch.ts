export interface ProjectSearchFile {
  path: string;
  content: string;
}

export interface ProjectSearchOptions {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  include: string;
  exclude: string;
  contextLines: number;
  maxResults: number;
}

export interface ProjectSearchMatch {
  id: string;
  path: string;
  line: number;
  column: number;
  endColumn: number;
  lineText: string;
  matchText: string;
  before: string[];
  after: string[];
}

export interface ProjectSearchFileResult {
  path: string;
  matches: ProjectSearchMatch[];
}

export interface ProjectSearchResult {
  query: string;
  files: ProjectSearchFileResult[];
  totalMatches: number;
  searchedFiles: number;
  skippedFiles: number;
  truncated: boolean;
  error?: string;
}

const defaultIgnoredPathParts = new Set([
  ".git",
  ".latexdo",
  "node_modules",
  "dist",
  "dist-electron",
  "build",
  "coverage",
  "release",
]);

const defaultSearchableExtensions = new Set([
  "tex",
  "bib",
  "sty",
  "cls",
  "asy",
  "txt",
  "md",
  "json",
  "csv",
  "yaml",
  "yml",
  "xml",
  "html",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "r",
  "jl",
  "m",
  "sh",
  "log",
  "out",
]);

export const defaultProjectSearchOptions: ProjectSearchOptions = {
  query: "",
  matchCase: false,
  wholeWord: false,
  useRegex: false,
  include: "",
  exclude: "",
  contextLines: 1,
  maxResults: 500,
};

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\/+/, "");
}

function fileName(filePath: string): string {
  return normalizePath(filePath).split("/").pop() ?? filePath;
}

function fileExtension(filePath: string): string {
  const name = fileName(filePath);
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 ? name.slice(dotIndex + 1).toLowerCase() : "";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenizePatterns(value: string): string[] {
  return value
    .split(/[,\n]/)
    .flatMap((part) => part.split(/\s+/))
    .map((part) => part.trim())
    .filter(Boolean);
}

function globToRegex(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  let source = "";

  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index];
    const next = normalized[index + 1];
    const afterNext = normalized[index + 2];
    if (char === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*/)?";
      index += 2;
    } else if (char === "*" && next === "*") {
      source += ".*";
      index++;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(char);
    }
  }

  return new RegExp(`(^|/)${source}$`, "i");
}

function patternMatches(filePath: string, pattern: string): boolean {
  const normalizedPath = normalizePath(filePath).toLowerCase();
  const normalizedPattern = normalizePath(pattern).toLowerCase();
  const name = fileName(normalizedPath);

  if (normalizedPattern.startsWith(".")) {
    return normalizedPath.endsWith(normalizedPattern);
  }

  if (!/[/*?]/.test(normalizedPattern)) {
    return (
      name.includes(normalizedPattern) ||
      normalizedPath.endsWith(`.${normalizedPattern}`)
    );
  }

  return globToRegex(normalizedPattern).test(normalizedPath);
}

function isIgnoredPath(filePath: string): boolean {
  const parts = normalizePath(filePath).split("/");
  return parts.some((part) => defaultIgnoredPathParts.has(part));
}

export function isProjectSearchablePath(filePath: string): boolean {
  if (isIgnoredPath(filePath)) {
    return false;
  }
  return defaultSearchableExtensions.has(fileExtension(filePath));
}

function shouldSearchPath(
  filePath: string,
  includePatterns: string[],
  excludePatterns: string[],
): boolean {
  if (!isProjectSearchablePath(filePath)) {
    return false;
  }

  if (
    includePatterns.length &&
    !includePatterns.some((pattern) => patternMatches(filePath, pattern))
  ) {
    return false;
  }

  return !excludePatterns.some((pattern) => patternMatches(filePath, pattern));
}

function buildMatcher(options: ProjectSearchOptions): RegExp | string | null {
  const query = options.query;
  if (!query) {
    return null;
  }

  if (!options.useRegex) {
    return options.matchCase ? query : query.toLowerCase();
  }

  const source = options.wholeWord
    ? `(?<![A-Za-z0-9_])(?:${query})(?![A-Za-z0-9_])`
    : query;
  const flags = options.matchCase ? "g" : "gi";
  const matcher = new RegExp(source, flags);
  matcher.lastIndex = 0;
  if (matcher.test("")) {
    throw new Error("Regular expression must not match empty text.");
  }
  matcher.lastIndex = 0;
  return matcher;
}

function findLiteralMatches(
  line: string,
  matcher: string,
  options: ProjectSearchOptions,
): Array<{ index: number; text: string }> {
  const haystack = options.matchCase ? line : line.toLowerCase();
  const needle = matcher;
  const matches: Array<{ index: number; text: string }> = [];

  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const matchedText = line.slice(index, index + needle.length);
    const before = line[index - 1] ?? "";
    const after = line[index + needle.length] ?? "";
    const isWholeWordMatch =
      !options.wholeWord ||
      (!/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after));
    if (isWholeWordMatch) {
      matches.push({ index, text: matchedText });
    }
    index = haystack.indexOf(needle, index + Math.max(1, needle.length));
  }

  return matches;
}

function findRegexMatches(
  line: string,
  matcher: RegExp,
): Array<{ index: number; text: string }> {
  const matches: Array<{ index: number; text: string }> = [];
  let match: RegExpExecArray | null;
  matcher.lastIndex = 0;

  while ((match = matcher.exec(line)) !== null) {
    if (match[0].length === 0) {
      matcher.lastIndex++;
      continue;
    }
    matches.push({ index: match.index, text: match[0] });
  }

  return matches;
}

function contextLines(
  lines: string[],
  lineIndex: number,
  count: number,
): { before: string[]; after: string[] } {
  const safeCount = Math.max(0, Math.min(3, count));
  return {
    before: lines.slice(Math.max(0, lineIndex - safeCount), lineIndex),
    after: lines.slice(lineIndex + 1, lineIndex + 1 + safeCount),
  };
}

export function searchProjectFiles(
  files: ProjectSearchFile[],
  options: ProjectSearchOptions,
): ProjectSearchResult {
  const query = options.query;
  const emptyResult: ProjectSearchResult = {
    query,
    files: [],
    totalMatches: 0,
    searchedFiles: 0,
    skippedFiles: files.length,
    truncated: false,
  };

  if (!query) {
    return emptyResult;
  }

  let matcher: RegExp | string | null;
  try {
    matcher = buildMatcher(options);
  } catch (error) {
    return {
      ...emptyResult,
      error: error instanceof Error ? error.message : "Invalid search query.",
    };
  }

  if (matcher === null) {
    return emptyResult;
  }

  const includePatterns = tokenizePatterns(options.include);
  const excludePatterns = tokenizePatterns(options.exclude);
  const resultFiles: ProjectSearchFileResult[] = [];
  let totalMatches = 0;
  let searchedFiles = 0;
  let skippedFiles = 0;
  let truncated = false;
  const maxResults = Math.max(1, Math.min(5000, options.maxResults));

  for (const file of files) {
    const path = normalizePath(file.path);
    if (!shouldSearchPath(path, includePatterns, excludePatterns)) {
      skippedFiles++;
      continue;
    }

    searchedFiles++;
    const lines = file.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const fileMatches: ProjectSearchMatch[] = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const matches =
        typeof matcher === "string"
          ? findLiteralMatches(line, matcher, options)
          : findRegexMatches(line, matcher);

      for (const match of matches) {
        const { before, after } = contextLines(lines, lineIndex, options.contextLines);
        const line = lineIndex + 1;
        const column = match.index + 1;
        totalMatches++;
        fileMatches.push({
          id: `${path}:${line}:${column}:${totalMatches}`,
          path,
          line,
          column,
          endColumn: column + match.text.length,
          lineText: lines[lineIndex],
          matchText: match.text,
          before,
          after,
        });

        if (totalMatches >= maxResults) {
          truncated = true;
          break;
        }
      }

      if (truncated) {
        break;
      }
    }

    if (fileMatches.length) {
      resultFiles.push({ path, matches: fileMatches });
    }

    if (truncated) {
      break;
    }
  }

  return {
    query,
    files: resultFiles,
    totalMatches,
    searchedFiles,
    skippedFiles,
    truncated,
  };
}

export function formatProjectSearchResults(result: ProjectSearchResult): string {
  if (result.error) {
    return result.error;
  }

  return result.files
    .flatMap((file) =>
      file.matches.map(
        (match) =>
          `${match.path}:${match.line}:${match.column}: ${match.lineText.trim()}`,
      ),
    )
    .join("\n");
}
