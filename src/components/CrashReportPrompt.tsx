/*
 * Asks the person whether to report a crash or bug LatexDo caught: send it to
 * LatexDo's report server, open a pre-filled GitHub issue, or dismiss it. The
 * exact report (already scrubbed of paths, emails and tokens) can be read
 * before anything is sent.
 */

import React from "react";
import { Bug, ChevronDown, ChevronRight, Github, Send, X } from "lucide-react";
import type { CrashReport } from "../../electron/crashReportTriage";
import type { CrashReportSendResult } from "../../electron/crashReports";
import "../features/crashReports/crashReports.css";

type Phase =
  | { kind: "idle" }
  | { kind: "busy"; action: "send" | "github" }
  | { kind: "failed"; message: string }
  | { kind: "sent"; result: CrashReportSendResult };

const thanksLifetimeMs = 7_000;

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // Electron prefixes errors that cross IPC.
  return text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}

function sentMessage(result: CrashReportSendResult): string {
  if (result.status === "fixed" && result.fixedIn) {
    return `This is already fixed in LatexDo ${result.fixedIn}. Updating will solve it.`;
  }
  if (result.known && result.occurrences > 1) {
    return `Others hit this too (${result.occurrences} reports), so it is now a higher priority.`;
  }
  return "It will help us find and fix the problem.";
}

export function CrashReportPrompt() {
  const api = window.latexdo;
  const [pending, setPending] = React.useState<CrashReport[]>([]);
  const [note, setNote] = React.useState("");
  const [showDetails, setShowDetails] = React.useState(false);
  const [alwaysSend, setAlwaysSend] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });

  const refresh = React.useCallback(async () => {
    if (typeof api?.getCrashReports !== "function") return;
    try {
      const settings = await api.getCrashReports();
      setPending(settings.mode === "ask" ? settings.pending : []);
    } catch {
      // Crash reporting must never cause another error.
    }
  }, [api]);

  React.useEffect(() => {
    void refresh();
    return api?.onCrashReportsChanged?.(() => void refresh());
  }, [api, refresh]);

  React.useEffect(() => {
    if (phase.kind !== "sent") return;
    const timer = window.setTimeout(() => setPhase({ kind: "idle" }), thanksLifetimeMs);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const report = pending[0];
  const resetForm = () => {
    setNote("");
    setShowDetails(false);
  };

  if (phase.kind === "sent") {
    return (
      <div className="crash-report-prompt is-thanks" role="status" aria-live="polite">
        <div className="crash-report-head">
          <span className="crash-report-icon is-ok" aria-hidden="true">
            <Send size={15} />
          </span>
          <div className="crash-report-heading">
            <strong>Thanks, the report was sent</strong>
            <span>{sentMessage(phase.result)}</span>
          </div>
          <button
            type="button"
            className="crash-report-close"
            aria-label="Close"
            onClick={() => setPhase({ kind: "idle" })}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (!report) return null;
  const busy = phase.kind === "busy";

  const send = async () => {
    setPhase({ kind: "busy", action: "send" });
    try {
      if (alwaysSend) await api.setCrashReportMode("always");
      const result = await api.sendCrashReport(report.id, note);
      resetForm();
      setPhase({ kind: "sent", result });
      await refresh();
    } catch (error) {
      setPhase({ kind: "failed", message: errorMessage(error) });
    }
  };

  const openIssue = async () => {
    setPhase({ kind: "busy", action: "github" });
    try {
      await api.openCrashReportIssue(report.id, note);
      resetForm();
      setPhase({ kind: "idle" });
      await refresh();
    } catch (error) {
      setPhase({ kind: "failed", message: errorMessage(error) });
    }
  };

  const dismiss = async () => {
    resetForm();
    setPhase({ kind: "idle" });
    setPending((current) => current.filter((entry) => entry.id !== report.id));
    try {
      await api.dismissCrashReport(report.id);
    } finally {
      await refresh();
    }
  };

  const { note: _unsent, ...preview } = report;
  return (
    <div
      className="crash-report-prompt"
      role="alertdialog"
      aria-labelledby="crash-report-title"
      aria-describedby="crash-report-summary"
    >
      <div className="crash-report-head">
        <span
          className={`crash-report-icon ${report.category === "crash" ? "is-crash" : ""}`}
          aria-hidden="true"
        >
          <Bug size={15} />
        </span>
        <div className="crash-report-heading">
          <strong id="crash-report-title">
            {report.category === "crash"
              ? "LatexDo crashed. Report it?"
              : "LatexDo hit a bug. Report it?"}
          </strong>
          <span className="crash-report-title" title={report.title}>
            {report.title}
          </span>
        </div>
        <button
          type="button"
          className="crash-report-close"
          aria-label="Dismiss this report"
          title="Don't report this"
          disabled={busy}
          onClick={() => void dismiss()}
        >
          <X size={14} />
        </button>
      </div>

      <p id="crash-report-summary" className="crash-report-summary">
        {report.occurrences > 1 ? `It happened ${report.occurrences} times. ` : ""}
        Sending the report helps fix it. Your files, paths, email addresses and tokens
        were removed from it.
        {pending.length > 1 ? ` ${pending.length - 1} more waiting.` : ""}
      </p>

      <label className="crash-report-note">
        <span>What were you doing? (optional)</span>
        <textarea
          value={note}
          rows={2}
          maxLength={2000}
          placeholder="e.g. I had just pasted a figure and pressed compile"
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      <button
        type="button"
        className="crash-report-details-toggle"
        aria-expanded={showDetails}
        onClick={() => setShowDetails((value) => !value)}
      >
        {showDetails ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        See exactly what is sent
      </button>
      {showDetails ? (
        <pre className="crash-report-details" tabIndex={0} aria-label="Report contents">
          {JSON.stringify(
            note.trim() ? { ...preview, note: note.trim() } : preview,
            null,
            2,
          )}
        </pre>
      ) : null}

      {phase.kind === "failed" ? (
        <p className="crash-report-error" role="alert">
          Could not send it: {phase.message} Try again, or open a GitHub issue instead.
        </p>
      ) : null}

      <label className="crash-report-always">
        <input
          type="checkbox"
          checked={alwaysSend}
          disabled={busy}
          onChange={(event) => setAlwaysSend(event.target.checked)}
        />
        Send future reports automatically
      </label>

      <div className="crash-report-actions">
        <button
          type="button"
          className="crash-report-primary"
          disabled={busy}
          onClick={() => void send()}
        >
          <Send size={13} aria-hidden="true" />
          {busy && phase.action === "send" ? "Sending…" : "Send report"}
        </button>
        <button
          type="button"
          className="crash-report-secondary"
          disabled={busy}
          onClick={() => void openIssue()}
        >
          <Github size={13} aria-hidden="true" />
          GitHub issue
        </button>
      </div>
    </div>
  );
}

const modeLabels = {
  ask: "Ask me each time",
  always: "Send automatically",
  never: "Never send",
} as const;

/** The Settings row: whether LatexDo asks, sends on its own, or never reports. */
export function CrashReportSettingsRow() {
  const api = window.latexdo;
  const [mode, setMode] = React.useState<keyof typeof modeLabels | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void api
      ?.getCrashReports?.()
      .then((settings) => {
        if (!cancelled) setMode(settings.mode);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (!mode || api?.runtime === "browser") return null;
  return (
    <label className="settings-row">
      <span>
        <strong>Crash and bug reports</strong>
        <small>
          Only real crashes and bugs, with your files, paths, emails and tokens removed.
        </small>
      </span>
      <select
        value={mode}
        aria-label="Crash and bug reports"
        onChange={(event) => {
          const next = event.target.value as keyof typeof modeLabels;
          setMode(next);
          void api.setCrashReportMode(next).catch(() => undefined);
        }}
      >
        {Object.entries(modeLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
