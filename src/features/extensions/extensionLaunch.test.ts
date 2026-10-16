import { describe, expect, it } from "vitest";
import type { LatexDoExtensionManifest } from "../../extensions";
import { extensionLaunchTarget } from "./extensionLaunch";

const withFlags = (featureFlags: Record<string, boolean>) =>
  ({ id: "x", contributes: { featureFlags } }) as unknown as LatexDoExtensionManifest;

describe("extensionLaunchTarget", () => {
  it("opens the window an extension adds", () => {
    expect(extensionLaunchTarget(withFlags({ tikzConverterEnabled: true }))).toEqual({
      kind: "tool",
      tool: "tikzConverter",
    });
    expect(
      extensionLaunchTarget(withFlags({ citationAssistantEnabled: true })),
    ).toEqual({
      kind: "tool",
      tool: "citationManager",
    });
  });

  it("opens the Settings page of a check without a window", () => {
    expect(extensionLaunchTarget(withFlags({ errorDoctorEnabled: true }))).toEqual({
      kind: "settings",
      tab: "doctor",
    });
  });

  it("has nothing to open for snippet and template packs", () => {
    expect(extensionLaunchTarget(withFlags({}))).toBeNull();
  });
});
