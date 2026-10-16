import { appendFileSync, mkdirSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { RenderProcessGoneDetails } from "electron";

export type DiagnosticSeverity = "info" | "warning" | "error" | "fatal";

export type DiagnosticProcessType = "main" | "renderer";

export type DiagnosticKind =
  | "fatal-startup"
  | "uncaught-exception"
  | "unhandled-rejection"
  | "renderer-load-failure"
  | "renderer-process-gone"
  | "renderer-unresponsive"
  | "child-process-gone"
  | "renderer-error"
  | "renderer-unhandled-rejection"
  | "renderer-react-error"
  | "pending-update";

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
}

export interface DiagnosticEvent {
  schemaVersion: 1;
  recordedAt: string;
  kind: DiagnosticKind;
  severity: DiagnosticSeverity;
  processType: DiagnosticProcessType;
  appVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  pid: number;
  error: SerializedError;
  context?: Record<string, unknown>;
}

export interface DiagnosticReporter {
  logPath: () => string;
  record: (
    kind: DiagnosticKind,
    severity: DiagnosticSeverity,
    error: unknown,
    context?: Record<string, unknown>,
  ) => Promise<void>;
  recordSync: (
    kind: DiagnosticKind,
    severity: DiagnosticSeverity,
    error: unknown,
    context?: Record<string, unknown>,
  ) => void;
}

interface DiagnosticReporterOptions {
  getUserDataPath: () => string;
  getAppVersion: () => string;
  processType: DiagnosticProcessType;
}

const maxMessageLength = 2_000;
const maxStackLength = 12_000;
const maxContextStringLength = 2_000;

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringProperty(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const property = value[key];
  return typeof property === "string" && property ? property : undefined;
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const codedError = error as NodeJS.ErrnoException;
    return {
      name: truncate(error.name || "Error", 200),
      message: truncate(error.message || String(error), maxMessageLength),
      stack: error.stack ? truncate(error.stack, maxStackLength) : undefined,
      code:
        typeof codedError.code === "string"
          ? truncate(codedError.code, 120)
          : undefined,
    };
  }

  if (isRecord(error)) {
    const name = stringProperty(error, "name") ?? "NonError";
    const message =
      stringProperty(error, "message") ??
      (() => {
        try {
          return JSON.stringify(error);
        } catch {
          return String(error);
        }
      })();
    return {
      name: truncate(name, 200),
      message: truncate(message, maxMessageLength),
      stack: stringProperty(error, "stack")
        ? truncate(stringProperty(error, "stack")!, maxStackLength)
        : undefined,
      code: stringProperty(error, "code")
        ? truncate(stringProperty(error, "code")!, 120)
        : undefined,
    };
  }

  return {
    name: "NonError",
    message: truncate(String(error), maxMessageLength),
  };
}

function sanitizeContextValue(value: unknown): unknown {
  if (typeof value === "string") {
    return truncate(value, maxContextStringLength);
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 25).map(sanitizeContextValue);
  }
  if (isRecord(value)) {
    return sanitizeContext(value);
  }
  return truncate(String(value), maxContextStringLength);
}

function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(context)
      .slice(0, 50)
      .map(([key, value]) => [truncate(key, 120), sanitizeContextValue(value)]),
  );
}

function diagnosticLogPath(userDataPath: string): string {
  return path.join(userDataPath, "diagnostics", "runtime.jsonl");
}

function createDiagnosticEvent(
  options: DiagnosticReporterOptions,
  kind: DiagnosticKind,
  severity: DiagnosticSeverity,
  error: unknown,
  context?: Record<string, unknown>,
): DiagnosticEvent {
  return {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    kind,
    severity,
    processType: options.processType,
    appVersion: options.getAppVersion(),
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    error: serializeError(error),
    context: context ? sanitizeContext(context) : undefined,
  };
}

export function createDiagnosticReporter(
  options: DiagnosticReporterOptions,
): DiagnosticReporter {
  const logPath = () => diagnosticLogPath(options.getUserDataPath());

  return {
    logPath,
    async record(kind, severity, error, context) {
      const filePath = logPath();
      await mkdir(path.dirname(filePath), { recursive: true });
      await appendFile(
        filePath,
        `${JSON.stringify(createDiagnosticEvent(options, kind, severity, error, context))}\n`,
        "utf8",
      );
    },
    recordSync(kind, severity, error, context) {
      const filePath = logPath();
      mkdirSync(path.dirname(filePath), { recursive: true });
      appendFileSync(
        filePath,
        `${JSON.stringify(createDiagnosticEvent(options, kind, severity, error, context))}\n`,
        "utf8",
      );
    },
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function rendererFailureHtml(options: {
  productName: string;
  title: string;
  message: string;
  detail?: string;
}): string {
  const detail = options.detail
    ? `<p class="detail">${escapeHtml(options.detail)}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.productName)} Recovery</title>
    <style>
      :root {
        color-scheme: dark;
        background: #111318;
        color: #eef2f8;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
          sans-serif;
      }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
      }
      main {
        width: min(640px, calc(100vw - 48px));
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
        line-height: 1.2;
        font-weight: 700;
      }
      p {
        margin: 0 0 12px;
        color: #c8d0dd;
        font-size: 15px;
        line-height: 1.55;
      }
      .detail {
        padding-top: 8px;
        color: #9ea8b8;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
          "Liberation Mono", monospace;
        overflow-wrap: anywhere;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(options.title)}</h1>
      <p>${escapeHtml(options.message)}</p>
      ${detail}
    </main>
  </body>
</html>`;
}

export function rendererFailureDataUrl(options: {
  productName: string;
  title: string;
  message: string;
  detail?: string;
}): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    rendererFailureHtml(options),
  )}`;
}

export function rendererGoneMessage(details: RenderProcessGoneDetails): string {
  if (details.reason === "oom") {
    return "The editor renderer ran out of memory. Reload the window to recover the editing session.";
  }
  if (details.reason === "crashed") {
    return "The editor renderer crashed. Reload the window to recover the editing session.";
  }
  if (details.reason === "killed") {
    return "The editor renderer was terminated. Reload the window to continue.";
  }
  if (details.reason === "launch-failed") {
    return "The editor renderer failed to start. Restart the app if reloading does not recover it.";
  }
  return `The editor renderer stopped unexpectedly (${details.reason}). Reload the window to continue.`;
}
