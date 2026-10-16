import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeLatexDiagnostic, rankLatexDiagnostics } from "./latexDiagnostics.js";
import { assertProjectPath } from "./projectPaths.js";
import type { CompileResult, Diagnostic } from "./types.js";

type CompileLatexRequest = {
  projectPath: string;
  rootFile: string;
  engine: "pdflatex" | "xelatex" | "lualatex";
};

type CompileAsymptoteRequest = {
  projectPath: string;
  relativePath: string;
};

interface CompileRunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  killGraceMs?: number;
  executable?: string;
  /**
   * Optional callback invoked with an integer 0..100 estimate of how far the
   * active compile has progressed. It is monotonic within a single compile and
   * always ends at 100 when the toolchain reports that all targets are
   * up-to-date.
   */
  onProgress?: (progress: number) => void;
}

type CompileStopReason = "canceled" | "timeout";

const defaultCompileTimeoutMs = 60_000;
const defaultKillGraceMs = 2_500;

const executableCandidates =
  process.platform === "darwin"
    ? ["/Library/TeX/texbin/latexmk", "/usr/local/bin/latexmk", "latexmk"]
    : ["latexmk"];

const asymptoteExecutableCandidates =
  process.platform === "darwin"
    ? ["/Library/TeX/texbin/asy", "/usr/local/bin/asy", "asy"]
    : ["asy"];
const missingLatexToolchainCode = "missing-latex-toolchain";
const missingAsymptoteToolchainCode = "missing-asymptote-toolchain";

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function windowsExecutableExtensions(command: string): string[] {
  if (process.platform !== "win32" || path.extname(command)) {
    return [""];
  }

  const extensions = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean);
  return extensions.length ? extensions : [""];
}

async function resolveCommandOnPath(command: string): Promise<string | null> {
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const directory of pathEntries) {
    for (const extension of windowsExecutableExtensions(command)) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export async function resolveExecutable(
  candidates: readonly string[],
): Promise<string | null> {
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) || hasPathSeparator(candidate)) {
      if (await isExecutable(candidate)) {
        return candidate;
      }
      continue;
    }

    const resolved = await resolveCommandOnPath(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

// LatexDo can install its own TeX distribution when the computer has none.
// The locator is injected so this module stays free of Electron imports.
let bundledTexBinLocator: () => Promise<string | null> = async () => null;

export function setBundledTexBinLocator(locator: () => Promise<string | null>): void {
  bundledTexBinLocator = locator;
}

async function findBundledExecutable(command: string): Promise<string | null> {
  const directory = await bundledTexBinLocator();
  if (!directory) return null;
  for (const extension of windowsExecutableExtensions(command)) {
    const candidate = path.join(directory, `${command}${extension}`);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

/** A system TeX install wins; the LatexDo-installed one is the fallback. */
export async function findTexExecutable(
  command: string,
  systemCandidates: readonly string[] = [command],
): Promise<string | null> {
  return (
    (await resolveExecutable(systemCandidates)) ??
    (await findBundledExecutable(command))
  );
}

/** PATH for TeX tools: the executable's own directory first, so latexmk finds its engines. */
export function texToolPath(executable: string): string {
  const entries = [process.env.PATH ?? ""];
  if (process.platform === "darwin") entries.unshift("/Library/TeX/texbin");
  if (path.isAbsolute(executable)) entries.unshift(path.dirname(executable));
  return entries.filter(Boolean).join(path.delimiter);
}

export async function findLatexmk(): Promise<string | null> {
  return findTexExecutable("latexmk", executableCandidates);
}

async function findAsymptote(): Promise<string | null> {
  return findTexExecutable("asy", asymptoteExecutableCandidates);
}

function missingLatexToolchainDiagnostic(rootFile: string): Diagnostic {
  return {
    file: rootFile,
    line: 1,
    column: 1,
    severity: "error",
    message: "PDF builder is not installed on this computer.",
    title: "Set up PDF building",
    detail:
      "Your document may be fine. LatexDo needs a TeX distribution installed before it can turn .tex files into PDFs.",
    suggestion:
      "Install MacTeX on macOS, MiKTeX or TeX Live on Windows, or TeX Live with latexmk on Linux. Then restart LatexDo and press Compile again.",
    source: "latex",
    code: missingLatexToolchainCode,
    locationAccuracy: "inferred",
    isPrimary: true,
    priority: 100,
  };
}

function missingAsymptoteToolchainDiagnostic(relativePath: string): Diagnostic {
  return {
    file: relativePath,
    line: 1,
    column: 1,
    severity: "error",
    message: "Asymptote is not installed on this computer.",
    title: "Set up Asymptote drawing builds",
    detail:
      "LatexDo can edit .asy files now, but this computer needs the Asymptote compiler before it can render them to PDF.",
    suggestion:
      "Install Asymptote from TeX Live, MacTeX, or MiKTeX. Then restart LatexDo and compile again.",
    source: "latex",
    code: missingAsymptoteToolchainCode,
    locationAccuracy: "inferred",
    isPrimary: true,
    priority: 100,
  };
}

function cleanLatexMessage(message: string): string {
  return message
    .replace(/^!+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDiagnosticFile(projectPath: string, filePath: string): string {
  const absoluteFile = path.isAbsolute(filePath)
    ? filePath
    : path.join(projectPath, filePath);
  return path.relative(projectPath, absoluteFile);
}

function sanitizeCompileOutput(output: string): string {
  const lines = output.split(/\r?\n/).map((line) => line.trimEnd());

  const staleLatexmkFailure =
    lines.some((line) =>
      line.includes("gave an error in previous invocation of latexmk"),
    ) && lines.some((line) => line.includes("Nothing to do for"));

  if (!staleLatexmkFailure) {
    return output.trim();
  }

  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return false;
    }
    if (trimmed.startsWith("Rc files read:")) {
      return false;
    }
    if (trimmed === "NONE") {
      return false;
    }
    if (trimmed.startsWith("Latexmk: This is Latexmk")) {
      return false;
    }
    if (trimmed.startsWith("Latexmk: Nothing to do for")) {
      return false;
    }
    if (trimmed.startsWith("Latexmk: All targets")) {
      return false;
    }
    if (trimmed.startsWith("Collected error summary")) {
      return false;
    }
    if (trimmed.includes("gave an error in previous invocation of latexmk")) {
      return false;
    }
    if (trimmed.startsWith("Latexmk: Sometimes, the -f option")) {
      return false;
    }
    if (trimmed.startsWith("to try to force complete processing.")) {
      return false;
    }
    if (trimmed.startsWith("But normally, you will need to correct")) {
      return false;
    }
    if (trimmed.startsWith("error, and then rerun latexmk.")) {
      return false;
    }
    if (trimmed.startsWith("In some cases, it is best to clean out")) {
      return false;
    }
    if (trimmed.startsWith("latexmk after you've corrected the files.")) {
      return false;
    }
    return true;
  });

  return (
    filtered.join("\n").trim() ||
    "LatexDo forced a fresh compile because latexmk was stuck on a previous failed run."
  );
}

function compileStoppedMessage(reason: CompileStopReason, timeoutMs: number): string {
  if (reason === "timeout") {
    const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    return `LaTeX compile timed out after ${seconds} second${
      seconds === 1 ? "" : "s"
    }.`;
  }
  return "LaTeX compile canceled.";
}

function killChildProcess(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
): void {
  if (!child.pid) {
    return;
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to killing the direct child if process-group kill fails.
    }
  }

  try {
    child.kill(signal);
  } catch {
    // The process may already have exited.
  }
}

async function enrichDiagnostics(
  diagnostics: Diagnostic[],
  output: string,
  projectPath: string,
): Promise<Diagnostic[]> {
  const fileCache = new Map<string, string>();

  const enriched = await Promise.all(
    diagnostics.map(async (diagnostic) => {
      let content: string | undefined;
      if (diagnostic.file) {
        const relativePath = normalizeDiagnosticFile(projectPath, diagnostic.file);
        content = fileCache.get(relativePath);
        if (content === undefined) {
          try {
            content = await readFile(path.join(projectPath, relativePath), "utf8");
          } catch {
            content = "";
          }
          fileCache.set(relativePath, content);
        }
      }

      const analysis = analyzeLatexDiagnostic(diagnostic, content, output);
      return {
        ...diagnostic,
        ...analysis,
      };
    }),
  );
  return rankLatexDiagnostics(enriched);
}

function warningLineRange(message: string): {
  line: number;
  endLine?: number;
} {
  const inputLineMatch = message.match(/\bon input line\s+(\d+)/i);
  if (inputLineMatch) {
    return { line: Number(inputLineMatch[1]) };
  }

  const lineRangeMatch = message.match(/\bat lines?\s+(\d+)(?:--(\d+))?/i);
  if (lineRangeMatch) {
    return {
      line: Number(lineRangeMatch[1]),
      endLine: lineRangeMatch[2] ? Number(lineRangeMatch[2]) : undefined,
    };
  }

  return { line: 1 };
}

function cleanWarningMessage(message: string): string {
  return message
    .replace(/^\([^)]+\)\s*/gm, "")
    .replace(/\s+/g, " ")
    .replace(/\s*\.$/, "")
    .trim();
}

function warningContinuationText(line: string): string | null {
  const packageContinuation = line.match(/^\([^)]+\)\s*(.*)$/);
  if (packageContinuation) {
    return packageContinuation[1].trim();
  }

  if (/^\s{2,}\S/.test(line)) {
    return line.trim();
  }

  return null;
}

function relatedProblemStartIndex(lines: string[], errorIndex: number): number {
  for (let index = errorIndex - 1; index >= Math.max(0, errorIndex - 4); index -= 1) {
    const trimmed = lines[index].trim();
    if (/^Runaway argument\??/i.test(trimmed)) {
      return index;
    }
    if (trimmed && /^!\s*/.test(trimmed)) {
      break;
    }
  }

  return errorIndex;
}

function compilerExcerpt(lines: string[], startIndex: number, maxLines = 10): string {
  const excerpt: string[] = [];
  const end = Math.min(lines.length, startIndex + maxLines);
  const startsWithRunawayArgument = /^Runaway argument\??/i.test(
    lines[startIndex]?.trim() ?? "",
  );
  let includedBangLine = /^!\s*/.test(lines[startIndex]?.trim() ?? "");

  for (let index = startIndex; index < end; index += 1) {
    const line = lines[index].trimEnd();
    if (!line.trim() && !excerpt.length) {
      continue;
    }
    if (index > startIndex && /^!\s*/.test(line)) {
      if (includedBangLine || !startsWithRunawayArgument) {
        break;
      }
      includedBangLine = true;
    }

    excerpt.push(line);

    if (/^\?\s*$/.test(line.trim())) {
      break;
    }
  }

  return excerpt.join("\n").trim();
}

function contextualErrorMessage(
  lines: string[],
  errorIndex: number,
  errorText: string,
): string {
  const message = cleanLatexMessage(errorText);
  const startIndex = relatedProblemStartIndex(lines, errorIndex);
  if (startIndex === errorIndex) {
    return message;
  }

  return `${cleanLatexMessage(lines[startIndex])} ${message}`.trim();
}

function lineLocationAfter(
  lines: string[],
  startIndex: number,
): { line: number } | null {
  for (
    let index = startIndex + 1;
    index < Math.min(lines.length, startIndex + 12);
    index += 1
  ) {
    const lineMatch = lines[index].match(/^l\.(\d+)\s*(.*)$/);
    if (lineMatch) {
      return {
        line: Number(lineMatch[1]),
      };
    }
  }

  return null;
}

function fallbackProblemBlock(
  lines: string[],
): { line: number; message: string; excerpt: string } | null {
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      continue;
    }

    const bangMatch = trimmed.match(/^!\s*(.+)$/);
    const explicitErrorMatch = trimmed.match(
      /^(?:(?:LaTeX|Package\s+[^:]+|Class\s+[^:]+)\s+Error:\s*.+|Emergency stop\.|Fatal error occurred.*)$/i,
    );
    const isRunawayArgument = /^Runaway argument\??/i.test(trimmed);

    if (!bangMatch && !explicitErrorMatch && !isRunawayArgument) {
      continue;
    }

    const startIndex = isRunawayArgument
      ? index
      : relatedProblemStartIndex(lines, index);
    const location = lineLocationAfter(lines, startIndex);
    return {
      line: location?.line ?? 1,
      message: isRunawayArgument
        ? cleanLatexMessage(trimmed)
        : bangMatch
          ? contextualErrorMessage(lines, index, bangMatch[1])
          : cleanLatexMessage(trimmed),
      excerpt: compilerExcerpt(lines, startIndex),
    };
  }

  return null;
}

export function parseDiagnostics(
  output: string,
  projectPath: string,
  rootFile: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const fileLinePattern = /^(.*?\.(?:tex|sty|cls|bib)):(\d+):(?:(\d+):)?\s*(.*)$/gm;
  const warningStartPattern =
    /^(?:LaTeX|Package\s+[^:]+|Class\s+[^:]+)\s+Warning:\s*(.*)$/;
  const boxWarningPattern =
    /^(?:(?:Over|Under)full \\[hv]box\b.*?)(?:\bat lines?\s+\d+(?:--\d+)?)?.*$/;

  const addDiagnostic = (diagnostic: Diagnostic) => {
    const key = `${diagnostic.file}:${diagnostic.line}:${diagnostic.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      diagnostics.push(diagnostic);
    }
  };

  for (const match of output.matchAll(fileLinePattern)) {
    const message = cleanLatexMessage(match[4]);
    const severity = /warning/i.test(message) ? "warning" : "error";
    const file = normalizeDiagnosticFile(projectPath, match[1]);
    addDiagnostic({
      file,
      line: Number(match[2]),
      column: Number(match[3] ?? 1),
      severity,
      message,
      compilerExcerpt: match[0].trim(),
      source: "latex",
    });
  }

  const outputLines = output.split(/\r?\n/);
  for (let index = 0; index < outputLines.length; index += 1) {
    const warningMatch = outputLines[index].match(warningStartPattern);
    if (warningMatch) {
      const warningParts = [warningMatch[1]];
      for (
        let continuationIndex = index + 1;
        continuationIndex < Math.min(outputLines.length, index + 8);
        continuationIndex += 1
      ) {
        const continuationLine = outputLines[continuationIndex];
        fileLinePattern.lastIndex = 0;
        if (
          warningStartPattern.test(continuationLine) ||
          fileLinePattern.test(continuationLine) ||
          /^!\s*/.test(continuationLine)
        ) {
          break;
        }

        const continuation = warningContinuationText(continuationLine);
        if (!continuation) {
          break;
        }
        warningParts.push(continuation);
      }

      const message = cleanWarningMessage(warningParts.join(" "));
      const { line, endLine } = warningLineRange(message);
      addDiagnostic({
        file: normalizeDiagnosticFile(projectPath, rootFile),
        line,
        endLine,
        column: 1,
        severity: "warning",
        message,
        compilerExcerpt: warningParts.join("\n").trim(),
        source: "latex",
      });
      continue;
    }

    const boxWarningMatch = outputLines[index].match(boxWarningPattern);
    if (boxWarningMatch) {
      const message = cleanWarningMessage(boxWarningMatch[0]);
      const { line, endLine } = warningLineRange(message);
      addDiagnostic({
        file: normalizeDiagnosticFile(projectPath, rootFile),
        line,
        endLine,
        column: 1,
        severity: "warning",
        message,
        compilerExcerpt: message,
        source: "latex",
      });
    }
  }

  for (let index = 0; index < outputLines.length; index += 1) {
    const errorMatch = outputLines[index].match(/^!\s*(.+)$/);
    if (!errorMatch) {
      continue;
    }

    const startIndex = relatedProblemStartIndex(outputLines, index);
    const excerpt = compilerExcerpt(outputLines, startIndex);
    const message = contextualErrorMessage(outputLines, index, errorMatch[1]);

    for (
      let contextIndex = index + 1;
      contextIndex < Math.min(outputLines.length, index + 8);
      contextIndex += 1
    ) {
      const lineMatch = outputLines[contextIndex].match(/^l\.(\d+)\s*(.*)$/);
      if (!lineMatch) {
        continue;
      }

      addDiagnostic({
        file: normalizeDiagnosticFile(projectPath, rootFile),
        line: Number(lineMatch[1]),
        column: 1,
        severity: "error",
        message,
        compilerExcerpt: excerpt,
        source: "latex",
      });
      break;
    }
  }

  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    const fallback = fallbackProblemBlock(outputLines);
    if (fallback) {
      addDiagnostic({
        file: normalizeDiagnosticFile(projectPath, rootFile),
        line: fallback.line,
        column: 1,
        severity: "error",
        message: fallback.message,
        detail:
          "LaTeX did not report a precise source line for this failure, so LatexDo is showing the first explicit compiler problem.",
        compilerExcerpt: fallback.excerpt,
        source: "latex",
        locationAccuracy: "inferred",
        locationConfidence: 20,
      });
    }
  }

  return diagnostics.slice(0, 100);
}

export interface CloudCompileFile {
  relativePath: string;
  content: string;
}

export const maxCloudCompileFiles = 2000;
export const maxCloudCompileFileBytes = 8 * 1024 * 1024;
export const maxCloudCompileTotalBytes = 64 * 1024 * 1024;

const preservedScratchEntries = new Set([".latexdo"]);

function safeCloudRelativePath(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.length > 1024 ||
    path.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(normalized) ||
    [...normalized].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error(`Unsafe project path: ${relativePath}`);
  }

  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        !segment || segment === "." || segment === ".." || segment.endsWith(":"),
    )
  ) {
    throw new Error(`Unsafe project path: ${relativePath}`);
  }

  return segments.join("/");
}

/**
 * Mirrors a cloud collaboration project into a local scratch folder so the
 * desktop TeX toolchain can compile it. Existing scratch content is replaced
 * (except cached build artifacts under .latexdo) so deletions in the shared
 * project do not leave stale inputs behind.
 */
export async function materializeCloudCompileFiles(
  projectRoot: string,
  files: CloudCompileFile[],
): Promise<void> {
  if (files.length > maxCloudCompileFiles) {
    throw new Error(
      `Shared project has too many files to compile locally (limit ${maxCloudCompileFiles}).`,
    );
  }

  let totalBytes = 0;
  const validated = files.map((file) => {
    const relativePath = safeCloudRelativePath(file.relativePath);
    const content = String(file.content ?? "");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > maxCloudCompileFileBytes) {
      throw new Error(`${relativePath} is too large to compile locally.`);
    }
    totalBytes += bytes;
    return { relativePath, content };
  });
  if (totalBytes > maxCloudCompileTotalBytes) {
    throw new Error("Shared project is too large to compile locally.");
  }

  await mkdir(projectRoot, { recursive: true });
  const existingEntries = await readdir(projectRoot);
  await Promise.all(
    existingEntries
      .filter((entry) => !preservedScratchEntries.has(entry))
      .map((entry) =>
        rm(path.join(projectRoot, entry), { recursive: true, force: true }),
      ),
  );

  for (const file of validated) {
    const targetPath = path.join(projectRoot, file.relativePath);
    const relative = path.relative(projectRoot, targetPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Unsafe project path: ${file.relativePath}`);
    }
    await assertProjectPath(projectRoot, targetPath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.content, "utf8");
  }
}

/**
 * Progress windows for each pdflatex/lualatex/xelatex pass. latexmk re-runs
 * the engine until cross-references settle, so we hand each pass a slice of
 * the overall bar and widen the margin for extra passes instead of assuming a
 * fixed number of runs up front.
 */
const enginePassWindows: ReadonlyArray<readonly [start: number, end: number]> = [
  [10, 26],
  [26, 42],
  [42, 56],
  [56, 68],
  [68, 78],
  [78, 86],
  [86, 92],
];

/** Page markers (`[1`, `[2{...}`, ...) only count at the start of a line. */
const pageMarkerPattern = /(?:^|\n)[ \t]*\[(\d+)/g;
const outputWrittenPattern = /Output written on\s+.+\(\d+\s+pages?(?:,|\))/;

const engineRunPattern =
  /Latexmk:\s*Run number\s+(\d+)\s+of\s+rule\s+'((?:pdf|xe|lua)latex)'/g;
const engineApplyPattern = /Latexmk:\s*applying rule\s+'((?:pdf|xe|lua)latex)'/g;

/** Bibliography / index work (bibtex, biber, makeindex, ...) gets a bump. */
const auxRulePattern =
  /Latexmk:\s*Run number\s+\d+\s+of\s+rule\s+'(?:bibtex|biber|makeindex|makeit|mkidx|bib2gls|splitindex|texindy|upmendex)'/;

const engineActivityPattern =
  /Latexmk:\s*(?:applying rule|Run number)|entering extended mode|This is (?:pdfTeX|LuaHBTeX|XeTeX)/;

/**
 * Pages inside a single engine pass needed to interpolate across the full
 * window. Most LatexDo documents are short papers, so fill this slice quickly
 * and rely on pass completion to snap to the end of the slice.
 */
const pagesToFillPass = 12;

function lastEngineRun(output: string): { pass: number; at: number } | null {
  const matches = [...output.matchAll(engineRunPattern)];
  const last = matches[matches.length - 1];
  if (!last) {
    return null;
  }
  const pushedAt = output.lastIndexOf(last[0]) + last[0].length;
  return { pass: Number(last[1]), at: pushedAt };
}

function lastEngineApply(output: string): { pass: number; at: number } | null {
  const matches = [...output.matchAll(engineApplyPattern)];
  const last = matches[matches.length - 1];
  if (!last) {
    return null;
  }
  const pushedAt = output.lastIndexOf(last[0]) + last[0].length;
  return { pass: matches.length, at: pushedAt };
}

function lastEngineInvocation(output: string): { pass: number; at: number } | null {
  const run = lastEngineRun(output);
  const apply = lastEngineApply(output);
  if (!run) {
    return apply;
  }
  if (!apply) {
    return run;
  }
  if (apply.at > run.at && apply.pass > run.pass) {
    return apply;
  }
  return run;
}

function interpolatePass(output: string, fallbackPass: number): number | null {
  const invocation = lastEngineInvocation(output) ?? null;
  const pass = invocation?.pass ?? fallbackPass;
  if (!pass) {
    return null;
  }

  const passSegment = invocation === null ? output : output.slice(invocation.at);
  let maxPage = 0;
  for (const match of passSegment.matchAll(pageMarkerPattern)) {
    maxPage = Math.max(maxPage, Number(match[1]));
  }

  const [windowStart, windowEnd] =
    enginePassWindows[Math.min(pass, enginePassWindows.length) - 1];
  if (outputWrittenPattern.test(passSegment)) {
    return windowEnd;
  }
  if (maxPage <= 0) {
    return windowStart;
  }
  const within = Math.min(1, maxPage / pagesToFillPass);
  return Math.round(windowStart + within * (windowEnd - windowStart));
}

/**
 * Estimates how far a latexmk invocation has progressed as an integer 0..100.
 *
 * The estimate is a pure function of the accumulated toolchain output:
 *   - startup/format milestones walk the bar to ~10%,
 *   - each numbered engine pass owns a window that fills as pages are set,
 *   - bibliography/index rules add a mid-bar bump,
 *   - "All targets are up-to-date" pins the bar at 100%.
 * Callers that stream output should clamp to the highest value seen so the
 * reported percentage never goes backwards.
 */
export function estimateCompileProgress(output: string): number {
  if (/All targets are up-to-date/.test(output)) {
    return 100;
  }
  if (
    /Latexmk:\s*(?:Errors?|Failure)\s*,\s*so I did not complete making targets/.test(
      output,
    )
  ) {
    return 92;
  }

  let progress = 0;
  if (/Latexmk:\s*This is Latexmk/.test(output)) {
    progress = 4;
  }
  if (/Latexmk:\s*(?:applying|Run number)/.test(output)) {
    progress = 6;
  }
  if (/entering extended mode/.test(output)) {
    progress = 8;
  }
  if (/^(?:LaTeX2e\s*<|LuaTeX\s+\d)/m.test(output)) {
    progress = 10;
  }

  if (engineActivityPattern.test(output)) {
    const passProgress = interpolatePass(output, 1);
    progress = Math.max(progress, passProgress ?? 0);
  }

  const enginePass = lastEngineInvocation(output)?.pass ?? 1;
  if (auxRulePattern.test(output)) {
    const auxWindow: Record<number, number> = { 1: 46, 2: 60, 3: 70, 4: 74 };
    progress = Math.max(progress, auxWindow[enginePass] ?? 74);
  }

  return Math.min(100, Math.max(0, Math.round(progress)));
}

function createProgressEmitter(
  onProgress?: (progress: number) => void,
): (progress: number) => void {
  if (!onProgress) {
    return () => {};
  }

  let lastSent = -1;
  let lastSentAt = 0;
  const minimumIntervalMs = 100;

  return (progress: number) => {
    const now = Date.now();
    if (progress === lastSent && now - lastSentAt < minimumIntervalMs) {
      return;
    }
    if (now - lastSentAt < minimumIntervalMs && progress !== 100) {
      return;
    }
    lastSent = progress;
    lastSentAt = now;
    onProgress(progress);
  };
}

export async function compileLatex(
  request: CompileLatexRequest,
  options: CompileRunOptions = {},
): Promise<CompileResult> {
  const startedAt = performance.now();
  const inputPath = path.resolve(request.projectPath, request.rootFile);
  await assertProjectPath(request.projectPath, inputPath);
  const latexmk = options.executable ?? (await findLatexmk());

  if (!latexmk) {
    return {
      ok: false,
      durationMs: 0,
      output:
        "LatexDo could not find latexmk, the small program that runs LaTeX builds. Install a full TeX distribution, restart LatexDo, and press Compile again.",
      diagnostics: [missingLatexToolchainDiagnostic(request.rootFile)],
      error: "latexmk was not found. Install a LaTeX distribution and restart LatexDo.",
    };
  }

  const buildDirectory = path.join(
    request.projectPath,
    ".latexdo",
    "build",
    `job-${randomUUID()}`,
  );
  await assertProjectPath(request.projectPath, buildDirectory);
  await mkdir(buildDirectory, { recursive: true });

  const engineFlag = {
    pdflatex: "-pdf",
    xelatex: "-xelatex",
    lualatex: "-lualatex",
  }[request.engine];

  const args = [
    engineFlag,
    "-g",
    "-synctex=1",
    "-interaction=nonstopmode",
    "-file-line-error",
    "-halt-on-error",
    `-outdir=${buildDirectory}`,
    inputPath,
  ];

  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve({
        ok: false,
        durationMs: Math.round(performance.now() - startedAt),
        output: "",
        diagnostics: [],
        error: compileStoppedMessage(
          "canceled",
          options.timeoutMs ?? defaultCompileTimeoutMs,
        ),
      });
      return;
    }

    const timeoutMs = options.timeoutMs ?? defaultCompileTimeoutMs;
    const killGraceMs = options.killGraceMs ?? defaultKillGraceMs;
    let stopReason: CompileStopReason | null = null;
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | null = null;

    const child = spawn(latexmk, args, {
      cwd: request.projectPath,
      env: {
        ...process.env,
        PATH: texToolPath(latexmk),
      },
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    let output = "";
    const emitProgress = createProgressEmitter(options.onProgress);
    const timeout = setTimeout(() => {
      stopReason = "timeout";
      killChildProcess(child, "SIGTERM");
      forceKillTimer = setTimeout(() => {
        killChildProcess(child, "SIGKILL");
      }, killGraceMs);
      forceKillTimer.unref?.();
    }, timeoutMs);
    timeout.unref?.();
    const abortHandler = () => {
      stopReason = "canceled";
      clearTimeout(timeout);
      killChildProcess(child, "SIGTERM");
      forceKillTimer = setTimeout(() => {
        killChildProcess(child, "SIGKILL");
      }, killGraceMs);
      forceKillTimer.unref?.();
    };
    options.signal?.addEventListener("abort", abortHandler, { once: true });

    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      options.signal?.removeEventListener("abort", abortHandler);
    };

    const finish = (code: number | null, spawnError?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const cleanedOutput = sanitizeCompileOutput(output);
      void enrichDiagnostics(
        parseDiagnostics(cleanedOutput, request.projectPath, request.rootFile),
        cleanedOutput,
        request.projectPath,
      ).then((diagnostics) => {
        const stoppedMessage = stopReason
          ? compileStoppedMessage(stopReason, timeoutMs)
          : null;
        resolve({
          ok: false,
          pdfPath: undefined,
          durationMs: Math.round(performance.now() - startedAt),
          output: cleanedOutput,
          diagnostics,
          error:
            stoppedMessage ??
            spawnError?.message ??
            `LaTeX exited with code ${code ?? "unknown"}.`,
        });
      });
    };

    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
      emitProgress(estimateCompileProgress(output));
    });
    child.stderr.on("data", (data: Buffer) => {
      output += data.toString();
      emitProgress(estimateCompileProgress(output));
    });
    child.on("error", (error) => {
      finish(null, error);
    });
    child.on("close", (code) => {
      if (stopReason || code !== 0) {
        finish(code);
        return;
      }
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      emitProgress(100);
      const pdfName = `${path.basename(request.rootFile, path.extname(request.rootFile))}.pdf`;
      const pdfPath = path.join(buildDirectory, pdfName);
      const cleanedOutput = sanitizeCompileOutput(output);
      void enrichDiagnostics(
        parseDiagnostics(cleanedOutput, request.projectPath, request.rootFile),
        cleanedOutput,
        request.projectPath,
      ).then((diagnostics) => {
        resolve({
          ok: true,
          pdfPath,
          durationMs: Math.round(performance.now() - startedAt),
          output: cleanedOutput,
          diagnostics,
          error: undefined,
        });
      });
    });
  });
}

function parseAsymptoteDiagnostics(output: string, relativePath: string): Diagnostic[] {
  if (!output.trim()) {
    return [];
  }

  const lineMatch =
    output.match(/(?:line|:)\s*(\d+)(?:[.:,]\s*(\d+))?/i) ??
    output.match(
      new RegExp(
        `${relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+)(?::(\\d+))?`,
      ),
    );
  const line = lineMatch ? Math.max(1, Number(lineMatch[1])) : 1;
  const column = lineMatch?.[2] ? Math.max(1, Number(lineMatch[2])) : 1;
  const firstLine = output
    .split(/\r?\n/)
    .map((lineText) => lineText.trim())
    .find(Boolean);

  return [
    {
      file: relativePath,
      line,
      column,
      severity: "error",
      message: firstLine ?? "Asymptote compilation failed.",
      detail: output.trim().slice(0, 1200),
      source: "latex",
      locationAccuracy: lineMatch ? "line" : "inferred",
    },
  ];
}

export async function compileAsymptote(
  request: CompileAsymptoteRequest,
  options: CompileRunOptions = {},
): Promise<CompileResult> {
  const startedAt = performance.now();
  const inputPath = path.resolve(request.projectPath, request.relativePath);
  await assertProjectPath(request.projectPath, inputPath);
  const asymptote = options.executable ?? (await findAsymptote());

  if (!asymptote) {
    return {
      ok: false,
      durationMs: 0,
      output:
        "LatexDo could not find Asymptote, the program that renders .asy drawings. Install Asymptote, restart LatexDo, and compile again.",
      diagnostics: [missingAsymptoteToolchainDiagnostic(request.relativePath)],
      error:
        "Asymptote was not found. Install Asymptote from TeX Live, MacTeX, or MiKTeX and restart LatexDo.",
    };
  }

  const buildDirectory = path.join(
    request.projectPath,
    ".latexdo",
    "build",
    `asy-${randomUUID()}`,
  );
  await assertProjectPath(request.projectPath, buildDirectory);
  await mkdir(buildDirectory, { recursive: true });

  const outputBase = path.join(
    buildDirectory,
    path.basename(request.relativePath, path.extname(request.relativePath)),
  );
  const outputPdf = `${outputBase}.pdf`;
  const args = ["-f", "pdf", "-o", outputBase, inputPath];

  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve({
        ok: false,
        durationMs: Math.round(performance.now() - startedAt),
        output: "",
        diagnostics: [],
        error: compileStoppedMessage(
          "canceled",
          options.timeoutMs ?? defaultCompileTimeoutMs,
        ),
      });
      return;
    }

    const timeoutMs = options.timeoutMs ?? defaultCompileTimeoutMs;
    const killGraceMs = options.killGraceMs ?? defaultKillGraceMs;
    let stopReason: CompileStopReason | null = null;
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | null = null;

    const child = spawn(asymptote, args, {
      cwd: request.projectPath,
      env: {
        ...process.env,
        PATH: texToolPath(asymptote),
      },
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    let output = "";
    const timeout = setTimeout(() => {
      stopReason = "timeout";
      killChildProcess(child, "SIGTERM");
      forceKillTimer = setTimeout(() => {
        killChildProcess(child, "SIGKILL");
      }, killGraceMs);
      forceKillTimer.unref?.();
    }, timeoutMs);
    timeout.unref?.();
    const abortHandler = () => {
      stopReason = "canceled";
      clearTimeout(timeout);
      killChildProcess(child, "SIGTERM");
      forceKillTimer = setTimeout(() => {
        killChildProcess(child, "SIGKILL");
      }, killGraceMs);
      forceKillTimer.unref?.();
    };
    options.signal?.addEventListener("abort", abortHandler, { once: true });

    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      options.signal?.removeEventListener("abort", abortHandler);
    };

    const finish = (code: number | null, spawnError?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const cleanedOutput = sanitizeCompileOutput(output);
      const stoppedMessage = stopReason
        ? compileStoppedMessage(stopReason, timeoutMs)
        : null;
      resolve({
        ok: false,
        durationMs: Math.round(performance.now() - startedAt),
        output: cleanedOutput,
        diagnostics: parseAsymptoteDiagnostics(
          cleanedOutput || spawnError?.message || "",
          request.relativePath,
        ),
        error:
          stoppedMessage ??
          spawnError?.message ??
          `Asymptote exited with code ${code ?? "unknown"}.`,
      });
    };

    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.on("error", (error) => {
      finish(null, error);
    });
    child.on("close", (code) => {
      if (stopReason || code !== 0) {
        finish(code);
        return;
      }
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const cleanedOutput = sanitizeCompileOutput(output);
      resolve({
        ok: true,
        pdfPath: outputPdf,
        durationMs: Math.round(performance.now() - startedAt),
        output: cleanedOutput,
        diagnostics: [],
        error: undefined,
      });
    });
  });
}
