import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectLocalTranscriptionServers } from "../features/voice/localTranscriptionDetection";
import {
  defaultLocalTranscriptionBaseUrl,
  defaultVoiceSettings,
  type VoiceSettings,
} from "../features/voice/voiceSettings";
import { VoiceSettingsPanel } from "./VoiceSettingsPanel";

vi.mock("../features/voice/localTranscriptionDetection", () => ({
  detectLocalTranscriptionServers: vi.fn(),
}));

const settings: VoiceSettings = {
  ...defaultVoiceSettings,
  sttBaseUrl: "http://localhost:8080/v1",
  transcriptionModel: "whisper-large-v3",
};

describe("VoiceSettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the local server and model when each field is committed", () => {
    const onSave = vi.fn();
    render(<VoiceSettingsPanel settings={settings} onSave={onSave} />);

    const endpoint = screen.getByLabelText("Speech server");
    fireEvent.change(endpoint, { target: { value: "http://localhost:1234/v1" } });
    fireEvent.blur(endpoint);
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ sttBaseUrl: "http://localhost:1234/v1" }),
    );

    const model = screen.getByLabelText("Speech model");
    fireEvent.change(model, { target: { value: "whisper-small" } });
    fireEvent.blur(model);
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ transcriptionModel: "whisper-small" }),
    );
  });

  it("does not save when a field loses focus unchanged", () => {
    const onSave = vi.fn();
    render(<VoiceSettingsPanel settings={settings} onSave={onSave} />);
    fireEvent.blur(screen.getByLabelText("Speech server"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("normalizes remote endpoints back to bundled local speech", () => {
    const onSave = vi.fn();
    render(<VoiceSettingsPanel settings={settings} onSave={onSave} />);

    const endpoint = screen.getByLabelText("Speech server") as HTMLInputElement;
    fireEvent.change(endpoint, { target: { value: "https://api.openai.com/v1" } });
    fireEvent.blur(endpoint);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ sttBaseUrl: defaultLocalTranscriptionBaseUrl }),
    );
    expect(endpoint.value).toBe(defaultLocalTranscriptionBaseUrl);
  });

  it("saves clean-up as clean versus verbatim transcription", () => {
    const onSave = vi.fn();
    render(<VoiceSettingsPanel settings={settings} onSave={onSave} />);

    const cleanUp = screen.getByLabelText(/Clean up what I say/i) as HTMLInputElement;
    expect(cleanUp.checked).toBe(true);
    fireEvent.click(cleanUp);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptMode: "verbatim" }),
    );
  });

  it("switches to OpenAI speech and saves its model", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <VoiceSettingsPanel settings={settings} onSave={onSave} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /OpenAI/ }));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ sttMode: "openai" }),
    );

    rerender(
      <VoiceSettingsPanel
        settings={{ ...settings, sttMode: "openai" }}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText(/OpenAI speech model/i), {
      target: { value: "gpt-4o-transcribe" },
    });
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sttMode: "openai",
        cloudTranscriptionModel: "gpt-4o-transcribe",
        sttBaseUrl: defaultLocalTranscriptionBaseUrl,
      }),
    );
  });

  it("finds a running speech server and uses it in one click", async () => {
    vi.mocked(detectLocalTranscriptionServers).mockResolvedValueOnce([
      {
        label: "whisper.cpp server · http://localhost:8080/v1",
        baseUrl: "http://localhost:8080/v1",
        models: ["whisper-base", "whisper-large-v3"],
        speechModel: "whisper-large-v3",
      },
    ]);
    const onSave = vi.fn();
    render(<VoiceSettingsPanel settings={settings} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: /Find/i }));
    fireEvent.click(await screen.findByRole("button", { name: /whisper.cpp server/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        sttBaseUrl: "http://localhost:8080/v1",
        transcriptionModel: "whisper-large-v3",
      }),
    );
  });

  it("reports when no local server responds", async () => {
    vi.mocked(detectLocalTranscriptionServers).mockResolvedValueOnce([]);
    render(<VoiceSettingsPanel settings={settings} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Find/i }));

    await screen.findByText(/No speech server is running/i);
  });
});
