import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrashReport } from "../../electron/crashReportTriage";
import { CrashReportPrompt, CrashReportSettingsRow } from "./CrashReportPrompt";

const report: CrashReport = {
  schemaVersion: 1,
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  fingerprint: "0123456789abcdef",
  category: "crash",
  title: "TypeError: x is undefined",
  kind: "uncaught-exception",
  severity: "fatal",
  processType: "main",
  firstSeenAt: "2026-11-10T10:00:00.000Z",
  lastSeenAt: "2026-11-10T10:00:00.000Z",
  occurrences: 3,
  error: { name: "TypeError", message: "x is undefined" },
  context: {},
  environment: {
    appVersion: "1.0.0",
    platform: "darwin",
    arch: "arm64",
    osVersion: "25",
    electron: "38",
    chrome: "140",
    node: "22",
  },
};

let changed: (() => void) | undefined;
let api: Record<string, ReturnType<typeof vi.fn>>;
const original = window.latexdo;

beforeEach(() => {
  let pending = [report];
  api = {
    getCrashReports: vi.fn(async () => ({ mode: "ask", pending })),
    setCrashReportMode: vi.fn(async (mode: string) => ({ mode, pending })),
    sendCrashReport: vi.fn(async () => {
      pending = [];
      return { reportId: "srv", occurrences: 4, known: true };
    }),
    openCrashReportIssue: vi.fn(async () => {
      pending = [];
    }),
    dismissCrashReport: vi.fn(async () => {
      pending = [];
    }),
    onCrashReportsChanged: vi.fn((callback: () => void) => {
      changed = callback;
      return () => undefined;
    }),
  };
  window.latexdo = {
    ...original,
    runtime: "desktop",
    ...api,
  } as unknown as typeof window.latexdo;
});

afterEach(() => {
  window.latexdo = original;
  changed = undefined;
});

describe("CrashReportPrompt", () => {
  it("asks about a waiting crash and sends it with the person's note", async () => {
    render(<CrashReportPrompt />);
    expect(await screen.findByText("LatexDo crashed. Report it?")).toBeVisible();
    expect(screen.getByText("TypeError: x is undefined")).toBeVisible();
    expect(screen.getByText(/It happened 3 times/)).toBeVisible();

    fireEvent.change(screen.getByLabelText("What were you doing? (optional)"), {
      target: { value: "compiling" },
    });
    fireEvent.click(screen.getByRole("button", { name: "See exactly what is sent" }));
    expect(screen.getByLabelText("Report contents").textContent).toContain(
      '"note": "compiling"',
    );

    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByText("Thanks, the report was sent")).toBeVisible();
    expect(screen.getByText(/Others hit this too \(4 reports\)/)).toBeVisible();
    expect(api.sendCrashReport).toHaveBeenCalledWith(report.id, "compiling");
    expect(api.setCrashReportMode).not.toHaveBeenCalled();
  });

  it("can switch to sending automatically", async () => {
    render(<CrashReportPrompt />);
    fireEvent.click(await screen.findByLabelText("Send future reports automatically"));
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await screen.findByText("Thanks, the report was sent");
    expect(api.setCrashReportMode).toHaveBeenCalledWith("always");
  });

  it("opens a GitHub issue instead", async () => {
    render(<CrashReportPrompt />);
    fireEvent.click(await screen.findByRole("button", { name: "GitHub issue" }));
    await waitFor(() =>
      expect(screen.queryByText("LatexDo crashed. Report it?")).toBeNull(),
    );
    expect(api.openCrashReportIssue).toHaveBeenCalledWith(report.id, "");
  });

  it("dismisses the report", async () => {
    render(<CrashReportPrompt />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss this report" }));
    await waitFor(() =>
      expect(screen.queryByText("LatexDo crashed. Report it?")).toBeNull(),
    );
    expect(api.dismissCrashReport).toHaveBeenCalledWith(report.id);
  });

  it("explains a failed send and keeps the report", async () => {
    api.sendCrashReport.mockRejectedValueOnce(
      new Error("Error invoking remote method 'crash-reports:send': Error: offline."),
    );
    render(<CrashReportPrompt />);
    fireEvent.click(await screen.findByRole("button", { name: "Send report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not send it: offline.",
    );
    expect(screen.getByText("LatexDo crashed. Report it?")).toBeVisible();
  });

  it("shows nothing until a report waits, then appears when told", async () => {
    api.getCrashReports.mockResolvedValueOnce({ mode: "ask", pending: [] });
    render(<CrashReportPrompt />);
    await waitFor(() => expect(api.getCrashReports).toHaveBeenCalled());
    expect(screen.queryByText("LatexDo crashed. Report it?")).toBeNull();
    await act(async () => changed?.());
    expect(await screen.findByText("LatexDo crashed. Report it?")).toBeVisible();
  });
});

describe("CrashReportSettingsRow", () => {
  it("changes the reporting mode", async () => {
    render(<CrashReportSettingsRow />);
    const select = await screen.findByLabelText("Crash and bug reports");
    expect(select).toHaveValue("ask");
    fireEvent.change(select, { target: { value: "never" } });
    expect(api.setCrashReportMode).toHaveBeenCalledWith("never");
  });
});
