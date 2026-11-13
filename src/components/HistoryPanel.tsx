/*
 * The shared project's change history, like Overleaf's: who changed which
 * file and when, with the lines they removed and added. Click a change to see
 * it, and jump to that place in the editor.
 */

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  History,
  LocateFixed,
  RefreshCw,
} from "lucide-react";
import type { HistoryHunk, ProjectHistoryEntry } from "../types";
import { groupHistory, type HistoryGroup } from "../features/history/useProjectHistory";
import { DiscussionAvatar } from "./DiscussionPanel";
import "../features/history/history.css";

export interface HistoryPanelProps {
  /** False when the project is not shared (history needs a shared copy). */
  available: boolean;
  entries: readonly ProjectHistoryEntry[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  /** Names by client id; this person is "You". */
  names: ReadonlyMap<string, string>;
  me: string;
  onRefresh: () => void;
  onLoadOlder: () => void;
  onOpen: (path: string, line: number) => void;
}

const dayMs = 24 * 60 * 60 * 1000;

function dayLabel(at: number, now = Date.now()): string {
  const day = new Date(at).setHours(0, 0, 0, 0);
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (day === today) return "Today";
  if (today - day === dayMs) return "Yesterday";
  return new Date(at).toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** The first changed line of a hunk, in the file as it is after the change. */
function firstChangedLine(hunk: HistoryHunk): number {
  let line = hunk.newStart;
  for (const text of hunk.lines) {
    if (text[0] === "+" || text[0] === "-") return line;
    if (text[0] === " ") line += 1;
  }
  return hunk.newStart;
}

function HunkView({
  hunk,
  onOpen,
}: {
  hunk: HistoryHunk;
  onOpen: (line: number) => void;
}) {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  return (
    <div className="history-hunk">
      <button
        type="button"
        className="history-hunk-open"
        onClick={() => onOpen(firstChangedLine(hunk))}
        title="Show this place in the editor"
      >
        <LocateFixed size={12} aria-hidden="true" />
        Line {firstChangedLine(hunk)}
      </button>
      <table className="history-diff">
        <tbody>
          {hunk.lines.map((text, index) => {
            const kind = text[0];
            const body = text.slice(1);
            if (kind === "~") {
              return (
                <tr key={index} className="history-diff-more">
                  <td colSpan={3}>… {body}</td>
                </tr>
              );
            }
            const before = kind === "+" ? "" : String(oldLine++);
            const after = kind === "-" ? "" : String(newLine++);
            return (
              <tr
                key={index}
                className={
                  kind === "+" ? "is-added" : kind === "-" ? "is-removed" : undefined
                }
              >
                <td className="history-diff-number" aria-hidden="true">
                  {kind === "-" ? before : after}
                </td>
                <td className="history-diff-sign" aria-hidden="true">
                  {kind === " " ? "" : kind === "+" ? "+" : "−"}
                </td>
                <td className="history-diff-text">
                  <span className="history-sr-only">
                    {kind === "+" ? "Added: " : kind === "-" ? "Removed: " : ""}
                  </span>
                  {body || " "}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GroupRow({
  group,
  name,
  open,
  onToggle,
  onOpen,
}: {
  group: HistoryGroup;
  name: string;
  open: boolean;
  onToggle: () => void;
  onOpen: (path: string, line: number) => void;
}) {
  return (
    <li className={`history-group ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="history-group-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <DiscussionAvatar clientId={group.from} name={name} size={24} />
        <span className="history-group-text">
          <span className="history-group-title">
            <strong>{name}</strong> edited{" "}
            <span title={group.path}>{fileName(group.path)}</span>
          </span>
          <span className="history-group-meta">
            {timeLabel(group.endedAt)}
            <span className="history-count is-added">+{group.added}</span>
            <span className="history-count is-removed">−{group.removed}</span>
          </span>
        </span>
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
      </button>
      {open ? (
        <div className="history-group-body">
          {group.entries.flatMap((entry) =>
            entry.change.hunks.map((hunk, index) => (
              <HunkView
                key={`${entry.seq}-${index}`}
                hunk={hunk}
                onOpen={(line) => onOpen(group.path, line)}
              />
            )),
          )}
        </div>
      ) : null}
    </li>
  );
}

export function HistoryPanel({
  available,
  entries,
  loading,
  error,
  hasMore,
  names,
  me,
  onRefresh,
  onLoadOlder,
  onOpen,
}: HistoryPanelProps) {
  const [person, setPerson] = useState("all");
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const nameOf = (clientId: string) =>
    clientId === me ? "You" : (names.get(clientId) ?? "Someone");

  const people = useMemo(
    () => [...new Set(entries.map((entry) => entry.from))],
    [entries],
  );
  const groups = useMemo(
    () =>
      groupHistory(
        person === "all" ? entries : entries.filter((e) => e.from === person),
      ),
    [entries, person],
  );

  if (!available) {
    return (
      <div className="history-panel history-empty">
        <History size={28} aria-hidden="true" />
        <p>History keeps track of who changed what in a shared project.</p>
        <p className="sub-text">Share this project to start recording changes.</p>
      </div>
    );
  }

  let lastDay = "";
  return (
    <div className="history-panel">
      <div className="history-toolbar">
        <select
          aria-label="Show changes by"
          value={person}
          onChange={(event) => setPerson(event.target.value)}
        >
          <option value="all">Everyone</option>
          {people.map((clientId) => (
            <option key={clientId} value={clientId}>
              {nameOf(clientId)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="small-icon"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh history"
        >
          <RefreshCw size={13} className={loading ? "spin" : undefined} />
        </button>
      </div>
      {error ? (
        <p className="history-error" role="alert">
          {error}
        </p>
      ) : null}
      {groups.length === 0 && !loading ? (
        <div className="history-empty">
          <History size={28} aria-hidden="true" />
          <p>No changes recorded yet.</p>
          <p className="sub-text">
            Edits made in LatexDo from now on appear here, with who made them.
          </p>
        </div>
      ) : (
        <ol className="history-list">
          {groups.map((group) => {
            const day = dayLabel(group.endedAt);
            const heading = day !== lastDay ? day : null;
            lastDay = day;
            return (
              <li key={group.key} className="history-day-item">
                {heading ? <h4 className="history-day">{heading}</h4> : null}
                <ol className="history-day-list">
                  <GroupRow
                    group={group}
                    name={nameOf(group.from)}
                    open={openGroups.has(group.key)}
                    onToggle={() =>
                      setOpenGroups((current) => {
                        const next = new Set(current);
                        if (next.has(group.key)) next.delete(group.key);
                        else next.add(group.key);
                        return next;
                      })
                    }
                    onOpen={onOpen}
                  />
                </ol>
              </li>
            );
          })}
        </ol>
      )}
      {hasMore ? (
        <button
          type="button"
          className="history-older"
          onClick={onLoadOlder}
          disabled={loading}
        >
          Load older changes
        </button>
      ) : null}
    </div>
  );
}
