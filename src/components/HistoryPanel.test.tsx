import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectHistoryEntry } from "../types";
import { groupHistory } from "../features/history/useProjectHistory";
import { HistoryPanel, type HistoryPanelProps } from "./HistoryPanel";

const minute = 60_000;
const now = Date.now();

function entry(
  seq: number,
  from: string,
  path: string,
  endedAt: number,
): ProjectHistoryEntry {
  return {
    seq,
    at: endedAt + 1000,
    from,
    change: {
      path,
      startedAt: endedAt - minute,
      endedAt,
      added: 1,
      removed: 1,
      hunks: [
        {
          oldStart: 9,
          newStart: 9,
          lines: [" context", "-The result shows", "+The results show", " more"],
        },
      ],
    },
  };
}

const entries = [
  entry(4, "bob", "chapters/intro.tex", now - 2 * minute),
  entry(3, "bob", "chapters/intro.tex", now - 5 * minute),
  entry(2, "me", "main.tex", now - 30 * minute),
  entry(1, "bob", "chapters/intro.tex", now - 90 * minute),
];

function props(overrides: Partial<HistoryPanelProps> = {}): HistoryPanelProps {
  return {
    available: true,
    entries,
    loading: false,
    error: null,
    hasMore: false,
    names: new Map([["bob", "Bob Stone"]]),
    me: "me",
    onRefresh: vi.fn(),
    onLoadOlder: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  };
}

describe("groupHistory", () => {
  it("joins one person's nearby edits to one file, newest first", () => {
    const groups = groupHistory(entries);
    expect(
      groups.map((group) => [group.from, group.entries.map((e) => e.seq)]),
    ).toEqual([
      ["bob", [3, 4]],
      ["me", [2]],
      ["bob", [1]],
    ]);
    expect(groups[0]).toMatchObject({ added: 2, removed: 2 });
  });
});

describe("HistoryPanel", () => {
  it("lists who changed which file, with what was added and removed", () => {
    const p = props();
    render(<HistoryPanel {...p} />);
    expect(screen.getByText("Today")).toBeTruthy();
    const rows = screen.getAllByRole("button", { expanded: false });
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Bob Stone edited intro.tex"),
      expect.stringContaining("You edited main.tex"),
      expect.stringContaining("Bob Stone edited intro.tex"),
    ]);
    fireEvent.click(rows[0]!);
    const diff = screen.getAllByRole("table")[0]!;
    expect(within(diff).getByText("The result shows").closest("tr")?.className).toBe(
      "is-removed",
    );
    expect(within(diff).getByText("The results show").closest("tr")?.className).toBe(
      "is-added",
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Line 10" })[0]!);
    expect(p.onOpen).toHaveBeenCalledWith("chapters/intro.tex", 10);
  });

  it("shows one person's changes only and loads older ones", () => {
    const p = props({ hasMore: true });
    render(<HistoryPanel {...p} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Show changes by" }), {
      target: { value: "me" },
    });
    expect(screen.queryByText(/Bob Stone edited/)).toBeNull();
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(1);
    expect(screen.getByText(/edited/).textContent).toBe("You edited main.tex");
    fireEvent.click(screen.getByRole("button", { name: "Load older changes" }));
    expect(p.onLoadOlder).toHaveBeenCalled();
  });

  it("explains itself when there is nothing to show", () => {
    const view = render(<HistoryPanel {...props({ entries: [] })} />);
    expect(screen.getByText("No changes recorded yet.")).toBeTruthy();
    view.rerender(<HistoryPanel {...props({ available: false })} />);
    expect(screen.getByText(/Share this project to start recording/)).toBeTruthy();
  });
});
