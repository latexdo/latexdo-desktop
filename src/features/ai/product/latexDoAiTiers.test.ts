import { describe, expect, it } from "vitest";
import {
  capabilityById,
  fastTierAvailability,
  fastTierRuntimeAvailability,
  latexDoAiTiers,
  tierCapabilityCatalog,
  tierUnlockGuidance,
} from "./latexDoAiTiers";
import type { AiSystemCapabilities } from "../aiTypes";

const GB = 1024 ** 3;
const capableButLowStorageSystem: AiSystemCapabilities = {
  totalRamBytes: 32 * GB,
  freeRamBytes: 16 * GB,
  totalStorageBytes: 256 * GB,
  freeStorageBytes: 1 * GB,
  modelStoragePath: "/Users/ada/Library/Application Support/LatexDo/models",
  platform: "darwin",
  arch: "arm64",
  cpuCount: 10,
  localAiAvailable: true,
};

describe("LatexDo AI tier capabilities", () => {
  it("orders tiers so each higher tier includes every capability of the one below", () => {
    for (let index = 1; index < latexDoAiTiers.length; index += 1) {
      const tier = latexDoAiTiers[index];
      const lower = latexDoAiTiers[index - 1];
      for (const capabilityId of lower.capabilities) {
        expect(
          tier.capabilities,
          `${tier.name} must include ${capabilityId}`,
        ).toContain(capabilityId);
      }
    }
  });

  it("keeps the smallest tier focused on light inline work", () => {
    const smallest = latexDoAiTiers[0];
    expect(smallest.capabilities).toEqual([
      "inline-completion",
      "quick-fixes",
      "light-chat",
    ]);
  });

  it("the largest tier covers the full capability catalog", () => {
    const max = latexDoAiTiers[latexDoAiTiers.length - 1];
    expect(new Set(max.capabilities)).toEqual(
      new Set(tierCapabilityCatalog.map((capability) => capability.id)),
    );
  });

  it("resolves every declared capability to a user-facing entry", () => {
    for (const tier of latexDoAiTiers) {
      for (const capabilityId of tier.capabilities) {
        expect(capabilityById(capabilityId), capabilityId).toBeDefined();
        expect(capabilityById(capabilityId)!.label.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("tierUnlockGuidance", () => {
  it("returns null when the tier is available", () => {
    expect(tierUnlockGuidance({ state: "available" })).toBeNull();
  });

  it("explains how to free memory during pressure", () => {
    const guidance = tierUnlockGuidance({
      state: "memory-pressure",
      requiredAvailableBytes: 4 * GB,
      availableBytes: 2 * GB,
    });
    expect(guidance?.heading).toContain("Memory is currently low");
    expect(guidance?.steps.join(" ")).toContain("2.0 GB");
    expect(guidance?.steps.join(" ")).toContain("lighter tier");
  });

  it("explains how to free disk space during storage pressure", () => {
    const guidance = tierUnlockGuidance({
      state: "storage-pressure",
      requiredAvailableStorageBytes: 6 * GB,
      availableStorageBytes: 1.5 * GB,
    });
    expect(guidance?.heading).toContain("Not enough disk space");
    expect(guidance?.steps.join(" ")).toContain("1.5 GB");
  });

  it("recommends Customize for machines below the memory floor", () => {
    const guidance = tierUnlockGuidance({
      state: "unsupported",
      reason: "Insufficient physical memory",
      requiredSystemRamBytes: 12 * GB,
      detectedSystemRamBytes: 8 * GB,
    });
    expect(guidance?.heading).toContain("memory floor");
    expect(guidance?.steps.join(" ")).toContain("Customize");
  });

  it("falls back to the unsupported reason when no numbers exist", () => {
    const guidance = tierUnlockGuidance({
      state: "unsupported",
      reason: "Local AI requires the LatexDo desktop app.",
    });
    expect(guidance?.heading).toContain("Can't run this tier here");
    expect(guidance?.steps.join(" ")).toContain("desktop app");
  });
});

describe("tier availability checks", () => {
  it("uses storage pressure for installs but not for already-installed runtime checks", () => {
    const tier = latexDoAiTiers.find((item) => item.id === "latexdo-ai-plus");
    expect(tier).toBeDefined();

    expect(fastTierAvailability(tier!, capableButLowStorageSystem)).toMatchObject({
      state: "storage-pressure",
    });
    expect(
      fastTierRuntimeAvailability(tier!, capableButLowStorageSystem),
    ).toMatchObject({
      state: "available",
    });
  });
});
