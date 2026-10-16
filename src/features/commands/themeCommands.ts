import { colorThemeOptions } from "../settings/settings";
import type { CommandResult, LatexDoCommandDefinition } from "./commandTypes";
import { findSettingDefinition, parseSettingValue } from "./settingsCommands";

function themeList(): CommandResult {
  return {
    ok: true,
    message: "Available LatexDo themes:",
    details: colorThemeOptions.map((theme) => `  ${theme.id.padEnd(10)} ${theme.name}`),
  };
}

export function registerThemeCommands(registry: {
  register: (command: LatexDoCommandDefinition) => void;
}): void {
  registry.register({
    id: "theme",
    path: ["theme"],
    usage: "latexdo theme <theme>|list",
    summary: "List or change the application theme.",
    topics: ["theme", "settings"],
    complete: () => [...colorThemeOptions.map((theme) => theme.id), "list"],
    execute: (args, context) => {
      const [theme] = args;
      if (!theme || theme === "list") return themeList();

      const definition = findSettingDefinition("colorTheme");
      if (!definition) {
        return { ok: false, message: "Theme setting is unavailable." };
      }

      const parsed = parseSettingValue(definition, theme);
      if (!parsed.ok) {
        return {
          ok: false,
          message: parsed.message ?? "Invalid theme.",
          details: parsed.details,
        };
      }

      context.updateSetting("colorTheme", parsed.value as never);
      const label = definition.valueLabel?.(parsed.value) ?? String(parsed.value);
      const message = `Theme changed to ${label}.`;
      context.setStatusMessage?.(message);
      return { ok: true, message: `✓ ${message}` };
    },
  });
}
