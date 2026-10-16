// Optional conservative transcript cleanup.
//
// This is a punctuation/capitalization pass, NOT a rewrite. It preserves the
// speaker's wording, meaning, terminology, tone, and sentence order, and it
// must never "improve" the prose into different words. A cleanup failure is
// swallowed upstream (dictation falls back to the raw transcript), so this
// module never surfaces a blocking error.

import type { AiConfig } from "../ai/aiConfig";
import { generateStep } from "../ai/aiClient";
import type { ChatMessage, GenerateRequest } from "../ai/aiTypes";
import { resolveAiRuntime } from "../ai/product/aiRuntimeResolver";
import type { TranscriptCleanup, VoiceDictationError } from "./types";
import { voiceError } from "./types";
import { customDictionaryPromptSection } from "../proofreading/customDictionary";

const cleanupSystemPrompt = `You are cleaning a speech-to-text transcript for a LaTeX paragraph.
Preserve the speaker's wording, meaning, terminology, tone, and sentence order.
You may only:
- add punctuation;
- correct capitalization;
- remove obvious accidental duplicate words caused by transcription;
- correct an unmistakable transcription error when the intended word is clear from context;
- encode the text so it is safe inside a LaTeX paragraph (escape special characters such as $, %, &, #, _, {, }, ~, and ^).
Write math as inline LaTeX (\\(...\\)) only when the speaker clearly dictated it.
Do not summarize.
Do not rewrite.
Do not improve style.
Do not make the writing more professional.
Do not add information.
Do not remove information.
Do not replace the user's vocabulary with synonyms.
Return only the cleaned transcript.`;

export function buildCleanupMessages(transcript: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: [cleanupSystemPrompt, customDictionaryPromptSection()]
        .filter(Boolean)
        .join("\n"),
    },
    {
      role: "user",
      content: `Transcript:\n${transcript}`,
    },
  ];
}

/** Request id used for cancellation, matching the app's request-id pattern. */
export function newCleanupRequestId(): string {
  return `voice_clean_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function buildCleanupRequest(
  config: AiConfig,
  transcript: string,
  requestId: string,
): GenerateRequest {
  const runtime = resolveAiRuntime(config);
  return {
    requestId,
    provider: runtime.provider,
    messages: buildCleanupMessages(transcript),
    tools: [],
    options: {
      modelId: runtime.provider === "local" ? runtime.modelId : config.modelId,
      fileName: runtime.provider === "local" ? runtime.fileName : undefined,
      temperature: 0,
      effort: "low",
      maxTokens: 1200,
      ollamaBaseUrl:
        runtime.provider === "ollama" ? runtime.baseUrl : config.ollamaBaseUrl,
      ollamaModel: runtime.provider === "ollama" ? runtime.model : config.ollamaModel,
      cloudVendor: config.cloud.vendor,
      cloudBaseUrl:
        runtime.provider === "cloud" ? runtime.baseUrl : config.cloud.baseUrl,
      cloudModel: runtime.provider === "cloud" ? runtime.model : config.cloud.model,
      cloudCredentialId:
        runtime.provider === "cloud" ? runtime.credentialId : config.cloud.credentialId,
    },
  };
}

export class LlmTranscriptCleanup implements TranscriptCleanup {
  readonly id = "llm";

  private readonly config: AiConfig;

  constructor(config: AiConfig) {
    this.config = config;
  }

  async cleanup(transcript: string, _signal?: AbortSignal): Promise<string> {
    const requestId = newCleanupRequestId();
    const step = await generateStep(
      buildCleanupRequest(this.config, transcript, requestId),
      () => {},
    );
    if (step.type === "error") {
      throw cleanupFailureError(step.content);
    }
    const cleaned = step.content.trim();
    if (!cleaned) throw cleanupFailureError("Empty cleanup result.");
    return cleaned;
  }
}

/** Build cleanup against the selected local workspace AI model. */
export function createTranscriptCleanup(config: AiConfig): TranscriptCleanup | null {
  if (config.provider !== "local") return null;
  return new LlmTranscriptCleanup(config);
}

/**
 * A structured cleanup error. This is deliberately NOT surfaced to the user as
 * a dictation failure (see useVoiceDictation: cleanup failure falls back to
 * the raw transcript).
 */
export function cleanupFailureError(cause?: unknown): VoiceDictationError {
  return voiceError("cleanup-failed", "Transcript cleanup failed.", cause);
}
