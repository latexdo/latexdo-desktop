/*
 * Crash-report triage: decides which recorded problems are worth asking the
 * person to report, groups repeats of the same problem under one fingerprint,
 * and strips anything personal before a report leaves the machine.
 *
 * Pure (no Electron), so it is tested on its own and shared by the reporter.
 */

import { createHash } from "node:crypto";
import type { DiagnosticEvent, SerializedError } from "./diagnostics.js";

export type CrashReportCategory = "crash" | "error";

export type TriageVerdict =
  | {
      report: true;
      category: CrashReportCategory;
      fingerprint: string;
      title: string;
    }
  | { report: false; reason: string };

/** Problems that are never bugs in LatexDo: slow moments, updates, exits. */
const ignoredKinds = new Set<DiagnosticEvent["kind"]>([
  "renderer-freeze",
  "renderer-unresponsive",
  "pending-update",
]);

const errorKinds = new Set<DiagnosticEvent["kind"]>([
  "uncaught-exception",
  "unhandled-rejection",
  "renderer-error",
  "renderer-unhandled-rejection",
  "renderer-react-error",
]);

/** Process exits that mean something actually broke (not "killed" or "clean-exit"). */
const crashExitReasons = new Set([
  "crashed",
  "oom",
  "launch-failed",
  "integrity-failure",
  "abnormal-exit",
  "memory-eviction",
]);

/**
 * The network, the disk or the person's own machine, not LatexDo's code: being
 * offline, a full disk or a file another program locked is not a bug report.
 */
const environmentCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ENOTFOUND",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPIPE",
  "ENOSPC",
  "EDQUOT",
  "EACCES",
  "EPERM",
  "EROFS",
  "EMFILE",
  "ENFILE",
  "EBUSY",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "ERR_NETWORK_CHANGED",
  "ERR_INTERNET_DISCONNECTED",
]);

const noisePatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /ResizeObserver loop/i, reason: "benign browser layout warning" },
  { pattern: /^Script error\.?$/i, reason: "opaque cross-origin script error" },
  {
    pattern: /^(?:Canceled|Cancelled)(?:: Canceled)?$/i,
    reason: "cancelled operation",
  },
  {
    pattern:
      /\b(?:The (?:user|operation) (?:was )?aborted|signal is aborted|aborted by the user|Request aborted)\b/i,
    reason: "cancelled operation",
  },
  {
    pattern:
      /\b(?:Failed to fetch|fetch failed|NetworkError|Network request failed|Load failed|net::ERR_[A-Z_]+|socket hang up|getaddrinfo|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|Connection (?:refused|reset|timed out)|You are offline)\b/i,
    reason: "network problem",
  },
  {
    pattern: /\b(?:ENOSPC|no space left on device|EDQUOT|disk quota exceeded)\b/i,
    reason: "the disk is full",
  },
  {
    pattern:
      /\b(?:EACCES|EPERM|EROFS|permission denied|operation not permitted|read-only file system)\b/i,
    reason: "a file permission problem",
  },
  { pattern: /\bUntrusted IPC sender\b/, reason: "a blocked untrusted page" },
  {
    pattern: /\b(?:chrome-extension|moz-extension|devtools):\/\//,
    reason: "code outside LatexDo",
  },
];

function stackFrames(stack: string | undefined): string[] {
  if (!stack) return [];
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^at\s/.test(line) || /@.+:\d+/.test(line));
}

/** A frame in a browser extension, DevTools or the engine itself. */
function isForeignFrame(frame: string): boolean {
  return /(?:chrome-extension|moz-extension|devtools|chrome):\/\//.test(frame);
}

function isEngineFrame(frame: string): boolean {
  return /\(node:|at node:|\(<anonymous>\)|\(native\)|at <anonymous>|^at new Promise \(<anonymous>\)$/.test(
    frame,
  );
}

/** Numbers, ids, quoted values, paths and URLs vary between repeats of one bug. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s'"`)]+/g, "<url>")
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\s'"`]+/g, "<path>")
    .replace(/(?:^|(?<=[\s'"`(=:]))\/[^\s'"`)]+/g, "<path>")
    .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "<value>")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "<id>",
    )
    .replace(/\b(?:0x)?[0-9a-f]{8,}\b/gi, "<hex>")
    .replace(/\b\d+(?:\.\d+)?/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** "at fn (…/assets/index-3f2a1c.js:10:4)" → "fn@index.js", stable across builds. */
function frameSignature(frame: string): string {
  const match = /^at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?)(?::\d+)?(?::\d+)?\)?$/.exec(
    frame,
  );
  const functionName = (match?.[1] ?? "<anonymous>").replace(/^Object\./, "");
  const location = (match?.[2] ?? frame).split(/[?#]/)[0];
  const file = (location.split(/[\\/]/).pop() ?? location)
    .replace(/:\d+(?::\d+)?$/, "")
    .replace(/-[A-Za-z0-9_-]{6,12}(?=\.[cm]?js$)/, "");
  return `${functionName}@${file}`;
}

function sha256(value: string, length = 16): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function fingerprintFor(
  kind: DiagnosticEvent["kind"],
  error: SerializedError,
  extra = "",
): string {
  const frames = stackFrames(error.stack)
    .filter((frame) => !isEngineFrame(frame))
    .slice(0, 5)
    .map(frameSignature);
  // A renderer error is the same bug whether it surfaced as a throw or a rejection.
  const family = kind.replace("renderer-unhandled-rejection", "renderer-error");
  return sha256(
    [family, error.name, normalizeMessage(error.message), extra, ...frames].join("\n"),
  );
}

function errorTitle(error: SerializedError): string {
  const message = error.message.split("\n")[0].trim() || "(no message)";
  const name = error.name && error.name !== "NonError" ? error.name : "Error";
  const text = message.startsWith(name) ? message : `${name}: ${message}`;
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

/** Whether this recorded problem looks like a real LatexDo bug worth reporting. */
export function triageDiagnostic(event: DiagnosticEvent): TriageVerdict {
  const { kind, severity, error } = event;
  const context = event.context ?? {};

  if (severity === "info") return { report: false, reason: "informational" };
  if (ignoredKinds.has(kind)) return { report: false, reason: "not a crash" };
  if (context.expectedE2eRecovery === true) {
    return { report: false, reason: "expected during automated tests" };
  }

  if (kind === "renderer-process-gone" || kind === "child-process-gone") {
    const reason = String(context.reason ?? error.message ?? "");
    if (!crashExitReasons.has(reason)) {
      return {
        report: false,
        reason: `process ended normally (${reason || "unknown"})`,
      };
    }
    const processType =
      kind === "renderer-process-gone"
        ? "Editor window"
        : `${String(context.type ?? "Helper")} process`;
    const title =
      reason === "oom"
        ? `${processType} ran out of memory`
        : reason === "launch-failed"
          ? `${processType} failed to start`
          : `${processType} crashed (${reason})`;
    return {
      report: true,
      category: "crash",
      title,
      fingerprint: sha256([kind, reason, String(context.type ?? "")].join("\n")),
    };
  }

  if (kind === "fatal-startup" || kind === "renderer-load-failure") {
    return {
      report: true,
      category: "crash",
      title:
        `${kind === "fatal-startup" ? "LatexDo failed to start" : "The editor failed to load"}: ${errorTitle(error)}`.slice(
          0,
          160,
        ),
      fingerprint: fingerprintFor(kind, error),
    };
  }

  if (!errorKinds.has(kind)) return { report: false, reason: "unknown kind" };

  if (error.code && environmentCodes.has(error.code)) {
    return { report: false, reason: `environment problem (${error.code})` };
  }
  if (error.name === "AbortError" || error.name === "CanceledError") {
    return { report: false, reason: "cancelled operation" };
  }
  const haystack = `${error.name}: ${error.message}`;
  for (const { pattern, reason } of noisePatterns) {
    if (pattern.test(haystack)) return { report: false, reason };
  }

  const frames = stackFrames(error.stack);
  if (!frames.length && kind !== "renderer-react-error") {
    // A thrown string or a rejection with no stack gives nothing to act on.
    return { report: false, reason: "no stack trace to act on" };
  }
  const ownFrames = frames.filter(
    (frame) => !isForeignFrame(frame) && !isEngineFrame(frame),
  );
  if (frames.length && !ownFrames.length) {
    return { report: false, reason: "happened outside LatexDo's code" };
  }

  const fatal = kind === "uncaught-exception" || kind === "renderer-react-error";
  return {
    report: true,
    category: fatal || severity === "fatal" ? "crash" : "error",
    title: errorTitle(error),
    fingerprint: fingerprintFor(kind, error),
  };
}

export interface ScrubOptions {
  homeDir?: string;
  userName?: string;
}

const appRootMarkers = [
  "app.asar",
  "dist-electron",
  "Resources/app",
  "latexdo-desktop",
];

/** Removes the person's name, files, addresses and secrets from text. */
export function scrubText(text: string, options: ScrubOptions = {}): string {
  let result = text;
  // Secrets first, before any of them can be mistaken for a path.
  result = result
    .replace(/\bp[0-9a-f]{32}_[A-Za-z0-9_-]{43}\b/g, "<share-token>")
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, "<api-key>")
    .replace(/\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/g, "<token>")
    .replace(/\b(?:AIza|xox[abposr]-)[A-Za-z0-9_-]{16,}\b/g, "<token>")
    .replace(/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 <token>")
    .replace(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      "<token>",
    )
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>");

  // URLs keep their host (where it failed) but not their path or query, which
  // can hold share tokens and invite links. The app's own pages stay readable.
  result = result.replace(
    /\b(https?):\/\/([^/\s'"`)]+)([^\s'"`)]*)/g,
    (whole, scheme, host, rest) => {
      if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host)) {
        return `${scheme}://${host}${String(rest).replace(/[?#][^\s:]*/, "")}`;
      }
      return rest && rest !== "/" ? `${scheme}://${host}/<redacted>` : whole;
    },
  );
  result = result.replace(/\b(latexdo:\/\/app[^\s?#'"`)]*)[?#][^\s'"`)]*/g, "$1");

  if (options.homeDir && options.homeDir.length > 1) {
    const escaped = options.homeDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), "~");
    const forward = options.homeDir.replaceAll("\\", "/");
    if (forward !== options.homeDir) {
      result = result.replace(
        new RegExp(forward.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
        "~",
      );
    }
  }
  result = result
    .replace(/\/(?:Users|home)\/[^/\s'"`)]+/g, "~")
    .replace(/[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s'"`)]+/gi, "~");

  // Paths inside LatexDo's own bundle stay (they locate the bug); any other
  // absolute path is the person's project, so only its extension is kept.
  // Paths inside URLs (latexdo://app/…, http://localhost/…) are left alone.
  result = result.replace(/file:\/\/(?=\/|~|[A-Za-z]:)/g, "");
  result = result.replace(
    /(?<![\w:/.~\\])(?:~|[A-Za-z]:)?(?:[\\/][^\\/\s'"`():]+)+[\\/]?/g,
    (pathText) => {
      for (const marker of appRootMarkers) {
        const index = pathText.indexOf(marker);
        if (index >= 0) return `<app>/${pathText.slice(index)}`.replace(/\\/g, "/");
      }
      const extension = /\.([A-Za-z0-9]{1,8})$/.exec(pathText)?.[1];
      return extension ? `<path>/<file>.${extension}` : "<path>";
    },
  );
  // Project-relative document names ("chapters/intro.tex") say what someone writes.
  result = result.replace(
    /(?<![\w<>.-])[\w-][\w.-]*(?:[\\/][\w .-]+)*\.(tex|bib|bbl|sty|cls|pdf|png|jpe?g|gif|svg|eps|docx?|md|txt|csv|tsv|xlsx?|json)\b/gi,
    (_whole, extension: string) => `<file>.${extension}`,
  );

  if (options.userName && options.userName.length > 2) {
    const escaped = options.userName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "<user>");
  }
  return result;
}

/** Context fields that help locate a bug and say nothing about the person. */
const contextAllowlist = new Set([
  "reason",
  "exitCode",
  "type",
  "serviceName",
  "name",
  "source",
  "componentStack",
  "filename",
  "lineno",
  "colno",
  "url",
  "phase",
]);

export function scrubContext(
  context: Record<string, unknown> | undefined,
  options: ScrubOptions,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    if (!contextAllowlist.has(key)) continue;
    if (typeof value === "string")
      result[key] = scrubText(value, options).slice(0, 2_000);
    else if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    else if (typeof value === "boolean") result[key] = value;
  }
  return result;
}

export interface CrashReportEnvironment {
  appVersion: string;
  platform: string;
  arch: string;
  osVersion: string;
  electron: string;
  chrome: string;
  node: string;
}

/** Exactly what leaves the machine, and what the person sees before it does. */
export interface CrashReport {
  schemaVersion: 1;
  id: string;
  fingerprint: string;
  category: CrashReportCategory;
  title: string;
  kind: DiagnosticEvent["kind"];
  severity: DiagnosticEvent["severity"];
  processType: DiagnosticEvent["processType"];
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  error: { name: string; message: string; stack?: string; code?: string };
  context: Record<string, string | number | boolean>;
  environment: CrashReportEnvironment;
  /** What the person said they were doing; added when they send it. */
  note?: string;
}

export function buildCrashReport(
  event: DiagnosticEvent,
  verdict: Extract<TriageVerdict, { report: true }>,
  environment: CrashReportEnvironment,
  options: ScrubOptions & { id: string },
): CrashReport {
  const stack = event.error.stack
    ? scrubText(event.error.stack, options).split("\n").slice(0, 40).join("\n")
    : undefined;
  return {
    schemaVersion: 1,
    id: options.id,
    fingerprint: verdict.fingerprint,
    category: verdict.category,
    title: scrubText(verdict.title, options),
    kind: event.kind,
    severity: event.severity,
    processType: event.processType,
    firstSeenAt: event.recordedAt,
    lastSeenAt: event.recordedAt,
    occurrences: 1,
    error: {
      name: event.error.name.slice(0, 200),
      message: scrubText(event.error.message, options).slice(0, 2_000),
      ...(stack ? { stack } : {}),
      ...(event.error.code ? { code: event.error.code.slice(0, 120) } : {}),
    },
    context: scrubContext(event.context, options),
    environment,
  };
}

export const githubIssuesUrl = "https://github.com/latexdo/latexdo-desktop/issues/new";
// Browsers and GitHub reject very long URLs; leave room for encoding.
const maxIssueUrlLength = 7_500;

function issueBody(report: CrashReport, note: string, stackLines: number): string {
  const stack = report.error.stack?.split("\n").slice(0, stackLines).join("\n");
  const context = Object.entries(report.context)
    .filter(([key]) => key !== "componentStack")
    .map(([key, value]) => `- **${key}:** \`${String(value).slice(0, 200)}\``)
    .join("\n");
  return [
    "### What happened",
    note.trim() || "_Describe what you were doing when this happened._",
    "",
    "### Error",
    `**${report.category === "crash" ? "Crash" : "Error"}** · \`${report.kind}\` · seen ${report.occurrences}× · fingerprint \`${report.fingerprint}\``,
    "",
    "```text",
    `${report.error.name}: ${report.error.message}`.slice(0, 1_500),
    ...(stack ? [stack] : []),
    "```",
    ...(context ? ["", context] : []),
    "",
    "### Environment",
    `- **LatexDo:** ${report.environment.appVersion}`,
    `- **OS:** ${report.environment.platform} ${report.environment.osVersion} (${report.environment.arch})`,
    `- **Electron:** ${report.environment.electron} · Chrome ${report.environment.chrome}`,
    "",
    "<sub>Prepared by LatexDo's crash reporter. Personal paths, email addresses and tokens were removed.</sub>",
  ].join("\n");
}

/** A pre-filled "new issue" page on GitHub for this report. */
export function githubIssueUrl(report: CrashReport, note = ""): string {
  const prefix = report.category === "crash" ? "[Crash]" : "[Bug]";
  for (const stackLines of [25, 12, 6, 0]) {
    const url = new URL(githubIssuesUrl);
    url.searchParams.set("title", `${prefix} ${report.title}`.slice(0, 200));
    url.searchParams.set("labels", "bug,crash-report");
    url.searchParams.set("body", issueBody(report, note.slice(0, 1_500), stackLines));
    if (url.href.length <= maxIssueUrlLength || stackLines === 0) return url.href;
  }
  return githubIssuesUrl;
}
