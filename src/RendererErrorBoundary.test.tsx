import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererErrorBoundary } from "./RendererErrorBoundary";

const originalLatexDo = window.latexdo;

function BrokenChild() {
  throw new Error("render failed");
  return null;
}

afterEach(() => {
  Object.defineProperty(window, "latexdo", {
    configurable: true,
    value: originalLatexDo,
  });
  vi.restoreAllMocks();
});

describe("RendererErrorBoundary", () => {
  it("renders a recovery state and reports the React error", async () => {
    const reportRendererIssue = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "latexdo", {
      configurable: true,
      value: { reportRendererIssue },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <RendererErrorBoundary>
        <BrokenChild />
      </RendererErrorBoundary>,
    );

    expect(
      screen.getByRole("heading", { name: "LatexDo hit a renderer error" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload Editor" })).toBeInTheDocument();

    await waitFor(() => {
      expect(reportRendererIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "renderer-react-error",
          error: expect.objectContaining({
            message: "render failed",
          }),
        }),
      );
    });
  });

  it("reloads the window from the recovery state", () => {
    Object.defineProperty(window, "latexdo", {
      configurable: true,
      value: { reportRendererIssue: vi.fn().mockResolvedValue(undefined) },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const originalLocation = window.location;
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload },
    });
    try {
      render(
        <RendererErrorBoundary>
          <BrokenChild />
        </RendererErrorBoundary>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Reload Editor" }));
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });
});
