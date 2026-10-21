// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
const remove = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => ({ rm: remove }));
vi.mock("node:os", () => ({ default: { homedir: () => "/test-home" } }));
const platform = Object.getOwnPropertyDescriptor(process, "platform");
afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("development cache cleanup targets", () => {
  it.each([
    ["darwin", undefined, undefined, "/test-home/Library/Application Support"],
    ["win32", "/custom-appdata", undefined, "/custom-appdata"],
    ["win32", undefined, undefined, "/test-home/AppData/Roaming"],
    ["linux", undefined, "/custom-config", "/custom-config"],
    ["linux", undefined, undefined, "/test-home/.config"],
  ])(
    "clears only development and legacy runtime paths on %s",
    async (os, appdata, config, base) => {
      Object.defineProperty(process, "platform", { configurable: true, value: os });
      vi.stubEnv("APPDATA", appdata);
      vi.stubEnv("XDG_CONFIG_HOME", config);
      remove.mockReset().mockResolvedValue(undefined);
      vi.spyOn(console, "log").mockImplementation(() => {});
      const { clearDevRuntimeCache, devUserDataPath } =
        await import("./clear-dev-runtime-cache.mjs");
      await clearDevRuntimeCache();
      expect(remove.mock.calls.map(([p]) => p)).toEqual([
        devUserDataPath,
        ...["latexdo", "LatexDo"].flatMap((name) => [
          path.join(base, name, "models"),
          path.join(base, name, "speech"),
        ]),
      ]);
      expect(remove).toHaveBeenCalledWith(devUserDataPath, {
        recursive: true,
        force: true,
      });
    },
  );
  it("propagates removal errors without deleting subsequent targets", async () => {
    remove.mockReset().mockRejectedValue(new Error("denied"));
    const { clearDevRuntimeCache } = await import("./clear-dev-runtime-cache.mjs");
    await expect(clearDevRuntimeCache()).rejects.toThrow("denied");
    expect(remove).toHaveBeenCalledOnce();
  });
});
