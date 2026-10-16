import { describe, expect, it } from "vitest";
import { defaultAiConfig, normalizeAiConfig } from "./aiConfig";

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

  it("does not honor saved autonomous edit mode", () => {
    expect(normalizeAiConfig({ autoApproveEdits: true }).autoApproveEdits).toBe(false);
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
