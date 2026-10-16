import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VoiceDictationStatus } from "../features/voice/types";
import { VoiceDictationButton, formatVoiceDuration } from "./VoiceDictationButton";

const noop = () => {};

function renderButton(
  status: VoiceDictationStatus,
  overrides: Partial<Parameters<typeof VoiceDictationButton>[0]> = {},
) {
  return render(
    <VoiceDictationButton
      status={status}
      durationMs={0}
      onStart={noop}
      onStop={noop}
      onCancel={noop}
      {...overrides}
    />,
  );
}

describe("VoiceDictationButton", () => {
  it("formats the recording timer as mm:ss", () => {
    expect(formatVoiceDuration(0)).toBe("00:00");
    expect(formatVoiceDuration(8_400)).toBe("00:08");
    expect(formatVoiceDuration(65_000)).toBe("01:05");
    expect(formatVoiceDuration(-50)).toBe("00:00");
  });

  it("idle shows an accessible start control", () => {
    const onStart = vi.fn();
    renderButton("idle", { onStart });
    const button = screen.getByRole("button", {
      name: "Start voice dictation",
    });
    fireEvent.click(button);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("recording shows a live indicator with timer plus stop and cancel", () => {
    const onStop = vi.fn();
    const onCancel = vi.fn();
    renderButton("recording", {
      durationMs: 8_000,
      onStop,
      onCancel,
    });

    expect(screen.getByText("Recording")).toBeVisible();
    expect(screen.getByText("00:08")).toBeVisible();
    expect(screen.getByText("Transcribe")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Stop voice dictation" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel voice dictation" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("busy states advertise the running step and stay cancelable", () => {
    const onCancel = vi.fn();
    renderButton("transcribing", { onCancel });
    const cleanup = screen.getByRole("status");
    expect(cleanup).toBeVisible();
    expect(screen.getByRole("button", { name: "Transcribing…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel voice dictation" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("surfaces friendly errors with a retry affordance", () => {
    const onStart = vi.fn();
    renderButton("error", {
      error: { code: "permission-denied", message: "denied" },
      onStart,
    });

    expect(
      screen.getByText(/Microphone access was denied\. Enable microphone permission/i),
    ).toBeVisible();
    const retry = screen.getByRole("button", {
      name: "Start voice dictation",
    });
    fireEvent.click(retry);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("never communicates the recording state through color alone", () => {
    const { container } = renderButton("recording");
    const live = container.querySelector(".voice-live");
    expect(live?.textContent).toContain("Recording");
    const dot = container.querySelector(".voice-live-dot");
    expect(dot).not.toBeNull();
    // The textual label and the aria-labels are the primary signal.
    expect(
      screen.getByRole("button", { name: "Stop voice dictation" }),
    ).toBeInTheDocument();
    screen.getByText("Recording");
  });
});
