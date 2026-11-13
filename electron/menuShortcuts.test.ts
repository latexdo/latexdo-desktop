import { describe, expect, it } from "vitest";
import {
  acceleratorFromInput,
  acceleratorSignature,
  isAssignableAccelerator,
  parseAccelerator,
  parseShortcutOverrides,
  serializeShortcutOverrides,
  type RecordedKeyInput,
} from "./menuShortcuts.js";

const key = (input: Partial<RecordedKeyInput>): RecordedKeyInput => ({
  type: "keyDown",
  code: "",
  key: "",
  shift: false,
  control: false,
  alt: false,
  meta: false,
  ...input,
});

describe("menu shortcuts", () => {
  it("parses the accelerators the menu uses", () => {
    expect(parseAccelerator("CmdOrCtrl+T")).toEqual({
      modifiers: ["CmdOrCtrl"],
      key: "T",
    });
    expect(parseAccelerator("CmdOrCtrl+-")).toEqual({
      modifiers: ["CmdOrCtrl"],
      key: "-",
    });
    expect(parseAccelerator("Ctrl+Shift+Tab")?.key).toBe("Tab");
    expect(parseAccelerator("CmdOrCtrl+Shift+\\")?.key).toBe("\\");
    expect(parseAccelerator("F8")).toEqual({ modifiers: [], key: "F8" });
    for (const bad of [
      "",
      "CmdOrCtrl+",
      "Hyper+T",
      "Cmd+Cmd+T",
      "CmdOrCtrl+TT",
      "Ctrl+F25",
    ]) {
      expect(parseAccelerator(bad)).toBeNull();
    }
  });

  it("only assigns keys that cannot be ordinary typing", () => {
    expect(isAssignableAccelerator("CmdOrCtrl+T")).toBe(true);
    expect(isAssignableAccelerator("Alt+Shift+F")).toBe(true);
    expect(isAssignableAccelerator("F5")).toBe(true);
    expect(isAssignableAccelerator("T")).toBe(false);
    expect(isAssignableAccelerator("Shift+T")).toBe(false);
    expect(isAssignableAccelerator("CmdOrCtrl+Escape")).toBe(false);
  });

  it("compares accelerators by the keys pressed on this platform", () => {
    expect(acceleratorSignature("CmdOrCtrl+Shift+T", true)).toBe(
      acceleratorSignature("Shift+Cmd+T", true),
    );
    expect(acceleratorSignature("CmdOrCtrl+T", false)).toBe(
      acceleratorSignature("Ctrl+T", false),
    );
    expect(acceleratorSignature("CmdOrCtrl+T", true)).not.toBe(
      acceleratorSignature("Ctrl+T", true),
    );
    expect(acceleratorSignature("CmdOrCtrl+Return", true)).toBe(
      acceleratorSignature("Cmd+Enter", true),
    );
  });

  it("records the physical key with the platform's main modifier", () => {
    expect(acceleratorFromInput(key({ code: "KeyT", meta: true }), true)).toBe(
      "CmdOrCtrl+T",
    );
    expect(acceleratorFromInput(key({ code: "KeyT", control: true }), false)).toBe(
      "CmdOrCtrl+T",
    );
    // ⌥ changes the typed character on a Mac; the key is still S.
    expect(
      acceleratorFromInput(
        key({ code: "KeyS", key: "ß", meta: true, alt: true }),
        true,
      ),
    ).toBe("CmdOrCtrl+Alt+S");
    expect(acceleratorFromInput(key({ code: "KeyG", control: true }), true)).toBe(
      "Ctrl+G",
    );
    expect(acceleratorFromInput(key({ code: "ArrowUp", alt: true }), false)).toBe(
      "Alt+Up",
    );
    expect(acceleratorFromInput(key({ code: "Digit1", control: true }), false)).toBe(
      "CmdOrCtrl+1",
    );
    expect(acceleratorFromInput(key({ code: "F5" }), false)).toBe("F5");
    expect(
      acceleratorFromInput(key({ code: "MetaLeft", meta: true }), true),
    ).toBeNull();
  });

  it("keeps only valid stored overrides", () => {
    const text = serializeShortcutOverrides({
      "build.compile": "CmdOrCtrl+T",
      "file.save": "",
    });
    expect(parseShortcutOverrides(JSON.parse(text))).toEqual({
      "build.compile": "CmdOrCtrl+T",
      "file.save": "",
    });
    expect(
      parseShortcutOverrides({
        version: 1,
        overrides: { good: "Alt+F", bare: "K", number: 3, "": "CmdOrCtrl+K" },
      }),
    ).toEqual({ good: "Alt+F" });
    expect(parseShortcutOverrides({ version: 2, overrides: { a: "Alt+F" } })).toEqual(
      {},
    );
    expect(parseShortcutOverrides(null)).toEqual({});
  });
});
