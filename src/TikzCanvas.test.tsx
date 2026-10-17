import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TikzCanvas from "./TikzCanvas";

function getSvg(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg.tikz-svg");
  if (!(svg instanceof SVGSVGElement)) {
    throw new Error("TikZ SVG canvas was not rendered");
  }
  return svg;
}

function generatedCode(container: HTMLElement): string {
  const textarea = container.querySelector<HTMLTextAreaElement>(".tikz-code-textarea");
  return textarea?.value ?? "";
}

/** Picks a drawing tool from the bar, or from the More shapes menu. */
function pickTool(name: string): void {
  const direct = screen.queryByRole("button", { name });
  if (direct) {
    fireEvent.click(direct);
    return;
  }
  fireEvent.click(screen.getByRole("button", { name: /More shapes/ }));
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

const toolButton = (name: string) => screen.getByRole("button", { name });

/** Picks a color from the Stroke or Fill pop-up palette. */
function pickColor(kind: "Stroke" | "Fill", color: string): void {
  fireEvent.click(screen.getByRole("button", { name: `${kind} color` }));
  fireEvent.click(screen.getByRole("button", { name: `${kind} ${color}` }));
}

function expectCodeOrder(code: string, first: string, second: string): void {
  expect(code.indexOf(first)).toBeGreaterThanOrEqual(0);
  expect(code.indexOf(second)).toBeGreaterThanOrEqual(0);
  expect(code.indexOf(first)).toBeLessThan(code.indexOf(second));
}

describe("TikzCanvas interactions", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it.each([
    "Circle",
    "Ellipse",
    "Parallelogram",
    "Cylinder",
    "Line",
    "Arrow",
    "Diamond",
    "Triangle",
    "Pentagon",
    "Hexagon",
    "Star",
    "Cloud",
    "Trapezium",
    "Grid",
    "Axes",
  ])("draws %s and supports undo, redo and deletion", (title) => {
    const { container } = render(<TikzCanvas />);
    const svg = getSvg(container);
    pickTool(title);
    fireEvent.mouseDown(svg, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(svg);
    expect(screen.getByText("1 shape")).toBeVisible();
    const code = generatedCode(container);
    expect(code).toContain("\\draw");
    fireEvent.click(toolButton("Undo"));
    expect(screen.getByText("0 shapes")).toBeVisible();
    fireEvent.click(toolButton("Redo"));
    expect(generatedCode(container)).toBe(code);
    fireEvent.click(toolButton("Clear canvas"));
    expect(screen.getByText("0 shapes")).toBeVisible();
  });
  it("adds text, applies edited code and inserts the full standalone document", () => {
    const insert = vi.fn();
    const { container } = render(<TikzCanvas onInsertCode={insert} />);
    const svg = getSvg(container);
    pickTool("Text");
    fireEvent.mouseDown(svg, { button: 0, clientX: 100, clientY: 100 });
    const input = screen.getByPlaceholderText("Text…");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(generatedCode(container)).toContain("{Hello}");
    const textarea = container.querySelector("textarea")!;
    fireEvent.change(textarea, {
      target: {
        value:
          "\\begin{tikzpicture}\n\\draw (1,1) rectangle (2,2);\n\\end{tikzpicture}",
      },
    });
    fireEvent.click(screen.getByTitle("Apply edited code to canvas"));
    expect(screen.getByText("1 shape")).toBeVisible();
    expect(generatedCode(container)).toContain("rectangle");
    fireEvent.click(screen.getByText("Full document"));
    fireEvent.click(screen.getByTitle("Insert into editor"));
    expect(insert).toHaveBeenCalledWith(
      expect.stringContaining("\\documentclass[border=10pt]{standalone}"),
    );
    fireEvent.click(screen.getByText("TikZ only"));
    expect(generatedCode(container)).not.toContain("\\documentclass");
  });
  it("changes drawing styles, canvas dimensions, grid and zoom", () => {
    const { container } = render(<TikzCanvas />);
    const svg = getSvg(container);
    fireEvent.click(toolButton("Dashed"));
    fireEvent.click(toolButton("Snap"));
    fireEvent.click(toolButton("Show grid"));
    expect(container.querySelector(".tikz-grid")).toBeNull();
    fireEvent.click(toolButton("Line width"));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "3" } });
    pickColor("Fill", "#ef4444");
    pickTool("Rectangle");
    fireEvent.mouseDown(svg, { button: 0, clientX: 101, clientY: 101 });
    fireEvent.mouseMove(svg, { clientX: 201, clientY: 201 });
    fireEvent.mouseUp(svg);
    expect(generatedCode(container)).toContain("dashed");
    expect(generatedCode(container)).toContain(
      "fill={rgb,255:red,239;green,68;blue,68}",
    );
    expect(generatedCode(container)).toContain("(2.02,13.98)");
    fireEvent.change(screen.getByTitle("Canvas dimensions preset"), {
      target: { value: "640x480" },
    });
    expect(generatedCode(container)).toContain("(2.02,7.58)");
    fireEvent.click(screen.getByTitle("Zoom in"));
    expect(screen.getByText("110%")).toBeVisible();
    fireEvent.click(screen.getByTitle("Zoom out"));
    expect(screen.getByText("100%")).toBeVisible();
    pickTool("Pan");
    fireEvent.mouseDown(svg, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(svg);
    expect(svg.getAttribute("viewBox")).not.toBe("0 0 1200 800");
    fireEvent.click(screen.getByTitle("Reset zoom/pan (100%)"));
    expect(svg.getAttribute("viewBox")).toBe("0 0 1200 800");
  });
  it("deletes selected shapes using the keyboard and restores them with undo", () => {
    const { container } = render(<TikzCanvas />);
    const svg = getSvg(container);
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.mouseDown(svg, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(svg);
    fireEvent.keyDown(window, { key: "v" });
    fireEvent.mouseDown(svg, { button: 0, clientX: 150, clientY: 150 });
    fireEvent.mouseUp(svg);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(screen.getByText("0 shapes")).toBeVisible();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByText("1 shape")).toBeVisible();
    fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(screen.getByText("0 shapes")).toBeVisible();
  });
  it("keeps the toolbar stable while selecting and moving a shape", () => {
    const { container } = render(<TikzCanvas />);
    const svg = getSvg(container);

    pickTool("Rectangle");
    fireEvent.mouseDown(svg, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(svg);

    expect(screen.queryByText("Selected: rect")).not.toBeInTheDocument();
    expect(container.querySelector(".tikz-toolbar-selected")).toBeNull();
    expect(container.querySelector(".tikz-toolbar-selected-props")).toBeNull();
    expect(container.querySelector(".tikz-selected-props")).toBeNull();
    expect(toolButton("Rectangle")).toHaveClass("active");
    expect(generatedCode(container)).toContain("(2,14) rectangle (4,12)");

    pickColor("Stroke", "#ef4444");
    expect(generatedCode(container)).toContain(
      "draw={rgb,255:red,239;green,68;blue,68}",
    );

    pickTool("Select");
    fireEvent.mouseDown(svg, { button: 0, clientX: 150, clientY: 150 });
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 225 });
    fireEvent.mouseUp(svg);

    expect(screen.queryByText("Selected: rect")).not.toBeInTheDocument();
    expect(container.querySelector(".tikz-toolbar-selected")).toBeNull();
    expect(container.querySelector(".tikz-toolbar-selected-props")).toBeNull();
    expect(generatedCode(container)).toContain("(3,12.5) rectangle (5,10.5)");
    expect(generatedCode(container)).toContain(
      "draw={rgb,255:red,239;green,68;blue,68}",
    );
  });

  it("keeps freehand selected after each stroke", () => {
    const { container } = render(<TikzCanvas />);
    const svg = getSvg(container);

    pickTool("Freehand");
    fireEvent.mouseDown(svg, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(svg, { clientX: 110, clientY: 110 });
    fireEvent.mouseUp(svg);

    expect(toolButton("Freehand")).toHaveClass("active");

    fireEvent.mouseDown(svg, { button: 0, clientX: 130, clientY: 130 });
    fireEvent.mouseMove(svg, { clientX: 140, clientY: 140 });
    fireEvent.mouseUp(svg);

    expect(toolButton("Freehand")).toHaveClass("active");
    expect(generatedCode(container).match(/\\draw/g)).toHaveLength(2);
  });

  it("offers right-click layer controls for overlapping shapes", () => {
    const { container } = render(<TikzCanvas />);
    const svg = getSvg(container);
    const lowerRect = "(2,14) rectangle (4,12)";
    const upperRect = "(3,13) rectangle (5,11)";

    pickTool("Rectangle");
    fireEvent.mouseDown(svg, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(svg);
    fireEvent.mouseDown(svg, { button: 0, clientX: 150, clientY: 150 });
    fireEvent.mouseMove(svg, { clientX: 250, clientY: 250 });
    fireEvent.mouseUp(svg);

    expectCodeOrder(generatedCode(container), lowerRect, upperRect);

    fireEvent.contextMenu(svg, { clientX: 125, clientY: 125 });

    expect(screen.getByRole("menu", { name: /shape order/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /bring to front/i }));

    expectCodeOrder(generatedCode(container), upperRect, lowerRect);
    expect(
      screen.queryByRole("menu", { name: /shape order/i }),
    ).not.toBeInTheDocument();
  });
});
