import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { defaultSettings, supportLatexDoUrl } from "../../features/settings/settings";
import type { AppCtx } from "../appContext";
import {
  renderSettingsFooter,
  renderSettingsSectionHeading11,
  renderSettingsSectionHeading12,
} from "./settingsAboutView";
import {
  renderSettingsSectionHeading10,
  renderSettingsSectionHeading3,
  renderSettingsSectionHeading4,
  renderSettingsSectionHeading5,
  renderSettingsSectionHeading6,
  renderSettingsSectionHeading7,
  renderSettingsSectionHeading8,
  renderSettingsSectionHeading9,
} from "./settingsToolsView";

type Settings = typeof defaultSettings;
type View = (ctx: AppCtx) => ReactNode;

let current: Settings = defaultSettings;

function Harness({
  view,
  extra = {},
  initial = defaultSettings,
}: {
  view: View;
  extra?: Record<string, unknown>;
  initial?: Settings;
}) {
  const [settings, setSettings] = useState<Settings>(initial);
  current = settings;
  return <>{view({ ...extra, settings, setSettings } as unknown as AppCtx)}</>;
}

/** Every setting key whose value differs between two settings objects. */
function changedKeys(before: Settings, after: Settings): string[] {
  return Object.keys({ ...before, ...after }).filter(
    (key) =>
      JSON.stringify((before as unknown as Record<string, unknown>)[key]) !==
      JSON.stringify((after as unknown as Record<string, unknown>)[key]),
  );
}

function exerciseCheckboxes() {
  const count = screen.getAllByRole("checkbox").length;
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const before = current;
    const box = screen.getAllByRole("checkbox")[index] as HTMLInputElement;
    const wasChecked = box.checked;
    fireEvent.click(box);
    const changed = changedKeys(before, current);
    expect(changed).toHaveLength(1);
    expect((current as unknown as Record<string, unknown>)[changed[0]]).toBe(!wasChecked);
    expect((screen.getAllByRole("checkbox")[index] as HTMLInputElement).checked).toBe(
      !wasChecked,
    );
    fireEvent.click(screen.getAllByRole("checkbox")[index]);
    expect(changedKeys(before, current)).toEqual([]);
  }
}

const toolViews: Array<[string, View]> = [
  ["submission checker", renderSettingsSectionHeading3],
  ["citation assistant", renderSettingsSectionHeading4],
  ["structure assistant", renderSettingsSectionHeading5],
  ["reproducibility", renderSettingsSectionHeading6],
  ["acronyms", renderSettingsSectionHeading7],
  ["error doctor", renderSettingsSectionHeading8],
  ["TikZ converter", renderSettingsSectionHeading9],
  ["notation manager", renderSettingsSectionHeading10],
  ["PDF compliance", renderSettingsSectionHeading11],
];

describe("tool settings sections", () => {
  it.each(toolViews)("toggles every %s setting on and off", (_name, view) => {
    render(<Harness view={view} />);
    exerciseCheckboxes();
  });

  it("chooses a venue template and edits a custom one", () => {
    render(<Harness view={renderSettingsSectionHeading3} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(screen.queryByPlaceholderText(/documentclass/)).toBeNull();
    for (const option of ["acm", "springer", "elsevier", "neurips", "cvpr", "ieee"]) {
      fireEvent.change(select, { target: { value: option } });
      expect(current.conferenceTemplate).toBe(option);
    }
    fireEvent.change(select, { target: { value: "custom" } });
    const custom = screen.getByPlaceholderText(/documentclass/);
    fireEvent.change(custom, { target: { value: "\\documentclass{article}" } });
    expect(current.conferenceChecker_customTemplate).toBe("\\documentclass{article}");
    expect((custom as HTMLInputElement).value).toBe("\\documentclass{article}");
  });

  it("edits the PDF compliance limits, falling back to defaults", () => {
    render(<Harness view={renderSettingsSectionHeading11} />);
    const [pages, words] = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    fireEvent.change(pages, { target: { value: "12" } });
    expect(current.maxPages).toBe(12);
    fireEvent.change(pages, { target: { value: "" } });
    expect(current.maxPages).toBe(8);
    fireEvent.change(words, { target: { value: "150" } });
    expect(current.maxAbstractWords).toBe(150);
    fireEvent.change(words, { target: { value: "abc" } });
    expect(current.maxAbstractWords).toBe(250);
  });
});

describe("updates section", () => {
  function updates(extra: Record<string, unknown>) {
    const ctx = {
      openExternalLink: vi.fn(),
      checkForUpdates: vi.fn(async () => undefined),
      updateNow: vi.fn(async () => undefined),
      checkingUpdates: false,
      updatingNow: false,
      updateProgressActive: false,
      updateInfo: null,
      updateProgressLabel: "",
      updateProgressPercent: null,
      ...extra,
    };
    render(<Harness view={renderSettingsSectionHeading12} extra={ctx} />);
    return ctx;
  }

  it("checks for updates before anything is known and links to donations", () => {
    const ctx = updates({});
    expect(screen.getByText("LatexDo updates")).toBeInTheDocument();
    const check = screen.getByRole("button", { name: /Check for updates/ });
    expect(check).toHaveAttribute("title", "Check again");
    fireEvent.click(check);
    expect(ctx.checkForUpdates).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Donate/ }));
    expect(ctx.openExternalLink).toHaveBeenCalledWith(supportLatexDoUrl);
  });

  it("says when LatexDo is up to date", () => {
    updates({ updateInfo: { updateAvailable: false, currentVersion: "1.2.3" } });
    expect(screen.getByText("LatexDo 1.2.3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /You’re up to date/ })).toBeEnabled();
  });

  it("shows a check error", () => {
    updates({ updateInfo: { updateAvailable: false, currentVersion: "1", error: "Offline" } });
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Check for updates/ })).toBeInTheDocument();
  });

  it("offers an available update", () => {
    const ctx = updates({
      updateInfo: { updateAvailable: true, currentVersion: "1", latestVersion: "2.0.0" },
    });
    expect(screen.getByText("Version 2.0.0 is available")).toBeInTheDocument();
    const update = screen.getByRole("button", { name: "Update" });
    expect(update).not.toHaveAttribute("title");
    fireEvent.click(update);
    expect(ctx.updateNow).toHaveBeenCalled();
  });

  it("shows download progress with and without a percentage", () => {
    updates({
      updateInfo: { updateAvailable: true, currentVersion: "1", latestVersion: "2" },
      updatingNow: true,
      updateProgressActive: true,
      updateProgressLabel: "Downloading 42%",
      updateProgressPercent: 41.6,
    });
    expect(screen.getByText("Downloading 42%")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).not.toHaveClass("is-indeterminate");
    expect((bar.firstChild as HTMLElement).style.width).toBe("41.6%");
    expect(screen.getByRole("button", { name: /Updating…/ })).toBeDisabled();
  });

  it("shows an indeterminate bar while checking", () => {
    updates({
      checkingUpdates: true,
      updateProgressActive: true,
      updateProgressLabel: "",
      updateProgressPercent: null,
    });
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveClass("is-indeterminate");
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByRole("button", { name: /Checking…/ })).toBeDisabled();
  });
});

describe("settings footer", () => {
  it("resets to defaults but keeps the legal acceptance, and closes", () => {
    const setEngine = vi.fn();
    const setSettingsOpen = vi.fn();
    const initial = {
      ...defaultSettings,
      maxPages: 99,
      legalAccepted: true,
      legalAcceptedAt: "2026-01-01",
      legalPolicyVersion: "v9",
    } as Settings;
    render(
      <Harness
        view={renderSettingsFooter}
        extra={{ setEngine, setSettingsOpen }}
        initial={initial}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset defaults" }));
    expect(current.maxPages).toBe(defaultSettings.maxPages);
    expect(current.legalAccepted).toBe(true);
    expect(current.legalAcceptedAt).toBe("2026-01-01");
    expect(current.legalPolicyVersion).toBe("v9");
    expect(setEngine).toHaveBeenCalledWith(defaultSettings.defaultEngine);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(setSettingsOpen).toHaveBeenCalledWith(false);
  });
});
