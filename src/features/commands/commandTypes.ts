import type { AppSettings } from "../settings/settings";

export interface CommandResult {
  ok: boolean;
  message: string;
  details?: string[];
}

export interface LatexDoCommandContext {
  getSettings: () => AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  resetSetting: <K extends keyof AppSettings>(key: K) => void;
  setStatusMessage?: (message: string) => void;
  getVersion?: () => string;
}

export interface LatexDoCommandService {
  execute: (input: string) => Promise<CommandResult>;
  complete: (input: string) => string[];
  help: (topic?: string) => CommandResult;
}

export interface CommandRegistryView {
  commands: () => LatexDoCommandDefinition[];
  find: (
    tokens: string[],
  ) => { command: LatexDoCommandDefinition; args: string[] } | null;
}

export interface CommandExecutionScope {
  registry: CommandRegistryView;
}

export interface LatexDoCommandDefinition {
  id: string;
  path: string[];
  usage: string;
  summary: string;
  topics?: string[];
  execute: (
    args: string[],
    context: LatexDoCommandContext,
    scope: CommandExecutionScope,
  ) => CommandResult | Promise<CommandResult>;
  complete?: (args: string[], context: LatexDoCommandContext) => string[];
}
