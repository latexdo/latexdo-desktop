import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isVoiceBarStatus, VoiceRecordingBar } from "./VoiceRecordingBar";
import type { VoiceDictationStatus } from "../features/voice/types";
import { voiceLevelHistory } from "../features/voice/useVoiceDictation";

function renderBar(overrides: Partial<Parameters<typeof VoiceRecordingBar>[0]> = {}) {
  const props = {
    status: "recording" as VoiceDictationStatus,
    levels: [0.5, 0],
    durationMs: 65_000,
    canSend: true,
    pending: null,
    onCancel: vi.fn(),
    onStop: vi.fn(),
    onSend: vi.fn(),
    ...overrides,
  };
  const view = render(<VoiceRecordingBar {...props} />);
  return { ...view, props };
}

describe("isVoiceBarStatus", () => {
  it.each([
    ["requesting-permission", true],
    ["recording", true],
    ["processing", true],
    ["transcribing", true],
    ["cleaning", true],
    ["idle", false],
    ["error", false],
  ])("%s -> %s", (status, expected) => {
    expect(isVoiceBarStatus(status as VoiceDictationStatus)).toBe(expected);
  });
});

describe("VoiceRecordingBar", () => {
  it("renders a waveform padded with empty bars and wires the buttons", () => {
    const { container, props } = renderBar();
    const bars = container.querySelectorAll(".voice-bar-wave i");
    expect(bars).toHaveLength(voiceLevelHistory);
    expect(container.querySelectorAll(".voice-bar-wave i.is-empty")).toHaveLength(
      voiceLevelHistory - 2,
    );
    const filled = bars[bars.length - 2] as HTMLElement;
    expect(filled.style.height).toBe("11px");
    expect((bars[bars.length - 1] as HTMLElement).style.height).toBe("3px");
    expect(container.querySelector(".voice-bar-time")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Cancel voice dictation"));
    fireEvent.click(screen.getByLabelText("Stop voice dictation"));
    fireEvent.click(screen.getByLabelText("Transcribe and send"));
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(props.onStop).toHaveBeenCalledOnce();
    expect(props.onSend).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Transcribe and send").getAttribute("title")).toBe(
      "Transcribe and send",
    );
  });

  it("keeps only the most recent levels", () => {
    const levels = Array.from({ length: voiceLevelHistory + 5 }, () => 1);
    const { container } = renderBar({ levels });
    expect(container.querySelectorAll(".voice-bar-wave i")).toHaveLength(
      voiceLevelHistory,
    );
    expect(container.querySelectorAll(".voice-bar-wave i.is-empty")).toHaveLength(0);
  });

  it("disables send while the assistant answers", () => {
    renderBar({ canSend: false });
    const send = screen.getByLabelText("Transcribe and send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.title).toBe("Wait for the answer to finish");
  });

  it.each([
    ["requesting-permission", "Waiting for the microphone…"],
    ["processing", "Transcribing…"],
    ["cleaning", "Cleaning up…"],
  ])("shows a working label for %s", (status, label) => {
    const { container } = renderBar({ status: status as VoiceDictationStatus });
    expect(screen.getByRole("status").textContent).toContain(label);
    expect(container.querySelector(".voice-bar-time")).toBeNull();
    expect(
      (screen.getByLabelText("Stop voice dictation") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it.each(["stop", "send"] as const)(
    "shows a spinner on the %s button once recording ends",
    (pending) => {
      const { container } = renderBar({ status: "transcribing", pending });
      const cls = pending === "stop" ? ".voice-bar-stop" : ".voice-bar-send";
      expect(container.querySelector(`${cls} .spin`)).not.toBeNull();
      const other = pending === "stop" ? ".voice-bar-send" : ".voice-bar-stop";
      expect(container.querySelector(`${other} .spin`)).toBeNull();
    },
  );
});
