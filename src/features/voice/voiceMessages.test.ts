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
