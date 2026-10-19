import { describe, expect, it } from "vitest";
import { colorThemeOptions } from "../settings/settings";
import { commandHelp, registerHelpCommands } from "./commandHelp";
import type {
  CommandExecutionScope,
  CommandRegistryView,
  LatexDoCommandContext,
  LatexDoCommandDefinition,
} from "./commandTypes";

function command(
  path: string[],
  usage: string,
  topics?: string[],
): LatexDoCommandDefinition {
  return {
    id: path.join("."),
    path,
    usage,
    summary: `${usage} summary`,
    topics,
    execute: () => ({ ok: true, message: "" }),
  } as LatexDoCommandDefinition;
}

const registry: CommandRegistryView = {
  commands: () => [
    command(["compile"], "latexdo compile", ["build"]),
    command(["git", "status"], "latexdo git status"),
  ],
} as CommandRegistryView;

describe("commandHelp", () => {
  it("lists every command without a topic", () => {
    const result = commandHelp(registry);
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Available LatexDo commands:");
    expect(result.details).toEqual([
      `  ${"latexdo compile".padEnd(52)} latexdo compile summary`,
      `  ${"latexdo git status".padEnd(52)} latexdo git status summary`,
    ]);
  });

  it("filters by the first path segment or by declared topics, case-insensitively", () => {
    expect(commandHelp(registry, "GIT").details).toHaveLength(1);
    const byTopic = commandHelp(registry, "build");
    expect(byTopic.message).toBe("build commands:");
    expect(byTopic.details?.[0]).toContain("latexdo compile");
  });

  it("reports unknown topics", () => {
    expect(commandHelp(registry, "nope")).toEqual({
      ok: false,
      message: 'No help is available for "nope".',
      details: ["Run latexdo help to list available command groups."],
    });
  });

  it("lists the themes for the theme topic", () => {
    const result = commandHelp(registry, "Theme");
    expect(result.message).toBe("Theme commands:");
    expect(result.details).toHaveLength(4 + colorThemeOptions.length);
    expect(result.details?.at(-1)).toContain(colorThemeOptions.at(-1)!.name);
  });
});

describe("registerHelpCommands", () => {
  const registered: LatexDoCommandDefinition[] = [];
  registerHelpCommands({ register: (c) => registered.push(c) });
  const [help, version] = registered;
  const scope = { registry } as CommandExecutionScope;

  it("registers help and version", () => {
    expect(registered.map((c) => c.id)).toEqual(["help", "version"]);
  });

  it("help passes its first argument as the topic", () => {
    const result = help.execute(["git"], {} as LatexDoCommandContext, scope);
    expect(result).toMatchObject({ ok: true, message: "git commands:" });
  });

  it("version reports the app version or a development fallback", () => {
    expect(
      version.execute([], { getVersion: () => "1.2.3" } as LatexDoCommandContext, scope),
    ).toEqual({ ok: true, message: "LatexDo 1.2.3" });
    expect(version.execute([], {} as LatexDoCommandContext, scope)).toEqual({
      ok: true,
      message: "LatexDo 0.0.0-development",
    });
  });
});
