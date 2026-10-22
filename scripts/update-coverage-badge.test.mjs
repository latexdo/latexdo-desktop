// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
const state = vi.hoisted(() => ({ percentage: 95, omit: false, written: "" }));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () =>
    JSON.stringify({
      total: { lines: { pct: state.percentage } },
      ...(state.omit
        ? {}
        : { [fileURLToPath(new URL("../src/example.ts", import.meta.url))]: {} }),
    }),
  ),
  readdir: vi.fn(async (url) => {
    const p = url.pathname;
    if (p.endsWith("/src/"))
      return [
        { name: "example.ts", isDirectory: () => false },
        { name: "example.test.ts", isDirectory: () => false },
        { name: "types.d.ts", isDirectory: () => false },
        { name: "node_modules", isDirectory: () => true },
        { name: "__tests__", isDirectory: () => true },
        { name: "nested", isDirectory: () => true },
        { name: "style.css", isDirectory: () => false },
      ];
    if (p.endsWith("/collaborations/"))
      return [{ name: "cloudflare", isDirectory: () => true }];
    return [];
  }),
  mkdir: vi.fn(),
  writeFile: vi.fn(async (_url, text) => {
    state.written = text;
  }),
}));
beforeEach(() => {
  vi.resetModules();
  state.omit = false;
  state.percentage = 95;
  state.written = "";
});
describe("coverage badge verification", () => {
  it.each([
    [95, "#4c1"],
    [70, "#dfb317"],
    [40, "#e05d44"],
  ])("renders %s percent with its coverage color", async (pct, color) => {
    state.percentage = pct;
    await import("./update-coverage-badge.mjs");
    expect(state.written).toContain(`${pct.toFixed(2)}%`);
    expect(state.written).toContain(color);
  });
  it("rejects reports missing application source", async () => {
    state.omit = true;
    await expect(import("./update-coverage-badge.mjs")).rejects.toThrow(
      "src/example.ts",
    );
    expect(state.written).toBe("");
  });
  it.each([-1, 101, null])("rejects invalid percentage %s", async (pct) => {
    state.percentage = pct;
    await expect(import("./update-coverage-badge.mjs")).rejects.toThrow(
      "valid line percentage",
    );
    expect(state.written).toBe("");
  });
});
