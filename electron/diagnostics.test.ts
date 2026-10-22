import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDiagnosticReporter,
  rendererFailureDataUrl,
  rendererFailureHtml,
  rendererGoneMessage,
  serializeError,
} from "./diagnostics.js";

async function withTempDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-diagnostics-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("main-process diagnostics", () => {
  it("writes bounded JSONL diagnostic events", async () => {
    await withTempDirectory(async (directory) => {
      const reporter = createDiagnosticReporter({
        getUserDataPath: () => directory,
        getAppVersion: () => "1.2.3",
        processType: "main",
      });

      await reporter.record("fatal-startup", "fatal", new Error("boom"), {
        path: "x".repeat(3000),
      });

      const lines = (await readFile(reporter.logPath(), "utf8")).trim().split("\n");
      expect(lines).toHaveLength(1);
      const event = JSON.parse(lines[0]) as {
        schemaVersion: number;
        appVersion: string;
        kind: string;
        severity: string;
        processType: string;
        error: { name: string; message: string; stack?: string };
        context: { path: string };
      };
      expect(event).toMatchObject({
        schemaVersion: 1,
        appVersion: "1.2.3",
        kind: "fatal-startup",
        severity: "fatal",
        processType: "main",
        error: {
          name: "Error",
          message: "boom",
        },
      });
      expect(event.error.stack).toContain("Error: boom");
      expect(event.context.path).toHaveLength(2003);
    });
  });

  it("serializes non-Error rejection reasons without throwing", () => {
    const circular: Record<string, unknown> = { message: "renderer rejected" };
    circular.self = circular;

    expect(serializeError(circular)).toEqual({
      name: "NonError",
      message: "renderer rejected",
      stack: undefined,
      code: undefined,
    });
  });

  it("renders escaped fallback HTML for renderer load failures", () => {
    const html = rendererFailureHtml({
      productName: "LatexDo",
      title: "Could not load <editor>",
      message: "Install is damaged & blocked.",
      detail: "latexdo://app/<missing>",
    });

    expect(html).toContain("Could not load &lt;editor&gt;");
    expect(html).toContain("Install is damaged &amp; blocked.");
    expect(html).toContain("latexdo://app/&lt;missing&gt;");
    expect(
      rendererFailureDataUrl({ productName: "LatexDo", title: "A", message: "B" }),
    ).toMatch(/^data:text\/html;charset=utf-8,/);
  });

  it("summarizes renderer process exits for recovery UI", () => {
    expect(rendererGoneMessage({ reason: "oom", exitCode: 9 })).toMatch(
      /out of memory/i,
    );
    expect(rendererGoneMessage({ reason: "crashed", exitCode: 5 })).toMatch(/crashed/i);
    expect(rendererGoneMessage({ reason: "clean-exit", exitCode: 0 })).toContain(
      "clean-exit",
    );
  });

  it("writes events synchronously for crash paths and sanitizes nested context", async () => {
    await withTempDirectory(async (directory) => {
      const reporter = createDiagnosticReporter({
        getUserDataPath: () => path.join(directory, "user"),
        getAppVersion: () => "9.9.9",
        processType: "renderer",
      });
      const context: Record<string, unknown> = {
        nothing: null,
        count: 3,
        flag: false,
        missing: undefined,
        list: Array.from({ length: 30 }, (_, i) => i),
        nested: { deep: { value: "ok" } },
        when: new Date("2026-01-01T00:00:00.000Z"),
        fn: Symbol("s"),
      };
      for (let i = 0; i < 60; i += 1) context[`extra${i}`] = i;
      context[`k${"y".repeat(200)}`] = "long key";
      reporter.recordSync("renderer-error", "error", "plain failure", context);
      reporter.recordSync("renderer-freeze", "warning", new Error("again"));

      const lines = (await readFile(reporter.logPath(), "utf8")).trim().split("\n");
      expect(lines).toHaveLength(2);
      const first = JSON.parse(lines[0]);
      expect(first).toMatchObject({
        kind: "renderer-error",
        processType: "renderer",
        appVersion: "9.9.9",
        error: { name: "NonError", message: "plain failure" },
      });
      expect(first.context).toMatchObject({
        nothing: null,
        count: 3,
        flag: false,
        nested: { deep: { value: "ok" } },
        when: {},
        fn: "Symbol(s)",
      });
      expect(first.context.list).toHaveLength(25);
      // 50 entries are kept; JSON drops the undefined one.
      expect(Object.keys(first.context)).toHaveLength(49);
      expect(JSON.parse(lines[1]).context).toBeUndefined();
    });
  });
});

describe("serializeError", () => {
  it("keeps error codes, fills in blank names and messages and truncates", () => {
    const coded = Object.assign(new Error("x".repeat(2100)), { code: "ENOENT" });
    const serialized = serializeError(coded);
    expect(serialized.code).toBe("ENOENT");
    expect(serialized.message).toHaveLength(2003);

    const blank = new Error("");
    blank.name = "";
    blank.stack = undefined;
    expect(serializeError(blank)).toEqual({
      name: "Error",
      message: "",
      stack: undefined,
      code: undefined,
    });
  });

  it("reads name, message, stack and code from error-like objects", () => {
    expect(
      serializeError({ name: "IpcError", message: "bad", stack: "at x", code: "E1" }),
    ).toEqual({ name: "IpcError", message: "bad", stack: "at x", code: "E1" });
  });

  it("serializes objects without a message as JSON, or as a string when JSON fails", () => {
    expect(serializeError({ status: 500 }).message).toBe('{"status":500}');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(serializeError(circular)).toMatchObject({
      name: "NonError",
      message: "[object Object]",
    });
  });

  it("stringifies primitives", () => {
    expect(serializeError(42)).toEqual({ name: "NonError", message: "42" });
    expect(serializeError(undefined)).toEqual({
      name: "NonError",
      message: "undefined",
    });
  });
});

describe("renderer failure helpers", () => {
  it("escapes quotes and apostrophes and omits an empty detail", () => {
    const html = rendererFailureHtml({
      productName: "Latex\"Do'",
      title: "t",
      message: "m",
    });
    expect(html).toContain("Latex&quot;Do&#39; Recovery");
    expect(html).not.toContain('class="detail"');
  });

  it.each([
    ["killed", /terminated/],
    ["launch-failed", /failed to start/],
  ])("explains %s", (reason, expected) => {
    expect(rendererGoneMessage({ reason, exitCode: 1 } as never)).toMatch(expected);
  });
});
