/*
 * The window's side of the crash reporter: list what is waiting, send it,
 * open a GitHub issue, dismiss it, or change whether LatexDo asks.
 */

import os from "node:os";
import type { CrashReportEnvironment, ScrubOptions } from "./crashReportTriage.js";
import type { CrashReporter, CrashReportMode } from "./crashReports.js";
import { ipcMain } from "./trustedIpc.js";

export const crashReportsChangedChannel = "crash-reports:changed";

export const defaultCrashReportServerUrl = "https://reports.latexdo.org";

export function crashReportServerUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.LATEXDO_REPORTS_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (
        url.protocol === "https:" ||
        (url.protocol === "http:" && /^(?:localhost|127\.0\.0\.1)$/.test(url.hostname))
      ) {
        return url.origin;
      }
    } catch {
      // Fall back to the hosted server.
    }
  }
  return defaultCrashReportServerUrl;
}

export function crashReportEnvironment(appVersion: string): CrashReportEnvironment {
  return {
    appVersion,
    platform: process.platform,
    arch: process.arch,
    osVersion: os.release(),
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node,
  };
}

export function crashReportScrubOptions(): ScrubOptions {
  let userName: string | undefined;
  try {
    userName = os.userInfo().username;
  } catch {
    userName = process.env.USER || process.env.USERNAME || undefined;
  }
  return { homeDir: os.homedir(), userName };
}

function invalid(channel: string): never {
  throw new Error(`Invalid IPC input for ${channel}.`);
}

function args(channel: string, raw: unknown[], min: number, max: number): unknown[] {
  if (raw.length < min || raw.length > max) invalid(channel);
  return raw;
}

function reportId(channel: string, value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/.test(value)) invalid(channel);
  return value;
}

function note(channel: string, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > 4_000 || value.includes("\0")) {
    invalid(channel);
  }
  return value;
}

function mode(channel: string, value: unknown): CrashReportMode {
  if (value !== "ask" && value !== "always" && value !== "never") invalid(channel);
  return value;
}

export function registerCrashReportIpc(reporter: CrashReporter): void {
  ipcMain.handle("crash-reports:settings", async (_event, ...raw: unknown[]) => {
    args("crash-reports:settings", raw, 0, 0);
    return reporter.settings();
  });
  ipcMain.handle("crash-reports:set-mode", async (_event, ...raw: unknown[]) => {
    const channel = "crash-reports:set-mode";
    const [value] = args(channel, raw, 1, 1);
    return reporter.setMode(mode(channel, value));
  });
  ipcMain.handle("crash-reports:send", async (_event, ...raw: unknown[]) => {
    const channel = "crash-reports:send";
    const [id, text] = args(channel, raw, 1, 2);
    return reporter.send(reportId(channel, id), note(channel, text));
  });
  ipcMain.handle("crash-reports:open-github", async (_event, ...raw: unknown[]) => {
    const channel = "crash-reports:open-github";
    const [id, text] = args(channel, raw, 1, 2);
    await reporter.openGithubIssue(reportId(channel, id), note(channel, text));
  });
  ipcMain.handle("crash-reports:dismiss", async (_event, ...raw: unknown[]) => {
    const channel = "crash-reports:dismiss";
    const [id] = args(channel, raw, 1, 1);
    await reporter.dismiss(reportId(channel, id));
  });
}
