import { describe, expect, it, vi } from "vitest";
import { defaultAiConfig, type AiConfig } from "../../ai/aiConfig";
import { findLocalModel } from "../../ai/aiModels";
import type { GenerateRequest, GenerationStep } from "../../ai/aiTypes";
import {
  GenerateStepNextEditModelClient,
  nextEditModelAvailable,
} from "./nextEditModelClient";
import { defaultNextEditConfig } from "./nextEditTypes";

vi.mock("../../ai/aiClient", () => ({
  generateStep: vi.fn(),
  abortGeneration: vi.fn(),
}));

const localReady: AiConfig = {
  ...defaultAiConfig,
  provider: "local",
  modelDownloaded: true,
};
const messages = [{ role: "user" as const, content: "predict" }];

function client(
  config: AiConfig,
  generate: (r: GenerateRequest) => Promise<GenerationStep>,
  abort = vi.fn(async () => {}),
  useInlineModel = true,
) {
  return {
    abort,
    generate: vi.fn(generate),
    get instance() {
      return new GenerateStepNextEditModelClient(
        config,
        { ...defaultNextEditConfig, useInlineModel },
        true,
        this.generate,
        abort,
      );
    },
  };
}

describe("nextEditModelAvailable", () => {
  it("requires an enabled provider with editor access", () => {
    expect(nextEditModelAvailable({ ...localReady, provider: "off" }, true)).toBe(
      false,
    );
    expect(
      nextEditModelAvailable(
        { ...localReady, access: { ...localReady.access, currentEditor: false } },
        true,
      ),
    ).toBe(false);
  });

  it("checks cloud credentials, desktop runtime, local download and ollama model", () => {
    const cloud = { ...localReady, provider: "cloud" as const };
    expect(
      nextEditModelAvailable(
        { ...cloud, cloud: { ...cloud.cloud, credentialConfigured: true } },
        false,
      ),
    ).toBe(true);
    expect(
      nextEditModelAvailable(
        { ...cloud, cloud: { ...cloud.cloud, credentialConfigured: false } },
        true,
      ),
    ).toBe(false);
    expect(nextEditModelAvailable(localReady, false)).toBe(false);
    expect(nextEditModelAvailable(localReady, true)).toBe(true);
    expect(
      nextEditModelAvailable({ ...localReady, modelDownloaded: false }, true),
    ).toBe(false);
    const ollama = { ...localReady, provider: "ollama" as const };
    expect(nextEditModelAvailable(ollama, true)).toBe(true);
    expect(nextEditModelAvailable({ ...ollama, ollamaModel: "  " }, true)).toBe(false);
  });
});

describe("GenerateStepNextEditModelClient", () => {
  it("builds a deterministic low-effort request with the inline model", async () => {
    const c = client(localReady, async () => ({ type: "text", content: "next" }));
    const result = await c.instance.complete(
      { requestId: "r1", messages },
      new AbortController().signal,
    );
    expect(result).toBe("next");
    const request = c.generate.mock.calls[0][0];
    expect(request).toMatchObject({
      requestId: "r1",
      provider: "local",
      messages,
      tools: [],
      options: {
        modelId: localReady.inlineModelId,
        temperature: 0,
        effort: "low",
        maxTokens: 260,
        ollamaModel: localReady.ollamaModel,
      },
    });
    const expectedFile =
      findLocalModel(localReady.inlineModelId)?.fileName ??
      findLocalModel(localReady.modelId)?.fileName;
    expect(request.options.fileName).toBe(expectedFile);
  });

  it("uses the chat model and maps providers", async () => {
    const ollama = client(
      { ...localReady, provider: "ollama" },
      async () => ({ type: "text", content: "x" }),
      undefined,
      false,
    );
    await ollama.instance.complete(
      { requestId: "r", messages },
      new AbortController().signal,
    );
    expect(ollama.generate.mock.calls[0][0]).toMatchObject({
      provider: "ollama",
      options: { modelId: localReady.modelId },
    });

    const unknownModel = client(
      {
        ...localReady,
        provider: "cloud",
        modelId: "missing",
        inlineModelId: "missing",
        cloud: { ...localReady.cloud, credentialConfigured: true },
      },
      async () => ({ type: "text", content: "x" }),
    );
    await unknownModel.instance.complete(
      { requestId: "r", messages },
      new AbortController().signal,
    );
    expect(unknownModel.generate.mock.calls[0][0]).toMatchObject({ provider: "cloud" });
    expect(unknownModel.generate.mock.calls[0][0].options.fileName).toBeUndefined();
  });

  it("returns null when unavailable or already aborted", async () => {
    const off = client({ ...localReady, provider: "off" }, async () => ({
      type: "text",
      content: "x",
    }));
    expect(
      await off.instance.complete(
        { requestId: "r", messages },
        new AbortController().signal,
      ),
    ).toBeNull();
    const controller = new AbortController();
    controller.abort();
    const ready = client(localReady, async () => ({ type: "text", content: "x" }));
    expect(
      await ready.instance.complete({ requestId: "r", messages }, controller.signal),
    ).toBeNull();
    expect(off.generate).not.toHaveBeenCalled();
    expect(ready.generate).not.toHaveBeenCalled();
  });

  it("aborts the generation when the signal fires mid-request", async () => {
    const controller = new AbortController();
    const c = client(localReady, async () => {
      controller.abort();
      return { type: "text", content: "late" };
    });
    expect(
      await c.instance.complete({ requestId: "r9", messages }, controller.signal),
    ).toBeNull();
    expect(c.abort).toHaveBeenCalledWith("r9");
  });

  it("returns null for error steps and thrown errors, then stops listening", async () => {
    const errorStep = client(
      localReady,
      async () => ({ type: "error", content: "", error: "boom" }) as GenerationStep,
    );
    expect(
      await errorStep.instance.complete(
        { requestId: "r", messages },
        new AbortController().signal,
      ),
    ).toBeNull();

    const controller = new AbortController();
    const thrown = client(localReady, async () => {
      throw new Error("network");
    });
    expect(
      await thrown.instance.complete({ requestId: "r", messages }, controller.signal),
    ).toBeNull();
    controller.abort();
    expect(thrown.abort).not.toHaveBeenCalled();
  });

  it("defaults to the shared AI client", async () => {
    const { generateStep } = await import("../../ai/aiClient");
    vi.mocked(generateStep).mockResolvedValue({ type: "text", content: "shared" });
    const instance = new GenerateStepNextEditModelClient(
      localReady,
      defaultNextEditConfig,
      true,
    );
    expect(
      await instance.complete(
        { requestId: "r", messages },
        new AbortController().signal,
      ),
    ).toBe("shared");
  });
});
