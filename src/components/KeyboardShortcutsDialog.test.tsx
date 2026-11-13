import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MenuShortcut, MenuShortcutRecording } from "../../electron/types";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";

const compile: MenuShortcut = {
  menu: "Build",
  label: "Compile",
  keys: "⌘T",
  editorOnly: false,
  id: "build.compile",
};
const saveAll: MenuShortcut = {
  menu: "File",
  label: "Save All",
  keys: "",
  editorOnly: false,
  id: "file.saveAll",
};
const goToLine: MenuShortcut = {
  menu: "Go",
  label: "Go to Line",
  keys: "⌃G",
  editorOnly: true,
};

function installApi(shortcuts: MenuShortcut[]) {
  let finishRecording: (result: MenuShortcutRecording) => void = () => undefined;
  const api = {
    getMenuShortcuts: vi.fn(async () => shortcuts),
    recordMenuShortcut: vi.fn(
      () =>
        new Promise<MenuShortcutRecording>((resolve) => {
          finishRecording = resolve;
        }),
    ),
    cancelMenuShortcutRecording: vi.fn(async () => {
      finishRecording({ status: "cancelled" });
    }),
    setMenuShortcut: vi.fn(),
    resetMenuShortcut: vi.fn(),
  };
  Object.defineProperty(window, "latexdo", { configurable: true, value: api });
  return { api, finish: (result: MenuShortcutRecording) => finishRecording(result) };
}

afterEach(() => {
  Reflect.deleteProperty(window, "latexdo");
});

describe("KeyboardShortcutsDialog", () => {
  it("records new keys for a command and offers to restore the default", async () => {
    const { api, finish } = installApi([compile, goToLine]);
    api.setMenuShortcut.mockResolvedValue({
      ok: true,
      shortcuts: [{ ...compile, keys: "⇧⌘B", defaultKeys: "⌘T" }, goToLine],
    });
    render(<KeyboardShortcutsDialog open onClose={vi.fn()} />);

    // Editor keys belong to the editor and are shown, not edited.
    expect(await screen.findByText("⌃G")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Change the shortcut for Go to Line" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Change the shortcut for Compile" }),
    );
    expect(
      await screen.findByRole("button", { name: "Press the new shortcut for Compile" }),
    ).toHaveTextContent("Press keys…");
    await act(async () =>
      finish({ status: "recorded", accelerator: "CmdOrCtrl+Shift+B", keys: "⇧⌘B" }),
    );
    expect(api.setMenuShortcut).toHaveBeenCalledWith(
      "build.compile",
      "CmdOrCtrl+Shift+B",
    );
    expect(await screen.findByText("⇧⌘B")).toBeVisible();
    expect(screen.getByText("default ⌘T")).toBeVisible();

    api.resetMenuShortcut.mockResolvedValue([compile, goToLine]);
    fireEvent.click(
      screen.getByRole("button", { name: "Restore the default shortcut for Compile" }),
    );
    expect(api.resetMenuShortcut).toHaveBeenCalledWith("build.compile");
    expect(await screen.findByText("⌘T")).toBeVisible();
  });

  it("shows why keys were refused and lets the user try again", async () => {
    const { api, finish } = installApi([compile]);
    api.setMenuShortcut.mockResolvedValue({
      ok: false,
      error: "⌘S is already used by “Save”.",
    });
    render(<KeyboardShortcutsDialog open onClose={vi.fn()} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Change the shortcut for Compile" }),
    );
    await act(async () =>
      finish({ status: "recorded", accelerator: "CmdOrCtrl+S", keys: "⌘S" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "already used by “Save”",
    );
    expect(screen.getByText("⌘T")).toBeVisible();
  });

  it("keeps listening after a bare key and stops on Escape", async () => {
    const { api, finish } = installApi([compile]);
    const onClose = vi.fn();
    render(<KeyboardShortcutsDialog open onClose={onClose} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Change the shortcut for Compile" }),
    );
    await act(async () =>
      finish({ status: "invalid", keys: "K", error: "Use ⌘, ⌃ or ⌥ with the key." }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("K: Use ⌘");
    expect(api.recordMenuShortcut).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(api.cancelMenuShortcutRecording).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: "Change the shortcut for Compile" }),
    ).toBeVisible();
  });

  it("lists commands without keys on request so they can get one", async () => {
    installApi([compile, saveAll]);
    render(<KeyboardShortcutsDialog open onClose={vi.fn()} />);
    const dialog = await screen.findByRole("dialog", { name: "Keyboard Shortcuts" });
    await within(dialog).findByText("Compile");
    expect(within(dialog).queryByText("Save All")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText("Show commands without a shortcut"));
    expect(
      within(dialog).getByRole("button", { name: "Change the shortcut for Save All" }),
    ).toHaveTextContent("Add");
  });
});
