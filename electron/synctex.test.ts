// @vitest-environment node
import { EventEmitter } from "node:events";
import { beforeEach, describe, it, expect, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  output: "",
  error: "",
  code: 0,
  spawnError: null as Error | null,
}));
vi.mock("node:fs/promises", () => ({
  access: vi.fn(async () => {
    throw new Error("absent");
  }),
}));
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    queueMicrotask(() => {
      if (runtime.spawnError) {
        child.emit("error", runtime.spawnError);
        return;
      }
      child.stdout.emit("data", Buffer.from(runtime.output));
      child.stderr.emit("data", Buffer.from(runtime.error));
      child.emit("close", runtime.code);
    });
    return child;
  }),
}));
import { spawn } from "node:child_process";
import { forwardSyncTex, backwardSyncTex } from "./synctex.js";
beforeEach(() => {
  runtime.output = "";
  runtime.error = "";
  runtime.code = 0;
  runtime.spawnError = null;
  vi.clearAllMocks();
});
describe("SyncTeX process integration", () => {
  it("parses the first PDF match and preserves source paths as a single argument", async () => {
    runtime.output =
      "SyncTeX result begin\nOutput:paper.pdf\nPage:2\nx:12.5\ny:20\nh:10\nv:30\nW:42\nH:9\nOutput:paper.pdf\nPage:3\nx:99\nSyncTeX result end";
    expect(
      await forwardSyncTex("/paper", "paper.pdf", "source with space.tex", 12, 3),
    ).toEqual({ page: 2, x: 12.5, y: 20, h: 10, v: 30, width: 42, height: 9 });
    expect(spawn).toHaveBeenCalledWith(
      "synctex",
      ["view", "-i", "12:3:source with space.tex", "-o", "paper.pdf"],
      expect.objectContaining({ cwd: "/paper", windowsHide: true }),
    );
  });
  it("normalizes backward paths and clamps invalid columns", async () => {
    runtime.output = "Output:paper.pdf\nInput:sections/intro.tex\nLine:17\nColumn:-2";
    expect(await backwardSyncTex("/paper", "paper.pdf", 2, 10, 20)).toEqual({
      file: "sections/intro.tex",
      line: 17,
      column: 1,
    });
    expect(spawn).toHaveBeenCalledWith(
      "synctex",
      ["edit", "-o", "2:10:20:paper.pdf"],
      expect.anything(),
    );
  });
  it.each(["../private.tex", "/elsewhere/private.tex", "."])(
    "rejects source outside the project: %s",
    async (input) => {
      runtime.output = `Input:${input}\nLine:1`;
      expect(await backwardSyncTex("/paper", "paper.pdf", 1, 0, 0)).toBeNull();
    },
  );
  it("handles missing matches and nonnumeric coordinates", async () => {
    expect(await forwardSyncTex("/paper", "paper.pdf", "main.tex", 1, 1)).toBeNull();
    expect(await backwardSyncTex("/paper", "paper.pdf", 1, 0, 0)).toBeNull();
    runtime.output = "Page:NaN\nx:invalid";
    expect(await forwardSyncTex("/paper", "paper.pdf", "main.tex", 1, 1)).toEqual({
      page: 0,
      x: 0,
      y: 0,
      h: 0,
      v: 0,
      width: 0,
      height: 0,
    });
  });
  it.each(["TeX failed", ""])("surfaces subprocess errors (%s)", async (error) => {
    runtime.error = error;
    runtime.code = 1;
    await expect(
      forwardSyncTex("/paper", "paper.pdf", "main.tex", 1, 1),
    ).rejects.toThrow(error || "could not find a match");
  });
  it("propagates spawn errors", async () => {
    runtime.spawnError = new Error("ENOENT");
    await expect(
      forwardSyncTex("/paper", "paper.pdf", "main.tex", 1, 1),
    ).rejects.toThrow("ENOENT");
  });
});
