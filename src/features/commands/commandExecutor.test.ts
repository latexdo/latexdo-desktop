import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, type AppSettings } from "../settings/settings";
import { createLatexDoCommandService } from "./commandExecutor";
import type { LatexDoCommandContext } from "./commandTypes";

describe("LatexDo command service", () => {
  let settings: AppSettings;
  let statusMessages: string[];
  let context: LatexDoCommandContext;
  let updateSettingMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    settings = { ...defaultSettings };
    statusMessages = [];
    updateSettingMock = vi.fn(
      (key: keyof AppSettings, value: AppSettings[keyof AppSettings]) => {
        settings = { ...settings, [key]: value };
      },
    );
    context = {
      getSettings: () => settings,
      updateSetting: updateSettingMock as LatexDoCommandContext["updateSetting"],
      resetSetting: ((key) => {
        settings = { ...settings, [key]: defaultSettings[key] };
      }) as LatexDoCommandContext["resetSetting"],
      setStatusMessage: (message) => statusMessages.push(message),
      getVersion: () => "9.8.7-test",
    };
  });

  it("changes themes by canonical id", async () => {
    const service = createLatexDoCommandService(context);

    const result = await service.execute("latexdo theme midnight");

    expect(result.ok).toBe(true);
    expect(result.message).toBe("✓ Theme changed to Midnight Blue.");
    expect(settings.colorTheme).toBe("midnight");
  });

  it("normalizes theme aliases before updating settings", async () => {
    const service = createLatexDoCommandService(context);

    await service.execute("latexdo theme black");

    expect(settings.colorTheme).toBe("graphite");
  });

  it("rejects invalid themes without mutating settings", async () => {
    const service = createLatexDoCommandService(context);

    const result = await service.execute("latexdo theme purple");

    expect(result.ok).toBe(false);
    expect(result.message).toBe('Unknown theme "purple".');
    expect(result.details?.join("\n")).toContain("graphite");
    expect(settings.colorTheme).toBe(defaultSettings.colorTheme);
  });

  it("updates editor boolean settings", async () => {
    const service = createLatexDoCommandService(context);

    const result = await service.execute("latexdo editor minimap off");

    expect(result.ok).toBe(true);
    expect(settings.minimap).toBe(false);
  });

  it("validates and updates editor font size", async () => {
    const service = createLatexDoCommandService(context);

    const result = await service.execute("latexdo editor font-size 16");

    expect(result.ok).toBe(true);
    expect(settings.editorFontSize).toBe(16);
  });

  it("updates the default compiler engine", async () => {
    const service = createLatexDoCommandService(context);

    const result = await service.execute("latexdo compiler engine xelatex");

    expect(result.ok).toBe(true);
    expect(result.message).toBe("✓ Default compiler changed to XeLaTeX.");
    expect(settings.defaultEngine).toBe("xelatex");
  });

  it("reads and resets allowlisted settings", async () => {
    const service = createLatexDoCommandService(context);
    await service.execute("latexdo theme forest");

    expect(await service.execute("latexdo settings get colorTheme")).toMatchObject({
      ok: true,
      message: "colorTheme = forest",
    });

    const reset = await service.execute("latexdo settings reset colorTheme");

    expect(reset.ok).toBe(true);
    expect(settings.colorTheme).toBe(defaultSettings.colorTheme);
  });

  it("does not mutate protected legal settings", async () => {
    const service = createLatexDoCommandService(context);

    const result = await service.execute("latexdo settings set legalAccepted true");

    expect(result.ok).toBe(false);
    expect(settings.legalAccepted).toBe(defaultSettings.legalAccepted);
    expect(updateSettingMock).not.toHaveBeenCalledWith("legalAccepted", true);
  });

  it("requires confirmation before reset-all", async () => {
    const service = createLatexDoCommandService(context);

    const result = await service.execute("latexdo settings reset-all");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("--yes");
  });

  it("returns help and version results", async () => {
    const service = createLatexDoCommandService(context);

    expect(await service.execute("latexdo help")).toMatchObject({ ok: true });
    expect(await service.execute("latexdo version")).toMatchObject({
      ok: true,
      message: "LatexDo 9.8.7-test",
    });
  });
});
