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
const nested = file("sections/intro.tex"),
  main = file("main.tex"),
  image = file("plot.png");
const folder: ProjectEntry = {
  name: "sections",
  path: "/paper/sections",
  relativePath: "sections",
  type: "directory",
  children: [nested],
};
const target: ProjectEntry = {
  name: "appendix",
  path: "/paper/appendix",
  relativePath: "appendix",
  type: "directory",
  children: [],
};
function setup() {
  const callbacks = {
    onOpen: vi.fn(),
    onCompileFile: vi.fn(),
    onSetRootFile: vi.fn(),
    onMoveEntry: vi.fn(),
    onImportExternalFiles: vi.fn(),
    onChooseImportFilesInDirectory: vi.fn(),
    onCreateFileInDirectory: vi.fn(),
    onCreateFolderInDirectory: vi.fn(),
    onCopyRelativePath: vi.fn(),
    onInsertFileReference: vi.fn(),
    onRevealFile: vi.fn(),
    onCopyPath: vi.fn(),
    onRenameEntry: vi.fn(),
    onDeleteEntry: vi.fn(),
    onDeleteEntries: vi.fn(),
    onDuplicateEntry: vi.fn(),
    onPasteEntry: vi.fn(),
  };
  return {
    ...render(
      <FileTree
        entries={[main, image, folder, target, file("README.md")]}
        activePath={main.path}
        {...callbacks}
      />,
    ),
    ...callbacks,
  };
}
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
});
describe("file tree interaction", () => {
  it("toggles individual selections without opening files and preserves them on right-click", () => {
    const view = setup();
    fireEvent.click(row("main.tex"));
    fireEvent.click(row("plot.png"), { metaKey: true });
    expect(row("main.tex")).toHaveAttribute("aria-selected", "true");
    expect(row("plot.png")).toHaveAttribute("aria-selected", "true");
    expect(view.onOpen).toHaveBeenCalledTimes(1);
    fireEvent.contextMenu(row("main.tex"));
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 Items" }));
    expect(view.onDeleteEntries).toHaveBeenCalledWith([main, image]);
    expect(view.onDeleteEntry).not.toHaveBeenCalled();
    fireEvent.click(row("plot.png"), { ctrlKey: true });
    expect(row("plot.png")).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(row("plot.png"), { key: "Delete" });
    expect(view.onDeleteEntry).toHaveBeenCalledWith(main);
  });

  it("selects ranges across folders with Shift-click and Shift-arrows", () => {
    const view = setup();
    fireEvent.click(row("main.tex"));
    fireEvent.click(row("intro.tex"), { shiftKey: true });
    for (const name of ["main.tex", "plot.png", "sections", "intro.tex"])
      expect(row(name)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(row("intro.tex"), { key: "ArrowUp", shiftKey: true });
    expect(row("intro.tex")).toHaveAttribute("aria-selected", "false");
    expect(row("sections")).toHaveFocus();
    fireEvent.keyDown(row("sections"), { key: "Delete" });
    expect(view.onDeleteEntries).toHaveBeenCalledWith([main, image, folder]);
  });

  it("selects all visible entries and copies a selected folder only once", () => {
    const view = setup();
    fireEvent.click(row("main.tex"));
    fireEvent.keyDown(row("main.tex"), { key: "a", ctrlKey: true });
    expect(screen.getAllByRole("treeitem", { selected: true })).toHaveLength(6);
    fireEvent.click(row("sections"), { ctrlKey: true });
    fireEvent.click(row("sections"), { ctrlKey: true });
    fireEvent.keyDown(row("main.tex"), { key: "c", ctrlKey: true });
    fireEvent.click(row("appendix"));
    fireEvent.keyDown(row("appendix"), { key: "v", ctrlKey: true });
    expect(view.onPasteEntry.mock.calls.map(([path]) => path)).not.toContain(
      nested.path,
    );
    expect(
      view.onPasteEntry.mock.calls.filter(([path]) => path === folder.path),
    ).toHaveLength(1);
  });

  it("moves the entire selection when dragging one selected file", () => {
    const view = setup();
    fireEvent.click(row("main.tex"));
    fireEvent.click(row("plot.png"), { metaKey: true });
    const dataTransfer = transfer();
    fireEvent.dragStart(row("main.tex"), { dataTransfer });
    fireEvent.dragOver(row("appendix"), { dataTransfer });
    fireEvent.drop(row("appendix"), { dataTransfer });
    expect(view.onMoveEntry.mock.calls).toEqual([
      [main.path, target],
      [image.path, target],
    ]);
  });

  it("cuts several files and retains remaining items if a paste fails", () => {
    const view = setup();
    fireEvent.click(row("main.tex"));
    fireEvent.click(row("plot.png"), { ctrlKey: true });
    fireEvent.keyDown(row("plot.png"), { key: "x", ctrlKey: true });
    expect(row("main.tex")).toHaveClass("cut");
    expect(row("plot.png")).toHaveClass("cut");
    view.onPasteEntry.mockReturnValueOnce(true).mockReturnValueOnce(false);
    fireEvent.click(row("appendix"));
    fireEvent.keyDown(row("appendix"), { key: "v", ctrlKey: true });
    expect(row("main.tex")).not.toHaveClass("cut");
    expect(row("plot.png")).toHaveClass("cut");
    view.onPasteEntry.mockReturnValue(true);
    fireEvent.keyDown(row("appendix"), { key: "v", ctrlKey: true });
    expect(view.onPasteEntry).toHaveBeenLastCalledWith(image.path, "cut", target);
    expect(row("plot.png")).not.toHaveClass("cut");
  });

  it.each([
    ["macOS", { key: "Backspace", metaKey: true }],
    ["Windows/Linux", { key: "Delete" }],
  ])(
    "deletes the focused file or folder using the %s shortcut",
    (_platform, shortcut) => {
      const view = setup();
      fireEvent.click(row("main.tex"));
      expect(row("main.tex")).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, shortcut);
      expect(view.onDeleteEntry).toHaveBeenLastCalledWith(main);
      fireEvent.click(row("sections"));
      expect(row("sections")).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, shortcut);
      expect(view.onDeleteEntry).toHaveBeenLastCalledWith(folder);
      expect(view.onDeleteEntry).toHaveBeenCalledTimes(2);
    },
  );

  it("does not delete while renaming, typing elsewhere, or holding the shortcut", () => {
    const view = setup();
    fireEvent.keyDown(row("main.tex"), { key: "Backspace" });
    fireEvent.keyDown(row("main.tex"), { key: "Delete", repeat: true });
    fireEvent.keyDown(window, { key: "Delete" });
    fireEvent.keyDown(row("main.tex"), { key: "F2" });
    const input = screen.getByRole("textbox", { name: "Rename main.tex" });
    fireEvent.keyDown(input, { key: "Backspace", metaKey: true });
    fireEvent.keyDown(input, { key: "Delete" });
    expect(view.onDeleteEntry).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
  });

  it("navigates visible rows and copies or cuts into a focused folder", () => {
    const view = setup();
    fireEvent.click(row("main.tex"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(row("plot.png")).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "c", metaKey: true });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(row("sections")).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "v", metaKey: true });
    expect(view.onPasteEntry).toHaveBeenLastCalledWith(image.path, "copy", folder);
    fireEvent.click(row("main.tex"));
    fireEvent.keyDown(document.activeElement!, { key: "x", ctrlKey: true });
    fireEvent.click(row("appendix"));
    fireEvent.keyDown(document.activeElement!, { key: "v", ctrlKey: true });
    expect(view.onPasteEntry).toHaveBeenLastCalledWith(main.path, "cut", target);
    fireEvent.keyDown(document.activeElement!, { key: "v", ctrlKey: true });
    expect(view.onPasteEntry).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["Open", "onOpen"],
    ["Compile to PDF", "onCompileFile"],
    ["Set as Main File", "onSetRootFile"],
    ["Copy Path", "onCopyPath"],
    ["Copy Relative Path", "onCopyRelativePath"],
    ["Duplicate", "onDuplicateEntry"],
    ["Delete", "onDeleteEntry"],
    ["Open Containing Folder", "onRevealFile"],
  ] as const)("executes %s for the selected file", (label, callback) => {
    const view = setup();
    fireEvent.contextMenu(row("main.tex"));
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(view[callback]).toHaveBeenCalledWith(main);
    expect(screen.queryByText("Set as Main File")).not.toBeInTheDocument();
  });
  it.each([
    ["New File…", "onCreateFileInDirectory"],
    ["New Folder…", "onCreateFolderInDirectory"],
    ["Import Files Here…", "onChooseImportFilesInDirectory"],
    ["Delete", "onDeleteEntry"],
  ] as const)("executes folder action %s", (label, callback) => {
    const view = setup();
    fireEvent.click(screen.getByTitle("Actions for sections"));
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(view[callback]).toHaveBeenCalledWith(folder);
  });
  it.each([
    ["Open Containing Folder", "onRevealFile"],
    ["Insert Image Code", "onInsertFileReference"],
  ] as const)("executes image action %s", (label, callback) => {
    const view = setup();
    fireEvent.click(screen.getByTitle("Actions for plot.png"));
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(view[callback]).toHaveBeenCalledWith(image);
    expect(view.onOpen).not.toHaveBeenCalled();
  });
  it("reveals images without opening and closes menus on an outside click", () => {
    const view = setup();
    fireEvent.click(screen.getByLabelText("Reveal plot.png in file manager"));
    expect(view.onRevealFile).toHaveBeenCalledWith(image);
    fireEvent.click(screen.getByTitle("Actions for main.tex"));
    fireEvent.click(window);
    expect(screen.queryByText("Compile to PDF")).not.toBeInTheDocument();
    fireEvent.click(row("README.md"));
    expect(view.onOpen).toHaveBeenCalledWith(file("README.md"));
  });
  it("shows plain text actions with no emoji", () => {
    setup();
    fireEvent.contextMenu(row("main.tex"));
    const menu = screen.getByRole("menu");
    expect(menu.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(screen.getByRole("button", { name: "Compile to PDF" })).toHaveTextContent(
      /^Compile to PDF$/,
    );
  });
  it("renames inline with Enter and cancels with Escape", () => {
    const view = setup();
    fireEvent.contextMenu(row("main.tex"));
    fireEvent.click(screen.getByRole("button", { name: "Rename…" }));
    const input = screen.getByLabelText("Rename main.tex");
    fireEvent.change(input, { target: { value: "paper.tex" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(view.onRenameEntry).toHaveBeenCalledWith(main, "paper.tex");
    expect(view.onOpen).not.toHaveBeenCalled();

    fireEvent.contextMenu(row("README.md"));
    fireEvent.click(screen.getByRole("button", { name: "Rename…" }));
    fireEvent.keyDown(screen.getByLabelText("Rename README.md"), { key: "Escape" });
    expect(screen.queryByLabelText("Rename README.md")).not.toBeInTheDocument();
    expect(view.onRenameEntry).toHaveBeenCalledTimes(1);
  });
  it("cuts or copies an entry and pastes it into a folder", () => {
    const view = setup();
    fireEvent.contextMenu(row("sections"));
    expect(screen.getByRole("button", { name: "Paste" })).toBeDisabled();

    fireEvent.contextMenu(row("main.tex"));
    fireEvent.click(screen.getByRole("button", { name: "Cut" }));
    expect(row("main.tex")).toHaveClass("cut");
    fireEvent.contextMenu(row("appendix"));
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    expect(view.onPasteEntry).toHaveBeenCalledWith(main.path, "cut", target);
    expect(row("main.tex")).not.toHaveClass("cut");

    fireEvent.contextMenu(row("README.md"));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    fireEvent.contextMenu(row("appendix"));
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    expect(view.onPasteEntry).toHaveBeenLastCalledWith(
      file("README.md").path,
      "copy",
      target,
    );
  });
  it("moves files between directories and from a directory to root", () => {
    const view = setup(),
      data = transfer();
    fireEvent.dragStart(row("intro.tex"), { dataTransfer: data });
    expect(data.getData("text/plain")).toBe(nested.path);
    fireEvent.dragOver(row("appendix"), { dataTransfer: data });
    fireEvent.drop(row("appendix"), { dataTransfer: data });
    expect(view.onMoveEntry).toHaveBeenCalledWith(nested.path, target);
    fireEvent.dragStart(row("intro.tex"), { dataTransfer: data });
    const root = view.container.querySelector(".file-tree-drop-surface")!;
    fireEvent.dragOver(root, { dataTransfer: data });
    expect(root).toHaveClass("root-drop-target");
    fireEvent.drop(root, { dataTransfer: data });
    expect(view.onMoveEntry).toHaveBeenLastCalledWith(nested.path, null);
    expect(
      screen.queryByText("Drop in this space to move to the project root"),
    ).not.toBeInTheDocument();
  });
  it("rejects dropping into the same parent or a directory onto itself", () => {
    const view = setup(),
      data = transfer();
    fireEvent.dragStart(row("intro.tex"), { dataTransfer: data });
    fireEvent.dragOver(row("sections"), { dataTransfer: data });
    fireEvent.drop(row("sections"), { dataTransfer: data });
    expect(view.onMoveEntry).not.toHaveBeenCalled();
    fireEvent.dragEnd(row("intro.tex"), { dataTransfer: data });
    fireEvent.dragStart(row("sections"), { dataTransfer: data });
    fireEvent.drop(row("sections"), { dataTransfer: data });
    expect(view.onMoveEntry).not.toHaveBeenCalled();
  });
  it("imports external files into the hovered directory or project root", () => {
    const view = setup(),
      files = [new File(["text"], "external.tex")],
      data = transfer(files);
    fireEvent.dragOver(row("sections"), { dataTransfer: data });
    expect(data.dropEffect).toBe("copy");
    fireEvent.drop(row("sections"), { dataTransfer: data });
    expect(view.onImportExternalFiles).toHaveBeenCalledWith(files, folder);
    const root = view.container.querySelector(".file-tree-drop-surface")!;
    fireEvent.dragOver(root, { dataTransfer: data });
    expect(
      screen.getByText("Drop files here to import into the project root"),
    ).toBeInTheDocument();
    fireEvent.dragLeave(root, { dataTransfer: data, relatedTarget: document.body });
    expect(root).not.toHaveClass("root-drop-target");
    fireEvent.drop(root, { dataTransfer: data });
    expect(view.onImportExternalFiles).toHaveBeenLastCalledWith(files, null);
  });
  it("opens collapsed folders while hovering and cancels expansion when leaving", () => {
    vi.useFakeTimers();
    setup();
    fireEvent.click(row("sections"));
    const data = transfer([new File(["x"], "x.tex")]);
    fireEvent.dragOver(row("sections"), { dataTransfer: data });
    fireEvent.dragLeave(row("sections"), {
      dataTransfer: data,
      relatedTarget: document.body,
    });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByText("intro.tex")).not.toBeInTheDocument();
    fireEvent.dragOver(row("sections"), { dataTransfer: data });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByText("intro.tex")).toBeInTheDocument();
  });
});
