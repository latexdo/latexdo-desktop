import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FigureToTikzConverter } from "./FigureToTikzConverter";

class MockFileReader {
  onload: ((event: { target: { result: string } }) => void) | null = null;

  readAsDataURL() {
    this.onload?.({ target: { result: "data:image/png;base64,AA==" } });
  }

  readAsText() {
    this.onload?.({ target: { result: mockTextReadResult } });
  }
}

class MockImage {
  width = 120;
  height = 80;
  onload: (() => void) | null = null;

  set src(_value: string) {
    this.onload?.();
  }
}

function installCanvasMock() {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
    })),
  });
}

function installClipboardMock() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText,
      readText: vi.fn().mockResolvedValue(""),
    },
  });
  return { writeText };
}

let mockTextReadResult = "";

const sampleDrawio = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile>
  <diagram id="page-1" name="Flow">
    <mxGraphModel pageWidth="240" pageHeight="180">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="a" value="Input" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="20" y="20" width="80" height="40" as="geometry"/>
        </mxCell>
        <mxCell id="b" value="Output" style="ellipse;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="140" y="20" width="80" height="40" as="geometry"/>
        </mxCell>
        <mxCell id="e" value="" style="endArrow=classic;html=1;" edge="1" parent="1" source="a" target="b">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

describe("FigureToTikzConverter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockTextReadResult = "";
    vi.stubGlobal("FileReader", MockFileReader);
    vi.stubGlobal("Image", MockImage);
    installClipboardMock();
    installCanvasMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the upload state before an image is provided", () => {
    render(<FigureToTikzConverter />);

    expect(screen.getByText(/Drop an image or draw\.io file here/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
  });

  it("traces actual rectangle and line pixels into editable TikZ geometry", () => {
    class DiagramImage extends MockImage {
      width = 400;
      height = 400;
    }
    vi.stubGlobal("Image", DiagramImage);
    const pixels = new Uint8ClampedArray(400 * 400 * 4);
    pixels.fill(255);
    const outline = (
      x: number,
      y: number,
      width: number,
      height: number,
      color: number[],
    ) => {
      for (let py = y; py <= y + height; py++)
        for (let px = x; px <= x + width; px++)
          if (py === y || py === y + height || px === x || px === x + width) {
            const offset = (py * 400 + px) * 4;
            pixels.set([...color, 255], offset);
          }
    };
    outline(20, 20, 24, 24, [0, 0, 0]);
    outline(80, 20, 100, 12, [30, 20, 20]);
    outline(220, 20, 12, 100, [0, 0, 0]);
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => ({ drawImage: vi.fn(), getImageData: () => ({ data: pixels }) }),
    });
    const onInsertCode = vi.fn();
    const { container } = render(<FigureToTikzConverter onInsertCode={onInsertCode} />);
    fireEvent.change(container.querySelector("input[type=file]")!, {
      target: { files: [new File(["pixels"], "geometry.png", { type: "image/png" })] },
    });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(screen.getByRole("button", { name: /insert/i }));
    const code = onInsertCode.mock.calls[0][0];
    expect(code).toContain("(0.40,7.60) rectangle (0.88,7.12)");
    expect(code).toContain("(1.60,7.48) -- (3.60,7.48)");
    expect(code).toContain("(4.52,7.60) -- (4.52,5.60)");
    expect(code).toContain("rgb,255:red,30;green,20;blue,20");
  });

  it("generates TikZ code from an uploaded image and inserts it", () => {
    const onInsertCode = vi.fn();
    const { container } = render(<FigureToTikzConverter onInsertCode={onInsertCode} />);

    const input = container.querySelector("input[type='file']");
    expect(input).not.toBeNull();

    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [new File(["image"], "diagram.png", { type: "image/png" })],
      },
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByText("Original Image")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /re-analyze/i }));

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByText(/Auto-generated from image/i)).toBeVisible();
    // Nothing traceable: the image is kept in the picture to draw on (#119).
    expect(screen.getByRole("status")).toHaveTextContent(/No boxes or lines found/);
    expect(screen.getByText(/includegraphics/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /insert/i }));
    expect(onInsertCode).toHaveBeenCalledWith(
      expect.stringContaining("\\begin{tikzpicture}"),
    );
  });

  it("generates TikZ code from an uploaded draw.io file", async () => {
    mockTextReadResult = sampleDrawio;
    const onInsertCode = vi.fn();
    const { container } = render(<FigureToTikzConverter onInsertCode={onInsertCode} />);

    const input = container.querySelector("input[type='file']");
    expect(input).not.toBeNull();

    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [
          new File([sampleDrawio], "flow.drawio", {
            type: "application/xml",
          }),
        ],
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("draw.io Diagram")).toBeVisible();
    expect(screen.getByText("flow.drawio")).toBeVisible();
    expect(
      screen.getByText("Converted 2 shapes, 1 connector, and 2 labels."),
    ).toBeVisible();
    expect(screen.getByText(/Input/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /insert/i }));
    expect(onInsertCode).toHaveBeenCalledWith(expect.stringContaining("Output"));
  });
});
