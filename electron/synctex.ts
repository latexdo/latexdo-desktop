import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { findTexExecutable, texToolPath } from "./compiler.js";
import type { SyncTexPdfLocation, SyncTexSourceLocation } from "./types.js";

const executableCandidates =
  process.platform === "darwin"
    ? ["/Library/TeX/texbin/synctex", "/usr/local/bin/synctex", "synctex"]
    : ["synctex"];

async function findSynctex(): Promise<string | null> {
  for (const candidate of executableCandidates) {
    if (!path.isAbsolute(candidate)) {
      // Prefer the PDF builder LatexDo installed; otherwise let PATH decide.
      return (await findTexExecutable(candidate, [])) ?? candidate;
    }

    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known TeX installation path.
    }
  }

  return null;
}

async function runSynctex(
  args: string[],
  cwd: string,
): Promise<Record<string, string>[]> {
  const executable = await findSynctex();
  if (!executable) {
    throw new Error(
      "synctex was not found. Install MacTeX, TeX Live, or MiKTeX and restart LatexDo.",
    );
  }

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: {
        ...process.env,
        PATH: texToolPath(executable),
      },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || "SyncTeX could not find a match."));
      }
    });
  });

  const records: Record<string, string>[] = [];
  let record: Record<string, string> = {};

  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1 || line.startsWith("SyncTeX result")) {
      continue;
    }

    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === "Output" && record.Output) {
      records.push(record);
      record = {};
    }
    record[key] = value;
  }

  if (Object.keys(record).length) {
    records.push(record);
  }
  return records;
}

function numberField(
  record: Record<string, string>,
  key: string,
  fallback = 0,
): number {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : fallback;
}

export async function forwardSyncTex(
  projectPath: string,
  pdfPath: string,
  inputPath: string,
  line: number,
  column: number,
): Promise<SyncTexPdfLocation | null> {
  const records = await runSynctex(
    ["view", "-i", `${line}:${column}:${inputPath}`, "-o", pdfPath],
    projectPath,
  );
  const record = records[0];
  if (!record?.Page) {
    return null;
  }

  return {
    page: numberField(record, "Page"),
    x: numberField(record, "x"),
    y: numberField(record, "y"),
    h: numberField(record, "h"),
    v: numberField(record, "v"),
    width: numberField(record, "W"),
    height: numberField(record, "H"),
  };
}

export async function backwardSyncTex(
  projectPath: string,
  pdfPath: string,
  page: number,
  x: number,
  y: number,
): Promise<SyncTexSourceLocation | null> {
  const records = await runSynctex(
    ["edit", "-o", `${page}:${x}:${y}:${pdfPath}`],
    projectPath,
  );
  const record = records[0];
  if (!record?.Input || !record.Line) {
    return null;
  }

  const inputPath = path.resolve(projectPath, record.Input);
  const relativePath = path.relative(projectPath, inputPath);
  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    relativePath === ""
  ) {
    return null;
  }

  return {
    file: relativePath,
    line: numberField(record, "Line", 1),
    column: Math.max(1, numberField(record, "Column", 1)),
  };
}
