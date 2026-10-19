import { describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => vi.fn());
vi.mock("@monaco-editor/react", () => ({ loader: { config } }));
vi.mock("monaco-editor", () => ({ editor: { marker: "monaco" } }));

describe("monaco loader setup", () => {
  it("points the React loader at the bundled monaco instance", async () => {
    const mod = await import("./monaco");
    expect(config).toHaveBeenCalledWith({ monaco: mod.monaco });
    expect((mod.monaco as unknown as { editor: { marker: string } }).editor.marker).toBe(
      "monaco",
    );
  });
});
