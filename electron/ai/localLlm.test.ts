// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const llama = vi.hoisted(() => {
  const state = {
    wrapperName: "Qwen3ChatWrapper" as string | undefined,
    generate: vi.fn(),
    chats: [] as Array<{ dispose: ReturnType<typeof vi.fn> }>,
    createContext: vi.fn(),
    contextDispose: vi.fn(async () => {}),
    modelDispose: vi.fn(async () => {}),
    loadModel: vi.fn(),
    getLlama: vi.fn(),
  };
  class LlamaChat {
    chatWrapper = state.wrapperName === undefined ? undefined : { wrapperName: state.wrapperName };
    dispose = vi.fn();
    constructor() {
      state.chats.push(this);
    }
    generateResponse(...args: unknown[]) {
      return state.generate(...args);
    }
  }
  return { state, LlamaChat };
});

vi.mock("node-llama-cpp", () => ({
  getLlama: llama.state.getLlama,
  LlamaChat: llama.LlamaChat,
}));
vi.mock("./models.js", () => ({ modelPath: (file: string) => `/models/${file}` }));

type LocalLlm = typeof import("./localLlm.js");
let mod: LocalLlm;

function resetEngine() {
  const { state } = llama;
  state.wrapperName = "Qwen3ChatWrapper";
  state.chats = [];
  state.generate.mockReset();
  state.createContext.mockReset().mockResolvedValue({
    getSequence: vi.fn(() => ({})),
    dispose: state.contextDispose,
  });
  state.contextDispose.mockReset().mockResolvedValue(undefined);
  state.modelDispose.mockReset().mockResolvedValue(undefined);
  state.loadModel.mockReset().mockResolvedValue({
    createContext: state.createContext,
    dispose: state.modelDispose,
  });
  state.getLlama.mockReset().mockResolvedValue({ loadModel: state.loadModel });
}

beforeEach(async () => {
  resetEngine();
  vi.resetModules();
  mod = await import("./localLlm.js");
});

const user = [{ role: "user" as const, content: "hi" }];

describe("local LLM generation", () => {
  it("loads the model once, streams text and records thinking", async () => {
    llama.state.generate.mockImplementation(async (_history, options) => {
      options.onTextChunk("Hel");
      options.onResponseChunk({ type: "segment", segmentType: "thought" });
      options.onResponseChunk({ type: "segment", segmentType: "thought" });
      options.onResponseChunk({ type: "text" });
      return {
        response: "  Hello  ",
        fullResponse: ["Hello", "  ", { type: "segment" }],
        metadata: { stopReason: "maxTokens" },
      };
    });
    const tokens: string[] = [];
    const activity = vi.fn();
    const step = await mod.generateLocalStep(
      user,
      { fileName: "m.gguf" },
      (t) => tokens.push(t),
      undefined,
      [],
      activity,
    );
    expect(step).toEqual({
      type: "text",
      content: "Hello",
      truncated: true,
      providerContent: { kind: "llama", response: ["Hello", { type: "segment" }], rawCalls: [] },
    });
    expect(tokens).toEqual(["Hel"]);
    expect(activity).toHaveBeenCalledTimes(1);
    expect(llama.state.loadModel).toHaveBeenCalledWith({ modelPath: "/models/m.gguf" });
    const options = llama.state.generate.mock.calls[0][1];
    // Agent lane, medium effort, qwen thinking sampling.
    expect(options).toMatchObject({
      temperature: 0.6,
      topP: 0.95,
      maxTokens: 4096,
      budgets: { thoughtTokens: 512 },
      stopOnAbortSignal: true,
    });
    expect(options.functions).toBeUndefined();

    llama.state.generate.mockResolvedValue({});
    const second = await mod.generateLocalStep(user, { fileName: "m.gguf" }, () => {});
    expect(second).toMatchObject({ type: "text", content: "", truncated: false });
    expect(llama.state.loadModel).toHaveBeenCalledTimes(1);
  });

  it("uses the quick lane with low effort and non-thinking sampling", async () => {
    llama.state.generate.mockResolvedValue({ response: "ok" });
    await mod.generateLocalStep(user, { fileName: "m.gguf", maxTokens: 64 }, () => {});
    const options = llama.state.generate.mock.calls[0][1];
    expect(options).toMatchObject({ temperature: 0.7, topP: 0.8, budgets: { thoughtTokens: 0 } });

    await mod.generateLocalStep(
      user,
      { fileName: "m.gguf", effort: "high", temperature: 0.1 },
      () => {},
    );
    expect(llama.state.generate.mock.calls[1][1]).toMatchObject({
      temperature: 0.1,
      budgets: { thoughtTokens: 1024 },
    });
  });

  it("uses generic sampling for other model families and pads system-only history", async () => {
    llama.state.wrapperName = undefined;
    vi.resetModules();
    mod = await import("./localLlm.js");
    llama.state.generate.mockResolvedValue({ response: "ok" });
    await mod.generateLocalStep(
      [{ role: "system", content: "rules" }],
      { fileName: "m.gguf" },
      () => {},
    );
    const [history, options] = llama.state.generate.mock.calls[0];
    expect(history).toEqual([
      { type: "system", text: "rules" },
      { type: "user", text: " " },
    ]);
    expect(options).toMatchObject({ temperature: 0.5, topK: 40, minP: 0.05 });
  });

  it("returns tool calls with cleaned arguments and grammar functions", async () => {
    llama.state.generate.mockResolvedValue({
      response: "Calling",
      functionCalls: [
        { functionName: "read_file", params: { path: "a.tex", line: null, x: undefined }, raw: "r1" },
        { functionName: "list_files", params: null, raw: "r2" },
      ],
    });
    const step = await mod.generateLocalStep(user, { fileName: "m.gguf" }, () => {}, undefined, [
      {
        name: "read_file",
        description: "Read",
        params: { path: { type: "string", description: "p" } },
        required: ["path"],
      },
    ]);
    expect(step.type).toBe("tool_calls");
    if (step.type !== "tool_calls") return;
    expect(step.toolCalls.map((c) => [c.name, c.args])).toEqual([
      ["read_file", { path: "a.tex" }],
      ["list_files", {}],
    ]);
    expect(step.toolCalls[0].id).toMatch(/^call_/);
    expect(step.providerContent).toMatchObject({ rawCalls: ["r1", "r2"] });
    expect(llama.state.generate.mock.calls[0][1]).toMatchObject({
      documentFunctionParams: true,
      functions: { read_file: { description: "Read" } },
    });
  });

  it("returns empty text when aborted and a friendly error when the runtime is missing", async () => {
    const abortError = Object.assign(new Error("stop"), { name: "AbortError" });
    llama.state.generate.mockRejectedValueOnce(abortError);
    expect(await mod.generateLocalStep(user, { fileName: "m.gguf" }, () => {})).toEqual({
      type: "text",
      content: "",
    });

    const controller = new AbortController();
    controller.abort();
    llama.state.generate.mockRejectedValueOnce(new Error("whatever"));
    expect(
      await mod.generateLocalStep(user, { fileName: "m.gguf" }, () => {}, controller.signal),
    ).toEqual({ type: "text", content: "" });

    // A failed generation does not block the lane for the next one.
    llama.state.generate.mockRejectedValueOnce("plain failure");
    expect(await mod.generateLocalStep(user, { fileName: "m.gguf" }, () => {})).toEqual({
      type: "error",
      content: "Local model error: plain failure",
    });
  });

  it("reports a missing native runtime and retries loading later", async () => {
    llama.state.getLlama.mockRejectedValueOnce(
      new Error("Cannot find module 'node-llama-cpp'"),
    );
    const step = await mod.generateLocalStep(user, { fileName: "m.gguf" }, () => {});
    expect(step.type).toBe("error");
    expect(step.content).toContain("not installed in this build");

    llama.state.generate.mockResolvedValue({ response: "back" });
    expect(await mod.generateLocalStep(user, { fileName: "m.gguf" }, () => {})).toMatchObject({
      content: "back",
    });
    expect(llama.state.getLlama).toHaveBeenCalledTimes(2);
  });

  it("falls back to a smaller context when the large one does not fit", async () => {
    llama.state.createContext
      .mockRejectedValueOnce(new Error("out of memory"))
      .mockResolvedValueOnce({ getSequence: () => ({}), dispose: llama.state.contextDispose });
    llama.state.generate.mockResolvedValue({ response: "ok" });
    await mod.generateLocalStep(user, { fileName: "m.gguf" }, () => {});
    expect(llama.state.createContext.mock.calls[1][0]).toEqual({
      sequences: 2,
      contextSize: { min: 2048, max: 8192 },
    });
  });

  it("disposes the previous engine when switching models and on unload", async () => {
    llama.state.generate.mockResolvedValue({ response: "ok" });
    await mod.generateLocalStep(user, { fileName: "a.gguf" }, () => {});
    const firstChats = [...llama.state.chats];
    firstChats[0].dispose.mockImplementation(() => {
      throw new Error("already gone");
    });
    llama.state.contextDispose.mockRejectedValueOnce(new Error("ctx"));
    llama.state.modelDispose.mockRejectedValueOnce(new Error("model"));
    await mod.generateLocalStep(user, { fileName: "b.gguf" }, () => {});
    expect(firstChats[1].dispose).toHaveBeenCalledWith({ disposeSequence: true });
    expect(llama.state.contextDispose).toHaveBeenCalledTimes(1);
    expect(llama.state.modelDispose).toHaveBeenCalledTimes(1);
    expect(llama.state.loadModel).toHaveBeenLastCalledWith({ modelPath: "/models/b.gguf" });

    await mod.unloadLocalModel();
    expect(llama.state.modelDispose).toHaveBeenCalledTimes(2);
    await mod.unloadLocalModel();
    expect(llama.state.modelDispose).toHaveBeenCalledTimes(2);
  });

  it("recovers after a model fails to load", async () => {
    llama.state.loadModel.mockRejectedValueOnce(new Error("bad gguf"));
    expect(await mod.generateLocalStep(user, { fileName: "a.gguf" }, () => {})).toEqual({
      type: "error",
      content: "Local model error: bad gguf",
    });
    llama.state.generate.mockResolvedValue({ response: "ok" });
    // The failed engine is skipped (not disposed) when the next one loads.
    expect(await mod.generateLocalStep(user, { fileName: "a.gguf" }, () => {})).toMatchObject({
      content: "ok",
    });
    await mod.unloadLocalModel();

    llama.state.loadModel.mockRejectedValueOnce(new Error("bad again"));
    const failing = mod.generateLocalStep(user, { fileName: "c.gguf" }, () => {});
    // Switching while the failed load settles keeps the newer engine.
    const next = mod.generateLocalStep(user, { fileName: "d.gguf" }, () => {});
    expect((await failing).type).toBe("error");
    expect(await next).toMatchObject({ content: "ok" });
    await mod.unloadLocalModel();
  });
});

describe("local LLM unload races", () => {
  it("unloads cleanly while a load is failing and ignores thoughts without a listener", async () => {
    llama.state.loadModel.mockRejectedValueOnce(new Error("bad"));
    const pending = mod.generateLocalStep(user, { fileName: "a.gguf" }, () => {});
    await mod.unloadLocalModel();
    expect((await pending).type).toBe("error");
    expect(llama.state.modelDispose).not.toHaveBeenCalled();

    llama.state.generate.mockImplementation(async (_h, options) => {
      options.onResponseChunk({ type: "segment", segmentType: "thought" });
      return { response: "ok" };
    });
    expect(await mod.generateLocalStep(user, { fileName: "a.gguf" }, () => {})).toMatchObject({
      content: "ok",
    });
  });
});

describe("history mapping edge cases", () => {
  it("labels orphaned tool results and replays raw calls", () => {
    expect(
      mod.toLlamaHistory([
        { role: "tool", content: "out", toolCallId: "missing", name: "read" },
        { role: "tool", content: "anon" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "c1", name: "f", args: {} },
            { id: "c2", name: "g", args: {} },
          ],
          providerContent: { kind: "llama", response: ["thought"], rawCalls: ["raw1"] },
        },
        { role: "assistant", content: "" },
      ]),
    ).toEqual([
      { type: "user", text: "Tool read result:\nout" },
      { type: "user", text: "Tool  result:\nanon" },
      {
        type: "model",
        response: [
          "thought",
          { type: "functionCall", name: "f", params: {}, result: "", rawCall: "raw1" },
          { type: "functionCall", name: "g", params: {}, result: "" },
        ],
      },
    ]);
  });

  it("makes optional enum and typed params nullable", () => {
    expect(
      mod.toLlamaFunctions([
        {
          name: "t",
          description: "d",
          params: {
            mode: { type: "string", description: "m", enum: ["a", "b"] },
            count: { type: "integer", description: "c" },
          },
          required: [],
        },
        { name: "none", description: "n", params: {}, required: [] },
      ]),
    ).toEqual({
      t: {
        description: "d",
        params: {
          type: "object",
          properties: {
            mode: { enum: ["a", "b", null], description: "m" },
            count: { type: ["integer", "null"], description: "c" },
          },
        },
      },
      none: { description: "n", params: undefined },
    });
  });
});
