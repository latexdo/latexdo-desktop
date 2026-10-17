import { describe, expect, it } from "vitest";
import { defaultAiConfig, type AiConfig } from "./aiConfig";
import { latexDoAiTiers } from "./product/latexDoAiTiers";
import {
  applyChatModelOption,
  buildChatModelOptions,
  chatPrivacyText,
} from "./chatModelOptions";

const tier = latexDoAiTiers[0]!;
const cloudConfig: AiConfig = {
  ...defaultAiConfig,
  provider: "cloud",
  cloud: {
    ...defaultAiConfig.cloud,
    providerId: "anthropic",
    model: "claude-opus-5-5",
    credentialConfigured: true,
  },
};

describe("chat model options", () => {
  it("lists local, cloud and Ollama models with the active one marked", () => {
    const options = buildChatModelOptions({
      config: cloudConfig,
      isDesktop: true,
      ollamaModels: ["llama3"],
      tiers: [{ tier, ready: false, reason: "Download it in AI settings" }],
    });
    expect(options[0]).toMatchObject({
      id: `tier:${tier.id}`,
      available: false,
      reason: "Download it in AI settings",
    });
    const active = options.filter((option) => option.active);
    expect(active.map((option) => option.id)).toEqual(["cloud:claude-opus-5-5"]);
    expect(options.some((option) => option.id === "ollama:llama3")).toBe(true);
  });

  it("offers no cloud models without a key and no local ones in the browser", () => {
    const options = buildChatModelOptions({
      config: {
        ...cloudConfig,
        cloud: { ...cloudConfig.cloud, credentialConfigured: false },
      },
      isDesktop: false,
      ollamaModels: ["llama3"],
      tiers: [{ tier, ready: true }],
    });
    expect(options).toEqual([]);
  });

  it("switches the provider and the selection together", () => {
    const local = applyChatModelOption(cloudConfig, `tier:${tier.id}`, latexDoAiTiers)!;
    expect(local).toMatchObject({
      provider: "local",
      selection: { mode: "latexdo", tier: tier.id },
      modelId: tier.runtime.modelId,
    });
    const cloud = applyChatModelOption(
      local,
      "cloud:claude-sonnet-5-5",
      latexDoAiTiers,
    )!;
    expect(cloud.provider).toBe("cloud");
    expect(cloud.cloud.model).toBe("claude-sonnet-5-5");
    expect(cloud.selection).toMatchObject({
      mode: "custom",
      custom: { kind: "cloud" },
    });
    expect(applyChatModelOption(cloud, "ollama:llama3", latexDoAiTiers)).toMatchObject({
      provider: "ollama",
      ollamaModel: "llama3",
    });
    expect(applyChatModelOption(cloud, "nope", latexDoAiTiers)).toBeNull();
  });

  it("describes privacy truthfully for local and cloud models", () => {
    expect(chatPrivacyText(defaultAiConfig)).toMatch(/never leave this computer/);
    expect(chatPrivacyText(cloudConfig)).toMatch(/sent only to Claude \(Anthropic\)/);
  });
});
