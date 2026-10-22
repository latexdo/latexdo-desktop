// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import * as fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ directory: "" }));
vi.mock("electron", () => ({ app: { getPath: () => storage.directory } }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: vi.fn(actual.stat),
    unlink: vi.fn(actual.unlink),
    rename: vi.fn(actual.rename),
  };
});
import {
  deleteModelFile,
  downloadModelFile,
  listModelFiles,
  modelExists,
  modelPath,
  modelsDir,
} from "./models.js";

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

describe("model storage", () => {
  it("lists only GGUF files with their sizes", async () => {
    expect(await listModelFiles()).toEqual([]);
    await writeFile(modelPath("a.gguf"), "abc");
    await writeFile(path.join(modelsDir(), "notes.txt"), "x");
    expect(await listModelFiles()).toEqual([
      { fileName: "a.gguf", path: modelPath("a.gguf"), sizeBytes: 3 },
    ]);
  });

  it("returns no models when the folder cannot be read", async () => {
    storage.directory = path.join(storage.directory, "file");
    await writeFile(storage.directory, "not a folder");
    expect(await listModelFiles()).toEqual([]);
  });

  it("reports whether a non-empty model exists", async () => {
    await listModelFiles();
    expect(await modelExists("missing.gguf")).toBe(false);
    expect(await modelExists("../bad.gguf")).toBe(false);
    await writeFile(modelPath("empty.gguf"), "");
    expect(await modelExists("empty.gguf")).toBe(false);
    await writeFile(modelPath("full.gguf"), "x");
    expect(await modelExists("full.gguf")).toBe(true);
  });

  it("deletes model files and tolerates ones already gone", async () => {
    await listModelFiles();
    await writeFile(modelPath("gone.gguf"), "x");
    await deleteModelFile("gone.gguf");
    expect(await modelExists("gone.gguf")).toBe(false);
    await expect(deleteModelFile("gone.gguf")).resolves.toBeUndefined();
  });
});

describe("model download edge cases", () => {
  const url = "https://example.test/model";

  it("fails on HTTP errors and empty bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("no", { status: 404 })),
    );
    await expect(
      downloadModelFile(url, "m.gguf", { onProgress: vi.fn() }),
    ).rejects.toThrow("Download failed: HTTP 404");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );
    await expect(
      downloadModelFile(url, "m.gguf", { onProgress: vi.fn() }),
    ).rejects.toThrow("HTTP 200");
  });

  it("reports progress against the advertised size and stage changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("data", { headers: { "content-length": "4" } }),
        ),
    );
    const onProgress = vi.fn();
    const onStage = vi.fn();
    await downloadModelFile(url, "m.gguf", { onProgress, onStage });
    expect(onProgress).toHaveBeenLastCalledWith(4, 4);
    expect(onStage.mock.calls).toEqual([["downloading"], ["verifying"]]);

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("data", { headers: { "content-length": "lots" } }),
        ),
    );
    const unknownTotal = vi.fn();
    await downloadModelFile(url, "n.gguf", { onProgress: unknownTotal });
    expect(unknownTotal).toHaveBeenLastCalledWith(4, null);
  });

  it("accepts a matching checksum and one-sided size bounds", async () => {
    const { createHash } = await import("node:crypto");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("data"))),
    );
    await downloadModelFile(
      url,
      "sum.gguf",
      { onProgress: vi.fn() },
      {
        expectedSha256: createHash("sha256").update("data").digest("hex").toUpperCase(),
        sizeRangeBytes: { min: 1 } as never,
      },
    );
    expect(await readFile(modelPath("sum.gguf"), "utf8")).toBe("data");
    await downloadModelFile(
      url,
      "max.gguf",
      { onProgress: vi.fn() },
      { sizeRangeBytes: { max: 10 } as never },
    );
    expect(await modelExists("max.gguf")).toBe(true);
  });

  it("refuses a size check with no bounds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data")));
    await expect(
      downloadModelFile(
        url,
        "m.gguf",
        { onProgress: vi.fn() },
        { sizeRangeBytes: {} as never },
      ),
    ).rejects.toThrow(/misconfigured/);
    expect(await readdir(modelsDir())).toEqual([]);
  });

  it("rejects a file that grew past the size limit on disk", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data")));
    vi.mocked(fsPromises.stat).mockResolvedValueOnce({ size: 999 } as never);
    await expect(
      downloadModelFile(
        url,
        "m.gguf",
        { onProgress: vi.fn() },
        { sizeRangeBytes: { min: 1, max: 100 } },
      ),
    ).rejects.toThrow(/exceeds the expected size: expected at most 100/);
  });

  it("stops when the download is cancelled before verification", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data")));
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadModelFile(url, "m.gguf", {
        onProgress: vi.fn(),
        signal: controller.signal,
      }),
    ).rejects.toThrow("Model download cancelled.");
    expect(await readdir(modelsDir())).toEqual([]);
  });

  it("stops hashing when cancelled mid-verification", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data")));
    const controller = new AbortController();
    vi.mocked(fsPromises.stat).mockImplementationOnce(async (target) => {
      const info = await (
        await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
      ).stat(target);
      controller.abort();
      return info;
    });
    await expect(
      downloadModelFile(
        url,
        "m.gguf",
        { onProgress: vi.fn(), signal: controller.signal },
        { expectedSha256: "0".repeat(64) },
      ),
    ).rejects.toThrow("Model download cancelled.");
  });

  it("still reports the original error when the partial file cannot be removed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data")));
    vi.mocked(fsPromises.rename).mockRejectedValueOnce(new Error("rename failed"));
    vi.mocked(fsPromises.unlink).mockRejectedValueOnce(new Error("locked"));
    await expect(
      downloadModelFile(url, "m.gguf", { onProgress: vi.fn() }),
    ).rejects.toThrow("rename failed");

    const stream = new ReadableStream({
      start(controller) {
        controller.error(new Error("network dropped"));
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    vi.mocked(fsPromises.unlink).mockRejectedValueOnce(new Error("locked"));
    await expect(
      downloadModelFile(url, "n.gguf", { onProgress: vi.fn() }),
    ).rejects.toThrow("network dropped");
  });
});
