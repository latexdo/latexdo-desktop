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
});
