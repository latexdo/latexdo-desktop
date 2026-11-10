import { describe, expect, it } from "vitest";
import type { DiagnosticEvent } from "./diagnostics.js";
import {
  buildCrashReport,
  fingerprintFor,
  githubIssueUrl,
  normalizeMessage,
  scrubContext,
  scrubText,
  triageDiagnostic,
} from "./crashReportTriage.js";

const appStack = [
  "TypeError: Cannot read properties of undefined (reading 'length')",
  "    at renderOutline (latexdo://app/assets/index-3f2a1c9d.js:120:14)",
  "    at commitHook (latexdo://app/assets/vendor-a1b2c3d4.js:9:3)",
].join("\n");

function event(overrides: Partial<DiagnosticEvent> = {}): DiagnosticEvent {
  return {
    schemaVersion: 1,
    recordedAt: "2026-11-10T10:00:00.000Z",
    kind: "renderer-error",
    severity: "error",
    processType: "renderer",
    appVersion: "1.0.0",
    platform: "darwin",
    arch: "arm64",
    pid: 1,
    error: {
      name: "TypeError",
      message: "Cannot read properties of undefined (reading 'length')",
      stack: appStack,
    },
    ...overrides,
  };
}

const environment = {
  appVersion: "1.0.0",
  platform: "darwin",
  arch: "arm64",
  osVersion: "25.0.0",
  electron: "38.0.0",
  chrome: "140.0.0",
  node: "22.0.0",
};

describe("triageDiagnostic", () => {
  it("reports an error thrown in LatexDo's code", () => {
    const verdict = triageDiagnostic(event());
    expect(verdict).toMatchObject({
      report: true,
      category: "error",
      title: "TypeError: Cannot read properties of undefined (reading 'length')",
    });
  });

  it("treats uncaught main-process exceptions and React errors as crashes", () => {
    expect(
      triageDiagnostic(event({ kind: "uncaught-exception", processType: "main" })),
    ).toMatchObject({ report: true, category: "crash" });
    expect(
      triageDiagnostic(
        event({ kind: "renderer-react-error", error: { name: "Error", message: "x" } }),
      ),
    ).toMatchObject({ report: true, category: "crash" });
  });

  it.each([
    ["freezes", event({ kind: "renderer-freeze", severity: "warning" })],
    ["informational events", event({ severity: "info" })],
    ["pending updates", event({ kind: "pending-update" })],
    [
      "network failures",
      event({
        error: { name: "TypeError", message: "Failed to fetch", stack: appStack },
      }),
    ],
    [
      "offline error codes",
      event({
        error: { name: "Error", message: "boom", code: "ENOTFOUND", stack: appStack },
      }),
    ],
    [
      "a full disk",
      event({
        error: {
          name: "Error",
          message: "ENOSPC: no space left on device, write",
          stack: appStack,
        },
      }),
    ],
    [
      "aborted requests",
      event({
        error: {
          name: "AbortError",
          message: "The user aborted a request.",
          stack: appStack,
        },
      }),
    ],
    [
      "ResizeObserver warnings",
      event({
        error: {
          name: "Error",
          message: "ResizeObserver loop completed with undelivered notifications.",
        },
      }),
    ],
    [
      "Monaco cancellations",
      event({ error: { name: "Canceled", message: "Canceled", stack: appStack } }),
    ],
    [
      "thrown strings without a stack",
      event({ error: { name: "NonError", message: "oops" } }),
    ],
    [
      "browser-extension errors",
      event({
        error: {
          name: "Error",
          message: "x",
          stack: "Error: x\n    at y (chrome-extension://abc/content.js:1:1)",
        },
      }),
    ],
    [
      "killed renderers",
      event({
        kind: "renderer-process-gone",
        error: { name: "NonError", message: "killed" },
        context: { reason: "killed" },
      }),
    ],
    [
      "clean child exits",
      event({
        kind: "child-process-gone",
        error: { name: "NonError", message: "clean-exit" },
        context: { reason: "clean-exit" },
      }),
    ],
    [
      "expected E2E recoveries",
      event({
        kind: "renderer-process-gone",
        context: { reason: "crashed", expectedE2eRecovery: true },
      }),
    ],
  ])("ignores %s", (_label, input) => {
    expect(triageDiagnostic(input).report).toBe(false);
  });

  it("reports real process crashes with a readable title", () => {
    expect(
      triageDiagnostic(
        event({
          kind: "renderer-process-gone",
          severity: "fatal",
          error: { name: "NonError", message: "oom" },
          context: { reason: "oom", exitCode: 9 },
        }),
      ),
    ).toMatchObject({
      report: true,
      category: "crash",
      title: "Editor window ran out of memory",
    });
    expect(
      triageDiagnostic(
        event({
          kind: "child-process-gone",
          severity: "warning",
          error: { name: "NonError", message: "crashed" },
          context: { reason: "crashed", type: "GPU" },
        }),
      ),
    ).toMatchObject({ report: true, title: "GPU process crashed (crashed)" });
  });

  it("reports startup and load failures", () => {
    expect(
      triageDiagnostic(event({ kind: "fatal-startup", severity: "fatal" })),
    ).toMatchObject({ report: true, category: "crash" });
  });
});

describe("fingerprintFor", () => {
  it("groups repeats that differ only in numbers, values, paths and builds", () => {
    const one = fingerprintFor("renderer-error", {
      name: "Error",
      message: "Line 12 of '/Users/a/thesis.tex' failed after 300ms",
      stack: "Error\n    at compile (latexdo://app/assets/index-3f2a1c9d.js:10:4)",
    });
    const two = fingerprintFor("renderer-unhandled-rejection", {
      name: "Error",
      message: "Line 99 of '/Users/b/other.tex' failed after 12ms",
      stack: "Error\n    at compile (latexdo://app/assets/index-77aa11bb.js:88:2)",
    });
    expect(one).toBe(two);
    expect(one).toMatch(/^[0-9a-f]{16}$/);
  });

  it("separates different bugs", () => {
    const base = { name: "TypeError", message: "x is undefined" };
    expect(
      fingerprintFor("renderer-error", {
        ...base,
        stack: "E\n    at a (latexdo://app/assets/a.js:1:1)",
      }),
    ).not.toBe(
      fingerprintFor("renderer-error", {
        ...base,
        stack: "E\n    at b (latexdo://app/assets/a.js:1:1)",
      }),
    );
  });

  it("normalizes volatile parts of a message", () => {
    expect(
      normalizeMessage("Took 42 ms for id 0x1f2e3d4c5b at https://x.org/a?b=1"),
    ).toBe("Took <n> ms for id <hex> at <url>");
  });
});

describe("scrubText", () => {
  const options = { homeDir: "/Users/omar", userName: "omar" };

  it("removes home folders, project paths, documents and the user's name", () => {
    expect(
      scrubText("ENOENT: open '/Users/omar/Papers/grant/secret.tex'", options),
    ).toBe("ENOENT: open '<path>/<file>.tex'");
    expect(scrubText("Could not compile chapters/intro.tex for omar", options)).toBe(
      "Could not compile <file>.tex for <user>",
    );
    expect(scrubText(String.raw`C:\Users\Omar\Documents\paper.bib missing`)).toBe(
      "<path>/<file>.bib missing",
    );
  });

  it("keeps LatexDo's own frames so the bug can be located", () => {
    expect(
      scrubText(
        "at main (/Applications/LatexDo.app/Contents/Resources/app.asar/dist-electron/main.js:10:5)",
        options,
      ),
    ).toBe("at main (<app>/app.asar/dist-electron/main.js:10:5)");
    expect(scrubText("at r (latexdo://app/assets/index-3f2a.js:1:2)", options)).toBe(
      "at r (latexdo://app/assets/index-3f2a.js:1:2)",
    );
    expect(scrubText("at r (http://localhost:5173/src/App.tsx?t=1:1:2)", options)).toBe(
      "at r (http://localhost:5173/src/App.tsx:1:2)",
    );
  });

  it("removes emails, tokens and URL paths", () => {
    const shareToken = `p${"a".repeat(32)}_${"B".repeat(43)}`;
    const text = scrubText(
      `mail me@uni.edu key sk-ant-abcdefghijklmnopqrstu Bearer abc.def.ghijklmnop ${shareToken} at https://collab.latexdo.org/api/shares/${shareToken}?x=1`,
      options,
    );
    expect(text).toBe(
      "mail <email> key <api-key> Bearer <token> <share-token> at https://collab.latexdo.org/<redacted>",
    );
  });

  it("keeps only context that locates a bug", () => {
    expect(
      scrubContext(
        {
          reason: "oom",
          exitCode: 9,
          activeTab: "thesis.tex",
          focus: "div",
          filename: "/Users/omar/x.tex",
        },
        options,
      ),
    ).toEqual({ reason: "oom", exitCode: 9, filename: "<path>/<file>.tex" });
  });
});

describe("crash reports", () => {
  const input = event({
    error: {
      name: "TypeError",
      message: "Cannot open /Users/omar/thesis.tex",
      stack: `${appStack}\n    at load (/Users/omar/Desktop/latexdo-desktop/dist-electron/main.js:1:1)`,
    },
    context: { source: "window.error", activeTab: "thesis.tex" },
  });
  const verdict = triageDiagnostic(input);
  if (!verdict.report) throw new Error("expected a report");
  const report = buildCrashReport(input, verdict, environment, {
    id: "r1",
    homeDir: "/Users/omar",
    userName: "omar",
  });

  it("contains nothing personal", () => {
    const text = JSON.stringify(report);
    expect(text).not.toContain("omar");
    expect(text).not.toContain("thesis");
    expect(report.error.message).toBe("Cannot open <path>/<file>.tex");
    expect(report.context).toEqual({ source: "window.error" });
    expect(report.error.stack).toContain("at load (<app>/dist-electron/main.js:1:1)");
  });

  it("builds a bounded, pre-filled GitHub issue", () => {
    const url = new URL(githubIssueUrl(report, "I was opening a project"));
    expect(url.origin + url.pathname).toBe(
      "https://github.com/latexdo/latexdo-desktop/issues/new",
    );
    expect(url.searchParams.get("title")).toBe(
      "[Bug] TypeError: Cannot open <path>/<file>.tex",
    );
    expect(url.searchParams.get("body")).toContain("I was opening a project");
    expect(url.searchParams.get("body")).toContain(report.fingerprint);

    const huge = {
      ...report,
      error: { ...report.error, stack: "at x (latexdo://app/a.js:1:1)\n".repeat(400) },
    };
    expect(githubIssueUrl(huge).length).toBeLessThanOrEqual(7_500);
  });
});
