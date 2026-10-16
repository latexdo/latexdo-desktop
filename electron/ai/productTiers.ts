import type { AiSystemCapabilities } from "./systemCapabilities.js";

export const GB = 1024 ** 3;
const storageHeadroomBytes = 256 * 1024 ** 2;

function storageRequirementBytes(downloadSizeGb: number): number {
  return Math.ceil(downloadSizeGb * 1.15 * GB + storageHeadroomBytes);
}

export type LatexDoAiTier =
  | "latexdo-ai"
  | "latexdo-ai-plus"
  | "latexdo-pro"
  | "latexdo-pro-max";

export type TierAvailability =
  | { state: "available" }
  | {
      state: "memory-pressure";
      requiredAvailableBytes: number;
      availableBytes: number;
    }
  | {
      state: "storage-pressure";
      requiredAvailableStorageBytes: number;
      availableStorageBytes: number;
    }
  | {
      state: "unsupported";
      reason: string;
      requiredSystemRamBytes?: number;
      detectedSystemRamBytes?: number;
    };

export interface LatexDoAiTierDefinition {
  id: LatexDoAiTier;
  name: string;
  description: string;
  runtime: {
    modelId: string;
    fileName: string;
    downloadUrl: string;
    /** Trusted manifest entry. Compiled from official model metadata. */
    expectedSizeBytes: number;
    /** Expected size bands (bytes) accepted by the download verifier. */
    expectedSizeRangeBytes: { min: number; max: number };
    /**
     * If set, the downloaded artifact must match this hash exactly before it
     * is moved into place. Populated by release tooling from upstream model
     * metadata; `null` means the size band verification still applies.
     */
    expectedSha256: string | null;
  };
  requirements: {
    minSystemRamBytes: number;
    minAvailableRamBytes: number;
    minAvailableStorageBytes: number;
  };
}

export const latexDoAiTiers: readonly LatexDoAiTierDefinition[] = [
  {
    id: "latexdo-ai",
    name: "LatexDo AI",
    description: "Fast, capable, everyday AI",
    runtime: {
      modelId: "qwen2.5-coder-1.5b",
      fileName: "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
      downloadUrl:
        "https://huggingface.co/bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf",
      expectedSizeBytes: 1.12 * GB,
      expectedSizeRangeBytes: {
        min: Math.floor(1.12 * GB * 0.5),
        max: Math.ceil(1.12 * GB * 1.15),
      },
      expectedSha256: null,
    },
    requirements: {
      minSystemRamBytes: 8 * GB,
      minAvailableRamBytes: 3 * GB,
      minAvailableStorageBytes: storageRequirementBytes(1.12),
    },
  },
  {
    id: "latexdo-ai-plus",
    name: "LatexDo AI Plus",
    description: "Smarter, stronger, more capable",
    runtime: {
      modelId: "qwen2.5-coder-3b",
      fileName: "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
      downloadUrl:
        "https://huggingface.co/bartowski/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf",
      expectedSizeBytes: 2.0 * GB,
      expectedSizeRangeBytes: {
        min: Math.floor(2.0 * GB * 0.5),
        max: Math.ceil(2.0 * GB * 1.15),
      },
      expectedSha256: null,
    },
    requirements: {
      minSystemRamBytes: 8 * GB,
      minAvailableRamBytes: 4 * GB,
      minAvailableStorageBytes: storageRequirementBytes(2.0),
    },
  },
  {
    id: "latexdo-pro",
    name: "LatexDo Pro",
    description: "Advanced AI for professionals",
    runtime: {
      modelId: "qwen3-4b",
      fileName: "qwen3-4b-q4_k_m.gguf",
      downloadUrl:
        "https://huggingface.co/bartowski/Qwen_Qwen3-4B-GGUF/resolve/main/Qwen_Qwen3-4B-Q4_K_M.gguf",
      expectedSizeBytes: 2.5 * GB,
      expectedSizeRangeBytes: {
        min: Math.floor(2.5 * GB * 0.5),
        max: Math.ceil(2.5 * GB * 1.15),
      },
      expectedSha256: null,
    },
    requirements: {
      minSystemRamBytes: 12 * GB,
      minAvailableRamBytes: 6 * GB,
      minAvailableStorageBytes: storageRequirementBytes(2.5),
    },
  },
  {
    id: "latexdo-pro-max",
    name: "LatexDo Pro Max",
    description: "Our most powerful AI",
    runtime: {
      modelId: "qwen3-8b",
      fileName: "qwen3-8b-q4_k_m.gguf",
      downloadUrl:
        "https://huggingface.co/bartowski/Qwen_Qwen3-8B-GGUF/resolve/main/Qwen_Qwen3-8B-Q4_K_M.gguf",
      expectedSizeBytes: 5.03 * GB,
      expectedSizeRangeBytes: {
        min: Math.floor(5.03 * GB * 0.5),
        max: Math.ceil(5.03 * GB * 1.15),
      },
      expectedSha256: null,
    },
    requirements: {
      minSystemRamBytes: 16 * GB,
      minAvailableRamBytes: 8 * GB,
      minAvailableStorageBytes: storageRequirementBytes(5.03),
    },
  },
];

export function findLatexDoAiTier(tier: string): LatexDoAiTierDefinition | undefined {
  return latexDoAiTiers.find((item) => item.id === tier);
}

export function findLatexDoAiTierByRuntime(
  modelId: string | undefined,
  fileName: string | undefined,
): LatexDoAiTierDefinition | undefined {
  return latexDoAiTiers.find(
    (item) => item.runtime.modelId === modelId || item.runtime.fileName === fileName,
  );
}

export function fastTierRuntimeAvailability(
  tier: LatexDoAiTierDefinition,
  system: AiSystemCapabilities,
): TierAvailability {
  if (!system.localAiAvailable) {
    return {
      state: "unsupported",
      reason: "Local AI is not available in this runtime.",
    };
  }
  if (system.totalRamBytes < tier.requirements.minSystemRamBytes) {
    return {
      state: "unsupported",
      reason: "Insufficient physical memory",
      requiredSystemRamBytes: tier.requirements.minSystemRamBytes,
      detectedSystemRamBytes: system.totalRamBytes,
    };
  }
  if (system.freeRamBytes < tier.requirements.minAvailableRamBytes) {
    return {
      state: "memory-pressure",
      requiredAvailableBytes: tier.requirements.minAvailableRamBytes,
      availableBytes: system.freeRamBytes,
    };
  }
  return { state: "available" };
}

export function fastTierAvailability(
  tier: LatexDoAiTierDefinition,
  system: AiSystemCapabilities,
): TierAvailability {
  const runtimeAvailability = fastTierRuntimeAvailability(tier, system);
  if (runtimeAvailability.state !== "available") return runtimeAvailability;
  if (system.freeStorageBytes === null) {
    return {
      state: "unsupported",
      reason: "Could not check available storage for local AI models.",
    };
  }
  if (system.freeStorageBytes < tier.requirements.minAvailableStorageBytes) {
    return {
      state: "storage-pressure",
      requiredAvailableStorageBytes: tier.requirements.minAvailableStorageBytes,
      availableStorageBytes: system.freeStorageBytes,
    };
  }
  return { state: "available" };
}
