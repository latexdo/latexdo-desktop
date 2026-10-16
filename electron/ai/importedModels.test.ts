// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { AiSystemCapabilities } from "./systemCapabilities.js";
const storage = vi.hoisted(() => ({ directory: "" }));
vi.mock("./models.js", () => ({
  modelsDir: () => storage.directory,
  modelPath: (name: string) => path.join(storage.directory, path.basename(name)),
}));
vi.mock("./systemCapabilities.js", () => ({
  getAiSystemCapabilities: () => ({
    localAiAvailable: true,
    totalRamBytes: 16 * 1024 ** 3,
    freeRamBytes: 8 * 1024 ** 3,
  }),
}));
import {
  estimateImportedModelRam,
  evaluateImportedModelCompatibility,
  findImportedModelManifest,
  importGgufModel,
  inspectInstalledGgufModel,
  readImportedModelManifests,
  saveImportedModelManifest,
} from "./importedModels.js";
let root: string;
const system = {
  localAiAvailable: true,
  totalRamBytes: 16 * 1024 ** 3,
  freeRamBytes: 8 * 1024 ** 3,
} as AiSystemCapabilities;
function u32(n: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
function u64(n: number | bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}
function str(s: string) {
  return Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s)]);
}
function gguf(entries: [string, number, Buffer][] = []) {
  return Buffer.concat([
    Buffer.from("GGUF"),
    u32(3),
    u64(0),
    u64(entries.length),
    ...entries.flatMap(([key, type, value]) => [str(key), u32(type), value]),
  ]);
}
async function source(data: Buffer, name = "model-Q4_K_M.gguf") {
  const p = path.join(root, name);
  await writeFile(p, data);
  return p;
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "latexdo-gguf-"));
  storage.directory = path.join(root, "store");
  await mkdir(storage.directory);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe("GGUF imports", () => {
  it("reads metadata, preserves source bytes and installs duplicate names without overwriting", async () => {
    const data = gguf([
      ["general.name", 8, str("Tiny Model")],
      ["general.architecture", 8, str("llama")],
      ["llama.context_length", 4, u32(8192)],
    ]);
    const input = await source(data);
    const first = await importGgufModel(input);
    expect(first).toMatchObject({
      fileName: "model-Q4_K_M.gguf",
      modelName: "Tiny Model",
      architecture: "llama",
      contextLength: 8192,
      quantization: "Q4_K_M",
      downloaded: true,
      fileSizeBytes: data.length,
      compatibility: { state: "compatible" },
    });
    expect(await readFile(first.path!)).toEqual(data);
    expect(await readFile(input)).toEqual(data);
    expect((await importGgufModel(input, system)).fileName).toBe("model-Q4_K_M-2.gguf");
    expect((await importGgufModel(input, system)).fileName).toBe("model-Q4_K_M-3.gguf");
    expect(await readImportedModelManifests()).toHaveLength(3);
    expect(await findImportedModelManifest("../model-Q4_K_M.gguf")).toEqual(first);
    expect(await findImportedModelManifest("absent.gguf")).toBeNull();
    expect(await inspectInstalledGgufModel(first.fileName)).toMatchObject({
      modelName: "Tiny Model",
      contextLength: 8192,
    });
    expect(await readImportedModelManifests()).toHaveLength(3);
    await saveImportedModelManifest({ ...first, capabilities: { toolUse: "native" } });
    expect(
      (await findImportedModelManifest(first.fileName))?.capabilities.toolUse,
    ).toBe("native");
  });
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12])(
    "skips unrelated scalar and array metadata of type %i without losing following fields",
    async (type) => {
      const size = [0, 1, 7].includes(type)
        ? 1
        : [2, 3].includes(type)
          ? 2
          : [4, 5, 6].includes(type)
            ? 4
            : 8;
      const input = await source(
        gguf([
          ["unused.scalar", type, Buffer.alloc(size)],
          [
            "unused.array",
            9,
            Buffer.concat([u32(type), u64(2), Buffer.alloc(size * 2)]),
          ],
          ["general.basename", 8, str("Fallback Name")],
        ]),
        "simple.gguf",
      );
      expect(await importGgufModel(input, system)).toMatchObject({
        modelName: "Fallback Name",
        architecture: undefined,
        contextLength: undefined,
        quantization: undefined,
      });
    },
  );
  it("skips string arrays and preserves subsequent metadata", async () => {
    const input = await source(
      gguf([
        ["tokenizer.tokens", 9, Buffer.concat([u32(8), u64(2), str("a"), str("b")])],
        ["general.name", 8, str("After tokens")],
      ]),
    );
    expect((await importGgufModel(input, system)).modelName).toBe("After tokens");
  });
  it.each([
    ["bad magic", Buffer.from("not GGUF"), "not a valid"],
    ["short header", Buffer.from("GGUF"), "incomplete header"],
    [
      "unsafe integer",
      Buffer.concat([Buffer.from("GGUF"), u32(3), u64(2n ** 63n), u64(0)]),
      "too large",
    ],
    [
      "short key length",
      Buffer.concat([gguf().subarray(0, 16), u64(1)]),
      "Unexpected end",
    ],
    [
      "truncated string",
      gguf([["general.name", 8, Buffer.concat([u64(100), Buffer.from("x")])]]),
      "too large",
    ],
    ["unknown type", gguf([["unknown", 99, Buffer.alloc(0)]]), "Unsupported GGUF"],
    [
      "short signed integer",
      gguf([["unknown", 11, Buffer.alloc(2)]]),
      "Unexpected end",
    ],
    ["short array", gguf([["unknown", 9, Buffer.alloc(2)]]), "Unexpected end"],
    [
      "oversized array",
      gguf([["unknown", 9, Buffer.concat([u32(4), u64(100)])]]),
      "too large",
    ],
  ])("rejects %s before installing a manifest", async (_name, data, message) => {
    await expect(importGgufModel(await source(data as Buffer), system)).rejects.toThrow(
      message as string,
    );
    expect(await readImportedModelManifests()).toEqual([]);
  });
  it("rejects non-GGUF extensions and insufficient physical RAM", async () => {
    await expect(
      importGgufModel(await source(gguf(), "model.bin"), system),
    ).rejects.toThrow("Only GGUF");
    await expect(
      importGgufModel(await source(gguf()), { ...system, totalRamBytes: 1 }),
    ).rejects.toThrow("physical RAM");
  });
});
describe("model manifests and memory preflight", () => {
  it.each([null, {}, "broken", "[]"])(
    "recovers from missing or malformed manifests: %j",
    async (raw) => {
      if (raw !== null)
        await writeFile(
          path.join(storage.directory, "imported-models.json"),
          typeof raw === "string" ? raw : JSON.stringify(raw),
        );
      expect(await readImportedModelManifests()).toEqual([]);
    },
  );
  it("normalizes old manifests and ignores invalid entries", async () => {
    await writeFile(
      path.join(storage.directory, "imported-models.json"),
      JSON.stringify([
        null,
        [],
        { fileName: "bad.txt" },
        {
          fileName: "../old.gguf",
          sizeBytes: 12,
          compatibility: {
            state: "bad",
            estimatedRamBytes: 20,
            estimatedVramBytes: 10,
            availableRamBytes: 30,
            reason: "test",
          },
          capabilities: { toolUse: "bad" },
        },
        { fileName: "minimal.gguf" },
      ]),
    );
    const entries = await readImportedModelManifests();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: "imported-gguf:old.gguf",
      fileName: "old.gguf",
      fileSizeBytes: 12,
      downloaded: false,
      path: null,
      capabilities: { toolUse: "unknown" },
      compatibility: {
        state: "unknown",
        estimatedRamBytes: 20,
        estimatedVramBytes: 10,
        availableRamBytes: 30,
        reason: "test",
        checkedAt: new Date(0).toISOString(),
      },
    });
    expect(entries[1].fileSizeBytes).toBe(0);
  });
  it("distinguishes unsupported, unknown, physical limits and temporary memory pressure", () => {
    expect(estimateImportedModelRam(100)).toBe(512 * 1024 ** 2 + 135);
    expect(
      evaluateImportedModelCompatibility(100, { ...system, localAiAvailable: false })
        .state,
    ).toBe("unsupported");
    for (const size of [0, -1, NaN, Infinity])
      expect(evaluateImportedModelCompatibility(size, system).state).toBe("unknown");
    expect(
      evaluateImportedModelCompatibility(100, { ...system, freeRamBytes: 1 }),
    ).toMatchObject({ state: "memory-pressure", availableRamBytes: 1 });
    expect(evaluateImportedModelCompatibility(100, system)).toMatchObject({
      state: "compatible",
      estimatedRamBytes: 512 * 1024 ** 2 + 135,
    });
  });
});
