import { describe, expect, it } from "vitest";
import type { OpenDocument } from "../types";
import { markDocumentsSaved } from "./markDocumentsSaved";

const doc = (relativePath: string, content: string, savedContent: string) =>
  ({
    path: `/p/${relativePath}`,
    relativePath,
    name: relativePath,
    kind: "text",
    content,
    savedContent,
  }) satisfies OpenDocument;

describe("markDocumentsSaved", () => {
  it("marks a document clean when nothing changed during the write", () => {
    const [saved] = markDocumentsSaved(
      [doc("main.tex", "A", "old")],
      new Map([["main.tex", { from: "A", written: "A" }]]),
    );
    expect(saved).toMatchObject({ content: "A", savedContent: "A" });
  });

  it("keeps edits typed while the save was running, and keeps them unsaved", () => {
    const [saved] = markDocumentsSaved(
      [doc("main.tex", "A typed during save", "old")],
      new Map([["main.tex", { from: "A", written: "A" }]]),
    );
    expect(saved.content).toBe("A typed during save");
    expect(saved.savedContent).toBe("A");
    expect(saved.content).not.toBe(saved.savedContent);
  });

  it("applies content rewritten on save (normalized markup) only when unchanged", () => {
    const writes = new Map([["main.tex", { from: "raw", written: "normalized" }]]);
    expect(markDocumentsSaved([doc("main.tex", "raw", "")], writes)[0]).toMatchObject({
      content: "normalized",
      savedContent: "normalized",
    });
    expect(
      markDocumentsSaved([doc("main.tex", "raw+edit", "")], writes)[0],
    ).toMatchObject({ content: "raw+edit", savedContent: "normalized" });
  });

  it("leaves documents that were not written untouched", () => {
    const other = doc("other.tex", "x", "y");
    expect(
      markDocumentsSaved(
        [other],
        new Map([["main.tex", { from: "A", written: "A" }]]),
      )[0],
    ).toBe(other);
  });
});
