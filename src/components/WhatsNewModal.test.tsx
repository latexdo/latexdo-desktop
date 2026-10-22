import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReleaseNotesDocument } from "../types";
import { WhatsNewModal } from "./WhatsNewModal";

describe("WhatsNewModal", () => {
  it("lists the changes a build update brought, even without version notes", () => {
    render(
      <WhatsNewModal
        fromVersion="0.3.1"
        toVersion="0.3.1"
        releases={[]}
        notesAvailable={false}
        buildChanges={[
          { kind: "new", text: "Complete the sentence being written" },
          { kind: "fixed", text: "Let the author keep typing after a citation" },
        ]}
        onClose={vi.fn()}
        onViewFullNotes={vi.fn()}
      />,
    );
    const changes = screen.getByRole("region", { name: "Changes in this update" });
    expect(
      within(changes).getByText("Complete the sentence being written"),
    ).toBeVisible();
    expect(within(changes).getByText("Fixed")).toBeVisible();
  });
});

function release(
  version: string,
  extra: Partial<ReleaseNotesDocument> = {},
): ReleaseNotesDocument {
  return {
    schemaVersion: 1,
    version,
    title: `LatexDo ${version}`,
    publishedAt: "2026-01-01T00:00:00Z",
    releaseUrl: `https://latexdo.org/releases/${version}`,
    highlights: [],
    ...extra,
  };
}

function renderModal(props: Partial<React.ComponentProps<typeof WhatsNewModal>> = {}) {
  const onClose = vi.fn();
  const onViewFullNotes = vi.fn();
  const view = render(
    <WhatsNewModal
      fromVersion="1.0.0"
      toVersion="1.2.0"
      releases={[]}
      notesAvailable
      onClose={onClose}
      onViewFullNotes={onViewFullNotes}
      {...props}
    />,
  );
  return { ...view, onClose, onViewFullNotes };
}

describe("WhatsNewModal release notes", () => {
  it("shows every release with highlights, summaries and fixes", () => {
    const { onViewFullNotes } = renderModal({
      releases: [
        release("1.2.0", {
          summary: "Faster builds",
          highlights: [
            { id: "h1", title: "Live preview", description: "Updates as you type" },
            { id: "h2", title: "Dark mode" },
          ] as ReleaseNotesDocument["highlights"],
          fixes: ["Fixed a crash"],
        }),
        release("1.1.0", { fixes: [] }),
      ],
    });
    expect(
      screen.getByText("You've updated from 1.0.0. Here's what changed."),
    ).toBeVisible();
    const current = screen.getByRole("region", { name: "Release 1.2.0" });
    expect(within(current).getByRole("heading").className).toContain("--current");
    expect(within(current).getByText("Faster builds")).toBeVisible();
    expect(within(current).getByText("Updates as you type")).toBeVisible();
    expect(within(current).getByText("Fixed a crash")).toBeVisible();
    const older = screen.getByRole("region", { name: "Release 1.1.0" });
    expect(within(older).getByRole("heading").className).not.toContain("--current");
    expect(within(older).queryByRole("list")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View full release notes" }));
    expect(onViewFullNotes).toHaveBeenCalledOnce();
  });

  it("uses a short subtitle for a single release and none without a previous version", () => {
    const { rerender, onClose, onViewFullNotes } = renderModal({
      releases: [release("1.2.0")],
    });
    expect(screen.getByText("You've updated from 1.0.0.")).toBeVisible();
    rerender(
      <WhatsNewModal
        fromVersion={null}
        toVersion="1.2.0"
        releases={[]}
        notesAvailable={false}
        onClose={onClose}
        onViewFullNotes={onViewFullNotes}
      />,
    );
    expect(screen.queryByText(/You've updated from/)).toBeNull();
    expect(screen.getByText("Release notes aren’t available right now.")).toBeVisible();
    expect(screen.queryByText(/successfully updated/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "View full release notes" }),
    ).toBeDisabled();
  });

  it("falls back when notes are unavailable even if releases exist", () => {
    renderModal({ notesAvailable: false, releases: [release("1.2.0")] });
    expect(screen.getByText("You’ve successfully updated from 1.0.0.")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Release 1.2.0" })).toBeNull();
  });
});

describe("WhatsNewModal closing and focus", () => {
  it("closes on Escape, on Continue and on a backdrop click only", () => {
    const { onClose, container } = renderModal();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(container.querySelector(".whats-new-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("ignores other keys", () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(window, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps Tab focus inside the dialog", () => {
    renderModal({ releases: [release("1.2.0")] });
    const notes = screen.getByRole("button", { name: "View full release notes" });
    const proceed = screen.getByRole("button", { name: "Continue" });
    const dialog = screen.getByRole("dialog");

    proceed.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(notes);

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(proceed);

    notes.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(notes);

    dialog.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(dialog);
  });

  it("pulls focus back into the dialog from outside", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    renderModal({ releases: [release("1.2.0")] });
    const notes = screen.getByRole("button", { name: "View full release notes" });
    const proceed = screen.getByRole("button", { name: "Continue" });

    outside.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(notes);

    outside.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(proceed);
    outside.remove();
  });

  it("skips disabled controls and does nothing when nothing is focusable", () => {
    renderModal();
    const proceed = screen.getByRole("button", { name: "Continue" });
    proceed.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(proceed);
    proceed.setAttribute("disabled", "");
    expect(fireEvent.keyDown(window, { key: "Tab" })).toBe(true);
    expect(document.activeElement).toBe(proceed);
  });

  it("restores focus to the previously focused element on unmount", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = renderModal();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Continue" }),
    );
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
