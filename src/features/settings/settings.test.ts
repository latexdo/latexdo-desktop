import { beforeEach, describe, expect, it } from "vitest";
import { loadSettings, settingsStorageKey } from "./settings";

beforeEach(() => window.localStorage.clear());

describe("built-in tools migration", () => {
  it("turns the former extension tools on once for older saved settings", () => {
    window.localStorage.setItem(
      settingsStorageKey,
      JSON.stringify({ tableGeneratorEnabled: false, tikzConverterEnabled: false }),
    );
    const migrated = loadSettings();
    expect(migrated.tableGeneratorEnabled).toBe(true);
    expect(migrated.tikzConverterEnabled).toBe(true);
    expect(migrated.notationManagerEnabled).toBe(true);
    expect(migrated.builtInToolsVersion).toBe(1);

    // After the migration the user's own choice is kept.
    window.localStorage.setItem(
      settingsStorageKey,
      JSON.stringify({ ...migrated, tableGeneratorEnabled: false }),
    );
    expect(loadSettings().tableGeneratorEnabled).toBe(false);
  });
});
