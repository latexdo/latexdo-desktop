import type { Engine } from "../../types";
import {
  boundedInteger,
  colorThemeOptions,
  defaultSettings,
  maxEditorFontSize,
  maxProjectTreeDepth,
  maxProjectTreeEntries,
  minEditorFontSize,
  minProjectTreeDepth,
  minProjectTreeEntries,
  parseProjectTreeIgnoredNamesText,
  type AppSettings,
  type ColorTheme,
} from "../settings/settings";
import type {
  CommandResult,
  LatexDoCommandContext,
  LatexDoCommandDefinition,
} from "./commandTypes";

type SettingValue = AppSettings[keyof AppSettings];
type SettingValueType = "boolean" | "number" | "enum" | "stringArray";

type ParsedSettingValue =
  | {
      ok: true;
      value: SettingValue;
    }
  | {
      ok: false;
      message: string;
      details?: string[];
    };

interface SettingDefinition {
  key: keyof AppSettings;
  command: string;
  type: SettingValueType;
  description: string;
  parse: (value: string) => ParsedSettingValue;
  format: (value: SettingValue) => string;
  valueLabel?: (value: SettingValue) => string;
  commandMessage?: (value: SettingValue) => string;
  settingsSettable?: boolean;
}

const protectedSettings = new Set<keyof AppSettings>([
  "legalAccepted",
  "legalAcceptedAt",
  "legalPolicyVersion",
]);

const engineNames: Record<Engine, string> = {
  pdflatex: "pdfLaTeX",
  xelatex: "XeLaTeX",
  lualatex: "LuaLaTeX",
};

const themeAliases: Record<string, ColorTheme> = {
  black: "graphite",
  dark: "graphite",
  blue: "midnight",
  green: "forest",
  white: "studio",
};

const themeNames = Object.fromEntries(
  colorThemeOptions.map((theme) => [theme.id, theme.name]),
) as Record<ColorTheme, string>;

function result(ok: boolean, message: string, details?: string[]): CommandResult {
  return { ok, message, details };
}

function enumParser<T extends string>(
  allowedValues: readonly T[],
  aliases: Record<string, T> = {},
  label: string,
  valueName: (value: T) => string = (value) => value,
): (value: string) => ParsedSettingValue {
  return (rawValue) => {
    const normalized = rawValue.trim().toLowerCase();
    const canonical =
      aliases[normalized] ?? allowedValues.find((value) => value === normalized);

    if (!canonical) {
      return {
        ok: false,
        message: `Unknown ${label} "${rawValue}".`,
        details: [
          `Available ${label}s:`,
          ...allowedValues.map((value) => `  ${value.padEnd(10)} ${valueName(value)}`),
        ],
      };
    }

    return { ok: true, value: canonical };
  };
}

function parseBoolean(rawValue: string): ParsedSettingValue {
  const normalized = rawValue.trim().toLowerCase();
  if (["on", "true", "yes", "1", "enable", "enabled"].includes(normalized)) {
    return { ok: true, value: true };
  }
  if (["off", "false", "no", "0", "disable", "disabled"].includes(normalized)) {
    return { ok: true, value: false };
  }
  return {
    ok: false,
    message: `Expected on or off, received "${rawValue}".`,
    details: ["Accepted values: on, off, true, false, yes, no, 1, 0."],
  };
}

function numberParser(
  label: string,
  min: number,
  max: number,
  integer = false,
): (value: string) => ParsedSettingValue {
  return (rawValue) => {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      return { ok: false, message: `${label} must be a number.` };
    }
    if (value < min || value > max) {
      return {
        ok: false,
        message: `${label} must be between ${min} and ${max}.`,
      };
    }
    if (integer && !Number.isInteger(value)) {
      return { ok: false, message: `${label} must be a whole number.` };
    }
    return { ok: true, value };
  };
}

function formatSettingValue(value: SettingValue): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function booleanCommandMessage(label: string, enabled: string, disabled: string) {
  return (value: SettingValue) => `${label} ${value === true ? enabled : disabled}.`;
}

export const settingDefinitions: SettingDefinition[] = [
  {
    key: "colorTheme",
    command: "theme",
    type: "enum",
    description: "Application color theme.",
    parse: enumParser(
      colorThemeOptions.map((theme) => theme.id),
      themeAliases,
      "theme",
      (value) => themeNames[value],
    ),
    format: formatSettingValue,
    valueLabel: (value) => themeNames[value as ColorTheme],
    commandMessage: (value) => `Theme changed to ${themeNames[value as ColorTheme]}.`,
  },
  {
    key: "defaultEngine",
    command: "compiler.engine",
    type: "enum",
    description: "Default LaTeX compiler.",
    parse: enumParser(
      ["pdflatex", "xelatex", "lualatex"],
      {},
      "compiler engine",
      (value) => engineNames[value as Engine],
    ),
    format: formatSettingValue,
    valueLabel: (value) => engineNames[value as Engine],
    commandMessage: (value) =>
      `Default compiler changed to ${engineNames[value as Engine]}.`,
  },
  {
    key: "livePreview",
    command: "preview",
    type: "boolean",
    description: "Compile automatically after source edits.",
    parse: parseBoolean,
    format: formatSettingValue,
    commandMessage: booleanCommandMessage("Live preview", "enabled", "disabled"),
  },
  {
    key: "editorFontSize",
    command: "editor.font-size",
    type: "number",
    description: "Editor font size in pixels.",
    parse: numberParser("Editor font size", minEditorFontSize, maxEditorFontSize),
    format: formatSettingValue,
    commandMessage: (value) => `Editor font size changed to ${value}px.`,
  },
  {
    key: "wordWrap",
    command: "editor.word-wrap",
    type: "boolean",
    description: "Wrap long source lines inside the editor.",
    parse: parseBoolean,
    format: formatSettingValue,
    commandMessage: booleanCommandMessage("Editor word wrap", "enabled", "disabled"),
  },
  {
    key: "minimap",
    command: "editor.minimap",
    type: "boolean",
    description: "Show the source minimap beside the editor.",
    parse: parseBoolean,
    format: formatSettingValue,
    commandMessage: booleanCommandMessage("Editor minimap", "enabled", "disabled"),
  },
  {
    key: "inlineBlame",
    command: "git.inline-blame",
    type: "boolean",
    description: "Show inline Git blame annotations.",
    parse: parseBoolean,
    format: formatSettingValue,
    commandMessage: booleanCommandMessage("Inline Git blame", "enabled", "disabled"),
  },
  {
    key: "showRawLatex",
    command: "editor.raw-latex",
    type: "boolean",
    description: "Show raw LaTeX commands in the editor.",
    parse: parseBoolean,
    format: formatSettingValue,
    commandMessage: booleanCommandMessage("Raw LaTeX display", "enabled", "disabled"),
  },
  {
    key: "projectTreeIgnoredNames",
    command: "project.ignored",
    type: "stringArray",
    description: "Names excluded from project tree scans.",
    parse: () => ({
      ok: false,
      message: "Use latexdo project ignored add/remove/list instead of settings set.",
    }),
    format: formatSettingValue,
    settingsSettable: false,
  },
  {
    key: "projectTreeMaxDepth",
    command: "project.tree-depth",
    type: "number",
    description: "Maximum folder depth scanned by the project tree.",
    parse: numberParser(
      "Project tree depth",
      minProjectTreeDepth,
      maxProjectTreeDepth,
      true,
    ),
    format: formatSettingValue,
    commandMessage: (value) => `Project tree depth changed to ${value}.`,
  },
  {
    key: "projectTreeMaxEntries",
    command: "project.tree-limit",
    type: "number",
    description: "Maximum entries scanned by the project tree.",
    parse: numberParser(
      "Project tree entry limit",
      minProjectTreeEntries,
      maxProjectTreeEntries,
      true,
    ),
    format: formatSettingValue,
    commandMessage: (value) => `Project tree entry limit changed to ${value}.`,
  },
];

const settingsByKey = new Map(
  settingDefinitions.map((definition) => [definition.key, definition]),
);
const settingsByCommand = new Map(
  settingDefinitions.map((definition) => [definition.command, definition]),
);

export function findSettingDefinition(key: string): SettingDefinition | null {
  return (
    settingsByKey.get(key as keyof AppSettings) ??
    settingDefinitions.find((definition) => definition.command === key) ??
    null
  );
}

export function parseSettingValue(
  definition: SettingDefinition,
  value: string,
): ParsedSettingValue {
  return definition.parse(value);
}

function applySetting(
  context: LatexDoCommandContext,
  definition: SettingDefinition,
  value: SettingValue,
  successMessage?: string,
): CommandResult {
  context.updateSetting(definition.key as never, value as never);
  const message =
    successMessage ??
    definition.commandMessage?.(value) ??
    `${String(definition.key)} = ${definition.format(value)}`;
  context.setStatusMessage?.(message);
  return result(true, `✓ ${message}`);
}

function missingValue(usage: string): CommandResult {
  return result(false, `Missing value. Usage: ${usage}`);
}

function setFromCommand(
  context: LatexDoCommandContext,
  commandName: string,
  value: string | undefined,
  usage: string,
): CommandResult {
  if (!value) return missingValue(usage);
  const definition = settingsByCommand.get(commandName);
  if (!definition) return result(false, `Unknown setting command "${commandName}".`);
  const parsed = parseSettingValue(definition, value);
  if (!parsed.ok) {
    return result(false, parsed.message ?? "Invalid value.", parsed.details);
  }
  return applySetting(context, definition, parsed.value);
}

function registerSettingCommand(
  register: (command: LatexDoCommandDefinition) => void,
  path: string[],
  settingCommand: string,
  usage: string,
  summary: string,
): void {
  register({
    id: settingCommand,
    path,
    usage,
    summary,
    topics: [path[0], "settings"],
    execute: (args, context) => setFromCommand(context, settingCommand, args[0], usage),
  });
}

function settingsList(context: LatexDoCommandContext): CommandResult {
  const settings = context.getSettings();
  return result(
    true,
    "Available terminal-controlled settings:",
    settingDefinitions.map(
      (definition) =>
        `${String(definition.key).padEnd(24)} ${definition.format(settings[definition.key])}`,
    ),
  );
}

function settingsGet(context: LatexDoCommandContext, key: string | undefined) {
  if (!key) return missingValue("latexdo settings get <setting>");
  if (protectedSettings.has(key as keyof AppSettings)) {
    return result(false, `Setting "${key}" is protected.`);
  }

  const definition = findSettingDefinition(key);
  if (!definition) {
    return result(false, `Unknown or unavailable setting "${key}".`);
  }

  return result(
    true,
    `${String(definition.key)} = ${definition.format(
      context.getSettings()[definition.key],
    )}`,
  );
}

function settingsSet(
  context: LatexDoCommandContext,
  key: string | undefined,
  value: string | undefined,
): CommandResult {
  if (!key || !value) return missingValue("latexdo settings set <setting> <value>");
  if (protectedSettings.has(key as keyof AppSettings)) {
    return result(
      false,
      `Setting "${key}" is protected and cannot be changed from terminal commands.`,
    );
  }

  const definition = findSettingDefinition(key);
  if (!definition) {
    return result(false, `Unknown or unavailable setting "${key}".`);
  }
  if (definition.settingsSettable === false) {
    return result(false, `Setting "${key}" uses dedicated commands for changes.`);
  }

  const parsed = parseSettingValue(definition, value);
  if (!parsed.ok) {
    return result(false, parsed.message ?? "Invalid value.", parsed.details);
  }
  return applySetting(context, definition, parsed.value);
}

function settingsReset(
  context: LatexDoCommandContext,
  key: string | undefined,
): CommandResult {
  if (!key) return missingValue("latexdo settings reset <setting>");
  if (protectedSettings.has(key as keyof AppSettings)) {
    return result(
      false,
      `Setting "${key}" is protected and cannot be reset from terminal commands.`,
    );
  }

  const definition = findSettingDefinition(key);
  if (!definition) {
    return result(false, `Unknown or unavailable setting "${key}".`);
  }

  context.resetSetting(definition.key as never);
  const value = defaultSettings[definition.key];
  const message = `${String(definition.key)} reset to ${definition.format(value)}.`;
  context.setStatusMessage?.(message);
  return result(true, `✓ ${message}`);
}

function settingsResetAll(
  context: LatexDoCommandContext,
  args: string[],
): CommandResult {
  if (!args.includes("--yes") && !args.includes("--force")) {
    return result(
      false,
      "reset-all changes multiple preferences. Re-run with --yes to confirm.",
    );
  }

  for (const definition of settingDefinitions) {
    context.resetSetting(definition.key as never);
  }

  const message = "Terminal-controlled settings reset.";
  context.setStatusMessage?.(message);
  return result(true, `✓ ${message}`);
}

function projectIgnored(context: LatexDoCommandContext, args: string[]): CommandResult {
  const [action, name] = args;
  const current = context.getSettings().projectTreeIgnoredNames;

  if (action === "list") {
    return result(
      true,
      "Ignored project tree names:",
      current.map((entry) => `  ${entry}`),
    );
  }

  if ((action === "add" || action === "remove") && !name) {
    return missingValue(`latexdo project ignored ${action} <name>`);
  }

  if (action === "add") {
    const next = parseProjectTreeIgnoredNamesText([...current, name].join("\n"));
    if (!next.includes(name)) {
      return result(false, `Ignored name "${name}" is not valid.`);
    }
    context.updateSetting("projectTreeIgnoredNames", next);
    const message = `Added "${name}" to ignored project names.`;
    context.setStatusMessage?.(message);
    return result(true, `✓ ${message}`);
  }

  if (action === "remove") {
    const next = current.filter((entry) => entry !== name);
    context.updateSetting("projectTreeIgnoredNames", next);
    const message = `Removed "${name}" from ignored project names.`;
    context.setStatusMessage?.(message);
    return result(true, `✓ ${message}`);
  }

  return result(false, "Usage: latexdo project ignored list|add|remove [name]");
}

export function registerSettingsCommands(registry: {
  register: (command: LatexDoCommandDefinition) => void;
}): void {
  const register = registry.register.bind(registry);

  registerSettingCommand(
    register,
    ["editor", "font-size"],
    "editor.font-size",
    "latexdo editor font-size <size>",
    "Change the editor font size.",
  );
  registerSettingCommand(
    register,
    ["editor", "word-wrap"],
    "editor.word-wrap",
    "latexdo editor word-wrap on|off",
    "Toggle editor word wrap.",
  );
  registerSettingCommand(
    register,
    ["editor", "minimap"],
    "editor.minimap",
    "latexdo editor minimap on|off",
    "Toggle the editor minimap.",
  );
  registerSettingCommand(
    register,
    ["editor", "raw-latex"],
    "editor.raw-latex",
    "latexdo editor raw-latex on|off",
    "Toggle raw LaTeX command visibility.",
  );
  registerSettingCommand(
    register,
    ["compiler", "engine"],
    "compiler.engine",
    "latexdo compiler engine pdflatex|xelatex|lualatex",
    "Change the default LaTeX compiler.",
  );
  registerSettingCommand(
    register,
    ["preview"],
    "preview",
    "latexdo preview on|off",
    "Toggle live preview.",
  );
  registerSettingCommand(
    register,
    ["git", "inline-blame"],
    "git.inline-blame",
    "latexdo git inline-blame on|off",
    "Toggle inline Git blame.",
  );
  registerSettingCommand(
    register,
    ["project", "tree-depth"],
    "project.tree-depth",
    "latexdo project tree-depth <depth>",
    "Set the project tree scan depth.",
  );
  registerSettingCommand(
    register,
    ["project", "tree-limit"],
    "project.tree-limit",
    "latexdo project tree-limit <entries>",
    "Set the project tree entry limit.",
  );

  register({
    id: "project.ignored",
    path: ["project", "ignored"],
    usage: "latexdo project ignored list|add|remove [name]",
    summary: "List or change ignored project tree names.",
    topics: ["project", "settings"],
    execute: (args, context) => projectIgnored(context, args),
  });

  register({
    id: "settings",
    path: ["settings"],
    usage:
      "latexdo settings list|get <setting>|set <setting> <value>|reset <setting>|reset-all --yes",
    summary: "Inspect or reset terminal-controlled settings.",
    topics: ["settings"],
    execute: (args, context) => {
      const [action, key, value] = args;
      if (action === "list" || !action) return settingsList(context);
      if (action === "get") return settingsGet(context, key);
      if (action === "set") return settingsSet(context, key, value);
      if (action === "reset") return settingsReset(context, key);
      if (action === "reset-all") return settingsResetAll(context, args.slice(1));
      return result(false, `Unknown settings command "${action}".`);
    },
  });
}

export function normalizeSettingNumber<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): AppSettings[K] {
  if (key === "projectTreeMaxDepth") {
    return boundedInteger(
      value,
      defaultSettings.projectTreeMaxDepth,
      minProjectTreeDepth,
      maxProjectTreeDepth,
    ) as AppSettings[K];
  }
  if (key === "projectTreeMaxEntries") {
    return boundedInteger(
      value,
      defaultSettings.projectTreeMaxEntries,
      minProjectTreeEntries,
      maxProjectTreeEntries,
    ) as AppSettings[K];
  }
  return value;
}
