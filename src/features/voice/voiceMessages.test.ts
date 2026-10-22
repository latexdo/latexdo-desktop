import { describe, expect, it } from "vitest";
import { voiceErrorMessage } from "./voiceMessages";

describe("voiceErrorMessage", () => {
  it("keeps credential failures apart from microphone denials", () => {
    const message = voiceErrorMessage({
      code: "credential-unavailable",
      message: "LatexDo couldn't read your OpenAI API key.",
    });
    expect(message).toBe("LatexDo couldn't read your OpenAI API key.");
    expect(message).not.toMatch(/microphone/i);
  });

  it("explains a real microphone denial", () => {
    expect(voiceErrorMessage({ code: "permission-denied", message: "" })).toMatch(
      /Microphone access was denied/,
    );
  });
});

describe("voiceErrorMessage for every error code", () => {
  it("returns null without an error", () => {
    expect(voiceErrorMessage(null)).toBeNull();
  });

  it.each([
    ["credential-unavailable", /Enter your OpenAI API key/],
    ["device-not-found", /No microphone was detected/],
    ["device-unavailable", /Another application may be using it/],
    ["recording-failed", /Voice recording failed/],
    ["empty-recording", /No speech was detected/],
    ["transcription-failed", /Voice transcription failed/],
    ["unsupported", /Bundled local speech is not available/],
    ["something-new", /Voice dictation failed/],
  ])("explains %s", (code, expected) => {
    expect(voiceErrorMessage({ code, message: "" } as never)).toMatch(expected);
  });

  it("prefers the provider's message for transcription failures", () => {
    expect(
      voiceErrorMessage({ code: "transcription-failed", message: "Quota exceeded." }),
    ).toBe("Quota exceeded.");
  });

  it.each(["cancelled", "cleanup-failed"])("stays silent for %s", (code) => {
    expect(voiceErrorMessage({ code, message: "x" } as never)).toBeNull();
  });
});
