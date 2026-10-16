import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SetupIntroCaption,
  SetupIntroStage,
  setupIntroSlideMs,
  useSetupIntroSlide,
} from "./SetupIntroShowcase";

function Showcase({ active = true }: { active?: boolean }) {
  const index = useSetupIntroSlide(active);
  return (
    <>
      <SetupIntroStage index={index} />
      <SetupIntroCaption index={index} />
    </>
  );
}

function slide(container: HTMLElement): string | undefined {
  return container.querySelector<HTMLElement>(".setup-intro-visual")?.dataset.slide;
}

function nextSlide() {
  act(() => {
    vi.advanceTimersByTime(setupIntroSlideMs);
  });
}

describe("SetupIntroShowcase", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("plays the editor, AI, knowledge graph, sync and errors slides in a loop", () => {
    vi.useFakeTimers();
    const { container } = render(<Showcase />);
    const seen = [slide(container)];
    for (let i = 0; i < 5; i += 1) {
      nextSlide();
      seen.push(slide(container));
    }
    expect(seen).toEqual(["write", "ai", "graph", "sync", "errors", "write"]);
  });

  it("is a slider the user watches, with nothing to select", () => {
    render(<Showcase />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("shows the caption of the current slide", () => {
    vi.useFakeTimers();
    render(<Showcase />);
    expect(
      screen.getByText("Everything your paper needs, in one window."),
    ).toBeVisible();
    nextSlide();
    expect(
      screen.getByText("An assistant that never leaves your laptop."),
    ).toBeVisible();
    nextSlide();
    expect(screen.getByText("See how your references connect.")).toBeVisible();
  });

  it("proposes the AI rewrite, then approves it", () => {
    vi.useFakeTimers();
    const { container } = render(<Showcase />);
    nextSlide();
    const scene = container.querySelector(".setup-ai");
    expect(scene).not.toHaveClass("is-proposed");
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(scene).toHaveClass("is-proposed");
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(scene).toHaveClass("is-approved");
  });

  it("does not run while the intro step is off screen", () => {
    vi.useFakeTimers();
    const { container } = render(<Showcase active={false} />);
    act(() => {
      vi.advanceTimersByTime(setupIntroSlideMs * 3);
    });
    expect(slide(container)).toBe("write");
  });
});
