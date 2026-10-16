import { opendir } from "node:fs/promises";
import path from "node:path";
import type { ProjectEntry, ProjectListOptions } from "./types.js";

export const DEFAULT_PROJECT_TREE_IGNORED_NAMES = [
  ".git",
  ".latexdo",
  "node_modules",
  "dist",
  "dist-electron",
  "release",
  "coverage",
  "out",
  ".cache",
] as const;

export const DEFAULT_PROJECT_TREE_MAX_DEPTH = 8;
export const DEFAULT_PROJECT_TREE_MAX_ENTRIES = 5000;

interface NormalizedProjectListOptions {
  ignoredNames: Set<string>;
  maxDepth: number;
  maxEntries: number;
}

interface ProjectListState {
  emittedEntries: number;
}

function normalizeOptions(
  options: ProjectListOptions = {},
): NormalizedProjectListOptions {
  return {
    ignoredNames: new Set(options.ignoredNames ?? DEFAULT_PROJECT_TREE_IGNORED_NAMES),
    maxDepth: options.maxDepth ?? DEFAULT_PROJECT_TREE_MAX_DEPTH,
    maxEntries: options.maxEntries ?? DEFAULT_PROJECT_TREE_MAX_ENTRIES,
  };
}

function projectTreeLimitEntry(
  projectPath: string,
  directory: string,
  message: string,
): ProjectEntry {
  const markerPath = path.join(directory, "__latexdo_project_tree_limit__");
  return {
    name: message,
    path: markerPath,
    relativePath: path.relative(projectPath, markerPath),
    type: "file",
    limited: true,
  };
}

function sortProjectEntries(entries: ProjectEntry[]): ProjectEntry[] {
  return entries.sort((left, right) => {
    if (left.limited || right.limited) {
      return left.limited === right.limited ? 0 : left.limited ? 1 : -1;
    }
    if (left.type !== right.type) {
      return left.type === "directory" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

async function walkProjectDirectory(
  projectPath: string,
  directory: string,
  depth: number,
  options: NormalizedProjectListOptions,
  state: ProjectListState,
): Promise<ProjectEntry[]> {
  const result: ProjectEntry[] = [];
  const directoryHandle = await opendir(directory);

  try {
    for await (const entry of directoryHandle) {
      if (
        entry.name === ".DS_Store" ||
        options.ignoredNames.has(entry.name) ||
        state.emittedEntries >= options.maxEntries
      ) {
        if (state.emittedEntries >= options.maxEntries) {
          result.push(
            projectTreeLimitEntry(
              projectPath,
              directory,
              `Project tree limited to ${options.maxEntries.toLocaleString()} entries`,
            ),
          );
          break;
        }
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(projectPath, absolutePath);
      state.emittedEntries += 1;

      if (entry.isDirectory()) {
        const children =
          depth >= options.maxDepth
            ? [
                projectTreeLimitEntry(
                  projectPath,
                  absolutePath,
                  `Folder depth limited to ${options.maxDepth.toLocaleString()}`,
                ),
              ]
            : await walkProjectDirectory(
                projectPath,
                absolutePath,
                depth + 1,
                options,
                state,
              );
        result.push({
          name: entry.name,
          path: absolutePath,
          relativePath,
          type: "directory",
          children,
        });
      } else {
        result.push({
          name: entry.name,
          path: absolutePath,
          relativePath,
          type: "file",
        });
      }
    }
  } finally {
    await directoryHandle.close().catch(() => {});
  }

  return sortProjectEntries(result);
}

export async function listProject(
  projectPath: string,
  options: ProjectListOptions = {},
): Promise<ProjectEntry[]> {
  return walkProjectDirectory(projectPath, projectPath, 0, normalizeOptions(options), {
    emittedEntries: 0,
  });
}
