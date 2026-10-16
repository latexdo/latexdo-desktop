export type ModelTier = "recommended" | "balanced" | "light" | "inline";
export type ApiShape = "anthropic" | "openai";

export interface LocalModelInfo {
  /** Stable id stored in config; also used as the local file stem. */
  id: string;
  name: string;
  /** Short marketing-free description shown in the wizard. */
  description: string;
  params: string;
  /** Approximate on-disk size of the GGUF file. */
  downloadSize: string;
  /** Approximate resident RAM with an 8k context. */
  ramEstimate: string;
  /** Minimum system RAM we recommend before offering this model. */
  minSystemRamGb: number;
  /** Minimum currently available RAM before offering this model. */
  minAvailableRamGb: number;
  tier: ModelTier;
  quant: string;
  /** Direct GGUF download URL. */
  downloadUrl: string;
  /** File name written into the models directory. */
  fileName: string;
  /** Whether the model reliably supports structured tool/function calling. */
  supportsTools: boolean;
  /** Best-fit tasks, surfaced as chips in the wizard. */
  strengths: readonly string[];
}

export interface CloudProviderPreset {
  id: string;
  label: string;
  apiShape: ApiShape;
  /** Empty means aiCloud uses the vendor's default endpoint. */
  baseUrl: string;
  models: readonly string[];
  defaultModel: string;
  /** Where the user gets an API key. */
  apiKeyUrl: string;
  /** True means user must supply the base URL themselves. */
  custom?: boolean;
}

export interface AiCatalog {
  schemaVersion: 1;
  catalogVersion: string;
  defaultLocalModelId: string;
  defaultInlineModelId: string;
  defaultCloudProviderId: string;
  localModels: readonly LocalModelInfo[];
  cloudProviders: readonly CloudProviderPreset[];
}
