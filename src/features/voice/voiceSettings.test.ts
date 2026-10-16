import { describe, expect, it } from "vitest";
import {
  defaultCloudTranscriptionModel,
  defaultLocalTranscriptionBaseUrl,
  normalizeVoiceSettings,
} from "./voiceSettings";

describe("voiceSettings", () => {
  it("defaults blank speech settings to local transcription", () => {
    expect(
      normalizeVoiceSettings({ sttBaseUrl: "", transcriptionModel: "" }),
    ).toMatchObject({
      sttBaseUrl: defaultLocalTranscriptionBaseUrl,
      sttMode: "local",
      transcriptionModel: "whisper-1",
      cloudTranscriptionModel: defaultCloudTranscriptionModel,
    });
  });

  it("migrates the old cloud transcription model name to the local default", () => {
    expect(
      normalizeVoiceSettings({
        sttBaseUrl: "http://localhost:8080/v1",
        transcriptionModel: "gpt-4o-mini-transcribe",
      }).transcriptionModel,
    ).toBe("whisper-1");
  });

  it("migrates remote speech endpoints back to bundled local speech", () => {
    expect(
      normalizeVoiceSettings({
        sttBaseUrl: "https://api.openai.com/v1",
        transcriptionModel: "whisper-1",
      }).sttBaseUrl,
    ).toBe(defaultLocalTranscriptionBaseUrl);
  });

  it("keeps explicit OpenAI speech settings separate from local speech", () => {
    expect(
      normalizeVoiceSettings({
        sttMode: "openai",
        sttBaseUrl: "https://api.openai.com/v1",
        transcriptionModel: "whisper-large-v3",
        cloudTranscriptionModel: "gpt-4o-transcribe",
      }),
    ).toMatchObject({
      sttMode: "openai",
      sttBaseUrl: defaultLocalTranscriptionBaseUrl,
      transcriptionModel: "whisper-large-v3",
      cloudTranscriptionModel: "gpt-4o-transcribe",
    });
  });
});
