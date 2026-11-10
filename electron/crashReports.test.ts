import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticEvent } from "./diagnostics.js";
import { createCrashReporter, type CrashReporterOptions } from "./crashReports.js";

const environment = {
  appVersion: "1.0.0",
  platform: "darwin",
  arch: "arm64",
  osVersion: "25.0.0",
  electron: "38.0.0",
  chrome: "140.0.0",
  node: "22.0.0",
};

function bug(message = "x is undefined", fn = "render"): DiagnosticEvent {
  return {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    kind: "renderer-error",
    severity: "error",
    processType: "renderer",
    appVersion: "1.0.0",
    platform: "darwin",
    arch: "arm64",
    pid: 1,
    error: {
      name: "TypeError",
      message,
      stack: `TypeError: ${message}\n    at ${fn} (latexdo://app/assets/index-abc123.js:1:1)`,
    },
  };
}

function serverReply(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("createCrashReporter", () => {
  let dir: string;
  let onChange: ReturnType<typeof vi.fn<() => void>>;
  let openExternal: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "latexdo-crash-"));
    onChange = vi.fn<() => void>();
    openExternal = vi.fn<(url: string) => Promise<void>>(async () => undefined);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function reporter(overrides: Partial<CrashReporterOptions> = {}) {
    return createCrashReporter({
      getUserDataPath: () => dir,
      getEnvironment: () => environment,
      scrub: { homeDir: "/Users/someone" },
      serverUrl: "https://reports.example.org",
      fetch: serverReply(201, { id: "srv-1", occurrences: 3, known: true }),
      openExternal,
      onChange,
      ...overrides,
    });
  }

  it("asks about a real bug once, and counts its repeats", async () => {
    const crashes = reporter();
    await crashes.consider(bug());
    await crashes.consider(bug());
    const { mode, pending } = await crashes.settings();
    expect(mode).toBe("ask");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      occurrences: 2,
      title: "TypeError: x is undefined",
    });
    expect(onChange).toHaveBeenCalled();
  });

  it("ignores noise", async () => {
    const crashes = reporter();
    await crashes.consider({ ...bug("Failed to fetch") });
    await crashes.consider({ ...bug(), kind: "renderer-freeze", severity: "warning" });
    expect((await crashes.settings()).pending).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("sends a report with the person's note and stops asking about it", async () => {
    const fetchMock = serverReply(201, { id: "srv-1", occurrences: 3, known: true });
    const crashes = reporter({ fetch: fetchMock });
    await crashes.consider(bug());
    const [report] = (await crashes.settings()).pending;

    const result = await crashes.send(report.id, "  I was compiling  ");
    expect(result).toEqual({ reportId: "srv-1", occurrences: 3, known: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://reports.example.org/api/reports");
    const body = JSON.parse(String(init.body));
    expect(body.report).toMatchObject({ id: report.id, note: "I was compiling" });
    expect(body.reporter).toMatch(/^[0-9a-f-]{36}$/);

    await crashes.consider(bug());
    expect((await crashes.settings()).pending).toEqual([]);
  });

  it("keeps the report when sending fails", async () => {
    const crashes = reporter({ fetch: serverReply(503, { error: "Busy." }) });
    await crashes.consider(bug());
    const [report] = (await crashes.settings()).pending;
    await expect(crashes.send(report.id)).rejects.toThrow("Busy.");
    expect((await crashes.settings()).pending).toHaveLength(1);
  });

  it("opens a pre-filled GitHub issue", async () => {
    const crashes = reporter();
    await crashes.consider(bug());
    const [report] = (await crashes.settings()).pending;
    await crashes.openGithubIssue(report.id, "steps");
    expect(String(openExternal.mock.calls[0][0])).toMatch(
      /^https:\/\/github\.com\/latexdo\/latexdo-desktop\/issues\/new\?/,
    );
    expect((await crashes.settings()).pending).toEqual([]);
  });

  it("does not ask again about a dismissed problem in the same version", async () => {
    const crashes = reporter();
    await crashes.consider(bug());
    const [report] = (await crashes.settings()).pending;
    await crashes.dismiss(report.id);
    await crashes.consider(bug());
    expect((await crashes.settings()).pending).toEqual([]);

    const upgraded = reporter({
      getEnvironment: () => ({ ...environment, appVersion: "1.1.0" }),
    });
    await upgraded.consider(bug());
    expect((await upgraded.settings()).pending).toHaveLength(1);
  });

  it("offers a crash that closed the app on the next start", async () => {
    reporter().considerSync({
      ...bug(),
      kind: "uncaught-exception",
      processType: "main",
    });
    const saved = JSON.parse(
      await readFile(path.join(dir, "crash-reports", "state.json"), "utf8"),
    );
    expect(saved.pending).toHaveLength(1);
    const next = reporter();
    expect((await next.settings()).pending[0]).toMatchObject({ category: "crash" });
  });

  it("sends automatically when asked to, and never when told not to", async () => {
    const fetchMock = serverReply(201, { id: "srv" });
    const crashes = reporter({ fetch: fetchMock });
    await crashes.setMode("always");
    await crashes.consider(bug());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await crashes.setMode("never");
    await crashes.consider(bug("another", "other"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await crashes.settings()).toEqual({ mode: "never", pending: [] });
  });

  it("limits how many new problems it asks about in one session", async () => {
    const crashes = reporter();
    for (let index = 0; index < 8; index += 1) {
      await crashes.consider(
        bug(`problem ${"abcdefgh"[index]}`, `fn${"abcdefgh"[index]}`),
      );
    }
    expect((await crashes.settings()).pending).toHaveLength(5);
  });
});

// Against a running report server (collaborations/reports: npm run dev):
// LATEXDO_E2E_REPORTS_URL=http://localhost:8791 npx vitest run electron/crashReports.test.ts
describe.runIf(process.env.LATEXDO_E2E_REPORTS_URL)("against the report server", () => {
  it("delivers a scrubbed report the server accepts and groups", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "latexdo-crash-e2e-"));
    try {
      const make = () =>
        createCrashReporter({
          getUserDataPath: () => dir,
          getEnvironment: () => environment,
          scrub: { homeDir: os.homedir() },
          serverUrl: process.env.LATEXDO_E2E_REPORTS_URL!,
          openExternal: async () => undefined,
        });
      const unique = `${Date.now()}`.replace(
        /\d/g,
        (digit) => "abcdefghij"[Number(digit)],
      );
      const crashes = make();
      await crashes.consider(bug(`e2e problem ${unique}`, `e2e_${unique}`));
      const [report] = (await crashes.settings()).pending;
      const first = await crashes.send(report.id, "end-to-end check");
      expect(first).toMatchObject({ known: false, occurrences: 1 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
