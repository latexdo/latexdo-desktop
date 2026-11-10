/*
 * The crash reporter: problems the diagnostics log records are triaged (see
 * crashReportTriage.ts); the real bugs wait, scrubbed, until the person
 * chooses to send them to LatexDo's report server, open a GitHub issue, or
 * dismiss them. Nothing leaves the machine without that choice, unless they
 * asked for reports to be sent automatically.
 *
 * The queue lives on disk, so a crash that closes the app is offered the next
 * time it starts.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DiagnosticEvent } from "./diagnostics.js";
import {
  buildCrashReport,
  githubIssueUrl,
  triageDiagnostic,
  type CrashReport,
  type CrashReportEnvironment,
  type ScrubOptions,
} from "./crashReportTriage.js";

export type CrashReportMode = "ask" | "always" | "never";

export interface CrashReportSettings {
  mode: CrashReportMode;
  pending: CrashReport[];
}

export interface CrashReportSendResult {
  reportId: string;
  /** How many times the server has seen this problem, from anyone. */
  occurrences: number;
  /** Someone already reported it. */
  known: boolean;
  /** What the maintainers marked it as, e.g. fixed in a version. */
  status?: string;
  fixedIn?: string;
}

interface HandledEntry {
  appVersion: string;
  outcome: "sent" | "github" | "dismissed";
  at: string;
}

interface CrashReportState {
  version: 1;
  installId: string;
  mode: CrashReportMode;
  pending: CrashReport[];
  handled: Record<string, HandledEntry>;
}

export interface CrashReporterOptions {
  getUserDataPath: () => string;
  getEnvironment: () => CrashReportEnvironment;
  scrub: ScrubOptions;
  serverUrl: string;
  fetch?: typeof fetch;
  openExternal: (url: string) => Promise<void>;
  /** The pending list changed: tell the window. */
  onChange?: () => void;
  now?: () => number;
}

const maxPending = 10;
const maxHandled = 300;
/** New problems offered in one session, so a broken build does not nag. */
const maxNewPromptsPerSession = 5;
const pendingLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const sendTimeoutMs = 15_000;

function isMode(value: unknown): value is CrashReportMode {
  return value === "ask" || value === "always" || value === "never";
}

function freshState(): CrashReportState {
  return { version: 1, installId: randomUUID(), mode: "ask", pending: [], handled: {} };
}

function parseState(text: string): CrashReportState {
  const value = JSON.parse(text) as Partial<CrashReportState>;
  if (!value || typeof value !== "object" || value.version !== 1) return freshState();
  return {
    version: 1,
    installId:
      typeof value.installId === "string" && /^[0-9a-f-]{36}$/.test(value.installId)
        ? value.installId
        : randomUUID(),
    mode: isMode(value.mode) ? value.mode : "ask",
    pending: Array.isArray(value.pending)
      ? value.pending
          .filter(
            (report): report is CrashReport =>
              Boolean(report) &&
              typeof report === "object" &&
              report.schemaVersion === 1 &&
              typeof report.id === "string" &&
              typeof report.fingerprint === "string",
          )
          .slice(0, maxPending)
      : [],
    handled:
      value.handled &&
      typeof value.handled === "object" &&
      !Array.isArray(value.handled)
        ? value.handled
        : {},
  };
}

export interface CrashReporter {
  /** Considers one recorded problem; queues it if it is a real bug. */
  consider: (event: DiagnosticEvent) => Promise<void>;
  /** The same, safe to call while the process is going down. */
  considerSync: (event: DiagnosticEvent) => void;
  settings: () => Promise<CrashReportSettings>;
  setMode: (mode: CrashReportMode) => Promise<CrashReportSettings>;
  send: (id: string, note?: string) => Promise<CrashReportSendResult>;
  openGithubIssue: (id: string, note?: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  /** At startup: send what the person agreed to send automatically. */
  flushAutomatic: () => Promise<void>;
}

export function createCrashReporter(options: CrashReporterOptions): CrashReporter {
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetch ?? fetch;
  let state: CrashReportState | null = null;
  let newPromptsThisSession = 0;
  let writes: Promise<void> = Promise.resolve();
  const sending = new Set<string>();

  const statePath = () =>
    path.join(options.getUserDataPath(), "crash-reports", "state.json");

  function prune(current: CrashReportState): void {
    const cutoff = now() - pendingLifetimeMs;
    current.pending = current.pending.filter(
      (report) => Date.parse(report.lastSeenAt) >= cutoff,
    );
    const handled = Object.entries(current.handled);
    if (handled.length > maxHandled) {
      handled.sort((a, b) => b[1].at.localeCompare(a[1].at));
      current.handled = Object.fromEntries(handled.slice(0, maxHandled));
    }
  }

  function loadSync(): CrashReportState {
    if (state) return state;
    try {
      state = parseState(readFileSync(statePath(), "utf8"));
    } catch {
      state = freshState();
    }
    prune(state);
    return state;
  }

  async function load(): Promise<CrashReportState> {
    if (state) return state;
    let loaded: CrashReportState;
    try {
      loaded = parseState(await readFile(statePath(), "utf8"));
    } catch {
      loaded = freshState();
    }
    // Another call may have loaded it while this one was reading.
    if (!state) {
      prune(loaded);
      state = loaded;
    }
    return state;
  }

  function persistSync(): void {
    if (!state) return;
    const file = statePath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(state), "utf8");
    renameSync(`${file}.tmp`, file);
  }

  function persist(): Promise<void> {
    const snapshot = JSON.stringify(state);
    writes = writes
      .catch(() => undefined)
      .then(async () => {
        const file = statePath();
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, snapshot, "utf8");
        await rename(`${file}.tmp`, file);
      });
    return writes;
  }

  function notify(): void {
    try {
      options.onChange?.();
    } catch {
      // The window may be gone; the queue is on disk.
    }
  }

  /** Adds the problem to the queue. Returns whether anything changed. */
  function enqueue(current: CrashReportState, event: DiagnosticEvent): boolean {
    if (current.mode === "never") return false;
    const verdict = triageDiagnostic(event);
    if (!verdict.report) return false;

    const environment = options.getEnvironment();
    const handled = current.handled[verdict.fingerprint];
    // Already sent, filed or dismissed for this version: do not ask again.
    // A new version is a new chance that the fix did not work.
    if (handled && handled.appVersion === environment.appVersion) return false;

    const existing = current.pending.find(
      (report) => report.fingerprint === verdict.fingerprint,
    );
    if (existing) {
      existing.occurrences += 1;
      existing.lastSeenAt = event.recordedAt;
      return true;
    }
    if (newPromptsThisSession >= maxNewPromptsPerSession) return false;
    newPromptsThisSession += 1;

    const report = buildCrashReport(event, verdict, environment, {
      ...options.scrub,
      id: randomUUID(),
    });
    current.pending = [report, ...current.pending].slice(0, maxPending);
    return true;
  }

  function markHandled(
    current: CrashReportState,
    report: CrashReport,
    outcome: HandledEntry["outcome"],
  ): void {
    current.pending = current.pending.filter((entry) => entry.id !== report.id);
    current.handled[report.fingerprint] = {
      appVersion: options.getEnvironment().appVersion,
      outcome,
      at: new Date(now()).toISOString(),
    };
  }

  async function post(
    report: CrashReport,
    installId: string,
  ): Promise<CrashReportSendResult> {
    const response = await fetchImpl(new URL("/api/reports", options.serverUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report, reporter: installId }),
      signal: AbortSignal.timeout(sendTimeoutMs),
    });
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      // Not JSON: report the status below.
    }
    if (!response.ok) {
      throw new Error(
        typeof body.error === "string"
          ? body.error
          : `The report server answered ${response.status}.`,
      );
    }
    return {
      reportId: typeof body.id === "string" ? body.id : report.id,
      occurrences: typeof body.occurrences === "number" ? body.occurrences : 1,
      known: body.known === true,
      ...(typeof body.status === "string" ? { status: body.status } : {}),
      ...(typeof body.fixedIn === "string" ? { fixedIn: body.fixedIn } : {}),
    };
  }

  async function sendReport(
    current: CrashReportState,
    report: CrashReport,
  ): Promise<CrashReportSendResult> {
    if (sending.has(report.id)) throw new Error("This report is already being sent.");
    sending.add(report.id);
    try {
      const result = await post(report, current.installId);
      markHandled(current, report, "sent");
      await persist();
      notify();
      return result;
    } finally {
      sending.delete(report.id);
    }
  }

  function pendingReport(current: CrashReportState, id: string): CrashReport {
    const report = current.pending.find((entry) => entry.id === id);
    if (!report) throw new Error("This report is no longer waiting to be sent.");
    return report;
  }

  function withNote(report: CrashReport, note: string | undefined): CrashReport {
    const trimmed = note?.trim().slice(0, 2_000);
    return trimmed ? { ...report, note: trimmed } : report;
  }

  async function flushAutomatic(): Promise<void> {
    const current = await load();
    if (current.mode !== "always") return;
    for (const report of [...current.pending]) {
      try {
        await sendReport(current, report);
      } catch {
        // Offline or the server refused: it stays queued for next time.
      }
    }
  }

  return {
    async consider(event) {
      const current = await load();
      if (!enqueue(current, event)) return;
      await persist();
      if (current.mode === "always") void flushAutomatic();
      else notify();
    },
    considerSync(event) {
      try {
        const current = loadSync();
        if (!enqueue(current, event)) return;
        persistSync();
        // Sent next start if automatic; asked now if the window survives.
        if (current.mode === "ask") notify();
      } catch {
        // Never turn a crash into a second crash.
      }
    },
    async settings() {
      const current = await load();
      return {
        mode: current.mode,
        pending: current.mode === "ask" ? current.pending : [],
      };
    },
    async setMode(mode) {
      const current = await load();
      current.mode = mode;
      if (mode === "never") current.pending = [];
      await persist();
      notify();
      if (mode === "always") void flushAutomatic();
      return { mode, pending: mode === "ask" ? current.pending : [] };
    },
    async send(id, note) {
      const current = await load();
      const report = pendingReport(current, id);
      const result = await sendReport(current, withNote(report, note));
      return result;
    },
    async openGithubIssue(id, note) {
      const current = await load();
      const report = pendingReport(current, id);
      await options.openExternal(githubIssueUrl(report, note));
      markHandled(current, report, "github");
      await persist();
      notify();
    },
    async dismiss(id) {
      const current = await load();
      const report = current.pending.find((entry) => entry.id === id);
      if (!report) return;
      markHandled(current, report, "dismissed");
      await persist();
      notify();
    },
    flushAutomatic,
  };
}
