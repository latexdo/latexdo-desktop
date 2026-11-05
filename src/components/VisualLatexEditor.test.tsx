import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisualLatexEditor } from "./VisualLatexEditor";

vi.mock("../latex/mathPreview", () => ({
  mathPreviewDataUri: (tex: string) =>
    tex.includes("bad") ? null : `data:image/svg+xml,${tex}`,
}));

const paper = [
  "\\documentclass{article}",
  "\\title{Hello}",
  "\\begin{document}",
  "\\maketitle",
  "",
  "\\section{Intro}\\label{sec:intro}",
  "First paragraph with \\textbf{bold} and \\cite{knuth}.",
  "",
  "Second paragraph.",
  "",
  "\\begin{itemize}",
  "  \\item One",
  "\\end{itemize}",
  "",
  "\\begin{equation}",
  "  E = mc^2",
  "\\end{equation}",
  "\\end{document}",
  "",
].join("\n");

const execCommand = vi.fn<(command: string, ui?: boolean, value?: string) => boolean>(
  () => true,
);

beforeEach(() => {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand,
  });
  Object.defineProperty(document, "queryCommandState", {
    configurable: true,
    value: (command: string) => command === "bold",
  });
  execCommand.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

function root(): HTMLElement {
  return document.querySelector(".vl-root") as HTMLElement;
}

function paragraph(text: string): HTMLElement {
  return Array.from(root().children).find((child) =>
    child.textContent?.includes(text),
  ) as HTMLElement;
}

function caretAtEnd(element: Node) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function typeInto(element: HTMLElement, text: string) {
  caretAtEnd(element);
  element.append(text);
  fireEvent.input(root());
}

function setup(props: Partial<Parameters<typeof VisualLatexEditor>[0]> = {}) {
  const onChange = vi.fn();
  const view = render(
    <VisualLatexEditor content={paper} onChange={onChange} {...props} />,
  );
  return { ...view, onChange, last: () => onChange.mock.calls.at(-1)?.[0] as string };
}

describe("VisualLatexEditor page", () => {
  it("shows the document like a word processor and keeps the preamble off the page", async () => {
    setup();
    expect(screen.getByRole("textbox", { name: "Document" })).toHaveAttribute(
      "contenteditable",
      "true",
    );
    expect(root().textContent).not.toContain("documentclass");
    expect(root().querySelector("h2")!.textContent).toBe("Intro");
    expect(screen.getByText("[knuth]")).toHaveClass("vl-token-citation");
    expect(root().querySelector("strong")!.textContent).toBe("bold");
    // Objects mount into the page.
    expect(await screen.findByRole("textbox", { name: "Title" })).toHaveTextContent(
      "Hello",
    );
    expect(
      screen.getByRole("button", { name: "Equation" }).querySelector("img"),
    ).not.toBeNull();
    expect(screen.getByText("10 words")).toBeInTheDocument();
  });

  it("writes typing back as LaTeX and leaves the rest untouched", () => {
    const { last } = setup();
    typeInto(paragraph("Second paragraph"), " 50% & more");
    expect(last()).toBe(
      paper.replace("Second paragraph.", "Second paragraph. 50\\% \\& more"),
    );
  });

  it("re-renders when the source changes outside the page", () => {
    const { rerender, onChange } = setup();
    rerender(
      <VisualLatexEditor content={"\\section{New}\nBody"} onChange={onChange} />,
    );
    expect(root().querySelector("h2")!.textContent).toBe("New");
    expect(onChange).not.toHaveBeenCalled();
    // An empty page keeps a paragraph to type in.
    root().replaceChildren();
    fireEvent.input(root());
    expect(root().innerHTML).toBe("<p><br></p>");
  });

  it("undoes and redoes with its own history, from keys, menu and ribbon", () => {
    vi.useFakeTimers();
    const { last } = setup();
    typeInto(paragraph("Second paragraph"), " A");
    vi.advanceTimersByTime(2000);
    typeInto(paragraph("Second paragraph"), " B");
    expect(last()).toContain("Second paragraph. A B");

    fireEvent.keyDown(root(), { key: "z", metaKey: true });
    expect(last()).toContain("Second paragraph. A\n");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(last()).toBe(paper);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(last()).toBe(paper);
    fireEvent.keyDown(root(), { key: "z", ctrlKey: true, shiftKey: true });
    expect(last()).toContain("Second paragraph. A\n");
    const redo = new InputEvent("beforeinput", {
      inputType: "historyRedo",
      bubbles: true,
      cancelable: true,
    });
    root().dispatchEvent(redo);
    expect(redo.defaultPrevented).toBe(true);
    expect(last()).toContain("Second paragraph. A B");
    root().dispatchEvent(
      new InputEvent("beforeinput", {
        inputType: "historyUndo",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(last()).toContain("Second paragraph. A\n");
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    fireEvent.keyDown(root(), { key: "y", ctrlKey: true });
    expect(last()).toContain("Second paragraph. A B");
    // Other keys and inputs pass through.
    fireEvent.keyDown(root(), { key: "a", metaKey: true });
    root().dispatchEvent(
      new InputEvent("beforeinput", { inputType: "insertText", bubbles: true }),
    );
  });

  it("groups typing in one place into one undo step", () => {
    const { last } = setup();
    typeInto(paragraph("Second paragraph"), "x");
    typeInto(paragraph("Second paragraph"), "y");
    typeInto(paragraph("First paragraph"), "z");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(last()).toContain("Second paragraph.xy");
    expect(last()).not.toContain("knuth}.z");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(last()).toBe(paper);
  });
});

describe("ribbon", () => {
  it("runs formatting commands and shows the current style", () => {
    setup();
    caretAtEnd(paragraph("Second paragraph").firstChild!);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(screen.getByRole("combobox", { name: "Paragraph style" })).toHaveValue("P");
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const [label, command] of [
      ["Bold", "bold"],
      ["Italic", "italic"],
      ["Underline", "underline"],
      ["Superscript", "superscript"],
      ["Subscript", "subscript"],
      ["Clear formatting", "removeFormat"],
      ["Bulleted list", "insertUnorderedList"],
      ["Numbered list", "insertOrderedList"],
    ]) {
      fireEvent.mouseDown(screen.getByRole("button", { name: label }));
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(execCommand).toHaveBeenLastCalledWith(command, false, undefined);
    }
    caretAtEnd(root().querySelector("h2")!.firstChild!);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(screen.getByRole("combobox", { name: "Paragraph style" })).toHaveValue("H2");
    caretAtEnd(root().querySelector("li")!.firstChild!);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(screen.getByRole("button", { name: "Bulleted list" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("changes a paragraph style, keeping a heading's label", () => {
    const { last } = setup();
    execCommand.mockImplementation((command, _ui, value) => {
      if (command === "formatBlock") {
        const selection = window.getSelection()!;
        let node: Node | null = selection.getRangeAt(0).startContainer;
        while (node && node.parentNode !== root()) node = node.parentNode;
        const replacement = document.createElement(value!);
        replacement.append(...Array.from((node as HTMLElement).childNodes));
        (node as HTMLElement).replaceWith(replacement);
        caretAtEnd(replacement);
      }
      return true;
    });
    caretAtEnd(root().querySelector("h2")!.firstChild!);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Paragraph style" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Paragraph style" }), {
      target: { value: "H3" },
    });
    expect(last()).toContain("\n\\subsection{Intro}\\label{sec:intro}\n");
    caretAtEnd(paragraph("Second paragraph").firstChild!);
    fireEvent.change(screen.getByRole("combobox", { name: "Paragraph style" }), {
      target: { value: "H2" },
    });
    expect(last()).toContain("\\section{Second paragraph.}");
    caretAtEnd(root().querySelector("li")!.firstChild!);
    fireEvent.change(screen.getByRole("combobox", { name: "Paragraph style" }), {
      target: { value: "P" },
    });
    expect(execCommand).toHaveBeenCalledWith("insertUnorderedList", false, undefined);
    execCommand.mockImplementation(() => true);
  });

  it("offers Chapter only in books and reports", () => {
    setup({ content: "\\documentclass{book}\n\\begin{document}\nx\n\\end{document}" });
    expect(screen.getByRole("option", { name: "Chapter" })).toBeInTheDocument();
  });

  it("wraps and unwraps code", () => {
    const { last } = setup();
    const text = paragraph("Second paragraph").firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 6);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.click(screen.getByRole("button", { name: "Code (monospace)" }));
    expect(last()).toContain("\\texttt{Second} paragraph.");
    caretAtEnd(root().querySelector("code")!.firstChild!);
    fireEvent.click(screen.getByRole("button", { name: "Code (monospace)" }));
    expect(last()).toContain("\nSecond paragraph.\n");
    caretAtEnd(paragraph("Second paragraph"));
    fireEvent.click(screen.getByRole("button", { name: "Code (monospace)" }));
  });

  it.each([
    ["Insert citation", "Citation key", "lamport94", "\\cite{lamport94}"],
    ["Insert cross-reference", "Label to refer to", "sec:intro", "\\ref{sec:intro}"],
    ["Insert footnote", "Footnote text", "100% sure", "\\footnote{100\\% sure}"],
    ["Insert inline math", "Math (TeX)", "x^2", "$x^2$"],
    [
      "Insert link (⌘K)",
      "Link address",
      "https://x.org",
      "\\href{https://x.org}{https://x.org}",
    ],
  ])(
    "%s asks for a value and inserts it at the caret",
    (button, label, value, latex) => {
      Object.defineProperty(navigator, "platform", {
        configurable: true,
        value: "MacIntel",
      });
      const { last } = setup();
      caretAtEnd(paragraph("Second paragraph").firstChild!);
      fireEvent.click(screen.getByRole("button", { name: button }));
      fireEvent.change(screen.getByRole("textbox", { name: label }), {
        target: { value },
      });
      fireEvent.submit(screen.getByRole("textbox", { name: label }).closest("form")!);
      expect(last()).toContain(`Second paragraph.${latex}`);
    },
  );

  it("links a selection, and cancels or ignores empty prompts", () => {
    setup();
    const text = paragraph("Second paragraph").firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 6);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.keyDown(root(), { key: "k", metaKey: true });
    fireEvent.change(screen.getByRole("textbox", { name: "Link address" }), {
      target: { value: "https://a.b" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(execCommand).toHaveBeenCalledWith("createLink", false, "https://a.b");
    fireEvent.click(screen.getByRole("button", { name: "Insert citation" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert citation" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Citation key" }), {
      key: "Escape",
    });
    expect(
      screen.queryByRole("textbox", { name: "Citation key" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Insert citation" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Citation key" }), {
      key: "a",
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("textbox", { name: "Citation key" }),
    ).not.toBeInTheDocument();
  });

  it("inserts tables, equations and page breaks after the current block", async () => {
    const { last } = setup();
    caretAtEnd(paragraph("Second paragraph").firstChild!);
    fireEvent.click(screen.getByRole("button", { name: "Insert table" }));
    expect(last()).toContain("Second paragraph.\n\n\\begin{table}[ht]");
    caretAtEnd(paragraph("Second paragraph").firstChild!);
    fireEvent.click(screen.getByRole("button", { name: "Insert page break" }));
    expect(last()).toContain("Second paragraph.\n\n\\newpage");
    fireEvent.click(screen.getByRole("button", { name: "Insert equation" }));
    expect(
      await screen.findByRole("textbox", { name: "Equation source" }),
    ).toHaveFocus();
    // With no caret in the page, objects go at the end with a paragraph after.
    window.getSelection()!.removeAllRanges();
    fireEvent.click(screen.getByRole("button", { name: "Insert page break" }));
    expect(root().lastElementChild!.tagName).toBe("P");
  });

  it("inserts chosen images as figures", async () => {
    const importImages = vi.fn(async (files: File[]) =>
      files.map((file) => `figures/${file.name}`),
    );
    const { last } = setup({ importImages, figureSource: (path) => `\\fig{${path}}` });
    const input = document.querySelector(
      'input[type="file"][multiple]',
    ) as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Insert image" }));
    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(last()).toContain("\\fig{figures/a.png}"));
    fireEvent.change(input, { target: { files: [] } });
  });
});

describe("keyboard", () => {
  it("uses Tab to indent lists and the word-processor shortcuts", () => {
    setup();
    caretAtEnd(root().querySelector("li")!.firstChild!);
    fireEvent.keyDown(root(), { key: "Tab" });
    expect(execCommand).toHaveBeenLastCalledWith("indent", false, undefined);
    fireEvent.keyDown(root(), { key: "Tab", shiftKey: true });
    expect(execCommand).toHaveBeenLastCalledWith("outdent", false, undefined);
    caretAtEnd(paragraph("Second paragraph").firstChild!);
    execCommand.mockClear();
    fireEvent.keyDown(root(), { key: "Tab" });
    expect(execCommand).not.toHaveBeenCalled();
    for (const [key, command] of [
      ["b", "bold"],
      ["i", "italic"],
      ["u", "underline"],
    ]) {
      fireEvent.keyDown(root(), { key, ctrlKey: true });
      expect(execCommand).toHaveBeenLastCalledWith(command, false, undefined);
    }
  });

  it("leaves keys and input inside objects to them", async () => {
    const { onChange } = setup();
    const source = await screen.findByRole("textbox", { name: "Title" });
    fireEvent.keyDown(source, { key: "Tab" });
    fireEvent.input(source);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not follow links while editing", () => {
    setup({ content: "\\href{https://x.org}{site}" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    root().querySelector("a")!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });
});

describe("paste", () => {
  function paste(target: HTMLElement, data: Record<string, string>) {
    const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { getData: (type: string) => string };
    };
    event.clipboardData = { getData: (type) => data[type] ?? "" };
    target.dispatchEvent(event);
    return event;
  }

  it("pastes inline text and formatting at the caret", () => {
    const { last } = setup();
    caretAtEnd(paragraph("Second paragraph").firstChild!);
    const event = paste(root(), { "text/html": "<b>Bold</b> & co" });
    expect(event.defaultPrevented).toBe(true);
    expect(last()).toContain("Second paragraph.\\textbf{Bold} \\& co");
  });

  it("splits the paragraph for pasted paragraphs, like a word processor", () => {
    const { last } = setup();
    const text = paragraph("Second paragraph").firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 7);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    paste(root(), { "text/plain": "one\n\ntwo" });
    expect(last()).toContain("Second one\n\ntwoparagraph.");
  });

  it("puts pasted objects and headings between paragraphs", () => {
    const { last } = setup();
    const text = paragraph("Second paragraph").firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 7);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    paste(root(), { "text/html": "<h1>Head</h1><table><tr><td>a</td></tr></table>" });
    expect(last()).toMatch(
      /Second\n\n\\section\{Head\}\n\n\\begin\{table\}[\s\S]*\\end\{table\}\n\nparagraph\./,
    );
    caretAtEnd(root().querySelector("li")!.firstChild!);
    paste(root(), { "text/html": "<p>a</p><p>b</p>" });
    expect(last()).toContain("\\end{itemize}\n\na\n\nb");
    caretAtEnd(paragraph("First paragraph"));
    paste(root(), { "text/html": "<h1>Only a heading</h1>" });
    expect(last()).toContain("\\section{Only a heading}");
  });
});

describe("drag and drop", () => {
  function drag(
    type: "dragover" | "drop" | "dragleave",
    target: Element,
    init: { files?: File[]; text?: string; clientY?: number },
  ) {
    const data = {
      types: [...(init.files ? ["Files"] : []), ...(init.text ? ["text/plain"] : [])],
      files: init.files ?? [],
      getData: (format: string) => (format === "text/plain" ? (init.text ?? "") : ""),
      setData: vi.fn(),
      setDragImage: vi.fn(),
      dropEffect: "none",
      effectAllowed: "all",
    };
    fireEvent[
      type === "dragover" ? "dragOver" : type === "drop" ? "drop" : "dragLeave"
    ](target, {
      dataTransfer: data,
      clientY: init.clientY ?? 0,
    });
    return data;
  }

  it("drops image files as figures and project files as references", async () => {
    const importImages = vi.fn(async (files: File[]) =>
      files.map((file) => `figures/${file.name}`),
    );
    const { last } = setup({
      importImages,
      latexForProjectFile: (path) =>
        path.endsWith(".tex") ? `\\input{${path}}` : null,
    });
    const canvas = document.querySelector(".vl-canvas")!;
    const data = drag("dragover", canvas, {
      files: [new File(["x"], "a.png", { type: "image/png" })],
    });
    expect(data.dropEffect).toBe("copy");
    expect(document.querySelector(".vl-drop-line")).not.toBeNull();
    await act(async () => {
      drag("drop", canvas, {
        files: [
          new File(["x"], "a.png", { type: "image/png" }),
          new File(["x"], "notes.txt"),
        ],
      });
    });
    await waitFor(() =>
      expect(last()).toContain(
        "\\includegraphics[width=0.8\\linewidth]{figures/a.png}",
      ),
    );
    expect(importImages.mock.calls[0][0]).toHaveLength(1);
    await act(async () => {
      drag("drop", canvas, { files: [new File(["x"], "notes.txt")] });
    });
    expect(importImages).toHaveBeenCalledTimes(1);
    drag("dragover", canvas, { text: "/p/chapter.tex" });
    await act(async () => {
      drag("drop", canvas, { text: "/p/chapter.tex", clientY: 1 });
    });
    expect(last()).toContain("\\input{/p/chapter.tex}");
    drag("dragleave", canvas, {});
    expect(document.querySelector(".vl-drop-line")).toBeNull();
    await act(async () => {
      drag("drop", canvas, { text: "/p/data.csv" });
    });
  });

  it("moves a block with its drag handle", async () => {
    const { last } = setup();
    const canvas = document.querySelector(".vl-canvas")!;
    const target = paragraph("Second paragraph");
    fireEvent.mouseMove(target);
    fireEvent.mouseMove(target);
    const handle = document.querySelector(".vl-drag-handle")!;
    const data = {
      setData: vi.fn(),
      setDragImage: vi.fn(),
      effectAllowed: "",
      types: [] as string[],
    };
    fireEvent.dragStart(handle, { dataTransfer: data });
    // jsdom has no layout, so the drop lands after the last block.
    fireEvent.dragOver(canvas, {
      dataTransfer: { types: [], dropEffect: "" },
      clientY: 99999,
    });
    await act(async () => {
      fireEvent.drop(canvas, {
        dataTransfer: { types: [], files: [], getData: () => "" },
        clientY: 99999,
      });
    });
    expect(last()).toMatch(
      /\\end\{equation\}\n\nSecond paragraph\.\n\\end\{document\}/,
    );
    fireEvent.dragEnd(handle);
    fireEvent.mouseLeave(canvas);
    expect(document.querySelector(".vl-drag-handle")).toBeNull();
  });

  it("ignores other drags", () => {
    setup();
    const canvas = document.querySelector(".vl-canvas")!;
    const data = drag("dragover", canvas, {});
    expect(data.dropEffect).toBe("none");
  });
});

describe("objects", () => {
  it("edits the title in the preamble", async () => {
    const { last } = setup();
    const title = await screen.findByRole("textbox", { name: "Title" });
    title.textContent = "Better";
    fireEvent.input(title);
    expect(last()).toContain("\\title{Better}");
    const author = screen.getByRole("textbox", { name: "Author" });
    author.textContent = "Ada";
    fireEvent.input(author);
    expect(last()).toContain("\\author{Ada}\n\\begin{document}");
  });

  it("edits and deletes objects", async () => {
    const { last } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Equation" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Equation source" }), {
      target: { value: "F = ma" },
    });
    expect(last()).toContain("\\begin{equation}\nF = ma\n\\end{equation}");
    fireEvent.click(screen.getByRole("button", { name: "Delete equation" }));
    await waitFor(() => expect(last()).not.toContain("F = ma"));
  });
});

describe("read-only", () => {
  it("turns editing off", async () => {
    const { onChange } = setup({ readOnly: true });
    expect(root()).toHaveAttribute("contenteditable", "false");
    expect(screen.getByRole("button", { name: "Bold" })).toBeDisabled();
    fireEvent.keyDown(root(), { key: "z", metaKey: true });
    fireEvent.click(document.querySelector(".vl-canvas")!);
    fireEvent.mouseMove(paragraph("Second paragraph"));
    expect(document.querySelector(".vl-drag-handle")).toBeNull();
    const event = new Event("paste", { bubbles: true, cancelable: true });
    root().dispatchEvent(event);
    expect(onChange).not.toHaveBeenCalled();
    expect(await screen.findByRole("textbox", { name: "Title" })).toHaveAttribute(
      "contenteditable",
      "false",
    );
  });
});
