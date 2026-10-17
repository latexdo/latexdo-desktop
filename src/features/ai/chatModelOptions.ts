/*
 * The models the chat's model picker offers, and how choosing one changes the
 * AI configuration. Only models that can answer right now are selectable; the
 * others say why (not downloaded, not enough memory, no API key).
 */

import { cloudCredentialId, type AiConfig } from "./aiConfig";
import { findCloudProvider } from "./cloudProviders";
import type { LatexDoAiTierDefinition } from "./product/latexDoAiTiers";

export interface ChatModelOption {
  /** "tier:<id>", "cloud:<model>" or "ollama:<model>". */
  id: string;
  group: string;
  label: string;
  available: boolean;
  /** Why an unavailable model cannot be chosen yet. */
  reason?: string;
  active: boolean;
}

export interface TierChoice {
  tier: LatexDoAiTierDefinition;
  /** Downloaded and able to run on this computer now. */
  ready: boolean;
  reason?: string;
}

export function buildChatModelOptions(input: {
  config: AiConfig;
  isDesktop: boolean;
  tiers: readonly TierChoice[];
  ollamaModels: readonly string[];
}): ChatModelOption[] {
  const { config, isDesktop } = input;
  const options: ChatModelOption[] = [];

  if (isDesktop) {
    for (const { tier, ready, reason } of input.tiers) {
      options.push({
        id: `tier:${tier.id}`,
        group: "LatexDo AI · on this computer",
        label: tier.name,
        available: ready,
        reason: ready ? undefined : reason,
        active:
          config.provider === "local" &&
          config.selection.mode === "latexdo" &&
          config.selection.tier === tier.id,
      });
    }
  }

  const provider = findCloudProvider(config.cloud.providerId);
  if (config.cloud.credentialConfigured) {
    const models = new Set(provider?.models ?? []);
    if (config.cloud.model) models.add(config.cloud.model);
    for (const model of models) {
      options.push({
        id: `cloud:${model}`,
        group: provider?.label ?? "Cloud",
        label: model,
        available: true,
        active: config.provider === "cloud" && config.cloud.model === model,
      });
    }
  }

  if (isDesktop) {
    const models = new Set(input.ollamaModels);
    if (config.provider === "ollama" && config.ollamaModel)
      models.add(config.ollamaModel);
    for (const model of models) {
      options.push({
        id: `ollama:${model}`,
        group: "Ollama",
        label: model,
        available: true,
        active: config.provider === "ollama" && config.ollamaModel === model,
      });
    }
  }
  return options;
}

/** The configuration after choosing an option, or null for an unknown id. */
export function applyChatModelOption(
  config: AiConfig,
  id: string,
  tiers: readonly LatexDoAiTierDefinition[],
): AiConfig | null {
  const [kind, ...rest] = id.split(":");
  const value = rest.join(":");
  if (!value) return null;

  if (kind === "tier") {
    const tier = tiers.find((item) => item.id === value);
    if (!tier) return null;
    return {
      ...config,
      provider: "local",
      selection: { mode: "latexdo", tier: tier.id },
      modelId: tier.runtime.modelId,
      modelDownloaded: true,
    };
  }
  if (kind === "cloud") {
    const providerId = config.cloud.providerId;
    return {
      ...config,
      provider: "cloud",
      cloud: { ...config.cloud, model: value },
      selection: {
        mode: "custom",
        custom: {
          kind: "cloud",
          providerId,
          model: value,
          baseUrl: config.cloud.baseUrl,
          credentialId: cloudCredentialId(providerId),
        },
      },
    };
  }
  if (kind === "ollama") {
    return {
      ...config,
      provider: "ollama",
      ollamaModel: value,
      selection: {
        mode: "custom",
        custom: { kind: "ollama", baseUrl: config.ollamaBaseUrl, model: value },
      },
    };
  }
  return null;
}

/** What the privacy badge says, truthfully, for the model in use. */
export function chatPrivacyText(config: AiConfig): string {
  const approval = "The assistant asks before it changes any file.";
  if (config.provider === "cloud") {
    const name =
      findCloudProvider(config.cloud.providerId)?.label ?? "your cloud provider";
    return `Private and secure. Your chats are saved only on this computer and sent only to ${name}, with your own key, to get answers. ${approval}`;
  }
  return `Private and secure. Your chats and files never leave this computer: the AI runs locally. ${approval}`;
}
