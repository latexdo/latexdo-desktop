import { describe, expect, it } from "vitest";
import type { LatexDoCommandDefinition } from "./commandTypes";
import { createDefaultCommandRegistry, LatexDoCommandRegistry } from "./commandRegistry";

function command(path: string[]): LatexDoCommandDefinition {
  return {
    id: path.join("."),
    path,
    usage: path.join(" "),
    summary: "",
    execute: () => ({ ok: true, message: "" }),
  };
}

describe("LatexDoCommandRegistry", () => {
  it("matches the longest path case-insensitively and returns the remaining args", () => {
    const registry = new LatexDoCommandRegistry();
    registry.register(command(["set"]));
    registry.register(command(["set", "theme"]));
    expect(registry.commands().map((c) => c.id)).toEqual(["set.theme", "set"]);
    const match = registry.find(["SET", "Theme", "Dark"]);
    expect(match?.command.id).toBe("set.theme");
    expect(match?.args).toEqual(["Dark"]);
    expect(registry.find(["set", "font"])?.command.id).toBe("set");
  });

  it("returns null when nothing matches", () => {
    const registry = new LatexDoCommandRegistry();
    registry.register(command(["help", "me"]));
    expect(registry.find(["help"])).toBeNull();
    expect(registry.find(["other", "x"])).toBeNull();
    expect(createDefaultCommandRegistry().find(["no-such-command"])).toBeNull();
  });
});
