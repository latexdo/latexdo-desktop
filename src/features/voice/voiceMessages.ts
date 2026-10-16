// Friendly, user-facing messages for structured voice errors. Provider
// internals are never shown; raw audio and transcript content are never logged.

import type { VoiceDictationError } from "./types";

export function voiceErrorMessage(error: VoiceDictationError | null): string | null {
  if (!error) return null;
  switch (error.code) {
    case "permission-denied":
      return "Microphone access was denied. Enable microphone permission for LatexDo and try again.";
    case "credential-unavailable":
      return (
        error.message ||
        "Voice transcription isn't configured. Enter your OpenAI API key in the AI settings."
      );
    case "device-not-found":
      return "No microphone was detected.";
    case "device-unavailable":
      return "LatexDo couldn't access the microphone. Another application may be using it.";
    case "recording-failed":
      return "Voice recording failed. Your existing text was not changed.";
    case "empty-recording":
      return "No speech was detected.";
    case "transcription-failed":
      return (
        error.message ||
        "Voice transcription failed. Your existing text was not changed."
      );
    case "unsupported":
      return "Bundled local speech is not available in this build. Reinstall LatexDo with speech support.";
    case "cancelled":
      return null;
    case "cleanup-failed":
      return null;
    default:
      return "Voice dictation failed. Your existing text was not changed.";
  }
}
