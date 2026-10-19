import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalModelInfo } from "../aiModels";

// The tier table is built from the generated model catalog when the module
// loads; these tests feed it broken catalogs to check that it refuses them.
async function loadTiersWith(patch: (model: LocalModelInfo) => LocalModelInfo | undefined) {
  vi.resetModules();
  const actual = await vi.importActual<typeof import("../aiModels")>("../aiModels");
  vi.doMock("../aiModels", () => ({
    ...actual,
    findLocalModel: (id: string) => {
      const model = actual.findLocalModel(id);
      return model ? patch(model) : undefined;
    },
  }));
  return import("./latexDoAiTiers");
}

afterEach(() => {
  vi.doUnmock("../aiModels");
  vi.resetModules();
});

describe("LatexDo AI tier catalog validation", () => {
  it("converts megabyte download sizes", async () => {
    const { latexDoAiTiers } = await loadTiersWith((model) => ({
      ...model,
      downloadSize: "512 MB",
    }));
    expect(latexDoAiTiers[0].runtime.downloadBytes).toBe(512 * 1024 ** 2);
  });

  it("refuses a tier whose runtime model is missing", async () => {
    await expect(loadTiersWith(() => undefined)).rejects.toThrow(
      /Missing LatexDo AI runtime model/,
    );
  });

  it("refuses download sizes without a unit or with a malformed number", async () => {
    await expect(
      loadTiersWith((model) => ({ ...model, downloadSize: "big" })),
    ).rejects.toThrow("Invalid local model download size: big");
    await expect(
      loadTiersWith((model) => ({ ...model, downloadSize: "1.2.3 GB" })),
    ).rejects.toThrow("Invalid local model download size: 1.2.3 GB");
  });
});
