import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FileTree from "./FileTree";
import type { ProjectEntry } from "./types";

const file = (relativePath: string): ProjectEntry => ({
  name: relativePath.split("/").pop()!,
  path: `/paper/${relativePath}`,
  relativePath,
  type: "file",
});
const dir = (relativePath: string, children: ProjectEntry[] = []): ProjectEntry => ({
  name: relativePath.split("/").pop()!,
  path: `/paper/${relativePath}`,
  relativePath,
  type: "directory",
  children,
});

function transfer(files: File[] = []) {
  const values = new Map<string, string>();
  return {
    types: files.length ? ["Files"] : ["text/plain"],
    files,
    effectAllowed: "",
    dropEffect: "",
    setData: (kind: string, value: string) => values.set(kind, value),
    getData: (kind: string) => values.get(kind) || "",
  };
}
const row = (name: string) => screen.getByText(name).closest(".tree-row")!;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FileTree coverage", () => {
  it("renders a limit row for truncated listings", () => {
    render(
      <FileTree
        entries={[{ ...file("more"), name: "… 200 more files", limited: true }]}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("… 200 more files").closest(".tree-limit-row")).toBeTruthy();
  });

  it("picks icons for code, image and other files", () => {
    const { container } = render(
      <FileTree
        entries={[file("a.sty"), file("b.SVG"), file("c.txt"), file("Makefile")]}
        onOpen={vi.fn()}
      />,
    );
    expect(container.querySelector(".file-sty")).toBeTruthy();
    expect(container.querySelectorAll(".file-image")).toHaveLength(1);
    // Image files without a reveal handler are not wrapped in a button.
    expect(screen.queryByLabelText(/Reveal b.SVG/)).toBeNull();
  });

  it("renames a folder with F2, commits on blur and ignores unchanged names", () => {
    const onRenameEntry = vi.fn();
    const folder = dir("sections");
    render(<FileTree entries={[folder]} onOpen={vi.fn()} onRenameEntry={onRenameEntry} />);
    fireEvent.keyDown(row("sections"), { key: "Enter" });
    expect(screen.queryByLabelText("Rename sections")).toBeNull();
    fireEvent.keyDown(row("sections"), { key: "F2" });
    const input = screen.getByLabelText("Rename sections") as HTMLInputElement;
    expect(input.selectionEnd).toBe("sections".length);
    // Clicking the input neither toggles the folder nor closes the editor.
    fireEvent.click(input);
    fireEvent.click(row("sections"));
    expect(screen.getByLabelText("Rename sections")).toBeTruthy();
    fireEvent.blur(input, { target: { value: "  sections " } });
    expect(onRenameEntry).not.toHaveBeenCalled();
    fireEvent.keyDown(row("sections"), { key: "F2" });
    fireEvent.keyDown(screen.getByLabelText("Rename sections"), { key: "Escape" });
    expect(screen.queryByLabelText("Rename sections")).toBeNull();
    fireEvent.keyDown(row("sections"), { key: "F2" });
    fireEvent.blur(screen.getByLabelText("Rename sections"), {
      target: { value: "chapters" },
    });
    expect(onRenameEntry).toHaveBeenCalledWith(folder, "chapters");
  });

  it("does not rename with F2 when renaming is unavailable", () => {
    render(<FileTree entries={[dir("sections")]} onOpen={vi.fn()} />);
    fireEvent.keyDown(row("sections"), { key: "F2" });
    expect(screen.queryByLabelText("Rename sections")).toBeNull();
  });

  it("selects a file name without its extension when renaming", () => {
    const onOpen = vi.fn();
    render(<FileTree entries={[file(".env")]} onOpen={onOpen} onRenameEntry={vi.fn()} />);
    fireEvent.contextMenu(row(".env"));
    fireEvent.click(screen.getByRole("button", { name: "Rename…" }));
    const input = screen.getByLabelText("Rename .env") as HTMLInputElement;
    expect(input.selectionEnd).toBe(4);
    fireEvent.click(row(".env"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("closes a menu with Escape and toggles it with a second right-click", () => {
    render(<FileTree entries={[dir("sections"), file("main.tex")]} onOpen={vi.fn()} />);
    fireEvent.contextMenu(row("main.tex"));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "a" });
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(row("sections"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.contextMenu(row("sections"));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByTitle("Actions for sections"));
    fireEvent.click(screen.getByTitle("Actions for sections"));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByTitle("Actions for main.tex"));
    fireEvent.click(screen.getByTitle("Actions for main.tex"));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(row("main.tex"));
    fireEvent.contextMenu(row("main.tex"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("expands a collapsed folder after hovering a move over it, and resets on drag end", () => {
    vi.useFakeTimers();
    const intro = file("sections/deep/intro.tex");
    const deep = dir("sections/deep", [intro]);
    const target = dir("sections/target", [file("sections/target/inside.tex")]);
    const sections = dir("sections", [deep, target]);
    const onDragStartPath = vi.fn();
    const { container } = render(
      <FileTree entries={[sections]} onOpen={vi.fn()} onMoveEntry={vi.fn()} />,
    );
    // Depth-1 folders start collapsed; open "deep" so the file can be dragged.
    fireEvent.click(row("deep"));
    const data = transfer();
    fireEvent.dragStart(row("intro.tex"), { dataTransfer: data });
    fireEvent.dragOver(row("target"), { dataTransfer: data });
    fireEvent.dragOver(row("target"), { dataTransfer: data });
    expect(row("target")).toHaveClass("drop-target");
    // Leaving into a child keeps the highlight.
    fireEvent.dragLeave(row("target"), {
      dataTransfer: data,
      relatedTarget: row("target").firstChild,
    });
    expect(row("target")).toHaveClass("drop-target");
    act(() => vi.advanceTimersByTime(450));
    expect(screen.getByText("inside.tex")).toBeTruthy();
    // Dragging a folder and ending the drag clears state.
    fireEvent.dragStart(row("deep"), { dataTransfer: data });
    fireEvent.dragOver(row("sections"), { dataTransfer: data });
    fireEvent.dragEnd(row("deep"), { dataTransfer: data });
    expect(container.querySelector(".dragging")).toBeNull();
    expect(onDragStartPath).not.toHaveBeenCalled();
  });

  it("ignores a drop with no source path and drops onto folders without a move handler", () => {
    const onMoveEntry = vi.fn();
    const nested = file("sections/intro.tex");
    const target = dir("appendix");
    const view = render(
      <FileTree
        entries={[dir("sections", [nested]), target]}
        onOpen={vi.fn()}
        onMoveEntry={onMoveEntry}
      />,
    );
    const data = transfer();
    fireEvent.dragStart(row("intro.tex"), { dataTransfer: data });
    const empty = transfer();
    fireEvent.dragOver(row("appendix"), { dataTransfer: empty });
    fireEvent.drop(row("appendix"), { dataTransfer: empty });
    expect(onMoveEntry).not.toHaveBeenCalled();

    // At the root: a drop without a source path is ignored as well.
    fireEvent.dragStart(row("intro.tex"), { dataTransfer: data });
    const root = view.container.querySelector(".file-tree-drop-surface")!;
    expect(screen.getByText("Drop in this space to move to the project root")).toBeTruthy();
    fireEvent.drop(root, { dataTransfer: empty });
    expect(onMoveEntry).not.toHaveBeenCalled();
  });

  it("does not offer the root for top-level entries or without a move handler", () => {
    const onImportExternalFiles = vi.fn();
    const view = render(
      <FileTree
        entries={[file("main.tex"), dir("sections", [file("sections/a.tex")])]}
        onOpen={vi.fn()}
      />,
    );
    const root = view.container.querySelector(".file-tree-drop-surface")!;
    const data = transfer();
    fireEvent.dragStart(row("main.tex"), { dataTransfer: data });
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.assign(over, { dataTransfer: data });
    root.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    fireEvent.drop(root, { dataTransfer: data });
    view.unmount();

    // Nested entry but no move handler: dropping at the root does nothing.
    const second = render(
      <FileTree
        entries={[dir("sections", [file("sections/a.tex")])]}
        onOpen={vi.fn()}
        onImportExternalFiles={onImportExternalFiles}
      />,
    );
    fireEvent.dragStart(row("a.tex"), { dataTransfer: data });
    const surface = second.container.querySelector(".file-tree-drop-surface")!;
    fireEvent.dragOver(surface, { dataTransfer: data });
    expect(surface).toHaveClass("root-drop-target");
    fireEvent.drop(surface, { dataTransfer: data });
    expect(onImportExternalFiles).not.toHaveBeenCalled();
    // Dropping an external file without files in the list falls through.
    fireEvent.drop(row("sections"), { dataTransfer: transfer() });
    expect(onImportExternalFiles).not.toHaveBeenCalled();
  });

  it("uses a controlled clipboard and keeps it after a copy paste", () => {
    const onClipboardChange = vi.fn();
    const onPasteEntry = vi.fn();
    const target = dir("appendix");
    render(
      <FileTree
        entries={[target]}
        onOpen={vi.fn()}
        clipboard={{ path: "/paper/main.tex", mode: "copy" }}
        onClipboardChange={onClipboardChange}
        onPasteEntry={onPasteEntry}
      />,
    );
    fireEvent.contextMenu(row("appendix"));
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    expect(onPasteEntry).toHaveBeenCalledWith("/paper/main.tex", "copy", target);
    expect(onClipboardChange).not.toHaveBeenCalled();
  });
});

describe("FileTree reveal label", () => {
  it.each([
    ["MacIntel", "Reveal in Finder"],
    ["Win32", "Reveal in File Explorer"],
  ])("names the file manager on %s", async (platform, label) => {
    vi.resetModules();
    vi.stubGlobal("navigator", { ...navigator, platform });
    const { default: FreshTree } = await import("./FileTree");
    render(
      <FreshTree entries={[file("main.tex")]} onOpen={vi.fn()} onRevealFile={vi.fn()} />,
    );
    fireEvent.contextMenu(row("main.tex"));
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
  });
});
