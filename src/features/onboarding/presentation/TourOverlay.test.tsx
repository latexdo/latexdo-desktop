import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { TourOverlay } from "./TourOverlay";
import { emitProductEvent } from "../core/ProductEvents";
import {
  getTourProgress,
  loadDiscoveryStore,
  updateTourProgress,
} from "../core/DiscoveryStore";
import type { TourDefinition } from "../core/TourTypes";
const tour: TourDefinition = {
  id: "coverage-tour",
  version: 1,
  title: "Try the editor",
  intro: "Learn the workflow",
  steps: [
    {
      id: "compile",
      featureId: "compile",
      targetId: "compile",
      title: "Build a PDF",
      body: "Compile the paper",
      mode: "user-action",
      expectedEvent: "compile:succeeded",
      success: "PDF ready",
    },
    {
      id: "finish",
      featureId: "finish",
      targetId: "missing-target",
      title: "Keep writing",
      body: "Tour complete",
      mode: "explain",
      cta: "Finish",
      success: "Ready",
    },
  ],
};
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function setup(overrides: Partial<React.ComponentProps<typeof TourOverlay>> = {}) {
  const onPrepare = vi.fn(),
    onRestore = vi.fn();
  const view = render(
    <>
      <button data-tour-id="compile">Compile target</button>
      <TourOverlay
        tour={tour}
        launchNonce={1}
        onPrepare={onPrepare}
        onRestore={onRestore}
        {...overrides}
      />
    </>,
  );
  act(() => vi.advanceTimersByTime(650));
  return { ...view, onPrepare, onRestore };
}
function start() {
  fireEvent.click(screen.getByRole("button", { name: "Start interactive tour" }));
  act(() => vi.advanceTimersByTime(80));
}
describe("interactive onboarding tour", () => {
  it("prepares a workspace, waits for the expected event, and restores it on completion", () => {
    const view = setup();
    vi.spyOn(
      screen.getByText("Compile target"),
      "getBoundingClientRect",
    ).mockReturnValue({
      top: 20,
      left: 30,
      width: 100,
      height: 40,
      bottom: 60,
      right: 130,
    } as DOMRect);
    start();
    expect(view.onPrepare).toHaveBeenCalledOnce();
    expect(view.container.querySelector(".tour-spotlight")).toHaveStyle({
      top: "12px",
      left: "22px",
      width: "116px",
      height: "56px",
    });
    fireEvent.resize(window);
    fireEvent.scroll(window);
    fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    act(() => vi.advanceTimersByTime(0));
    expect(getTourProgress(tour.id, 1).completedSteps).toEqual([]);
    act(() => emitProductEvent({ type: "compile:failed" }));
    expect(getTourProgress(tour.id, 1).completedSteps).toEqual([]);
    act(() => emitProductEvent({ type: "compile:succeeded" }));
    expect(screen.getByRole("status")).toHaveTextContent("PDF ready");
    expect(loadDiscoveryStore().features.compile.state).toBe("mastered");
    act(() => vi.advanceTimersByTime(650));
    expect(screen.getByRole("heading", { name: "Keep writing" })).toBeInTheDocument();
    expect(view.container.querySelector(".tour-spotlight")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    act(() => vi.advanceTimersByTime(650));
    expect(getTourProgress(tour.id, 1)).toMatchObject({
      state: "completed",
      completedSteps: ["compile", "finish"],
    });
    expect(view.onRestore).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("reveals a step without claiming success or advancing it", () => {
    const onRevealStep = vi.fn();
    const view = setup({ onRevealStep });
    start();
    expect(onRevealStep).toHaveBeenCalledWith(tour.steps[0]);
    fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    act(() => vi.advanceTimersByTime(1000));
    expect(getTourProgress(tour.id, 1).completedSteps).toEqual([]);
    expect(loadDiscoveryStore().features.compile.state).toBe("introduced");
    expect(screen.getByRole("heading", { name: "Build a PDF" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    act(() => vi.advanceTimersByTime(650));
    fireEvent.click(screen.getByRole("button", { name: "Skip step" }));
    act(() => vi.advanceTimersByTime(180));
    expect(getTourProgress(tour.id, 1).skippedSteps).toEqual(["finish"]);
    expect(view.onRestore).toHaveBeenCalledOnce();
  });
  it("invokes the real action and still waits for its success event", () => {
    const onStepAction = vi.fn();
    setup({ onStepAction });
    start();
    expect(screen.getByText("Compile the paper")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    act(() => vi.advanceTimersByTime(0));
    expect(onStepAction).toHaveBeenCalledWith(tour.steps[0]);
    expect(getTourProgress(tour.id, 1).completedSteps).toEqual([]);
    act(() => emitProductEvent({ type: "compile:succeeded" }));
    expect(getTourProgress(tour.id, 1).completedSteps).toEqual(["compile"]);
  });
  it("turns Show me into Next so a step can never get stuck", () => {
    const onStepAction = vi.fn();
    setup({ onStepAction });
    start();
    fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    act(() => vi.advanceTimersByTime(0));
    expect(onStepAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Show me" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    act(() => vi.advanceTimersByTime(650));
    expect(screen.getByRole("heading", { name: "Keep writing" })).toBeInTheDocument();
    expect(getTourProgress(tour.id, 1).completedSteps).toEqual(["compile"]);
  });
  it("highlights the fallback area when the control is not rendered", () => {
    const fallbackTour: TourDefinition = {
      ...tour,
      steps: [{ ...tour.steps[0], targetId: "absent", fallbackTargetId: "compile" }],
    };
    const view = setup({ tour: fallbackTour });
    vi.spyOn(
      screen.getByText("Compile target"),
      "getBoundingClientRect",
    ).mockReturnValue({
      top: 20,
      left: 30,
      width: 100,
      height: 40,
      bottom: 60,
      right: 130,
    } as DOMRect);
    start();
    expect(view.container.querySelector(".tour-spotlight")).toHaveStyle({
      top: "12px",
    });
  });
  it("does not advance twice when multiple success events arrive together", () => {
    setup();
    start();
    act(() => {
      emitProductEvent({ type: "compile:succeeded" });
      emitProductEvent({ type: "compile:succeeded" });
    });
    act(() => vi.advanceTimersByTime(650));
    expect(screen.getByRole("heading", { name: "Keep writing" })).toBeInTheDocument();
    expect(
      loadDiscoveryStore().analytics.filter(
        (event) => event.type === "tour_step_succeeded",
      ),
    ).toHaveLength(1);
  });
  it("cancels pending advancement when dismissed during success", () => {
    const view = setup();
    start();
    act(() => emitProductEvent({ type: "compile:succeeded" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    act(() => vi.advanceTimersByTime(1000));
    expect(view.onRestore).toHaveBeenCalledOnce();
    expect(getTourProgress(tour.id, 1).state).toBe("dismissed");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("ignores hidden duplicate targets and positions instructions away from the PDF", () => {
    const view = setup();
    const duplicate = document.createElement("button");
    duplicate.dataset.tourId = "compile";
    document.body.appendChild(duplicate);
    vi.spyOn(duplicate, "getBoundingClientRect").mockReturnValue({
      top: 20,
      left: 700,
      width: 100,
      height: 40,
      bottom: 60,
      right: 800,
    } as DOMRect);
    start();
    expect(view.container.querySelector(".tour-spotlight")).toHaveStyle({
      left: "692px",
    });
    expect(view.container.querySelector(".tour-coachmark")).toHaveClass(
      "tour-coachmark-left",
    );
    duplicate.remove();
  });
  it.each([false, true])("dismisses the tour after starting=%s", (started) => {
    const view = setup();
    if (started) start();
    fireEvent.click(
      screen.getByRole("button", { name: started ? "Skip tour" : "Skip for now" }),
    );
    expect(getTourProgress(tour.id, 1).state).toBe("dismissed");
    expect(view.onRestore).toHaveBeenCalledOnce();
    expect(loadDiscoveryStore().analytics.at(-1)?.type).toBe("tour_dismissed");
  });
  it.each(["completed", "dismissed"] as const)(
    "does not relaunch a %s tour",
    (state) => {
      updateTourProgress({ ...getTourProgress(tour.id, 1), state });
      setup();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );
  it("does not launch before a launch is requested", () => {
    setup({ launchNonce: 0 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("clips the spotlight to a scrolling ancestor and drops it when clipped away", () => {
    const view = render(
      <>
        <div data-testid="scroller" style={{ overflowX: "auto", overflowY: "auto" }}>
          <button data-tour-id="compile">Clipped target</button>
        </div>
        <TourOverlay tour={tour} launchNonce={1} onPrepare={vi.fn()} onRestore={vi.fn()} />
      </>,
    );
    act(() => vi.advanceTimersByTime(650));
    vi.spyOn(screen.getByText("Clipped target"), "getBoundingClientRect").mockReturnValue({
      top: 20,
      left: 30,
      width: 100,
      height: 40,
      bottom: 60,
      right: 130,
    } as DOMRect);
    const scroller = vi
      .spyOn(screen.getByTestId("scroller"), "getBoundingClientRect")
      .mockReturnValue({ top: 0, left: 0, bottom: 50, right: 80 } as DOMRect);
    start();
    // Intersected with the scroller (0..80 × 0..50), then padded by 8px.
    expect(view.container.querySelector(".tour-spotlight")).toHaveStyle({
      top: "12px",
      left: "22px",
      width: "66px",
      height: "46px",
    });
    scroller.mockReturnValue({ top: 0, left: 0, bottom: 50, right: 34 } as DOMRect);
    fireEvent.resize(window);
    expect(view.container.querySelector(".tour-spotlight")).toBeNull();
  });
  it("shows a tour without steps without a spotlight", () => {
    const empty: TourDefinition = { ...tour, id: "empty-tour", steps: [] };
    const view = render(
      <TourOverlay tour={empty} launchNonce={1} onPrepare={vi.fn()} onRestore={vi.fn()} />,
    );
    act(() => vi.advanceTimersByTime(650));
    start();
    fireEvent.resize(window);
    expect(view.container.querySelector(".tour-spotlight")).toBeNull();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
  });
});

