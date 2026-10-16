import type { GitDiffSession } from "../../types";

/** Keep Monaco's models mounted while refreshing the same open diff. */
export function reconcileDiffRefresh(
  current: GitDiffSession,
  refreshed: GitDiffSession,
): GitDiffSession {
  const next = { ...refreshed, id: current.id };
  const unchanged = (Object.keys(next) as (keyof GitDiffSession)[]).every(
    (key) => JSON.stringify(next[key]) === JSON.stringify(current[key]),
  );
  return unchanged ? current : next;
}
