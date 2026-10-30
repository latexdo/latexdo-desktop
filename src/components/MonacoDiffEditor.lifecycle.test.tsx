import { useEffect } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DiffEditorProps } from "@monaco-editor/react";

const state = vi.hoisted(() => ({ events: [] as string[] }));
vi.mock("monaco-editor", () => ({}));
vi.mock("@monaco-editor/react", () => ({
  loader: { config: vi.fn() },
  default: () => null,
  DiffEditor: (props: DiffEditorProps) => {
    useEffect(() => {
      let attached = true;
      const model = (side: string) => ({
        dispose: () => {
          if (attached)
            throw new Error(
              "TextModel got disposed before DiffEditorWidget model got reset",
            );
          state.events.push(`${props.original}:${side}`);
        },
      });
      const models = { original: model("original"), modified: model("modified") };
      const editor = {
        getModel: () => (attached ? models : null),
        setModel: () => {
          attached = false;
          state.events.push(`${props.original}:detach`);
        },
      };
      props.onMount?.(
        editor as unknown as Parameters<NonNullable<DiffEditorProps["onMount"]>>[0],
        {} as Parameters<NonNullable<DiffEditorProps["onMount"]>>[1],
      );
      return () => {
        // Reproduce the installed wrapper's model-before-widget disposal order.
        const current = editor.getModel();
        if (!props.keepCurrentOriginalModel) current?.original.dispose();
        if (!props.keepCurrentModifiedModel) current?.modified.dispose();
        state.events.push(`${props.original}:widget`);
      };
    }, []);
    return null;
  },
}));

import { MonacoDiffEditor } from "./MonacoEditor";
afterEach(() => {
  cleanup();
  state.events = [];
});

it("detaches before releasing either model when closing a diff", () => {
  const onMount = vi.fn();
  const { unmount } = render(<MonacoDiffEditor original="a" onMount={onMount} />);
  expect(onMount).toHaveBeenCalledOnce();
  expect(() => unmount()).not.toThrow();
  expect(state.events).toEqual(["a:detach", "a:original", "a:modified", "a:widget"]);
});

it("safely replaces a diff session and cleans up both sessions", () => {
  const { rerender, unmount } = render(<MonacoDiffEditor key="a" original="a" />);
  rerender(<MonacoDiffEditor key="b" original="b" />);
  unmount();
  expect(state.events).toEqual([
    "a:detach",
    "a:original",
    "a:modified",
    "a:widget",
    "b:detach",
    "b:original",
    "b:modified",
    "b:widget",
  ]);
});

it("retains caller-owned models while still detaching the diff", () => {
  const { unmount } = render(
    <MonacoDiffEditor
      original="kept"
      keepCurrentOriginalModel
      keepCurrentModifiedModel
    />,
  );
  unmount();
  expect(state.events).toEqual(["kept:detach", "kept:widget"]);
});
