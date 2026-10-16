import { useMemo, useState } from "react";
import type {
  GitBlameLine,
  GitCommitDetails,
  GitDiffSession,
  GitHistorySummary,
  GitStatusSummary,
} from "../../types";
import { groupGitChanges, type GitContextMenuState } from "./gitUi";

export function useGit() {
  const [gitStatus, setGitStatus] = useState<GitStatusSummary | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitCommitMessage, setGitCommitMessage] = useState("");
  const [gitActionBusy, setGitActionBusy] = useState<string | null>(null);
  const [gitDiffSession, setGitDiffSession] = useState<GitDiffSession | null>(null);
  const [gitBlameLines, setGitBlameLines] = useState<GitBlameLine[]>([]);
  const [gitRepoHistory, setGitRepoHistory] = useState<GitHistorySummary | null>(null);
  const [gitFileHistory, setGitFileHistory] = useState<GitHistorySummary | null>(null);
  const [gitFileHistoryPath, setGitFileHistoryPath] = useState<string | null>(null);
  const [selectedGitCommitHash, setSelectedGitCommitHash] = useState<string | null>(
    null,
  );
  const [gitCommitDetails, setGitCommitDetails] = useState<GitCommitDetails | null>(
    null,
  );
  const [gitCommitParentHash, setGitCommitParentHash] = useState("");
  const [collapsedGitGroups, setCollapsedGitGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [gitContextMenu, setGitContextMenu] = useState<GitContextMenuState | null>(
    null,
  );

  const stagedGitEntries = useMemo(
    () => (gitStatus?.entries ?? []).filter((entry) => entry.staged),
    [gitStatus],
  );
  const unstagedGitEntries = useMemo(
    () => (gitStatus?.entries ?? []).filter((entry) => entry.unstaged),
    [gitStatus],
  );
  const stagedGitGroups = useMemo(
    () => groupGitChanges(stagedGitEntries, "staged"),
    [stagedGitEntries],
  );
  const unstagedGitGroups = useMemo(
    () => groupGitChanges(unstagedGitEntries, "changes"),
    [unstagedGitEntries],
  );
  const gitRepositoryCommits = useMemo(
    () => (Array.isArray(gitRepoHistory?.commits) ? gitRepoHistory.commits : []),
    [gitRepoHistory],
  );
  const gitFileCommits = useMemo(
    () => (Array.isArray(gitFileHistory?.commits) ? gitFileHistory.commits : []),
    [gitFileHistory],
  );

  return {
    gitStatus,
    setGitStatus,
    gitLoading,
    setGitLoading,
    gitCommitMessage,
    setGitCommitMessage,
    gitActionBusy,
    setGitActionBusy,
    gitDiffSession,
    setGitDiffSession,
    gitBlameLines,
    setGitBlameLines,
    gitRepoHistory,
    setGitRepoHistory,
    gitFileHistory,
    setGitFileHistory,
    gitFileHistoryPath,
    setGitFileHistoryPath,
    selectedGitCommitHash,
    setSelectedGitCommitHash,
    gitCommitDetails,
    setGitCommitDetails,
    gitCommitParentHash,
    setGitCommitParentHash,
    collapsedGitGroups,
    setCollapsedGitGroups,
    gitContextMenu,
    setGitContextMenu,
    modifiedFiles: gitStatus?.entries.length ?? 0,
    stagedGitEntries,
    unstagedGitEntries,
    stagedGitGroups,
    unstagedGitGroups,
    gitRepositoryCommits,
    gitFileCommits,
  };
}
