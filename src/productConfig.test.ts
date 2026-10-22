import { afterEach, describe, expect, it, vi } from "vitest";

async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string);
  return import("./productConfig");
}

describe("productConfig", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to the personal edition", async () => {
    const { productConfig, productIsPro } = await loadConfig({
      VITE_LATEXDO_EDITION: "",
      VITE_LATEXDO_PRODUCT_NAME: "",
    });
    expect(productIsPro).toBe(false);
    expect(productConfig).toMatchObject({
      edition: "personal",
      name: "LatexDo",
      aiName: "LatexDo AI",
      commandCenterItems: [],
    });
  });

  it("uses a configured product name for the personal edition", async () => {
    const { productConfig } = await loadConfig({
      VITE_LATEXDO_EDITION: "personal",
      VITE_LATEXDO_PRODUCT_NAME: "  Paperwork  ",
    });
    expect(productConfig.name).toBe("Paperwork");
    expect(productConfig.documentTitle).toBe("Paperwork");
  });

  it.each(["pro", "business"])("selects the pro edition for %s", async (edition) => {
    const { productConfig, productIsPro } = await loadConfig({
      VITE_LATEXDO_EDITION: edition,
      VITE_LATEXDO_PRODUCT_NAME: "",
    });
    expect(productIsPro).toBe(true);
    expect(productConfig.name).toBe("LatexDo Pro");
    expect(productConfig.commandCenterItems).toHaveLength(3);
  });

  it("uses a configured product name for the pro edition", async () => {
    const { productConfig } = await loadConfig({
      VITE_LATEXDO_EDITION: "pro",
      VITE_LATEXDO_PRODUCT_NAME: "Acme Docs",
    });
    expect(productConfig.aiName).toBe("Acme Docs AI");
  });
});
