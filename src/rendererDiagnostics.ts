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

  return () => {
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleUnhandledRejection);
  };
}
