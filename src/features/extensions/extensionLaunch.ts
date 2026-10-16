import type { ExtensionFeatureFlag, LatexDoExtensionManifest } from "../../extensions";

/** What clicking an installed extension opens (#225). */
export type ExtensionLaunchTarget =
  | {
      kind: "tool";
      tool: "tikzConverter" | "notationManager" | "citationManager" | "tableGenerator";
    }
  | { kind: "settings"; tab: string };

// Tools come first: an extension that adds a window opens it. Checks and
// assistants without a window open their page in Settings.
const launchOrder: Array<[ExtensionFeatureFlag, ExtensionLaunchTarget]> = [
  ["tikzConverterEnabled", { kind: "tool", tool: "tikzConverter" }],
  ["notationManagerEnabled", { kind: "tool", tool: "notationManager" }],
  ["tableGeneratorEnabled", { kind: "tool", tool: "tableGenerator" }],
  ["projectBibliographyEnabled", { kind: "tool", tool: "citationManager" }],
  ["citationAssistantEnabled", { kind: "tool", tool: "citationManager" }],
  ["conferenceCheckerEnabled", { kind: "settings", tab: "conference" }],
  ["errorDoctorEnabled", { kind: "settings", tab: "doctor" }],
  ["acronymManagerEnabled", { kind: "settings", tab: "acronym" }],
  ["structureAssistantEnabled", { kind: "settings", tab: "structure" }],
  ["reproducibilityEnabled", { kind: "settings", tab: "reproducibility" }],
  ["pdfComplianceEnabled", { kind: "settings", tab: "pdf" }],
];

export function extensionLaunchTarget(
  extension: LatexDoExtensionManifest,
): ExtensionLaunchTarget | null {
  const flags = extension.contributes.featureFlags ?? {};
  for (const [flag, target] of launchOrder) {
    if (flags[flag]) return target;
  }
  return null;
}
