import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
});
