import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CodeIsland,
  CommandIsland,
  CommentIsland,
  FigureIsland,
  InlineField,
  MathIsland,
  TableIsland,
  TitleIsland,
  type IslandContext,
  type IslandProps,
} from "./VisualIslands";

vi.mock("../TikzRenderedPreview", () => ({
  TikzRenderedPreview: () => <div data-testid="pdf-figure" />,
}));

function context(overrides: Partial<IslandContext> = {}): IslandContext {
  return {
    readOnly: false,
    renderOptions: {},
    renderMath: (tex) => (tex.includes("bad") ? null : `data:math,${tex}`),
    head: "\\title{T}\n\\begin{document}\n",
    setHead: vi.fn(),
    ...overrides,
  };
}

function props(source: string, overrides: Partial<IslandProps> = {}): IslandProps {
  return {
    element: document.createElement("div"),
    source,
    context: context(),
    update: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}

const figure = [
  "\\begin{figure}[ht]",
  "  \\centering",
  "  \\includegraphics[width=0.5\\linewidth]{figures/plot}",
  "  \\caption{A plot}",
  "  \\label{fig:plot}",
  "\\end{figure}",
].join("\n");

describe("InlineField", () => {
  it("edits inline LaTeX on one line", () => {
    const onChange = vi.fn();
    render(
      <InlineField
        value={"\\emph{a}"}
        onChange={onChange}
        readOnly={false}
        options={{}}
        label="Field"
      />,
    );
    const field = screen.getByRole("textbox", { name: "Field" });
    expect(field.querySelector("em")).not.toBeNull();
    field.append(" b\nc");
    fireEvent.input(field);
    expect(onChange).toHaveBeenCalledWith("\\emph{a} b c");
    const enter = fireEvent.keyDown(field, { key: "Enter" });
    expect(enter).toBe(false);
    fireEvent.keyDown(field, { key: "a" });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(),
    });
    fireEvent.paste(field, { clipboardData: { getData: () => "x\n y" } });
    expect(document.execCommand).toHaveBeenCalledWith("insertText", false, "x y");
  });
});

describe("FigureIsland", () => {
  it("shows the image with its width, caption and label", async () => {
    const update = vi.fn();
    const loadImage = vi.fn(async () => ({
      kind: "image" as const,
      url: "data:image/png;base64,x",
    }));
    render(
      <FigureIsland {...props(figure, { update, context: context({ loadImage }) })} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading image…");
    expect(await screen.findByRole("img", { name: "A plot" })).toHaveAttribute(
      "src",
      "data:image/png;base64,x",
    );
    expect(loadImage).toHaveBeenCalledWith("figures/plot");
    expect(screen.getByText("fig:plot")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Figure width" }), {
      target: { value: "1" },
    });
    expect(update).toHaveBeenLastCalledWith(
      expect.stringContaining("[width=1\\linewidth]"),
    );
    const caption = screen.getByRole("textbox", { name: "Figure caption" });
    caption.textContent = "Better";
    fireEvent.input(caption);
    expect(update).toHaveBeenLastCalledWith(
      expect.stringContaining("\\caption{Better}"),
    );
  });

  it("shows PDF figures and missing images", async () => {
    const { unmount } = render(
      <FigureIsland
        {...props(figure, {
          context: context({
            loadImage: async () => ({ kind: "pdf", data: new Uint8Array([1]) }),
          }),
        })}
      />,
    );
    expect(await screen.findByTestId("pdf-figure")).toBeInTheDocument();
    unmount();
    const { unmount: second } = render(
      <FigureIsland
        {...props(figure, {
          context: context({ loadImage: async () => Promise.reject(new Error("x")) }),
        })}
      />,
    );
    expect(
      await screen.findByText("Image not found: figures/plot"),
    ).toBeInTheDocument();
    second();
    render(<FigureIsland {...props(figure.replace("[width=0.5\\linewidth]", ""))} />);
    expect(await screen.findByText(/Image not found/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "As set in LaTeX" })).toBeInTheDocument();
  });

  it("replaces the image from a file or a drop", async () => {
    const update = vi.fn();
    const importImages = vi.fn(async (files: File[]) =>
      files.map((file) => `figures/${file.name}`),
    );
    render(
      <FigureIsland
        {...props(figure, { update, context: context({ importImages }) })}
      />,
    );
    const file = new File(["x"], "new.png", { type: "image/png" });
    fireEvent.click(screen.getByRole("button", { name: "Replace image" }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(update).toHaveBeenLastCalledWith(
      expect.stringContaining("{figures/new.png}"),
    );
    fireEvent.change(input, { target: { files: [] } });
    const frame = document.querySelector(".vl-figure")!;
    fireEvent.dragOver(frame, { dataTransfer: { types: ["Files"] } });
    expect(frame).toHaveClass("is-dropping");
    fireEvent.dragLeave(frame);
    fireEvent.dragOver(frame, { dataTransfer: { types: ["text/plain"] } });
    expect(frame).not.toHaveClass("is-dropping");
    await act(async () => {
      fireEvent.drop(frame, { dataTransfer: { files: [new File(["y"], "drop.png")] } });
    });
    expect(update).toHaveBeenLastCalledWith(
      expect.stringContaining("{figures/drop.png}"),
    );
    fireEvent.drop(frame, { dataTransfer: { files: [] } });
    importImages.mockResolvedValueOnce([]);
    await act(async () => {
      fireEvent.drop(frame, { dataTransfer: { files: [file] } });
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete figure" }));
  });

  it("falls back to code for figures it cannot edit", () => {
    render(<FigureIsland {...props("\\begin{figure}\n\\end{figure}")} />);
    expect(screen.getByRole("textbox", { name: "LaTeX code" })).toBeInTheDocument();
  });
});

describe("TableIsland", () => {
  const table = [
    "\\begin{table}[ht]",
    "  \\begin{tabular}{ll}",
    "    \\hline",
    "    A & B \\\\",
    "    1 & 2 \\\\",
    "  \\end{tabular}",
    "  \\caption{Nums}",
    "\\end{table}",
  ].join("\n");

  it("edits cells, rows, columns and the caption", () => {
    const update = vi.fn();
    render(<TableIsland {...props(table, { update })} />);
    const cell = screen.getByRole("textbox", { name: "Row 2, column 2" });
    fireEvent.focus(cell);
    cell.textContent = "20";
    fireEvent.input(cell);
    expect(update).toHaveBeenLastCalledWith(expect.stringContaining("1 & 20 \\\\"));
    fireEvent.click(screen.getByRole("button", { name: "Insert row below" }));
    expect(update).toHaveBeenLastCalledWith(
      expect.stringContaining("1 & 2 \\\\\n     &  \\\\"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete row" }));
    expect(update).toHaveBeenLastCalledWith(expect.not.stringContaining("1 & 2"));
    fireEvent.click(screen.getByRole("button", { name: "Insert column right" }));
    expect(update).toHaveBeenLastCalledWith(expect.stringContaining("{lll}"));
    fireEvent.click(screen.getByRole("button", { name: "Delete column" }));
    expect(update).toHaveBeenLastCalledWith(expect.stringContaining("{l}"));
    const caption = screen.getByRole("textbox", { name: "Table caption" });
    caption.textContent = "Numbers";
    fireEvent.input(caption);
    expect(update).toHaveBeenLastCalledWith(
      expect.stringContaining("\\caption{Numbers}"),
    );
  });

  it("hides column tools for complex specs and the caption for bare tabulars", () => {
    render(
      <TableIsland {...props("\\begin{tabular}{@{}l@{}}\na \\\\\n\\end{tabular}")} />,
    );
    expect(
      screen.queryByRole("button", { name: "Insert column right" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Table caption" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete row" })).toBeDisabled();
  });

  it("falls back to code when the table is not simple", () => {
    render(
      <TableIsland
        {...props("\\begin{tabular}{l}\n\\multicolumn{1}{c}{x}\n\\end{tabular}")}
      />,
    );
    expect(screen.getByRole("textbox", { name: "LaTeX code" })).toBeInTheDocument();
  });
});

describe("MathIsland", () => {
  it("renders, numbers and edits display math", () => {
    const update = vi.fn();
    render(
      <MathIsland {...props("\\begin{equation}\nx^2\n\\end{equation}", { update })} />,
    );
    expect(screen.getByRole("img", { name: "x^2" })).toHaveAttribute(
      "src",
      "data:math,x^2",
    );
    expect(screen.getByText("(#)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Equation" }));
    const source = screen.getByRole("textbox", { name: "Equation source" });
    fireEvent.change(source, { target: { value: "y" } });
    expect(update).toHaveBeenCalledWith("\\begin{equation}\ny\n\\end{equation}");
    fireEvent.blur(source);
    expect(
      screen.queryByRole("textbox", { name: "Equation source" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit equation" }));
    expect(screen.getByText("equation")).toBeInTheDocument();
  });

  it("shows empty and unrenderable math, unnumbered forms and code fallback", () => {
    const { unmount } = render(
      <MathIsland {...props("\\[\n\n\\]", { startEditing: true })} />,
    );
    expect(screen.getByText("Empty equation: click to write it")).toBeInTheDocument();
    expect(screen.getByText("\\[ … \\]")).toBeInTheDocument();
    expect(screen.queryByText("(#)")).not.toBeInTheDocument();
    unmount();
    const { unmount: second } = render(
      <MathIsland
        {...props("\\begin{align*}\nbad\n\\end{align*}", {
          context: context({ readOnly: true }),
        })}
      />,
    );
    expect(screen.getByText("bad")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Equation" }));
    expect(
      screen.queryByRole("textbox", { name: "Equation source" }),
    ).not.toBeInTheDocument();
    second();
    render(<MathIsland {...props("\\begin{equation} x \\end{equation}")} />);
    expect(screen.getByRole("textbox", { name: "LaTeX code" })).toBeInTheDocument();
  });
});

describe("other objects", () => {
  it("edits code and comments as text", () => {
    const update = vi.fn();
    const { unmount } = render(
      <CodeIsland {...props("\\begin{tikzpicture}\n\\end{tikzpicture}", { update })} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "LaTeX code" }), {
      target: { value: "\\foo" },
    });
    expect(update).toHaveBeenCalledWith("\\foo");
    fireEvent.click(screen.getByRole("button", { name: "Delete code block" }));
    unmount();
    render(<CommentIsland {...props("% hi", { update })} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
      target: { value: "% bye" },
    });
    expect(update).toHaveBeenLastCalledWith("% bye");
  });

  it("labels page-level commands", () => {
    const element = document.createElement("div");
    element.dataset.command = "bibliography";
    const { unmount } = render(
      <CommandIsland {...props("\\bibliography{refs}", { element })} />,
    );
    expect(screen.getByText("References")).toBeInTheDocument();
    expect(screen.getByText("refs")).toBeInTheDocument();
    unmount();
    render(
      <CommandIsland {...props("\\weird", { context: context({ readOnly: true }) })} />,
    );
    expect(screen.getByText("LaTeX command")).toBeInTheDocument();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("edits the title, author and date in the preamble", () => {
    const setHead = vi.fn();
    const head = "\\title{T}\n\\date{Today}\n\\begin{document}\n";
    render(
      <TitleIsland
        {...props("\\maketitle", { context: context({ head, setHead }) })}
      />,
    );
    const date = screen.getByRole("textbox", { name: "Date" });
    date.textContent = "May";
    fireEvent.input(date);
    expect(setHead).toHaveBeenCalledWith(
      "\\title{T}\n\\date{May}\n\\begin{document}\n",
    );
  });
});

describe("loading", () => {
  it("does not update after the figure is gone", async () => {
    let resolve: (value: null) => void = () => undefined;
    const loadImage = vi.fn(() => new Promise<null>((done) => (resolve = done)));
    const { unmount } = render(
      <FigureIsland {...props(figure, { context: context({ loadImage }) })} />,
    );
    unmount();
    resolve(null);
    await waitFor(() => expect(loadImage).toHaveBeenCalled());
  });
});
