import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectHistoryEntry } from "../../types";

/** Refreshed this often, and only while the History panel is open. */
const refreshMs = 60_000;
/** Edits by one person to one file this close together read as one. */
const groupGapMs = 10 * 60_000;

export interface HistoryGroup {
  key: string;
  from: string;
  path: string;
  startedAt: number;
  endedAt: number;
  added: number;
  removed: number;
  /** Oldest first, as they happened. */
  entries: ProjectHistoryEntry[];
}

/** Newest first: consecutive changes by one person to one file, together. */
export function groupHistory(
  entries: readonly ProjectHistoryEntry[],
  gapMs = groupGapMs,
): HistoryGroup[] {
  const sorted = [...entries].sort(
    (left, right) => right.change.endedAt - left.change.endedAt || right.seq - left.seq,
  );
  const groups: HistoryGroup[] = [];
  for (const entry of sorted) {
    const last = groups.at(-1);
    if (
      last &&
      last.from === entry.from &&
      last.path === entry.change.path &&
      last.startedAt - entry.change.endedAt <= gapMs
    ) {
      last.entries.unshift(entry);
      last.startedAt = Math.min(last.startedAt, entry.change.startedAt);
      last.added += entry.change.added;
      last.removed += entry.change.removed;
      continue;
    }
    groups.push({
      key: `${entry.seq}`,
      from: entry.from,
      path: entry.change.path,
      startedAt: entry.change.startedAt,
      endedAt: entry.change.endedAt,
      added: entry.change.added,
      removed: entry.change.removed,
      entries: [entry],
    });
  }
  return groups;
}

function mergeEntries(
  current: readonly ProjectHistoryEntry[],
  incoming: readonly ProjectHistoryEntry[],
): ProjectHistoryEntry[] {
  const bySeq = new Map(current.map((entry) => [entry.seq, entry]));
  for (const entry of incoming) bySeq.set(entry.seq, entry);
  return [...bySeq.values()].sort((left, right) => right.seq - left.seq);
}

export function useProjectHistory({
  projectId,
  visible,
}: {
  /** The shared project, or null. */
  projectId: string | null;
  visible: boolean;
}) {
  const [entries, setEntries] = useState<ProjectHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<number | null>(null);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;

  useEffect(() => {
    setEntries([]);
    setHasMore(false);
    setError(null);
    cursorRef.current = null;
  }, [projectId]);

  const refresh = useCallback(async () => {
    const project = projectRef.current;
    if (!project) return;
    setLoading(true);
    try {
      const page = await window.latexdo.getProjectHistory(project);
      if (projectRef.current !== project) return;
      setEntries((current) => mergeEntries(current, page.entries));
      if (cursorRef.current === null) {
        cursorRef.current = page.cursor;
        setHasMore(page.hasMore);
      }
      setError(null);
    } catch (caught) {
      if (projectRef.current === project) {
        setError(
          caught instanceof Error ? caught.message : "Could not load the history.",
        );
      }
    } finally {
      if (projectRef.current === project) setLoading(false);
    }
  }, []);

  const loadOlder = useCallback(async () => {
    const project = projectRef.current;
    const before = cursorRef.current;
    if (!project || before === null) return;
    setLoading(true);
    try {
      const page = await window.latexdo.getProjectHistory(project, { before });
      if (projectRef.current !== project) return;
      setEntries((current) => mergeEntries(current, page.entries));
      cursorRef.current = page.cursor ?? before;
      setHasMore(page.hasMore);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load the history.",
      );
    } finally {
      if (projectRef.current === project) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible || !projectId) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), refreshMs);
    return () => window.clearInterval(timer);
  }, [projectId, refresh, visible]);

  return { entries, loading, error, hasMore, refresh, loadOlder };
}
