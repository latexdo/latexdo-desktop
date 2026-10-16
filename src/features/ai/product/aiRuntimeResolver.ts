import type { AiConfig } from "../aiConfig";
import { findLocalModel } from "../aiModels";
import { findLatexDoAiTierByModelId, resolveLatexDoAiTier } from "./latexDoAiTiers";

export type ResolvedAiRuntime =
  | {
      provider: "local";
      modelId: string;
      fileName?: string;
    }
  | {
      provider: "ollama";
      baseUrl: string;
      model: string;
    }
  | {
      provider: "cloud";
      vendor: string;
      baseUrl: string;
      model: string;
      /** Id used to fetch the secret from the OS vault at request time. */
      credentialId: string;
    };

export function resolveAiRuntime(config: AiConfig): ResolvedAiRuntime {
  if (config.provider === "local") {
    if (config.selection.mode === "latexdo") {
      const tier = resolveLatexDoAiTier(config.selection.tier);
      return {
        provider: "local",
        modelId: tier.runtime.modelId,
        fileName: tier.runtime.fileName,
      };
    }
    if (config.selection.mode === "custom" && config.selection.custom.kind === "gguf") {
      const model = findLocalModel(config.selection.custom.modelId);
      return {
        provider: "local",
        modelId: config.selection.custom.modelId,
        fileName: model?.fileName,
      };
    }
    const model = findLocalModel(config.modelId);
    const tier = findLatexDoAiTierByModelId(config.modelId);
    return {
      provider: "local",
      modelId: config.modelId,
      fileName: tier?.runtime.fileName ?? model?.fileName,
    };
  }

  if (config.provider === "ollama") {
    if (
      config.selection.mode === "custom" &&
      config.selection.custom.kind === "ollama"
    ) {
      return {
        provider: "ollama",
        baseUrl: config.selection.custom.baseUrl,
        model: config.selection.custom.model,
      };
    }
    return {
      provider: "ollama",
      baseUrl: config.ollamaBaseUrl,
      model: config.ollamaModel,
    };
  }

  if (
    config.provider === "cloud" &&
    config.selection.mode === "custom" &&
    config.selection.custom.kind === "cloud"
  ) {
    return {
      provider: "cloud",
      vendor: config.cloud.vendor,
      baseUrl: config.selection.custom.baseUrl ?? config.cloud.baseUrl,
      model: config.selection.custom.model || config.cloud.model,
      credentialId: config.selection.custom.credentialId || config.cloud.credentialId,
    };
  }

  if (config.provider === "cloud") {
    return {
      provider: "cloud",
      vendor: config.cloud.vendor,
      baseUrl: config.cloud.baseUrl,
      model: config.cloud.model,
      credentialId: config.cloud.credentialId,
    };
  }

  return {
    provider: "cloud",
    vendor: config.cloud.vendor,
    baseUrl: config.cloud.baseUrl,
    model: config.cloud.model,
    credentialId: config.cloud.credentialId,
  };
}
