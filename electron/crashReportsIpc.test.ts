import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
vi.mock("./trustedIpc.js", () => ({
  ipcMain: {
    handle: (
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => unknown,
    ) => handlers.set(channel, listener),
  },
}));

const {
  crashReportEnvironment,
  crashReportScrubOptions,
  crashReportServerUrl,
  defaultCrashReportServerUrl,
  registerCrashReportIpc,
} = await import("./crashReportsIpc.js");

const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function call(channel: string, ...args: unknown[]) {
  return Promise.resolve().then(() => handlers.get(channel)!({}, ...args));
}

describe("crash report IPC", () => {
  const reporter = {
    consider: vi.fn(),
    considerSync: vi.fn(),
    settings: vi.fn(async () => ({ mode: "ask", pending: [] })),
    setMode: vi.fn(async (mode: string) => ({ mode, pending: [] })),
    send: vi.fn(async () => ({ reportId: "r", occurrences: 1, known: false })),
    openGithubIssue: vi.fn(async () => undefined),
    dismiss: vi.fn(async () => undefined),
    flushAutomatic: vi.fn(),
  };

  beforeEach(() => {
    handlers.clear();
    registerCrashReportIpc(reporter as never);
  });

  it("forwards valid calls to the reporter", async () => {
    await expect(call("crash-reports:settings")).resolves.toEqual({
      mode: "ask",
      pending: [],
    });
    await call("crash-reports:set-mode", "always");
    expect(reporter.setMode).toHaveBeenCalledWith("always");
    await call("crash-reports:send", id, "note");
    expect(reporter.send).toHaveBeenCalledWith(id, "note");
    await call("crash-reports:send", id);
    expect(reporter.send).toHaveBeenLastCalledWith(id, undefined);
    await call("crash-reports:open-github", id, null);
    expect(reporter.openGithubIssue).toHaveBeenCalledWith(id, undefined);
    await call("crash-reports:dismiss", id);
    expect(reporter.dismiss).toHaveBeenCalledWith(id);
  });

  it.each([
    ["crash-reports:settings", ["extra"]],
    ["crash-reports:set-mode", ["sometimes"]],
    ["crash-reports:send", ["not-an-id"]],
    ["crash-reports:send", [id, "x".repeat(4_001)]],
    ["crash-reports:send", [id, "a\0b"]],
    ["crash-reports:send", [id, 5]],
    ["crash-reports:open-github", []],
    ["crash-reports:dismiss", [id, "extra"]],
  ])("rejects invalid input to %s", async (channel, args) => {
    await expect(call(channel, ...args)).rejects.toThrow("Invalid IPC input");
  });
});

describe("crash report configuration", () => {
  it("uses the hosted server unless a safe one is configured", () => {
    expect(crashReportServerUrl({})).toBe(defaultCrashReportServerUrl);
    expect(
      crashReportServerUrl({ LATEXDO_REPORTS_URL: "https://r.example.org/x" }),
    ).toBe("https://r.example.org");
    expect(crashReportServerUrl({ LATEXDO_REPORTS_URL: "http://localhost:8791" })).toBe(
      "http://localhost:8791",
    );
    expect(
      crashReportServerUrl({ LATEXDO_REPORTS_URL: "http://evil.example.org" }),
    ).toBe(defaultCrashReportServerUrl);
    expect(crashReportServerUrl({ LATEXDO_REPORTS_URL: "not a url" })).toBe(
      defaultCrashReportServerUrl,
    );
  });

  it("describes the environment and what to scrub", () => {
    expect(crashReportEnvironment("2.0.0")).toMatchObject({
      appVersion: "2.0.0",
      platform: process.platform,
      node: process.versions.node,
    });
    const scrub = crashReportScrubOptions();
    expect(scrub.homeDir).toBeTruthy();
  });
});
