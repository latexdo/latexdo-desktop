// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ directory: "" }));
vi.mock("electron", () => ({ app: { getPath: () => storage.directory } }));
import { downloadModelFile, modelPath, modelsDir } from "./models.js";

beforeEach(async () => {
  storage.directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-models-"));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(storage.directory, { recursive: true, force: true });
});

describe("model download verification", () => {
  it.each([
    "..",
    "../secret.gguf",
    "nested/model.gguf",
    "nested\\model.gguf",
    "config.json",
    "C:model.gguf",
    ".gguf",
  ])("rejects unsafe model name %s", (name) => {
    expect(() => modelPath(name)).toThrow(/Invalid model/);
  });
  it("aborts an oversized stream before accepting an artifact", async () => {
    let pulls = 0;
    const stream = new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(16));
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    await expect(
      downloadModelFile(
        "https://example.test/model",
        "model.gguf",
        { onProgress: vi.fn() },
        { sizeRangeBytes: { min: 1, max: 32 } },
      ),
    ).rejects.toThrow(/exceeds/);
    expect(pulls).toBeLessThan(10);
    expect(await readdir(modelsDir())).toEqual([]);
  });
  it("rejects truncated artifacts and checksum mismatches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(new Response("data"))),
    );
    await expect(
      downloadModelFile(
        "https://example.test/model",
        "model.gguf",
        { onProgress: vi.fn() },
        { sizeRangeBytes: { min: 10, max: 20 } },
      ),
    ).rejects.toThrow(/incomplete/);
    await expect(
      downloadModelFile(
        "https://example.test/model",
        "model.gguf",
        { onProgress: vi.fn() },
        { expectedSha256: "0".repeat(64) },
      ),
    ).rejects.toThrow(/checksum/);
    expect(await readdir(modelsDir())).toEqual([]);
  });
  it("publishes an artifact only after verification", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data")));
    await downloadModelFile(
      "https://example.test/model",
      "model.gguf",
      { onProgress: vi.fn() },
      { sizeRangeBytes: { min: 4, max: 4 } },
    );
    expect(await readFile(modelPath("model.gguf"), "utf8")).toBe("data");
    expect(await readdir(modelsDir())).toEqual(["model.gguf"]);
  });
});
