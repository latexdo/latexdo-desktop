/*
 * What a crash report may contain. The app already scrubs and triages each
 * report (electron/crashReportTriage.ts); the server checks the shape again,
 * strips anything personal that slipped through, and refuses noise, so a
 * modified or buggy client cannot fill the store with junk.
 */

export class ReportError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export const reportLimits = {
  maxBodyBytes: 64 * 1024,
  maxStackChars: 12_000,
  maxMessageChars: 2_000,
  maxNoteChars: 2_000,
  maxContextKeys: 20,
  /** Samples kept per problem; the counts keep going up past this. */
  samplesPerIssue: 20,
  maxReports: 20_000,
  reportLifetimeMs: 180 * 24 * 60 * 60 * 1000,
  issueLifetimeMs: 365 * 24 * 60 * 60 * 1000,
} as const;

const kinds = new Set([
  "fatal-startup",
  "uncaught-exception",
  "unhandled-rejection",
  "renderer-load-failure",
  "renderer-process-gone",
  "child-process-gone",
  "renderer-error",
  "renderer-unhandled-rejection",
  "renderer-react-error",
]);
const severities = new Set(["warning", "error", "fatal"]);
const categories = new Set(["crash", "error"]);
const processTypes = new Set(["main", "renderer"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Not bugs: the person was offline, the disk was full, a request was cancelled. */
const noisePattern =
  /\b(?:ResizeObserver loop|Failed to fetch|fetch failed|NetworkError|net::ERR_[A-Z_]+|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ENOSPC|socket hang up|The user aborted a request)\b|^Script error\.?$/i;

export interface StoredReport {
  schemaVersion: 1;
  id: string;
  fingerprint: string;
  category: "crash" | "error";
  title: string;
  kind: string;
  severity: string;
  processType: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  error: { name: string; message: string; stack?: string; code?: string };
  context: Record<string, string | number | boolean>;
  environment: {
    appVersion: string;
    platform: string;
    arch: string;
    osVersion: string;
    electron: string;
    chrome: string;
    node: string;
  };
  note?: string;
}

export interface Submission {
  report: StoredReport;
  reporter: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bad(field: string): never {
  throw new ReportError(400, `Invalid crash report: ${field}.`, "invalid");
}

/** Second line of defence: the client should already have removed all of this. */
export function redact(text: string): string {
  return text
    .replace(/\bp[0-9a-f]{32}_[A-Za-z0-9_-]{43}\b/g, "<share-token>")
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, "<api-key>")
    .replace(/\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/g, "<token>")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 <token>")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(/\/(?:Users|home)\/[^/\s'"`)]+/g, "~")
    .replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s'"`)]+/gi, "~");
}

function text(
  value: unknown,
  field: string,
  max: number,
  { optional = false, allowEmpty = false } = {},
): string | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    bad(field);
  if (!allowEmpty && !value.trim()) bad(field);
  return redact(value);
}

function oneOf(value: unknown, field: string, allowed: Set<string>): string {
  if (typeof value !== "string" || !allowed.has(value)) bad(field);
  return value;
}

function isoDate(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    Number.isNaN(Date.parse(value))
  ) {
    bad(field);
  }
  return new Date(value).toISOString();
}

export function parseSubmission(body: unknown): Submission {
  if (!isRecord(body) || !isRecord(body.report)) bad("body");
  const raw = body.report;
  if (raw.schemaVersion !== 1) bad("schemaVersion");
  if (typeof raw.id !== "string" || !uuidPattern.test(raw.id)) bad("id");
  if (
    typeof raw.fingerprint !== "string" ||
    !/^[0-9a-f]{16,64}$/.test(raw.fingerprint)
  ) {
    bad("fingerprint");
  }
  if (typeof body.reporter !== "string" || !uuidPattern.test(body.reporter))
    bad("reporter");
  if (
    typeof raw.occurrences !== "number" ||
    !Number.isInteger(raw.occurrences) ||
    raw.occurrences < 1 ||
    raw.occurrences > 1_000_000
  ) {
    bad("occurrences");
  }

  if (!isRecord(raw.error)) bad("error");
  const error = {
    name: text(raw.error.name, "error.name", 200)!,
    message: text(raw.error.message, "error.message", reportLimits.maxMessageChars, {
      allowEmpty: true,
    })!,
    stack: text(raw.error.stack, "error.stack", reportLimits.maxStackChars, {
      optional: true,
      allowEmpty: true,
    }),
    code: text(raw.error.code, "error.code", 120, { optional: true }),
  };
  if (
    noisePattern.test(`${error.name}: ${error.message}`) ||
    noisePattern.test(error.message)
  ) {
    throw new ReportError(
      422,
      "This looks like a network or system problem, not a LatexDo bug.",
      "ignored",
    );
  }

  if (!isRecord(raw.context)) bad("context");
  const entries = Object.entries(raw.context);
  if (entries.length > reportLimits.maxContextKeys) bad("context");
  const context: Record<string, string | number | boolean> = {};
  for (const [key, value] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) bad("context");
    if (typeof value === "string")
      context[key] = text(value, "context", 2_000, { allowEmpty: true })!;
    else if (typeof value === "boolean") context[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) context[key] = value;
    else bad("context");
  }

  if (!isRecord(raw.environment)) bad("environment");
  const env = raw.environment;
  const environment = {
    appVersion: text(env.appVersion, "environment.appVersion", 40)!,
    platform: text(env.platform, "environment.platform", 40)!,
    arch: text(env.arch, "environment.arch", 40)!,
    osVersion: text(env.osVersion, "environment.osVersion", 80, { allowEmpty: true })!,
    electron: text(env.electron, "environment.electron", 40, { allowEmpty: true })!,
    chrome: text(env.chrome, "environment.chrome", 40, { allowEmpty: true })!,
    node: text(env.node, "environment.node", 40, { allowEmpty: true })!,
  };

  const stack = error.stack;
  const note = text(raw.note, "note", reportLimits.maxNoteChars, { optional: true });
  const report: StoredReport = {
    schemaVersion: 1,
    id: raw.id,
    fingerprint: raw.fingerprint,
    category: oneOf(raw.category, "category", categories) as StoredReport["category"],
    title: text(raw.title, "title", 200)!,
    kind: oneOf(raw.kind, "kind", kinds),
    severity: oneOf(raw.severity, "severity", severities),
    processType: oneOf(raw.processType, "processType", processTypes),
    firstSeenAt: isoDate(raw.firstSeenAt, "firstSeenAt"),
    lastSeenAt: isoDate(raw.lastSeenAt, "lastSeenAt"),
    occurrences: raw.occurrences,
    error: {
      name: error.name,
      message: error.message,
      ...(stack ? { stack } : {}),
      ...(error.code ? { code: error.code } : {}),
    },
    context,
    environment,
    ...(note?.trim() ? { note: note.trim() } : {}),
  };
  return { report, reporter: body.reporter };
}

/** "1.10.2" > "1.9.0"; pre-release tags are ignored. */
export function compareVersions(left: string, right: string): number {
  const parts = (value: string) =>
    value
      .replace(/^v/, "")
      .split(/[-+]/)[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}
