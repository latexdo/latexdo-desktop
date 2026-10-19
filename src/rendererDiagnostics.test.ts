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

describe("freeze watcher", () => {
  function installFakeObserver() {
    let callback: ((list: { getEntries: () => PerformanceEntry[] }) => void) | null =
      null;
    const disconnect = vi.fn();
    class FakeObserver {
      static supportedEntryTypes = ["longtask"];
      constructor(cb: typeof callback) {
        callback = cb;
      }
      observe() {}
      disconnect = disconnect;
    }
    vi.stubGlobal("PerformanceObserver", FakeObserver);
    const emit = (...tasks: Array<[startTime: number, duration: number]>) =>
      callback?.({
        getEntries: () =>
          tasks.map(
            ([startTime, duration]) => ({ startTime, duration }) as PerformanceEntry,
          ),
      });
    return { emit, disconnect };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("logs only pauses people notice, at most once every 30 seconds", async () => {
    const { watchForFreezes } = await import("./rendererDiagnostics");
    const { emit, disconnect } = installFakeObserver();
    const report = vi.fn();
    const stop = watchForFreezes(report);

    emit([1_000, 120]); // too short to notice
    emit([2_000, 450], [5_000, 600]); // the second one is too soon after the first
    emit([40_000, 300]);

    expect(report.mock.calls.map(([ms]) => ms)).toEqual([450, 300]);
    expect(report.mock.calls[0][1]).toMatchObject({ durationMs: 450 });
    stop();
    expect(disconnect).toHaveBeenCalled();
  });

  it("stops after 20 reports in a session", async () => {
    const { watchForFreezes } = await import("./rendererDiagnostics");
    const { emit } = installFakeObserver();
    const report = vi.fn();
    watchForFreezes(report);
    for (let index = 0; index < 30; index += 1) emit([index * 60_000, 500]);
    expect(report).toHaveBeenCalledTimes(20);
  });
});

describe("serializeRendererError shapes", () => {
  it("fills defaults for bare errors and keeps string codes", () => {
    const bare = new Error("");
    bare.name = "";
    bare.stack = "";
    expect(serializeRendererError(bare)).toEqual({
      name: "Error",
      message: "",
      stack: undefined,
      code: undefined,
    });
    const unnamed = new Error("");
    unnamed.stack = undefined;
    expect(serializeRendererError(unnamed).message).toBe("Error");
    const coded = Object.assign(new Error("x".repeat(2_100)), { code: "ENOENT" });
    const serialized = serializeRendererError(coded);
    expect(serialized.code).toBe("ENOENT");
    expect(serialized.message).toHaveLength(2_003);
    expect(serialized.message.endsWith("...")).toBe(true);
  });

  it("reads error-like records", () => {
    expect(
      serializeRendererError({
        name: "IpcError",
        message: "lost",
        stack: "at x",
        code: "E1",
      }),
    ).toEqual({ name: "IpcError", message: "lost", stack: "at x", code: "E1" });
    expect(serializeRendererError({ name: "", detail: 3 })).toEqual({
      name: "NonError",
      message: '{"name":"","detail":3}',
      stack: undefined,
      code: undefined,
    });
  });

  it("falls back to String() for records that cannot be stringified", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(serializeRendererError(circular).message).toBe("[object Object]");
  });

  it("serializes primitives, null and arrays as NonError", () => {
    expect(serializeRendererError("plain")).toEqual({ name: "NonError", message: "plain" });
    expect(serializeRendererError(null)).toEqual({ name: "NonError", message: "null" });
    expect(serializeRendererError([1, 2])).toEqual({ name: "NonError", message: "1,2" });
  });
});

describe("reportRendererIssue without a bridge", () => {
  it("does nothing when the desktop bridge is missing", () => {
    Object.defineProperty(window, "latexdo", { configurable: true, value: undefined });
    expect(() => reportRendererIssue("renderer-error", new Error("x"))).not.toThrow();
  });

  it("swallows failures of the bridge itself", async () => {
    const mock = vi.fn().mockRejectedValue(new Error("ipc down"));
    Object.defineProperty(window, "latexdo", {
      configurable: true,
      value: { reportRendererIssue: mock },
    });
    reportRendererIssue("renderer-error", "oops");
    await Promise.resolve();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("reports the message of error events without an error object", () => {
    const mock = installLatexDoStub();
    const dispose = installRendererDiagnostics();
    try {
      window.dispatchEvent(new ErrorEvent("error", { message: "script error" }));
      expect(mock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: { name: "NonError", message: "script error" },
        }),
      );
    } finally {
      dispose();
    }
  });
});

describe("freeze watcher defaults", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("does nothing where long tasks cannot be observed", async () => {
    const { watchForFreezes } = await import("./rendererDiagnostics");
    vi.stubGlobal("PerformanceObserver", undefined);
    expect(watchForFreezes(vi.fn())()).toBeUndefined();
    vi.stubGlobal("PerformanceObserver", class {});
    expect(watchForFreezes(vi.fn())()).toBeUndefined();
  });

  it("reports freezes to the desktop bridge with what had focus", async () => {
    const { watchForFreezes } = await import("./rendererDiagnostics");
    let callback: ((list: { getEntries: () => PerformanceEntry[] }) => void) | null =
      null;
    vi.stubGlobal(
      "PerformanceObserver",
      class {
        static supportedEntryTypes = ["longtask"];
        constructor(cb: typeof callback) {
          callback = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    const mock = installLatexDoStub();
    document.body.innerHTML = `
      <div class="document-tab active"> main.tex </div>
      <div class="monaco-editor"><textarea class="inputarea monaco-mouse"></textarea></div>`;
    document.querySelector("textarea")!.focus();
    watchForFreezes();
    callback!({ getEntries: () => [{ startTime: 0, duration: 512.4 } as PerformanceEntry] });
    expect(mock).toHaveBeenCalledWith({
      kind: "renderer-freeze",
      error: expect.objectContaining({
        name: "Freeze",
        message: "The interface paused for 512 ms.",
      }),
      context: expect.objectContaining({
        durationMs: 512,
        activeTab: "main.tex",
        focus: "textarea in editor.inputarea",
      }),
    });

    document.body.innerHTML = "";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("tabindex", "0");
    document.body.appendChild(svg);
    svg.focus();
    callback!({ getEntries: () => [{ startTime: 60_000, duration: 300 } as PerformanceEntry] });
    expect(mock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ activeTab: undefined }),
      }),
    );

    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement")!;
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => null });
    try {
      callback!({
        getEntries: () => [{ startTime: 120_000, duration: 300 } as PerformanceEntry],
      });
    } finally {
      Object.defineProperty(document, "activeElement", descriptor);
      delete (document as unknown as Record<string, unknown>).activeElement;
    }
    expect(mock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ focus: undefined }),
      }),
    );
  });
});
