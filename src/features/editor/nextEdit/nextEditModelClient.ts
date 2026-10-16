import { generateStep, abortGeneration } from "../../ai/aiClient";
import type { AiConfig } from "../../ai/aiConfig";
import { findLocalModel } from "../../ai/aiModels";
import type { ChatMessage, GenerateRequest, GenerationStep } from "../../ai/aiTypes";
import type { NextEditConfig } from "./nextEditTypes";

export interface NextEditModelCompletionRequest {
  requestId: string;
  messages: ChatMessage[];
}

export interface NextEditModelClient {
  complete(
    request: NextEditModelCompletionRequest,
    signal: AbortSignal,
  ): Promise<string | null>;
}

export type GenerateStepFn = (
  request: GenerateRequest,
  onToken: (text: string) => void,
) => Promise<GenerationStep>;

export type AbortGenerationFn = (requestId: string) => Promise<void>;

export class GenerateStepNextEditModelClient implements NextEditModelClient {
  constructor(
    private readonly aiConfig: AiConfig,
    private readonly nextEditConfig: NextEditConfig,
    private readonly isDesktop: boolean,
    private readonly generate: GenerateStepFn = generateStep,
    private readonly abort: AbortGenerationFn = abortGeneration,
  ) {}

  async complete(
    request: NextEditModelCompletionRequest,
    signal: AbortSignal,
  ): Promise<string | null> {
    if (!nextEditModelAvailable(this.aiConfig, this.isDesktop)) return null;
    if (signal.aborted) return null;

    const generateRequest = requestFor(
      this.aiConfig,
      this.nextEditConfig,
      request.requestId,
      request.messages,
    );
    const onAbort = () => {
      void this.abort(request.requestId);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const step = await this.generate(generateRequest, () => {});
      if (signal.aborted || step.type === "error") return null;
      return step.content;
    } catch {
      return null;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

export function nextEditModelAvailable(config: AiConfig, isDesktop: boolean): boolean {
  if (config.provider === "off") return false;
  if (!config.access.currentEditor) return false;
  if (config.provider === "cloud") return config.cloud.credentialConfigured;
  if (!isDesktop) return false;
  if (config.provider === "local") return config.modelDownloaded;
  return config.ollamaModel.trim().length > 0;
}

function requestFor(
  config: AiConfig,
  nextEditConfig: NextEditConfig,
  requestId: string,
  messages: ChatMessage[],
): GenerateRequest {
  const localModelId = nextEditConfig.useInlineModel
    ? config.inlineModelId
    : config.modelId;
  const localModel = findLocalModel(localModelId) ?? findLocalModel(config.modelId);
  return {
    requestId,
    provider: providerFor(config),
    messages,
    tools: [],
    options: {
      modelId: localModelId,
      fileName: localModel?.fileName,
      temperature: 0,
      effort: "low",
      maxTokens: 260,
      ollamaBaseUrl: config.ollamaBaseUrl,
      ollamaModel: config.ollamaModel,
      cloudVendor: config.cloud.vendor,
      cloudBaseUrl: config.cloud.baseUrl,
      cloudModel: config.cloud.model,
      cloudCredentialId: config.cloud.credentialId,
    },
  };
}

function providerFor(config: AiConfig): "local" | "ollama" | "cloud" {
  if (config.provider === "local" || config.provider === "ollama") {
    return config.provider;
  }
  return "cloud";
}
