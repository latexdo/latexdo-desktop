import { describe, expect, it } from "vitest";
import { Uri as URI } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { editorModelMatchesPath } from "./appShared";

// @monaco-editor/react names models with Uri.parse(path).
const editorFor = (path: string) =>
  ({
    getModel: () => ({ uri: URI.parse(path) }),
  }) as unknown as Monaco.editor.IStandaloneCodeEditor;

describe("editorModelMatchesPath", () => {
  it("matches absolute desktop paths", () => {
    expect(
      editorModelMatchesPath(
        editorFor("/Users/me/paper/main.tex"),
        "/Users/me/paper/main.tex",
      ),
    ).toBe(true);
  });

  it("matches relative cloud project paths", () => {
    const path = "project_034c/ist/archive.tex";
    expect(editorModelMatchesPath(editorFor(path), path)).toBe(true);
    expect(editorModelMatchesPath(editorFor("main.tex"), "main.tex")).toBe(true);
  });

  it("rejects a different file", () => {
    expect(editorModelMatchesPath(editorFor("ist/archive.tex"), "main.tex")).toBe(
      false,
    );
    expect(editorModelMatchesPath(editorFor("/main.tex"), "/other/main.tex")).toBe(
      false,
    );
  });
});
