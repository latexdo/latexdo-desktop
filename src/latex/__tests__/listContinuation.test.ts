import { describe, expect, it } from "vitest";
import { getLatexListEnterEdit } from "../listContinuation";

function applyEnter(textWithCursor: string): string {
  const cursorOffset = textWithCursor.indexOf("|");
  expect(cursorOffset).toBeGreaterThanOrEqual(0);
  const text = textWithCursor.replace("|", "");
  const edit = getLatexListEnterEdit(text, cursorOffset);
  expect(edit).not.toBeNull();
  if (!edit) return textWithCursor;
  return `${text.slice(0, edit.startOffset)}${edit.text.slice(0, edit.cursorOffset)}|${edit.text.slice(edit.cursorOffset)}${text.slice(edit.endOffset)}`;
}

it("returns no edit outside a list environment", () => {
  expect(getLatexListEnterEdit("Plain text|".replace("|", ""), 10)).toBeNull();
});

describe("getLatexListEnterEdit", () => {
  it("continues an itemize list with the current item indentation", () => {
    expect(applyEnter("\\begin{itemize}\n  \\item First|\n\\end{itemize}")).toBe(
      "\\begin{itemize}\n  \\item First\n  \\item |\n\\end{itemize}",
    );
  });

  it("starts the first item after a begin line", () => {
    expect(applyEnter("\\begin{enumerate}|")).toBe("\\begin{enumerate}\n\t\\item |");
  });

  it("turns a blank line inside itemize into an item without adding another blank line", () => {
    expect(applyEnter("\\begin{itemize}\n  |\n\\end{itemize}")).toBe(
      "\\begin{itemize}\n  \\item |\n\\end{itemize}",
    );
  });

  it("continues then closes itemize on a double enter", () => {
    const afterFirstEnter = applyEnter(
      "\\begin{itemize}\n  \\item First|\n\\end{itemize}",
    );
    expect(afterFirstEnter).toBe(
      "\\begin{itemize}\n  \\item First\n  \\item |\n\\end{itemize}",
    );

    expect(applyEnter(afterFirstEnter)).toBe(
      "\\begin{itemize}\n  \\item First\n\\end{itemize}|",
    );
  });

  it("closes the open list when enter is pressed on an empty item", () => {
    expect(applyEnter("\\begin{itemize}\n  \\item |")).toBe(
      "\\begin{itemize}\n\\end{itemize}|",
    );
  });

  it("removes the empty item and moves after an existing end line", () => {
    expect(
      applyEnter("\\begin{itemize}\n  \\item First\n  \\item |\n\\end{itemize}\nNext"),
    ).toBe("\\begin{itemize}\n  \\item First\n\\end{itemize}|\nNext");
  });

  it("closes the nearest open nested list environment", () => {
    expect(
      applyEnter(
        "\\begin{itemize}\n  \\item Parent\n  \\begin{enumerate}\n    \\item |\n  \\end{enumerate}\n\\end{itemize}",
      ),
    ).toBe(
      "\\begin{itemize}\n  \\item Parent\n  \\begin{enumerate}\n  \\end{enumerate}|\n\\end{itemize}",
    );
  });

  it("ignores list commands inside comments", () => {
    expect(
      getLatexListEnterEdit(
        "% \\begin{itemize}\nStill normal".replace("|", ""),
        "% \\begin{itemize}\nStill normal".length,
      ),
    ).toBeNull();
  });

  it("supports description lists", () => {
    expect(applyEnter("\\begin{description}\n  \\item[Term] Definition|")).toBe(
      "\\begin{description}\n  \\item[Term] Definition\n  \\item |",
    );
  });
});
