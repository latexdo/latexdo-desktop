import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitGraphCommit } from "../types";
import { GitGraph } from "./GitGraph";

const commits: GitGraphCommit[] = [
  {
    hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    shortHash: "aaaaaaa",
    parents: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    subject: "Current branch work",
    authorName: "Omar",
    authorEmail: "omar@example.com",
    authoredAt: "2026-07-10T09:00:00.000Z",
    refs: [{ name: "main", kind: "head", current: true }],
    lane: 0,
    segments: [{ fromLane: 0, toLane: 0, kind: "vertical" }],
    isHead: true,
  },
  {
    hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    shortHash: "bbbbbbb",
    parents: [],
    subject: "Initial revision",
    authorName: "Ada",
    authorEmail: "ada@example.com",
    authoredAt: "2026-07-09T09:00:00.000Z",
    refs: [{ name: "v1.0", kind: "tag", current: false }],
    lane: 1,
    segments: [{ fromLane: 0, toLane: 1, kind: "merge-right" }],
    isHead: false,
  },
];

describe("GitGraph", () => {
  it("renders graph lanes, refs, authors, and persistent selection", () => {
    render(
      <GitGraph
        commits={commits}
        selectedHash={commits[1].hash}
        onSelectCommit={vi.fn()}
        formatTimestamp={() => "recently"}
      />,
    );

    expect(
      screen.getByRole("listbox", { name: /repository commit graph/i }),
    ).toBeVisible();
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: /initial revision/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("main")).toBeVisible();
    expect(screen.getByText("v1.0")).toBeVisible();
    expect(screen.getByText("Ada")).toBeVisible();
    expect(document.querySelectorAll(".git-graph-segment")).toHaveLength(2);
  });

  it("uses arrow keys to move selection and focus between commits", () => {
    const onSelectCommit = vi.fn();
    render(
      <GitGraph
        commits={commits}
        onSelectCommit={onSelectCommit}
        formatTimestamp={() => "recently"}
      />,
    );

    const rows = screen.getAllByRole("option");
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown" });

    expect(onSelectCommit).toHaveBeenCalledWith(commits[1]);
    expect(rows[1]).toHaveFocus();
  });

  it("supports Home, End and ignores other keys", () => {
    const onSelectCommit = vi.fn();
    render(<GitGraph commits={commits} onSelectCommit={onSelectCommit} />);
    const [first, second] = screen.getAllByRole("option");
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(first, { key: "End" });
    expect(onSelectCommit).toHaveBeenLastCalledWith(
      expect.objectContaining({ hash: commits[1].hash }),
    );
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "Home" });
    expect(onSelectCommit).toHaveBeenLastCalledWith(
      expect.objectContaining({ hash: commits[0].hash }),
    );
    fireEvent.keyDown(second, { key: "ArrowUp" });
    fireEvent.keyDown(first, { key: "Enter" });
    expect(onSelectCommit).toHaveBeenCalledTimes(3);
    fireEvent.click(second);
    expect(onSelectCommit).toHaveBeenCalledTimes(4);
  });

  it("shows loading and empty states with an extra class", () => {
    const { rerender, container } = render(
      <GitGraph commits={commits} onSelectCommit={vi.fn()} loading className="extra" />,
    );
    expect(screen.getByText("Loading commit graph...")).toHaveClass(
      "git-graph-state",
      "extra",
    );
    rerender(<GitGraph commits={[]} onSelectCommit={vi.fn()} />);
    expect(screen.getByText("No commits available.").className).toBe(
      "git-graph-empty git-graph-state",
    );
    rerender(
      <GitGraph
        commits={[]}
        onSelectCommit={vi.fn()}
        emptyMessage="Nothing here"
        className="x"
      />,
    );
    expect(screen.getByText("Nothing here")).toHaveClass("x");
    rerender(<GitGraph commits={commits} onSelectCommit={vi.fn()} className="wide" />);
    expect(container.querySelector(".git-graph")).toHaveClass("wide");
  });

  it("normalizes incomplete commit data from the backend", () => {
    const messy = [
      { hash: "" },
      { hash: 5 },
      {
        hash: "cccccccccccccccccccccccccccccccccccccccc",
        refs: [
          null,
          { name: 3 },
          { name: "feature", kind: "weird" },
          { name: "origin/x", kind: "remote-branch" },
        ],
        lane: Number.NaN,
        parents: ["p1", 7],
        segments: [
          { fromLane: 0, toLane: 0 },
          { fromLane: 2, toLane: 1 },
          { fromLane: 0, toLane: 3 },
          { fromLane: "a", toLane: 1 },
          null,
        ],
        authorEmail: 1,
        authoredAt: 1,
      },
      {
        hash: "dddddddddddddddddddddddddddddddddddddddd",
        shortHash: "",
        subject: "",
        authorName: "",
        lane: 2,
        refs: "nope",
        segments: "nope",
        parents: "nope",
      },
    ] as unknown as GitGraphCommit[];
    render(
      <GitGraph
        commits={messy}
        onSelectCommit={vi.fn()}
        formatTimestamp={(v) => `t:${v}`}
      />,
    );
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute("title", "cccccccc - Untitled commit");
    expect(screen.getAllByText("Unknown")).toHaveLength(2);
    expect(screen.getByText("feature")).toHaveAttribute("data-kind", "local-branch");
    expect(screen.getByText("origin/x")).toHaveAttribute(
      "title",
      "remote branch: origin/x",
    );
    const segments = [...options[0].querySelectorAll(".git-graph-segment")].map((p) =>
      p.getAttribute("class"),
    );
    expect(segments).toEqual([
      "git-graph-segment vertical",
      "git-graph-segment merge-left",
      "git-graph-segment merge-right",
    ]);
    expect(options[0].querySelector("circle")?.getAttribute("cx")).toBe("9");
    expect(options[1]).toHaveAttribute("title", "dddddddd - Untitled commit");
    expect(screen.getAllByText("t:")).toHaveLength(2);
    expect(screen.getByRole("listbox").getAttribute("style")).toContain("72px");
  });

  it("highlights the commit carrying the current ref even without isHead", () => {
    render(
      <GitGraph
        commits={[
          {
            ...commits[1],
            refs: [{ name: "dev", kind: "local-branch", current: true }],
          },
        ]}
        onSelectCommit={vi.fn()}
      />,
    );
    expect(document.querySelector(".git-graph-dot")).toHaveClass("head");
    expect(screen.getByText("dev")).toHaveClass("current");
  });
});

describe("GitGraph relative timestamps", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ["2026-07-10T11:59:30.000Z", /second|now/],
    ["2026-07-10T11:55:00.000Z", /5 minutes ago/],
    ["2026-07-10T09:00:00.000Z", /3 hours ago/],
    ["2026-07-08T12:00:00.000Z", /2 days ago/],
    ["2026-06-20T12:00:00.000Z", /3 weeks ago/],
    ["2026-03-01T12:00:00.000Z", /4 months ago/],
    ["2024-07-01T12:00:00.000Z", /2 years ago/],
    ["not a date", /^not a date$/],
  ])("formats %s", (authoredAt, expected) => {
    vi.useFakeTimers({ now: new Date("2026-07-10T12:00:00.000Z") });
    render(
      <GitGraph commits={[{ ...commits[0], authoredAt }]} onSelectCommit={vi.fn()} />,
    );
    expect(document.querySelector("time")?.textContent).toMatch(expected);
  });
});
