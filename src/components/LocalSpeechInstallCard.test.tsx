import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocalSpeechInstallCard } from "./LocalSpeechInstallCard";

describe("LocalSpeechInstallCard", () => {
  it("shows install progress with a percentage", () => {
    const { container } = render(
      <LocalSpeechInstallCard
        state={{ phase: "installing", percent: 42, message: "Downloading" }}
        onInstall={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Downloading");
    expect(screen.getByText("42%")).toBeTruthy();
    expect(
      (container.querySelector(".speech-install-bar span") as HTMLElement).style.width,
    ).toBe("42%");
  });

  it("shows an indeterminate bar when the percentage is unknown", () => {
    const { container } = render(
      <LocalSpeechInstallCard
        state={{ phase: "installing", percent: null, message: "Starting" }}
        onInstall={vi.fn()}
      />,
    );
    expect(container.querySelector("b")).toBeNull();
    expect(
      (container.querySelector(".speech-install-bar span") as HTMLElement).style.width,
    ).toBe("8%");
  });

  it.each(["unknown", "installed", "unavailable"] as const)(
    "renders nothing in the %s phase",
    (phase) => {
      const { container } = render(
        <LocalSpeechInstallCard state={{ phase }} onInstall={vi.fn()} />,
      );
      expect(container.innerHTML).toBe("");
    },
  );

  it("offers installation with size and optional actions when missing", () => {
    const onInstall = vi.fn();
    const onUseOpenAi = vi.fn();
    const onDismiss = vi.fn();
    render(
      <LocalSpeechInstallCard
        state={{ phase: "missing", downloadBytes: 150_000_000 }}
        onInstall={onInstall}
        onUseOpenAi={onUseOpenAi}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("not installed yet");
    fireEvent.click(
      screen.getByRole("button", { name: /Install local speech \(150 MB\)/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Use OpenAI instead" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onUseOpenAi).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("offers a retry without size or optional actions after a failure", () => {
    render(
      <LocalSpeechInstallCard
        state={{ phase: "failed", error: "disk full", downloadBytes: null }}
        onInstall={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Local speech could not be installed: disk full",
    );
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Try again",
    ]);
  });
});
