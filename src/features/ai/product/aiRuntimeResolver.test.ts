import { describe, expect, it } from "vitest";
import { defaultAiConfig, type AiConfig } from "../aiConfig";
import { localModelCatalog } from "../aiModels";
import { resolveAiRuntime } from "./aiRuntimeResolver";

describe("resolveAiRuntime", () => {
  it("uses the visible provider over stale legacy selection data", () => {
    expect(
      resolveAiRuntime({
        ...defaultAiConfig,
        provider: "cloud",
        selection: { mode: "latexdo", tier: "latexdo-ai-plus" },
        cloud: {
          ...defaultAiConfig.cloud,
          providerId: "openai",
          vendor: "openai",
          model: "gpt-4.1-mini",
          baseUrl: "https://api.openai.com/v1",
          credentialId: "credential-openai-primary",
          credentialConfigured: true,
        },
      }),
    ).toEqual({
      provider: "cloud",
      vendor: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      credentialId: "credential-openai-primary",
    });
  });

  it("resolves LatexDo tiers to local runtime models only for local configs", () => {
    expect(resolveAiRuntime(defaultAiConfig)).toEqual({
      provider: "local",
      modelId: "qwen2.5-coder-3b",
      fileName: "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
    });
  });

  const cloud = {
    ...defaultAiConfig.cloud,
    vendor: "anthropic" as const,
    model: "claude-default",
    baseUrl: "https://api.anthropic.com",
    credentialId: "credential-anthropic-primary",
  };

  it("resolves a custom GGUF model and an unknown one without a file name", () => {
    const known = localModelCatalog[0];
    expect(
      resolveAiRuntime({
        ...defaultAiConfig,
        selection: { mode: "custom", custom: { kind: "gguf", modelId: known.id } },
      }),
    ).toEqual({ provider: "local", modelId: known.id, fileName: known.fileName });
    expect(
      resolveAiRuntime({
        ...defaultAiConfig,
        selection: { mode: "custom", custom: { kind: "gguf", modelId: "mystery" } },
      }),
    ).toEqual({ provider: "local", modelId: "mystery", fileName: undefined });
  });

  it("falls back to the legacy local model id for other selections", () => {
    const known = localModelCatalog[localModelCatalog.length - 1];
    const ollamaSelection: AiConfig["selection"] = {
      mode: "custom",
      custom: { kind: "ollama", baseUrl: "http://x", model: "m" },
    };
    const resolved = resolveAiRuntime({
      ...defaultAiConfig,
      modelId: known.id,
      selection: ollamaSelection,
    });
    expect(resolved).toMatchObject({ provider: "local", modelId: known.id });
    expect((resolved as { fileName?: string }).fileName).toBeTruthy();
    expect(
      resolveAiRuntime({
        ...defaultAiConfig,
        modelId: "nope",
        selection: ollamaSelection,
      }),
    ).toEqual({ provider: "local", modelId: "nope", fileName: undefined });
  });

  it("resolves Ollama from the custom selection or the saved settings", () => {
    expect(
      resolveAiRuntime({
        ...defaultAiConfig,
        provider: "ollama",
        selection: {
          mode: "custom",
          custom: { kind: "ollama", baseUrl: "http://gpu:11434", model: "llama3" },
        },
      }),
    ).toEqual({ provider: "ollama", baseUrl: "http://gpu:11434", model: "llama3" });
    expect(resolveAiRuntime({ ...defaultAiConfig, provider: "ollama" })).toEqual({
      provider: "ollama",
      baseUrl: defaultAiConfig.ollamaBaseUrl,
      model: defaultAiConfig.ollamaModel,
    });
  });

  it("prefers a custom cloud selection and fills its gaps from the cloud settings", () => {
    expect(
      resolveAiRuntime({
        ...defaultAiConfig,
        provider: "cloud",
        cloud,
        selection: {
          mode: "custom",
          custom: {
            kind: "cloud",
            providerId: "x",
            model: "custom-model",
            baseUrl: "https://proxy.example",
            credentialId: "credential-x",
          },
        },
      }),
    ).toEqual({
      provider: "cloud",
      vendor: "anthropic",
      baseUrl: "https://proxy.example",
      model: "custom-model",
      credentialId: "credential-x",
    });
    expect(
      resolveAiRuntime({
        ...defaultAiConfig,
        provider: "cloud",
        cloud,
        selection: {
          mode: "custom",
          custom: { kind: "cloud", providerId: "x", model: "", credentialId: "" },
        },
      }),
    ).toEqual({
      provider: "cloud",
      vendor: "anthropic",
      baseUrl: cloud.baseUrl,
      model: cloud.model,
      credentialId: cloud.credentialId,
    });
  });

  it("returns the cloud settings when AI is switched off", () => {
    expect(resolveAiRuntime({ ...defaultAiConfig, provider: "off", cloud })).toEqual({
      provider: "cloud",
      vendor: "anthropic",
      baseUrl: cloud.baseUrl,
      model: cloud.model,
      credentialId: cloud.credentialId,
    });
  });
});
