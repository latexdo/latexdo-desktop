import { afterEach, describe, expect, it, vi } from "vitest";
import { colorThemeOptions } from "../settings/settings";
import * as settingsCommands from "./settingsCommands";
import type { LatexDoCommandContext, LatexDoCommandDefinition } from "./commandTypes";
import { registerThemeCommands } from "./themeCommands";

function themeCommand(): LatexDoCommandDefinition {
  const commands: LatexDoCommandDefinition[] = [];
  registerThemeCommands({ register: (command) => commands.push(command) });
  expect(commands).toHaveLength(1);
  return commands[0];
}

function context() {
  return {
    updateSetting: vi.fn(),
    setStatusMessage: vi.fn(),
  } as unknown as LatexDoCommandContext & {
    updateSetting: ReturnType<typeof vi.fn>;
    setStatusMessage: ReturnType<typeof vi.fn>;
  };
}

afterEach(() => vi.restoreAllMocks());

describe("theme command", () => {
  it("registers under `theme` and completes every theme plus list", () => {
    const command = themeCommand();
    expect(command.id).toBe("theme");
    expect(command.path).toEqual(["theme"]);
    expect(command.complete?.([], context())).toEqual([
      ...colorThemeOptions.map((theme) => theme.id),
      "list",
    ]);
  });

  it.each([[[]], [["list"]]])("lists the themes for %j", async (args) => {
    const ctx = context();
    const result = await command().execute(args, ctx, {
      registry: { commands: () => [], find: () => null },
    });
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Available LatexDo themes:");
    expect(result.details).toHaveLength(colorThemeOptions.length);
    expect(result.details?.[0]).toContain(colorThemeOptions[0].name);
    expect(ctx.updateSetting).not.toHaveBeenCalled();
  });

  it("changes the theme and reports its display name", async () => {
    const ctx = context();
    const theme = colorThemeOptions[1];
    const result = await command().execute([theme.id], ctx, {
      registry: { commands: () => [], find: () => null },
    });
    expect(ctx.updateSetting).toHaveBeenCalledWith("colorTheme", theme.id);
    expect(result).toEqual({ ok: true, message: `✓ Theme changed to ${theme.name}.` });
    expect(ctx.setStatusMessage).toHaveBeenCalledWith(
      `Theme changed to ${theme.name}.`,
    );
  });

  it("works without a status message sink", async () => {
    const ctx = { updateSetting: vi.fn() } as unknown as LatexDoCommandContext;
    const result = await command().execute([colorThemeOptions[0].id], ctx, {
      registry: { commands: () => [], find: () => null },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown theme without changing settings", async () => {
    const ctx = context();
    const result = await command().execute(["not-a-theme"], ctx, {
      registry: { commands: () => [], find: () => null },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
    expect(ctx.updateSetting).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the parser gives none", async () => {
    vi.spyOn(settingsCommands, "parseSettingValue").mockReturnValue({
      ok: false,
      details: ["x"],
    } as never);
    const result = await command().execute(["graphite"], context(), {
      registry: { commands: () => [], find: () => null },
    });
    expect(result).toEqual({ ok: false, message: "Invalid theme.", details: ["x"] });
  });

  it("uses the raw value when the definition has no label", async () => {
    const real = settingsCommands.findSettingDefinition("colorTheme")!;
    vi.spyOn(settingsCommands, "findSettingDefinition").mockReturnValue({
      ...real,
      valueLabel: undefined,
    });
    const result = await command().execute(["graphite"], context(), {
      registry: { commands: () => [], find: () => null },
    });
    expect(result.message).toBe("✓ Theme changed to graphite.");
  });

  it("reports when the theme setting is unavailable", async () => {
    vi.spyOn(settingsCommands, "findSettingDefinition").mockReturnValue(null);
    const ctx = context();
    const result = await command().execute(["graphite"], ctx, {
      registry: { commands: () => [], find: () => null },
    });
    expect(result).toEqual({ ok: false, message: "Theme setting is unavailable." });
    expect(ctx.updateSetting).not.toHaveBeenCalled();
  });
});

function command() {
  return themeCommand();
}
