import type { LatexDoCommandDefinition } from "./commandTypes";
import { registerHelpCommands } from "./commandHelp";
import { registerSettingsCommands } from "./settingsCommands";
import { registerThemeCommands } from "./themeCommands";

export class LatexDoCommandRegistry {
  private readonly definitions: LatexDoCommandDefinition[] = [];

  register(command: LatexDoCommandDefinition): void {
    this.definitions.push(command);
    this.definitions.sort((left, right) => right.path.length - left.path.length);
  }

  commands(): LatexDoCommandDefinition[] {
    return [...this.definitions];
  }

  find(tokens: string[]): { command: LatexDoCommandDefinition; args: string[] } | null {
    const normalizedTokens = tokens.map((token) => token.toLowerCase());

    for (const command of this.definitions) {
      if (command.path.length > normalizedTokens.length) {
        continue;
      }

      const matches = command.path.every(
        (segment, index) => segment === normalizedTokens[index],
      );
      if (matches) {
        return {
          command,
          args: tokens.slice(command.path.length),
        };
      }
    }

    return null;
  }
}

export function createDefaultCommandRegistry(): LatexDoCommandRegistry {
  const registry = new LatexDoCommandRegistry();
  registerHelpCommands(registry);
  registerThemeCommands(registry);
  registerSettingsCommands(registry);
  return registry;
}
