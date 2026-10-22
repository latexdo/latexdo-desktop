import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdateDownloadProgress } from "../types";
import { UpdateRestartCountdown } from "./UpdateRestartCountdown";

type Listener = (progress: UpdateDownloadProgress) => void;

function installBridge() {
  let listener: Listener | null = null;
  (window as unknown as { latexdo: unknown }).latexdo = {
    onUpdateProgress: vi.fn((callback: Listener) => {
      listener = callback;
      return () => {
        listener = null;
      };
    }),
  };
  return (progress: Partial<UpdateDownloadProgress>) =>
    act(() =>
      listener?.({
        status: "installing",
        currentVersion: "0.3.0",
        latestVersion: "0.3.1",
        fileName: null,
        fileLabel: null,
        transferredBytes: 1,
        totalBytes: 1,
        percent: 100,
        ...progress,
      }),
    );
}

afterEach(() => {
  delete (window as unknown as { latexdo?: unknown }).latexdo;
});

describe("UpdateRestartCountdown", () => {
  it("stays hidden until the main process starts counting down", () => {
    const emit = installBridge();
    render(<UpdateRestartCountdown />);
    emit({ status: "downloading" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("counts down and tells the user to save their work", () => {
    const emit = installBridge();
    render(<UpdateRestartCountdown />);
    emit({ restartInSeconds: 5 });
    const dialog = screen.getByRole("alertdialog", {
      name: "Updating to LatexDo 0.3.1",
    });
    expect(dialog).toHaveTextContent("5");
    expect(dialog).toHaveTextContent(/Save your work/);
    emit({ restartInSeconds: 1 });
    expect(dialog).toHaveTextContent("restart in 1 second.");
  });
});

describe("UpdateRestartCountdown dismissal", () => {
  it("hides on error or failure and names no version when unknown", () => {
    const emit = installBridge();
    render(<UpdateRestartCountdown />);
    emit({ restartInSeconds: 3, latestVersion: null });
    expect(
      screen.getByRole("alertdialog", { name: "Updating LatexDo" }),
    ).toHaveTextContent("restart in 3 seconds.");
    emit({ status: "error" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    emit({ restartInSeconds: 2 });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    emit({ status: "failed" as UpdateDownloadProgress["status"] });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
