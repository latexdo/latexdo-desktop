import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ config: vi.fn(), monaco: { id: "monaco" } }));

vi.mock("monaco-editor", () => mocks.monaco);
vi.mock("@monaco-editor/react", () => ({
  default: (props: { value?: string }) => <div data-testid="editor">{props.value}</div>,
  DiffEditor: (props: { original?: string; modified?: string }) => (
    <div data-testid="diff">
      {props.original}|{props.modified}
    </div>
  ),
  loader: { config: mocks.config },
}));

import { MonacoDiffEditor, MonacoEditor } from "./MonacoEditor";

describe("MonacoEditor", () => {
  it("configures the loader with the bundled monaco instance", () => {
    expect(mocks.config).toHaveBeenCalledTimes(1);
    expect(mocks.config.mock.calls[0][0].monaco).toMatchObject({ id: "monaco" });
  });

  it("forwards props to the editor and the diff editor", () => {
    render(
      <>
        <MonacoEditor value="hello" />
        <MonacoDiffEditor original="a" modified="b" />
      </>,
    );
    expect(screen.getByTestId("editor")).toHaveTextContent("hello");
    expect(screen.getByTestId("diff")).toHaveTextContent("a|b");
  });
});
