// AI model catalog facade. The data is generated from the in-repo catalog during
// the build and baked into normal desktop releases.

import { aiCatalog } from "./aiCatalog.generated";
import type { LocalModelInfo, ModelTier } from "./aiCatalog";

export type { LocalModelInfo, ModelTier } from "./aiCatalog";

export const localModelCatalog: readonly LocalModelInfo[] = aiCatalog.localModels;
export const defaultLocalModelId = aiCatalog.defaultLocalModelId;
export const defaultInlineModelId = aiCatalog.defaultInlineModelId;

export function findLocalModel(id: string): LocalModelInfo | undefined {
  return localModelCatalog.find((model) => model.id === id);
}

export const tierLabels: Record<ModelTier, string> = {
  recommended: "Recommended",
  balanced: "Balanced",
  light: "Lightweight",
  inline: "Inline completion",
};
