import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TikzCanvas from "./TikzCanvas";

vi.mock("./components/TikzRenderedPreview", () => ({
  TikzRenderedPreview: ({ data }: { data: Uint8Array }) => (
    <div data-testid="rendered-figure">{data.length} bytes</div>
  ),
}));

const compileTikz = vi.fn();
const pasted = [
  "\\foreach \\i in {1,...,5} {",
  "  \\draw (0,0) -- (\\i*72:2)",
  "}",
].join("\n");

function typeCode(container: HTMLElement, value: string) {
  fireEvent.change(container.querySelector("textarea")!, { target: { value } });
}

async function run() {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Run: render the code with LaTeX" }),
    );
  });
}

beforeEach(() => {
  (window as unknown as { latexdo: unknown }).latexdo = { compileTikz };
  compileTikz.mockReset();
});

afterEach(() => {
  delete (window as unknown as { latexdo?: unknown }).latexdo;
});

describe("TikZ Run renders with LaTeX", () => {
  it("shows the figure LaTeX drew and keeps code the canvas cannot edit", async () => {
    compileTikz.mockResolvedValue({
      ok: true,
      pdf: new Uint8Array([1, 2, 3]),
      errors: [],
      output: "",
      source: "",
      durationMs: 1234,
    });
    const { container } = render(<TikzCanvas />);
    typeCode(container, pasted);
    await run();
    expect(compileTikz).toHaveBeenCalledWith(pasted, "pdflatex");
    expect(screen.getByText("Rendered with LaTeX")).toBeVisible();
    expect(screen.getByText("1.2 s")).toBeVisible();
    expect(screen.getByTestId("rendered-figure")).toHaveTextContent("3 bytes");
    expect(
      screen.getByText(/The drawing canvas cannot edit 3 lines, such as line/),
    ).toBeVisible();
    // The pasted code is not replaced by a partial copy.
    expect(container.querySelector("textarea")!.value).toBe(pasted);
    expect(screen.getByText("0 shapes")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Back to the canvas" }));
    expect(screen.queryByText("Rendered with LaTeX")).not.toBeInTheDocument();
  });

  it("puts simple code on the canvas too and uses XeLaTeX for system fonts", async () => {
    compileTikz.mockResolvedValue({
      ok: true,
      pdf: new Uint8Array([1]),
      errors: [],
      output: "",
      source: "",
      durationMs: 0,
    });
    const { container } = render(<TikzCanvas />);
    typeCode(container, "\\usepackage{fontspec}\n\\draw (1,1) rectangle (2,2);");
    await run();
    expect(compileTikz).toHaveBeenLastCalledWith(expect.any(String), "xelatex");
    typeCode(container, "\\draw (1,1) rectangle (2,2);");
    await run();
    expect(screen.getByText("1 shape")).toBeVisible();
    expect(screen.queryByText(/cannot edit/)).not.toBeInTheDocument();
  });

  it("lists LaTeX's errors with the line, the code, a fix and the log", async () => {
    compileTikz.mockResolvedValue({
      ok: false,
      errors: [
        {
          line: 2,
          message:
            "Package tikz Error: Giving up on this path. Did you forget a semicolon?.",
          hint: "A path command does not end with “;”.",
          sourceLine: "\\draw (0,0) -- (\\i*72:2)",
        },
        { line: null, message: "LaTeX Error: File `x.sty' not found." },
      ],
      output: "This is pdfTeX\n! Package tikz Error",
      source: "",
      durationMs: 400,
    });
    const { container } = render(<TikzCanvas />);
    typeCode(container, pasted);
    await run();
    const panel = screen.getByRole("alert");
    expect(screen.getByText("LaTeX could not draw this figure")).toBeVisible();
    expect(within(panel).getByText("2 problems to fix:")).toBeVisible();
    expect(within(panel).getByText(/Did you forget a semicolon/)).toBeVisible();
    expect(within(panel).getByText("\\draw (0,0) -- (\\i*72:2)")).toBeVisible();
    expect(
      within(panel).getByText("A path command does not end with “;”."),
    ).toBeVisible();
    expect(within(panel).getByText("Full LaTeX log")).toBeInTheDocument();
    expect(within(panel).getAllByRole("button")).toHaveLength(1);

    fireEvent.click(within(panel).getByRole("button", { name: "Line 2" }));
    const textarea = container.querySelector("textarea")!;
    expect(document.activeElement).toBe(textarea);
    expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe(
      "  \\draw (0,0) -- (\\i*72:2)",
    );
  });

  it("shows progress while compiling and a single-problem title", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    compileTikz.mockReturnValue(new Promise((done) => (resolve = done)));
    const { container } = render(<TikzCanvas />);
    typeCode(container, "\\draw (1,1) rectangle (2,2);");
    await run();
    expect(screen.getByText("Compiling your code with LaTeX…")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Run: render the code with LaTeX" }),
    ).toBeDisabled();
    await act(async () =>
      resolve({
        ok: false,
        errors: [{ line: null, message: "latexmk was not found." }],
        output: "",
        source: "",
        durationMs: 0,
      }),
    );
    expect(screen.getByText("1 problem to fix:")).toBeVisible();
    expect(screen.queryByText("Full LaTeX log")).not.toBeInTheDocument();
  });

  it("reports when LaTeX cannot be started at all", async () => {
    compileTikz.mockRejectedValueOnce(new Error("IPC failed"));
    const { container } = render(<TikzCanvas />);
    typeCode(container, pasted);
    await run();
    expect(screen.getByText("IPC failed")).toBeVisible();
    compileTikz.mockRejectedValueOnce("odd");
    await run();
    expect(screen.getByText("LaTeX could not be started.")).toBeVisible();
  });

  it("asks for code when the box is empty", async () => {
    const { container } = render(<TikzCanvas />);
    typeCode(container, "   ");
    await run();
    expect(screen.getByText("Write or paste TikZ code first.")).toBeVisible();
    expect(compileTikz).not.toHaveBeenCalled();
  });
});
