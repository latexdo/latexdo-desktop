import type { RendererDiagnosticPayload } from "../electron/types";

type RendererDiagnosticKind = RendererDiagnosticPayload["kind"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function stringProperty(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const property = value[key];
  return typeof property === "string" && property ? property : undefined;
}

function stringifyUnknown(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function serializeRendererError(
  error: unknown,
): RendererDiagnosticPayload["error"] {
  if (error instanceof Error) {
    const codedError = error as Error & { code?: unknown };
    return {
      name: truncate(error.name || "Error", 200),
      message: truncate(error.message || String(error), 2_000),
      stack: error.stack ? truncate(error.stack, 12_000) : undefined,
      code:
        typeof codedError.code === "string"
          ? truncate(codedError.code, 120)
          : undefined,
    };
  }

  if (isRecord(error)) {
    return {
      name: truncate(stringProperty(error, "name") ?? "NonError", 200),
      message: truncate(
        stringProperty(error, "message") ?? stringifyUnknown(error),
        2_000,
      ),
      stack: stringProperty(error, "stack")
        ? truncate(stringProperty(error, "stack")!, 12_000)
        : undefined,
      code: stringProperty(error, "code")
        ? truncate(stringProperty(error, "code")!, 120)
        : undefined,
    };
  }

  return {
    name: "NonError",
    message: truncate(String(error), 2_000),
  };
}

export function reportRendererIssue(
  kind: RendererDiagnosticKind,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  const api = window.latexdo as
    | (typeof window.latexdo & {
        reportRendererIssue?: (payload: RendererDiagnosticPayload) => Promise<void>;
      })
    | undefined;

  if (typeof api?.reportRendererIssue !== "function") {
    return;
  }

  void api
    .reportRendererIssue({
      kind,
      error: serializeRendererError(error),
      context,
    })
    .catch(() => {
      // Diagnostics are best-effort. Never create a secondary renderer failure
      // while reporting the original one.
    });
}

/** A pause people notice: anything shorter is not logged. */
export const noticeableFreezeMs = 200;
const freezeReportIntervalMs = 30_000;
const maxFreezeReportsPerSession = 20;

/** What the person was looking at, to tell which part of the app froze. */
function freezeContext(durationMs: number): Record<string, unknown> {
  const focused = document.activeElement;
  return {
    durationMs: Math.round(durationMs),
    sinceStartMs: Math.round(performance.now()),
    activeTab: document
      .querySelector(".document-tab.active")
      ?.textContent?.trim()
      .slice(0, 80),
    focus: focused
      ? `${focused.tagName.toLowerCase()}${
          focused.closest(".monaco-editor") ? " in editor" : ""
        }${focused.className && typeof focused.className === "string" ? `.${focused.className.split(" ")[0]}` : ""}`
      : undefined,
    hidden: document.hidden,
  };
}

/**
 * Logs pauses of the interface long enough to notice, with what was on
 * screen, to the diagnostics log. Nothing is shown to the person.
 */
export function watchForFreezes(
  report: (durationMs: number, context: Record<string, unknown>) => void = (
    durationMs,
    context,
  ) =>
    reportRendererIssue(
      "renderer-freeze",
      {
        name: "Freeze",
        message: `The interface paused for ${Math.round(durationMs)} ms.`,
      },
      context,
    ),
): () => void {
  if (
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes?.includes("longtask")
  ) {
    return () => undefined;
  }
  let reported = 0;
  let lastReportAt = -Infinity;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration < noticeableFreezeMs) continue;
      if (reported >= maxFreezeReportsPerSession) return;
      if (entry.startTime - lastReportAt < freezeReportIntervalMs) continue;
      reported += 1;
      lastReportAt = entry.startTime;
      report(entry.duration, freezeContext(entry.duration));
    }
  });
  observer.observe({ type: "longtask" });
  return () => observer.disconnect();
}

export function installRendererDiagnostics(): () => void {
  const handleError = (event: ErrorEvent) => {
    reportRendererIssue("renderer-error", event.error ?? event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      source: "window.error",
    });
  };

  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    reportRendererIssue("renderer-unhandled-rejection", event.reason, {
      source: "window.unhandledrejection",
    });
  };

  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleUnhandledRejection);
  const stopWatchingFreezes = watchForFreezes();

  return () => {
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    stopWatchingFreezes();
  };
}
