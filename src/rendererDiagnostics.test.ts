import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installRendererDiagnostics,
  reportRendererIssue,
  serializeRendererError,
} from "./rendererDiagnostics";

const originalLatexDo = window.latexdo;

function installLatexDoStub() {
  const reportRendererIssueMock = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, "latexdo", {
    configurable: true,
    value: {
      reportRendererIssue: reportRendererIssueMock,
    },
  });
  return reportRendererIssueMock;
}

afterEach(() => {
  Object.defineProperty(window, "latexdo", {
    configurable: true,
    value: originalLatexDo,
  });
  vi.restoreAllMocks();
});

describe("renderer diagnostics", () => {
  it("serializes Error objects for IPC", () => {
    const error = new Error("renderer failed");
    expect(serializeRendererError(error)).toMatchObject({
      name: "Error",
      message: "renderer failed",
    });
  });

  it("reports renderer issues through the desktop bridge", () => {
    const reportRendererIssueMock = installLatexDoStub();

    reportRendererIssue("renderer-error", new Error("boom"), {
      source: "test",
    });

    expect(reportRendererIssueMock).toHaveBeenCalledWith({
      kind: "renderer-error",
      error: expect.objectContaining({
        name: "Error",
        message: "boom",
      }),
      context: {
        source: "test",
      },
    });
  });

  it("captures window error and unhandled rejection events", () => {
    const reportRendererIssueMock = installLatexDoStub();
    const dispose = installRendererDiagnostics();

    try {
      window.dispatchEvent(
        new ErrorEvent("error", {
          error: new Error("window boom"),
          filename: "main.js",
          lineno: 4,
          colno: 2,
          message: "window boom",
        }),
      );

      const rejection = new Event("unhandledrejection") as PromiseRejectionEvent;
      Object.defineProperty(rejection, "reason", {
        value: new Error("promise boom"),
      });
      window.dispatchEvent(rejection);

      expect(reportRendererIssueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "renderer-error",
          error: expect.objectContaining({ message: "window boom" }),
        }),
      );
      expect(reportRendererIssueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "renderer-unhandled-rejection",
          error: expect.objectContaining({ message: "promise boom" }),
        }),
      );
    } finally {
      dispose();
    }
  });
});
