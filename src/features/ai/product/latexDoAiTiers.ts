import type { AiSystemCapabilities, TierAvailability } from "../aiTypes";
import { findLocalModel } from "../aiModels";

export const GB = 1024 ** 3;
const storageHeadroomBytes = 256 * 1024 ** 2;

export type LatexDoAiTier =
  | "latexdo-ai"
  | "latexdo-ai-plus"
  | "latexdo-pro"
  | "latexdo-pro-max";

/** One concrete thing a tier can do, with the exact wording shown to users. */
export interface TierCapability {
  id: string;
  label: string;
  detail: string;
}

/**
 * The full universe of assistant capabilities. Each tier's `capabilities`
 * array references these ids, so the comparison view can render one shared
 * table of what every model can and cannot do.
 */
export const tierCapabilityCatalog: readonly TierCapability[] = [
  {
    id: "inline-completion",
    label: "Inline completion",
    detail: "Fast LaTeX and code completion while you type.",
  },
  {
    id: "quick-fixes",
    label: "Quick fixes",
    detail: "Patch small syntax errors and typos in the open document.",
  },
  {
    id: "light-chat",
    label: "Lightweight chat",
    detail: "Quick answers to everyday LaTeX questions.",
  },
  {
    id: "agent-project",
    label: "Project-aware agent",
    detail: "Read files, write LaTeX, compile, and fix errors for you.",
  },
  {
    id: "compile-diagnostics",
    label: "Compile diagnostics",
    detail: "Explain and resolve errors reported by the compiler.",
  },
  {
    id: "citations",
    label: "Citation lookup",
    detail: "Find and insert real references from your bibliography.",
  },
  {
    id: "conference-checks",
    label: "Conference compliance",
    detail: "ACM, IEEE, and journal format checks on the manuscript.",
  },
  {
    id: "pdf-compliance",
    label: "PDF compliance",
    detail: "Page limits, fonts, and submission-format checks.",
  },
  {
    id: "structure-review",
    label: "Structure & reproducibility",
    detail: "Section flow, numbering, and reproducibility checklist.",
  },
  {
    id: "rebuttals",
    label: "Rebuttal & review drafting",
    detail: "Draft reviewer responses and rebuttals.",
  },
  {
    id: "long-form",
    label: "Long-form review",
    detail: "Reads and rewrites whole sections in one pass.",
  },
  {
    id: "workspace-reasoning",
    label: "Workspace reasoning",
    detail: "Reason over many files: related work, figures, notation.",
  },
  {
    id: "recommendations",
    label: "Deep recommendations",
    detail: "Notation, acronyms, and cross-reference suggestions.",
  },
];

export function capabilityById(id: string): TierCapability | undefined {
  return tierCapabilityCatalog.find((capability) => capability.id === id);
}

export interface LatexDoAiTierDefinition {
  id: LatexDoAiTier;
  name: string;
  description: string;
  /**
   * The headline value of this tier, shown next to its name (e.g. "Inline
   * completion" or "In-editor agent").
   */
  tagline: string;
  /** Ordered by importance; the comparison view uses this ordering. */
  capabilities: readonly string[];
  runtime: {
    modelId: string;
    fileName: string;
    downloadUrl: string;
    /** Approximate download size, used for setup progress. */
    downloadBytes: number;
  };
  requirements: {
    minSystemRamBytes: number;
    minAvailableRamBytes: number;
    minAvailableStorageBytes: number;
  };
}

interface LatexDoAiTierProduct {
  id: LatexDoAiTier;
  name: string;
  description: string;
  tagline: string;
  capabilities: readonly string[];
  runtimeModelId: string;
}

const tierProducts: readonly LatexDoAiTierProduct[] = [
  {
    id: "latexdo-ai",
    name: "LatexDo AI",
    description: "Fast, capable, everyday AI",
    tagline: "Inline completion",
    capabilities: ["inline-completion", "quick-fixes", "light-chat"],
    runtimeModelId: "qwen2.5-coder-1.5b",
  },
  {
    id: "latexdo-ai-plus",
    name: "LatexDo AI Plus",
    description: "Smarter, stronger, more capable",
    tagline: "In-editor agent",
    capabilities: [
      "inline-completion",
      "quick-fixes",
      "light-chat",
      "agent-project",
      "compile-diagnostics",
      "citations",
    ],
    runtimeModelId: "qwen2.5-coder-3b",
  },
  {
    id: "latexdo-pro",
    name: "LatexDo Pro",
    description: "Advanced AI for professionals",
    tagline: "Paper reviewer",
    capabilities: [
      "inline-completion",
      "quick-fixes",
      "light-chat",
      "agent-project",
      "compile-diagnostics",
      "citations",
      "conference-checks",
      "pdf-compliance",
      "structure-review",
      "rebuttals",
    ],
    runtimeModelId: "qwen3-4b",
  },
  {
    id: "latexdo-pro-max",
    name: "LatexDo Pro Max",
    description: "Our most powerful AI",
    tagline: "Research companion",
    capabilities: [
      "inline-completion",
      "quick-fixes",
      "light-chat",
      "agent-project",
      "compile-diagnostics",
      "citations",
      "conference-checks",
      "pdf-compliance",
      "structure-review",
      "rebuttals",
      "long-form",
      "workspace-reasoning",
      "recommendations",
    ],
    runtimeModelId: "qwen3-8b",
  },
];

function gbToBytes(value: number): number {
  return Math.round(value * GB);
}

function downloadSizeToBytes(value: string): number {
  const match = /([\d.]+)\s*(GB|MB)\b/i.exec(value);
  if (!match) {
    throw new Error(`Invalid local model download size: ${value}`);
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid local model download size: ${value}`);
  }
  const unit = match[2].toUpperCase();
  return Math.round(amount * (unit === "GB" ? GB : 1024 ** 2));
}

function storageRequirementBytes(downloadSize: string): number {
  return Math.ceil(downloadSizeToBytes(downloadSize) * 1.15 + storageHeadroomBytes);
}

function toTierDefinition(product: LatexDoAiTierProduct): LatexDoAiTierDefinition {
  const runtime = findLocalModel(product.runtimeModelId);
  if (!runtime) {
    throw new Error(`Missing LatexDo AI runtime model: ${product.runtimeModelId}`);
  }
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    tagline: product.tagline,
    capabilities: product.capabilities,
    runtime: {
      modelId: runtime.id,
      fileName: runtime.fileName,
      downloadUrl: runtime.downloadUrl,
      downloadBytes: downloadSizeToBytes(runtime.downloadSize),
    },
    requirements: {
      minSystemRamBytes: gbToBytes(runtime.minSystemRamGb),
      minAvailableRamBytes: gbToBytes(runtime.minAvailableRamGb),
      minAvailableStorageBytes: storageRequirementBytes(runtime.downloadSize),
    },
  };
}

export const latexDoAiTiers: readonly LatexDoAiTierDefinition[] =
  tierProducts.map(toTierDefinition);

export const defaultLatexDoAiTier: LatexDoAiTier = "latexdo-ai-plus";

export function findLatexDoAiTier(tier: string): LatexDoAiTierDefinition | undefined {
  return latexDoAiTiers.find((item) => item.id === tier);
}

export function findLatexDoAiTierByModelId(
  modelId: string,
): LatexDoAiTierDefinition | undefined {
  return latexDoAiTiers.find((item) => item.runtime.modelId === modelId);
}

export function resolveLatexDoAiTier(tier: LatexDoAiTier): LatexDoAiTierDefinition {
  const definition = findLatexDoAiTier(tier);
  if (!definition) {
    throw new Error(`Unknown LatexDo AI tier: ${tier}`);
  }
  return definition;
}

export function fastTierRuntimeAvailability(
  tier: LatexDoAiTierDefinition,
  system: AiSystemCapabilities | null,
): TierAvailability {
  if (!system?.localAiAvailable) {
    return {
      state: "unsupported",
      reason: "Local AI requires the LatexDo desktop app.",
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
  system: AiSystemCapabilities | null,
): TierAvailability {
  const runtimeAvailability = fastTierRuntimeAvailability(tier, system);
  if (runtimeAvailability.state !== "available") return runtimeAvailability;
  if (!system) return runtimeAvailability;
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

function ramText(bytes: number): string {
  return `${(bytes / GB).toFixed(1)} GB`;
}

/**
 * Plain-language guidance for an unavailable tier so users know exactly how
 * to unlock it. Returns null when the tier is already available.
 */
export function tierUnlockGuidance(
  availability: TierAvailability,
): { heading: string; steps: readonly string[] } | null {
  switch (availability.state) {
    case "available":
      return null;
    case "memory-pressure": {
      const needed = availability.requiredAvailableBytes;
      const free = availability.availableBytes;
      return {
        heading: "Not enough free memory (RAM) right now",
        steps: [
          `This model needs about ${ramText(needed)} of free memory (RAM); ${ramText(free)} is free now.`,
          "Close other apps to free memory. LatexDo checks again every few seconds and unlocks this model as soon as it fits.",
          "Or pick a lighter tier that fits today.",
        ],
      };
    }
    case "storage-pressure": {
      const needed = availability.requiredAvailableStorageBytes;
      const free = availability.availableStorageBytes;
      return {
        heading: "Not enough disk space",
        steps: [
          `This model needs about ${ramText(needed)} of free disk space; ${ramText(free)} is free now.`,
          "Free space by removing old projects or snapshots, then try again.",
          "Or pick a lighter tier that fits today.",
        ],
      };
    }
    case "unsupported":
      if (
        typeof availability.detectedSystemRamBytes === "number" &&
        typeof availability.requiredSystemRamBytes === "number"
      ) {
        return {
          heading: "This computer has too little memory (RAM) for this model",
          steps: [
            `This model needs at least ${ramText(availability.requiredSystemRamBytes)} of memory (RAM) in total; this computer has ${ramText(availability.detectedSystemRamBytes)}.`,
            "Choose a lighter tier (LatexDo AI or LatexDo AI Plus) that fits.",
            "Connect your own model via Customize (cloud API or Ollama) instead.",
          ],
        };
      }
      return {
        heading: "Can't run this tier here",
        steps: [
          availability.reason,
          "Check memory and disk space, or use Customize to connect your own model.",
        ],
      };
  }
}
