import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceTabs, type WorkspaceTab } from "./WorkspaceTabs";

function fixture(): WorkspaceTab[] {
  return ["main.tex", "Knowledge Graph", "chapter.tex"].map((label, index) => ({
    id: label,
    label,
    icon: null,
    active: index === 0,
    onSelect: vi.fn(),
    onClose: vi.fn(),
  }));
}

describe("Workspace tabs", () => {
  it("reorders mixed tabs by dragging and keyboard without activating or closing them", () => {
    const tabs = fixture();
    render(<WorkspaceTabs tabs={tabs} />);
    const transfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(
      screen.getByRole("tab", { name: "Knowledge Graph" }).parentElement!,
      { dataTransfer: transfer },
    );
    fireEvent.dragOver(screen.getByRole("tab", { name: "main.tex" }).parentElement!, {
      dataTransfer: transfer,
    });
    fireEvent.drop(screen.getByRole("tab", { name: "main.tex" }).parentElement!, {
      dataTransfer: transfer,
    });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Knowledge Graph",
      "main.tex",
      "chapter.tex",
    ]);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Knowledge Graph" }), {
      key: "ArrowRight",
      altKey: true,
      shiftKey: true,
    });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "main.tex",
      "Knowledge Graph",
      "chapter.tex",
    ]);
    expect(tabs[1].onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close Knowledge Graph" }));
    expect(tabs[1].onClose).toHaveBeenCalledOnce();
    expect(tabs[1].onSelect).not.toHaveBeenCalled();
  });

  it("retains custom order when files open and close", () => {
    const tabs = fixture();
    const { rerender } = render(<WorkspaceTabs tabs={tabs} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Knowledge Graph" }), {
      key: "ArrowLeft",
      altKey: true,
      shiftKey: true,
    });
    rerender(
      <WorkspaceTabs
        tabs={[...tabs.slice(0, 2), { ...tabs[2], id: "new.tex", label: "new.tex" }]}
      />,
    );
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Knowledge Graph",
      "main.tex",
      "new.tex",
    ]);
  });

  it("moves focus and selection with arrow keys, wrapping around", () => {
    const tabs = fixture();
    render(<WorkspaceTabs tabs={tabs} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "main.tex" }), { key: "ArrowLeft" });
    expect(tabs[2].onSelect).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "chapter.tex" }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "chapter.tex" }), { key: "ArrowRight" });
    expect(tabs[0].onSelect).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole("tab", { name: "main.tex" }), { key: "Enter" });
    expect(tabs[1].onSelect).not.toHaveBeenCalled();
    // Alt+Shift past the edge leaves the order alone.
    fireEvent.keyDown(screen.getByRole("tab", { name: "main.tex" }), {
      key: "ArrowLeft",
      altKey: true,
      shiftKey: true,
    });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "main.tex",
      "Knowledge Graph",
      "chapter.tex",
    ]);
  });

  it("ignores foreign drags, clears the target on drag end and marks unsaved tabs", () => {
    const tabs = fixture();
    tabs[0].dirty = true;
    render(<WorkspaceTabs tabs={tabs} />);
    const closeDirty = screen.getByRole("button", { name: "Close main.tex" });
    expect(closeDirty.title).toBe("Close main.tex (unsaved)");
    expect(closeDirty.querySelector(".dirty-dot")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close chapter.tex" }).title).toBe(
      "Close chapter.tex",
    );

    const transfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    const shell = (name: string) => screen.getByRole("tab", { name }).parentElement!;
    // A drag that did not start on a tab is not accepted.
    fireEvent.dragOver(shell("main.tex"), { dataTransfer: transfer });
    expect(shell("main.tex").className).not.toContain("drop-target");
    fireEvent.drop(shell("main.tex"), { dataTransfer: transfer });

    fireEvent.dragStart(shell("chapter.tex"), { dataTransfer: transfer });
    expect(transfer.setData).toHaveBeenCalledWith("application/x-latexdo-tab", "chapter.tex");
    fireEvent.dragOver(shell("main.tex"), { dataTransfer: transfer });
    expect(shell("main.tex").className).toContain("drop-target");
    fireEvent.dragEnd(shell("chapter.tex"));
    expect(shell("main.tex").className).not.toContain("drop-target");
    // Dropping a tab on itself keeps the order.
    fireEvent.dragStart(shell("main.tex"), { dataTransfer: transfer });
    fireEvent.drop(shell("main.tex"), { dataTransfer: transfer });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "main.tex",
      "Knowledge Graph",
      "chapter.tex",
    ]);
  });
});
