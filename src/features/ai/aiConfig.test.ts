import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiConfigStorageKey,
  cloudCredentialId,
  defaultAiConfig,
  isAiReady,
  layoutPresetFlags,
  layoutPresetInfo,
  loadAiConfig,
  normalizeAiConfig,
  saveAiConfig,
  suggestedThemeForLayout,
  type AiConfig,
} from "./aiConfig";

describe("normalizeAiConfig", () => {
  it("defaults AI context access to enabled", () => {
    expect(normalizeAiConfig({}).access).toEqual(defaultAiConfig.access);
  });

  it("persists explicit AI context access choices", () => {
    expect(
      normalizeAiConfig({
        access: {
          chatHistory: false,
          currentEditor: false,
          projectFiles: true,
          bibliography: false,
          researcherProfile: true,
        },
      }).access,
    ).toEqual({
      chatHistory: false,
      currentEditor: false,
      projectFiles: true,
      bibliography: false,
      researcherProfile: true,
    });
  });

  it("falls back per access key when stored values are invalid", () => {
    expect(
      normalizeAiConfig({
        access: {
          chatHistory: "yes",
          currentEditor: true,
          projectFiles: null,
        },
      }).access,
    ).toEqual({
      ...defaultAiConfig.access,
      currentEditor: true,
    });
  });

  it("asks before AI edits unless the user turned approval off", () => {
    expect(normalizeAiConfig({}).autoApproveEdits).toBe(false);
    expect(normalizeAiConfig({ autoApproveEdits: true }).autoApproveEdits).toBe(true);
    expect(normalizeAiConfig({ autoApproveEdits: "yes" }).autoApproveEdits).toBe(false);
  });

  it("migrates known local runtime models to LatexDo AI tiers", () => {
    expect(
      normalizeAiConfig({
        provider: "local",
        modelId: "qwen2.5-coder-1.5b",
      }).selection,
    ).toEqual({ mode: "latexdo", tier: "latexdo-ai" });

    expect(
      normalizeAiConfig({
        provider: "local",
        modelId: "qwen3-8b",
      }).selection,
    ).toEqual({ mode: "latexdo", tier: "latexdo-pro-max" });
  });

  it("migrates legacy cloud and Ollama runtime settings into Customize selections", () => {
    expect(
      normalizeAiConfig({
        provider: "cloud",
        cloud: {
          ...defaultAiConfig.cloud,
          providerId: "openai",
          vendor: "openai",
          model: "gpt-4.1-mini",
          baseUrl: "https://api.openai.com/v1",
        },
      }).selection,
    ).toEqual({
      mode: "custom",
      custom: {
        kind: "cloud",
        providerId: "openai",
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
        credentialId: "credential-openai-primary",
      },
    });

    expect(
      normalizeAiConfig({
        provider: "ollama",
        ollamaBaseUrl: "http://localhost:11434",
        ollamaModel: "qwen2.5-coder:3b",
      }).selection,
    ).toEqual({
      mode: "custom",
      custom: {
        kind: "ollama",
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:3b",
      },
    });
  });

  it("does not keep a stale LatexDo tier selection for cloud configs", () => {
    expect(
      normalizeAiConfig({
        ...defaultAiConfig,
        provider: "cloud",
        selection: { mode: "latexdo", tier: "latexdo-pro-max" },
        cloud: {
          ...defaultAiConfig.cloud,
          providerId: "openai",
          vendor: "openai",
          model: "gpt-4.1-mini",
        },
      }).selection,
    ).toEqual({
      mode: "custom",
      custom: {
        kind: "cloud",
        providerId: "openai",
        model: "gpt-4.1-mini",
        baseUrl: defaultAiConfig.cloud.baseUrl,
        credentialId: "credential-openai-primary",
      },
    });
  });
});

describe("aiConfig normalization edge cases", () => {
  it("falls back to defaults for unknown models, providers, layouts and garbage", () => {
    const config = normalizeAiConfig({
      modelId: "missing",
      inlineModelId: "missing-inline",
      provider: "mystery",
      layoutPreset: "wide",
      userName: "u".repeat(120),
      maxAgentSteps: Number.NaN,
      autoApproveEdits: "garbage",
    });
    expect(config.modelId).toBe(defaultAiConfig.modelId);
    expect(config.inlineModelId).toBe(defaultAiConfig.inlineModelId);
    expect(config.provider).toBe("local");
    expect(config.layoutPreset).toBe("balanced");
    expect(config.userName).toHaveLength(80);
    expect(config.maxAgentSteps).toBe(defaultAiConfig.maxAgentSteps);
    expect(config.autoApproveEdits).toBe(false);
    expect(normalizeAiConfig(null).provider).toBe("local");
  });

  it("keeps valid inline models, layouts and clamps agent steps", () => {
    const config = normalizeAiConfig({
      inlineModelId: "qwen3-4b",
      layoutPreset: "power",
      maxAgentSteps: 999,
    });
    expect(config.inlineModelId).toBe("qwen3-4b");
    expect(config.layoutPreset).toBe("power");
    expect(config.maxAgentSteps).toBe(50);
    expect(normalizeAiConfig({ maxAgentSteps: -4.2 }).maxAgentSteps).toBe(1);
  });

  it("folds the legacy openai-compatible vendor and treats a legacy key as configured", () => {
    const cloud = normalizeAiConfig({
      cloud: { vendor: "openai-compatible", providerId: "groq", apiKey: " sk " },
    }).cloud;
    expect(cloud.vendor).toBe("openai");
    expect(cloud.credentialConfigured).toBe(true);
    expect(cloud.credentialId).toBe("credential-groq-primary");
    expect(JSON.stringify(cloud)).not.toContain("sk");
    const blank = normalizeAiConfig({
      cloud: { vendor: "weird", apiKey: "   " },
    }).cloud;
    expect(blank.vendor).toBe(defaultAiConfig.cloud.vendor);
    expect(blank.credentialConfigured).toBe(false);
  });

  it("names a credential for an empty provider id", () => {
    expect(cloudCredentialId("")).toBe("credential-custom-primary");
  });

  describe("selection", () => {
    it("keeps an explicit LatexDo tier for the local provider", () => {
      expect(
        normalizeAiConfig({
          provider: "local",
          selection: { mode: "latexdo", tier: "latexdo-pro" },
        }).selection,
      ).toEqual({ mode: "latexdo", tier: "latexdo-pro" });
    });

    it("derives a tier from the local model when the saved tier is invalid", () => {
      expect(
        normalizeAiConfig({
          provider: "local",
          modelId: "qwen3-8b",
          selection: { mode: "latexdo", tier: 4 },
        }).selection,
      ).toEqual({ mode: "latexdo", tier: "latexdo-pro-max" });
    });

    it("uses a custom gguf selection for a local model that is not a tier", () => {
      expect(normalizeAiConfig({ modelId: "llama-3.2-1b" }).selection).toEqual({
        mode: "custom",
        custom: { kind: "gguf", modelId: "llama-3.2-1b" },
      });
    });

    it("keeps custom gguf, filling the model id from runtime", () => {
      expect(
        normalizeAiConfig({
          provider: "local",
          modelId: "qwen3-4b",
          selection: { mode: "custom", custom: { kind: "gguf" } },
        }).selection,
      ).toEqual({ mode: "custom", custom: { kind: "gguf", modelId: "qwen3-4b" } });
      expect(
        normalizeAiConfig({
          selection: { mode: "custom", custom: { kind: "gguf", modelId: "x" } },
        }).selection,
      ).toEqual({ mode: "custom", custom: { kind: "gguf", modelId: "x" } });
    });

    it("keeps or derives ollama selections", () => {
      expect(
        normalizeAiConfig({
          provider: "ollama",
          ollamaBaseUrl: "http://h:1",
          ollamaModel: "m",
          selection: { mode: "custom", custom: { kind: "ollama", model: "picked" } },
        }).selection,
      ).toEqual({
        mode: "custom",
        custom: { kind: "ollama", baseUrl: "http://h:1", model: "picked" },
      });
      expect(
        normalizeAiConfig({
          provider: "ollama",
          selection: {
            mode: "custom",
            custom: { kind: "ollama", baseUrl: "http://b", model: "c" },
          },
        }).selection,
      ).toEqual({
        mode: "custom",
        custom: { kind: "ollama", baseUrl: "http://b", model: "c" },
      });
      expect(
        normalizeAiConfig({ provider: "ollama", selection: null }).selection,
      ).toEqual({
        mode: "custom",
        custom: {
          kind: "ollama",
          baseUrl: defaultAiConfig.ollamaBaseUrl,
          model: defaultAiConfig.ollamaModel,
        },
      });
    });

    it("keeps or derives cloud selections", () => {
      const cloud = { providerId: "openai", model: "gpt", baseUrl: "https://x" };
      expect(
        normalizeAiConfig({
          provider: "cloud",
          cloud,
          selection: { mode: "custom", custom: { kind: "cloud" } },
        }).selection,
      ).toEqual({
        mode: "custom",
        custom: {
          kind: "cloud",
          providerId: "openai",
          model: "gpt",
          baseUrl: "https://x",
          credentialId: "credential-openai-primary",
        },
      });
      expect(
        normalizeAiConfig({
          provider: "cloud",
          cloud,
          selection: {
            mode: "custom",
            custom: {
              kind: "cloud",
              providerId: "groq",
              model: "llama",
              baseUrl: "",
              credentialId: "credential-mine",
            },
          },
        }).selection,
      ).toEqual({
        mode: "custom",
        custom: {
          kind: "cloud",
          providerId: "groq",
          model: "llama",
          baseUrl: "",
          credentialId: "credential-mine",
        },
      });
      expect(normalizeAiConfig({ provider: "cloud", cloud }).selection).toEqual({
        mode: "custom",
        custom: {
          kind: "cloud",
          providerId: "openai",
          model: "gpt",
          baseUrl: "https://x",
          credentialId: "credential-openai-primary",
        },
      });
    });

    it("ignores a custom selection that does not match the provider", () => {
      expect(
        normalizeAiConfig({
          provider: "off",
          selection: { mode: "custom", custom: { kind: "cloud" } },
        }).selection,
      ).toEqual({ mode: "off" });
      expect(
        normalizeAiConfig({ provider: "off", selection: { mode: "custom" } }).selection,
      ).toEqual({ mode: "off" });
    });
  });
});

describe("aiConfig persistence", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips through local storage", () => {
    const config = { ...defaultAiConfig, userName: "Ada", setupComplete: true };
    saveAiConfig(config);
    expect(JSON.parse(window.localStorage.getItem(aiConfigStorageKey)!).userName).toBe(
      "Ada",
    );
    expect(loadAiConfig()).toMatchObject({ userName: "Ada", setupComplete: true });
  });

  it("loads defaults when nothing or corrupt data is stored", () => {
    expect(loadAiConfig().provider).toBe("local");
    window.localStorage.setItem(aiConfigStorageKey, "{nope");
    expect(loadAiConfig()).toBe(defaultAiConfig);
  });
});

describe("isAiReady", () => {
  it.each([
    [{ provider: "off" }, true, false],
    [{ provider: "cloud", cloud: { credentialConfigured: true } }, false, true],
    [{ provider: "cloud", cloud: { credentialConfigured: false } }, true, false],
    [{ provider: "local", modelDownloaded: true }, false, false],
    [{ provider: "local", modelDownloaded: true }, true, true],
    [{ provider: "local", modelDownloaded: false }, true, false],
    [{ provider: "ollama" }, true, true],
  ])("%j on desktop=%s → %s", (overrides, desktop, ready) => {
    expect(isAiReady({ ...defaultAiConfig, ...overrides } as AiConfig, desktop)).toBe(
      ready,
    );
  });
});

describe("layout helpers", () => {
  it("describes every preset and suggests the default theme", () => {
    expect(layoutPresetInfo.map((info) => info.id).sort()).toEqual(
      Object.keys(layoutPresetFlags).sort(),
    );
    expect(layoutPresetFlags.focus.sidebarVisible).toBe(false);
    expect(suggestedThemeForLayout("power")).toBe("graphite");
  });
});

describe("default cloud config without a catalog provider", () => {
  it("falls back to built-in Anthropic defaults", async () => {
    vi.resetModules();
    vi.doMock("./cloudProviders", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./cloudProviders")>()),
      findCloudProvider: () => undefined,
    }));
    const fresh = await import("./aiConfig");
    expect(fresh.defaultAiConfig.cloud).toMatchObject({
      vendor: "anthropic",
      model: "claude-opus-5-5",
      baseUrl: "",
    });
    vi.doUnmock("./cloudProviders");
    vi.resetModules();
  });
});
