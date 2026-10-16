// Installs local speech support (whisper.cpp server + model) on demand, from
// wherever dictation is used. Setup offers it too, but it must not be the only
// way: a person who skipped setup, finished it before speech existed, or lost
// the download halfway would otherwise be stuck.

import React from "react";
import {
  getSpeechRuntimeStatus,
  installSpeechRuntime,
  subscribeSpeechInstall,
} from "../ai/aiClient";

export type LocalSpeechState =
  | { phase: "unknown" | "installed" | "unavailable" }
  | { phase: "missing"; downloadBytes: number | null }
  | { phase: "installing"; percent: number | null; message: string }
  | { phase: "failed"; error: string; downloadBytes: number | null };

export function formatDownloadSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export function useLocalSpeechInstall() {
  const [state, setState] = React.useState<LocalSpeechState>({ phase: "unknown" });
  const downloadBytesRef = React.useRef<number | null>(null);

  /** Reads whether speech is installed; "unavailable" outside the desktop app. */
  const refresh = React.useCallback(async (): Promise<LocalSpeechState> => {
    let next: LocalSpeechState;
    try {
      const status = await getSpeechRuntimeStatus();
      if (!status) next = { phase: "unavailable" };
      else if (status.installed) next = { phase: "installed" };
      else {
        downloadBytesRef.current = status.downloadBytes ?? null;
        next = { phase: "missing", downloadBytes: status.downloadBytes ?? null };
      }
    } catch {
      next = { phase: "unavailable" };
    }
    setState((current) => (current.phase === "installing" ? current : next));
    return next;
  }, []);

  /** Downloads and installs; resolves true once speech is ready. */
  const install = React.useCallback(async (): Promise<boolean> => {
    setState({ phase: "installing", percent: 0, message: "Starting download…" });
    const unsubscribe = subscribeSpeechInstall((progress) => {
      if (progress.error) return;
      setState({
        phase: "installing",
        percent: progress.totalBytes
          ? Math.min(
              100,
              Math.round((progress.receivedBytes / progress.totalBytes) * 100),
            )
          : null,
        message: progress.message ?? "Installing local speech…",
      });
    });
    try {
      const result = await installSpeechRuntime();
      if (!result.ok) throw new Error(result.error ?? "Speech support install failed.");
      setState({ phase: "installed" });
      return true;
    } catch (error) {
      setState({
        phase: "failed",
        error: error instanceof Error ? error.message : String(error),
        downloadBytes: downloadBytesRef.current,
      });
      return false;
    } finally {
      unsubscribe();
    }
  }, []);

  return { state, refresh, install };
}
