import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadCodicon() {
  vi.resetModules();
  return import("./Codicon");
}

describe("Codicon", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the glyph with spin and custom classes, registering the font once", async () => {
    const add = vi.fn();
    const load = vi.fn(() => Promise.reject(new Error("offline")));
    const FontFaceMock = vi.fn(function (this: object, family: string, source: string) {
      Object.assign(this, { family, source, load });
    });
    vi.stubGlobal("FontFace", FontFaceMock);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { add },
    });

    const { Codicon } = await loadCodicon();
    const { container, rerender } = render(
      <Codicon name="check" spin className="extra" style={{ color: "red" }} />,
    );
    const span = container.querySelector("span")!;
    expect(span.className).toBe("scm-codicon spin extra");
    expect(span.getAttribute("aria-hidden")).toBe("true");
    expect(span.style.color).toBe("red");
    expect(span.textContent).toBe(String.fromCharCode(0xeab2));
    rerender(<Codicon name="add" />);
    expect(container.querySelector("span")!.className).toBe("scm-codicon");

    expect(FontFaceMock).toHaveBeenCalledTimes(1);
    expect(FontFaceMock.mock.calls[0][0]).toBe("latexdo-codicon");
    expect(add).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(load).toHaveBeenCalled();
    Reflect.deleteProperty(document, "fonts");
  });

  it("skips font registration when FontFace is unavailable", async () => {
    vi.stubGlobal("FontFace", undefined);
    const { Codicon } = await loadCodicon();
    const { container } = render(<Codicon name="file" />);
    expect(container.textContent).toBe(String.fromCharCode(0xea7b));
  });

  it("skips font registration when document.fonts is missing", async () => {
    const FontFaceMock = vi.fn();
    vi.stubGlobal("FontFace", FontFaceMock);
    Object.defineProperty(document, "fonts", { configurable: true, value: undefined });
    const { Codicon } = await loadCodicon();
    render(<Codicon name="file" />);
    expect(FontFaceMock).not.toHaveBeenCalled();
    Reflect.deleteProperty(document, "fonts");
  });

  it.each([
    ["main.tex", "file-code"],
    ["script.PY", "file-code"],
    ["paper.pdf", "file-pdf"],
    ["fig.drawio", "file-media"],
    ["data.tsv", "table"],
    ["README.md", "markdown"],
    ["package.json", "json"],
    ["Makefile", "file"],
    ["notes.txt", "file"],
  ])("maps %s to %s", async (path, icon) => {
    const { fileCodicon } = await loadCodicon();
    expect(fileCodicon(path)).toBe(icon);
  });
});
