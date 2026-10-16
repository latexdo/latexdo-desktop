import { readFileSync } from "node:fs";
import path from "node:path";

/** Identity of this build, written next to the compiled main process at build time. */
export interface BuildChange {
  commit: string;
  subject: string;
}

export interface BuildInfo {
  commit: string;
  builtAt: string;
  /** First-parent history of this build, newest first (may be empty). */
  changes: BuildChange[];
}

function parseChanges(value: unknown): BuildChange[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (change): change is BuildChange =>
      typeof change === "object" &&
      change !== null &&
      typeof (change as BuildChange).commit === "string" &&
      /^[a-f0-9]{40}$/.test((change as BuildChange).commit) &&
      typeof (change as BuildChange).subject === "string",
  );
}

export function readBuildInfo(directory: string): BuildInfo | null {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(directory, "build-info.json"), "utf8"),
    ) as Partial<BuildInfo>;
    if (
      typeof parsed.commit !== "string" ||
      !/^[a-f0-9]{40}$/.test(parsed.commit) ||
      typeof parsed.builtAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.builtAt))
    ) {
      return null;
    }
    return {
      commit: parsed.commit,
      builtAt: parsed.builtAt,
      changes: parseChanges((parsed as { changes?: unknown }).changes),
    };
  } catch {
    return null;
  }
}
