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
});
