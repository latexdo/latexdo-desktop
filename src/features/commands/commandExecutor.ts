import {
  isLatexDoCommandLine,
  parseLatexDoInput,
  tokenizeCommandLine,
} from "./commandParser";
import {
  createDefaultCommandRegistry,
  type LatexDoCommandRegistry,
} from "./commandRegistry";
import { commandHelp } from "./commandHelp";
import type {
  CommandResult,
  LatexDoCommandContext,
  LatexDoCommandService,
} from "./commandTypes";

function levenshtein(left: string, right: string): number {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= right.length; column += 1) {
    rows[0][column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
  }

  return rows[left.length][right.length];
}

function unknownCommand(
  tokens: string[],
  registry: LatexDoCommandRegistry,
): CommandResult {
  const commandName = tokens[0] ?? "";
  const candidates = [...new Set(registry.commands().map((command) => command.path[0]))]
    .map((candidate) => ({
      candidate,
      distance: levenshtein(commandName.toLowerCase(), candidate),
    }))
    .filter(({ distance }) => distance <= 2)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 3);

  return {
    ok: false,
    message: commandName
      ? `Unknown command "${commandName}".`
      : "Missing command. Run latexdo help.",
    details: candidates.length
      ? [
          "Did you mean:",
          ...candidates.map(({ candidate }) => `  latexdo ${candidate}`),
        ]
      : ["Run latexdo help to list available commands."],
  };
}

export function createLatexDoCommandService(
  context: LatexDoCommandContext,
  registry = createDefaultCommandRegistry(),
): LatexDoCommandService {
  return {
    async execute(input: string): Promise<CommandResult> {
      const parsed = parseLatexDoInput(input);
      if (parsed.kind === "external") {
        return {
          ok: false,
          message: "Not a LatexDo command.",
        };
      }
      if (parsed.kind === "error") {
        return parsed.result;
      }
      if (!parsed.args.length) {
        return commandHelp(registry);
      }

      const match = registry.find(parsed.args);
      if (!match) {
        return unknownCommand(parsed.args, registry);
      }

      return await match.command.execute(match.args, context, { registry });
    },

    complete(input: string): string[] {
      const tokenized = tokenizeCommandLine(input);
      if (!tokenized.ok || !isLatexDoCommandLine(input)) {
        return [];
      }

      const args = tokenized.tokens.slice(1);
      const match = registry.find(args);
      if (match?.command.complete) {
        return match.command.complete(match.args, context);
      }

      if (args.length <= 1) {
        const prefix = args[0]?.toLowerCase() ?? "";
        return [
          ...new Set(registry.commands().map((command) => command.path[0])),
        ].filter((command) => command.startsWith(prefix));
      }

      return [];
    },

    help(topic?: string): CommandResult {
      return commandHelp(registry, topic);
    },
  };
}

export function formatCommandResultForTerminal(result: CommandResult): string {
  return [result.message, ...(result.details ?? [])]
    .filter((line) => line !== undefined)
    .join("\r\n");
}
