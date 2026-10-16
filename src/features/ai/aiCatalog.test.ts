import { describe, expect, it } from "vitest";
import { aiCatalog } from "./aiCatalog.generated";
import { defaultAiConfig } from "./aiConfig";
import { findCloudProvider } from "./cloudProviders";
import { findLocalModel } from "./aiModels";
import { latexDoAiTiers } from "./product/latexDoAiTiers";

describe("AI catalog", () => {
  it("points default model ids at catalog entries", () => {
    expect(findLocalModel(aiCatalog.defaultLocalModelId)?.tier).toBe("recommended");
    expect(findLocalModel(aiCatalog.defaultInlineModelId)?.tier).toBe("inline");
  });

  it("drives the default cloud configuration", () => {
    const provider = findCloudProvider(aiCatalog.defaultCloudProviderId);

    expect(provider).toBeDefined();
    expect(defaultAiConfig.cloud).toMatchObject({
      providerId: aiCatalog.defaultCloudProviderId,
      vendor: provider?.apiShape,
      model: provider?.defaultModel,
      baseUrl: provider?.baseUrl,
    });
  });

  it("maps public LatexDo AI tiers to their private local runtimes", () => {
    expect(
      latexDoAiTiers.map((tier) => ({
        id: tier.id,
        name: tier.name,
        description: tier.description,
        modelId: tier.runtime.modelId,
        minSystemRamGb: tier.requirements.minSystemRamBytes / 1024 ** 3,
        minAvailableRamGb: tier.requirements.minAvailableRamBytes / 1024 ** 3,
      })),
    ).toEqual([
      {
        id: "latexdo-ai",
        name: "LatexDo AI",
        description: "Fast, capable, everyday AI",
        modelId: "qwen2.5-coder-1.5b",
        minSystemRamGb: 8,
        minAvailableRamGb: 3,
      },
      {
        id: "latexdo-ai-plus",
        name: "LatexDo AI Plus",
        description: "Smarter, stronger, more capable",
        modelId: "qwen2.5-coder-3b",
        minSystemRamGb: 8,
        minAvailableRamGb: 4,
      },
      {
        id: "latexdo-pro",
        name: "LatexDo Pro",
        description: "Advanced AI for professionals",
        modelId: "qwen3-4b",
        minSystemRamGb: 12,
        minAvailableRamGb: 6,
      },
      {
        id: "latexdo-pro-max",
        name: "LatexDo Pro Max",
        description: "Our most powerful AI",
        modelId: "qwen3-8b",
        minSystemRamGb: 16,
        minAvailableRamGb: 8,
      },
    ]);
  });
});
