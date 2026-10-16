import type {
  CommandResult,
  CommandRegistryView,
  LatexDoCommandDefinition,
} from "./commandTypes";
import { colorThemeOptions } from "../settings/settings";

function commandLinesForTopic(registry: CommandRegistryView, topic?: string): string[] {
  const normalizedTopic = topic?.toLowerCase();
  return registry
    .commands()
    .filter(
      (command) =>
        !normalizedTopic ||
        command.path[0] === normalizedTopic ||
        command.topics?.includes(normalizedTopic),
    )
    .map((command) => `  ${command.usage.padEnd(52)} ${command.summary}`);
}

export function commandHelp(
  registry: CommandRegistryView,
  topic?: string,
): CommandResult {
  const normalizedTopic = topic?.toLowerCase();
  if (normalizedTopic === "theme") {
    return {
      ok: true,
      message: "Theme commands:",
      details: [
        "  latexdo theme list",
        "  latexdo theme graphite|midnight|forest|sepia|studio|paper",
        "",
        "Available themes:",
        ...colorThemeOptions.map((theme) => `  ${theme.id.padEnd(10)} ${theme.name}`),
      ],
    };
  }

  const lines = commandLinesForTopic(registry, topic);
  if (topic && !lines.length) {
    return {
      ok: false,
      message: `No help is available for "${topic}".`,
      details: ["Run latexdo help to list available command groups."],
    };
  }

  return {
    ok: true,
    message: topic ? `${topic} commands:` : "Available LatexDo commands:",
    details: lines,
  };
}

export function registerHelpCommands(registry: {
  register: (command: LatexDoCommandDefinition) => void;
}): void {
  registry.register({
    id: "help",
    path: ["help"],
    usage: "latexdo help [topic]",
    summary: "Show command help.",
    topics: ["help"],
    execute: (args, _context, scope) => commandHelp(scope.registry, args[0]),
  });

  registry.register({
    id: "version",
    path: ["version"],
    usage: "latexdo version",
    summary: "Show the LatexDo application version.",
    topics: ["help"],
    execute: (_args, context) => ({
      ok: true,
      message: `LatexDo ${context.getVersion?.() ?? "0.0.0-development"}`,
    }),
  });
}
