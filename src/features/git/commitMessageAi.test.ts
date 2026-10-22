import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAiConfig, type AiConfig } from "../ai/aiConfig";
import {
  cleanCommitMessage,
  commitMessagePrompt,
  generateCommitMessage,
  sendsDiffOnline,
} from "./commitMessageAi";

const mocks = vi.hoisted(() => ({
  generateStep: vi.fn(),
  resolveAiRuntime: vi.fn(),
}));
vi.mock("../ai/aiClient", () => ({ generateStep: mocks.generateStep }));
vi.mock("../ai/product/aiRuntimeResolver", () => ({
  resolveAiRuntime: mocks.resolveAiRuntime,
}));

describe("commit message suggestions", () => {
  it("keeps only the message from a model reply", () => {
    expect(cleanCommitMessage('```\nCommit message: "Fix the intro."\n```')).toBe(
      "Fix the intro",
    );
    expect(cleanCommitMessage("Add results table\n\nExplains the new numbers.")).toBe(
      "Add results table\n\nExplains the new numbers.",
    );
  });

  it("cuts very large diffs", () => {
    const prompt = commitMessagePrompt("x".repeat(20_000));
    expect(prompt.length).toBeLessThan(13_000);
    expect(prompt).toContain("diff truncated");
  });
});

describe("generateCommitMessage", () => {
  const config: AiConfig = {
    ...defaultAiConfig,
    modelId: "config-model",
    ollamaBaseUrl: "http://config-ollama",
    ollamaModel: "config-llama",
    cloud: {
      ...defaultAiConfig.cloud,
      vendor: "anthropic",
      baseUrl: "https://config-cloud",
      model: "config-cloud-model",
      credentialId: "config-cred",
    },
  };

  beforeEach(() => {
    mocks.generateStep.mockReset();
    mocks.resolveAiRuntime.mockReset();
  });

  it("only treats the cloud provider as sending the diff online", () => {
    expect(sendsDiffOnline({ ...config, provider: "cloud" })).toBe(true);
    expect(sendsDiffOnline({ ...config, provider: "local" })).toBe(false);
    expect(sendsDiffOnline({ ...config, provider: "ollama" })).toBe(false);
  });

  it("asks a local model and cleans its reply", async () => {
    mocks.resolveAiRuntime.mockReturnValue({
      provider: "local",
      modelId: "tier-model",
      fileName: "tier.gguf",
    });
    mocks.generateStep.mockResolvedValue({ type: "text", content: '"Fix intro."' });
    await expect(generateCommitMessage(config, "diff --git")).resolves.toBe(
      "Fix intro",
    );
    const [request, onToken] = mocks.generateStep.mock.calls[0];
    expect(request.requestId).toMatch(/^commit_/);
    expect(request.provider).toBe("local");
    expect(request.messages[1].content).toContain("diff --git");
    expect(request.options).toMatchObject({
      modelId: "tier-model",
      fileName: "tier.gguf",
      ollamaBaseUrl: "http://config-ollama",
      ollamaModel: "config-llama",
      cloudVendor: "anthropic",
      cloudBaseUrl: "https://config-cloud",
      cloudModel: "config-cloud-model",
      cloudCredentialId: "config-cred",
      maxTokens: 256,
    });
    expect(onToken()).toBeUndefined();
  });

  it("uses the resolved Ollama endpoint", async () => {
    mocks.resolveAiRuntime.mockReturnValue({
      provider: "ollama",
      baseUrl: "http://runtime-ollama",
      model: "runtime-llama",
    });
    mocks.generateStep.mockResolvedValue({ type: "text", content: "Add table" });
    await generateCommitMessage(config, "d");
    expect(mocks.generateStep.mock.calls[0][0].options).toMatchObject({
      modelId: "config-model",
      fileName: undefined,
      ollamaBaseUrl: "http://runtime-ollama",
      ollamaModel: "runtime-llama",
      cloudBaseUrl: "https://config-cloud",
    });
  });

  it("uses the resolved cloud endpoint and credential", async () => {
    mocks.resolveAiRuntime.mockReturnValue({
      provider: "cloud",
      vendor: "openai",
      baseUrl: "https://runtime-cloud",
      model: "runtime-model",
      credentialId: "runtime-cred",
    });
    mocks.generateStep.mockResolvedValue({ type: "text", content: "Update refs" });
    await generateCommitMessage(config, "d");
    expect(mocks.generateStep.mock.calls[0][0].options).toMatchObject({
      ollamaBaseUrl: "http://config-ollama",
      cloudBaseUrl: "https://runtime-cloud",
      cloudModel: "runtime-model",
      cloudCredentialId: "runtime-cred",
    });
  });

  it("surfaces model errors and empty replies", async () => {
    mocks.resolveAiRuntime.mockReturnValue({ provider: "local", modelId: "m" });
    mocks.generateStep.mockResolvedValueOnce({
      type: "error",
      content: "model offline",
    });
    await expect(generateCommitMessage(config, "d")).rejects.toThrow("model offline");
    mocks.generateStep.mockResolvedValueOnce({ type: "text", content: "  ``  " });
    await expect(generateCommitMessage(config, "d")).rejects.toThrow(
      "The assistant did not suggest a message.",
    );
  });
});
