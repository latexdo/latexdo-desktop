import type { ProjectEntry } from "../../types";

/** Operating on a selected folder already includes its selected descendants. */
export function topLevelTreeEntries(entries: ProjectEntry[]): ProjectEntry[] {
  const unique = [...new Map(entries.map((entry) => [entry.path, entry])).values()];
  const normalized = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "");
  return unique.filter(
    (entry) =>
      !unique.some(
        (parent) =>
          parent !== entry &&
          parent.type === "directory" &&
          normalized(entry.path).startsWith(`${normalized(parent.path)}/`),
      ),
  );
}
