import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  abortCloudGeneration: vi.fn(() => false),
  generateStepCloud: vi.fn(async () => ({ type: "final", content: "cloud" })),
  loadCloudCredential: vi.fn(async (): Promise<string | null> => "vault-key"),
}));

vi.mock("./aiCloud", () => ({
  abortCloudGeneration: mocks.abortCloudGeneration,
  generateStepCloud: mocks.generateStepCloud,
}));
vi.mock("./cloudCredentials", () => ({ loadCloudCredential: mocks.loadCloudCredential }));

import * as client from "./aiClient";
import type { AiBridge } from "./aiClient";
import type { GenerateRequest } from "./aiTypes";

function setBridge(bridge: Partial<AiBridge> | undefined) {
  (globalThis as { aiApi?: unknown }).aiApi = bridge;
}

function request(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    requestId: "r1",
    provider: "local",
    messages: [],
    tools: [],
    options: {},
    ...overrides,
  };
}

afterEach(() => {
  setBridge(undefined);
  vi.clearAllMocks();
});

describe("generateStep (cloud)", () => {
  it("uses an inline API key without touching the vault", async () => {
    const onToken = vi.fn();
    const result = await client.generateStep(
      request({ provider: "cloud", options: { cloudApiKey: "inline", cloudCredentialId: "id" } }),
      onToken,
    );
    expect(result).toEqual({ type: "final", content: "cloud" });
    expect(mocks.loadCloudCredential).not.toHaveBeenCalled();
    expect(mocks.generateStepCloud).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ cloudApiKey: "inline" }) }),
      onToken,
      expect.any(Function),
    );
  });

  it("resolves the key from the credential vault", async () => {
    await client.generateStep(
      request({ provider: "cloud", options: { cloudCredentialId: "cred" } }),
      vi.fn(),
    );
    expect(mocks.loadCloudCredential).toHaveBeenCalledWith("cred");
    expect(mocks.generateStepCloud.mock.calls[0][0].options.cloudApiKey).toBe("vault-key");
  });

  it("reports a missing key when the vault has none or no key is configured", async () => {
    mocks.loadCloudCredential.mockResolvedValueOnce(null);
    const missing = await client.generateStep(
      request({ provider: "cloud", options: { cloudCredentialId: "cred" } }),
      vi.fn(),
    );
    expect(missing.type).toBe("error");
    expect(missing.content).toContain("API key is not available");
    const none = await client.generateStep(request({ provider: "cloud" }), vi.fn());
    expect(none.type).toBe("error");
    expect(mocks.generateStepCloud).not.toHaveBeenCalled();
  });
});

describe("generateStep (desktop)", () => {
  it("explains that local models need the desktop app", async () => {
    const result = await client.generateStep(request(), vi.fn());
    expect(result.type).toBe("error");
    expect(result.content).toContain("desktop app");
    expect(client.isLocalRuntimeAvailable()).toBe(false);
  });

  it("streams only this request's tokens and activity, then unsubscribes", async () => {
    const unsubscribe = vi.fn();
    let listener!: Parameters<AiBridge["subscribeTokens"]>[0];
    setBridge({
      subscribeTokens: (cb) => {
        listener = cb;
        return unsubscribe;
      },
      generateStep: vi.fn(async () => {
        listener({ requestId: "other", text: "ignored" });
        listener({ requestId: "r1", text: "hi" });
        listener({ requestId: "r1", text: "", activity: { kind: "tool" } as never });
        return { type: "final", content: "done" } as never;
      }),
    });
    expect(client.isLocalRuntimeAvailable()).toBe(true);
    const onToken = vi.fn();
    const onActivity = vi.fn();
    const result = await client.generateStep(request(), onToken, onActivity);
    expect(result).toEqual({ type: "final", content: "done" });
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith("hi");
    expect(onActivity).toHaveBeenCalledWith({ kind: "tool" });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes even when generation throws, and ignores activity by default", async () => {
    const unsubscribe = vi.fn();
    let listener!: Parameters<AiBridge["subscribeTokens"]>[0];
    setBridge({
      subscribeTokens: (cb) => {
        listener = cb;
        return unsubscribe;
      },
      generateStep: vi.fn(async () => {
        listener({ requestId: "r1", text: "", activity: { kind: "x" } as never });
        throw new Error("boom");
      }),
    });
    await expect(client.generateStep(request(), vi.fn())).rejects.toThrow("boom");
    expect(unsubscribe).toHaveBeenCalled();
  });
});

describe("abortGeneration", () => {
  it("stops a cloud request locally, otherwise asks the bridge", async () => {
    const abort = vi.fn(async () => {});
    setBridge({ abort });
    mocks.abortCloudGeneration.mockReturnValueOnce(true);
    await client.abortGeneration("a");
    expect(abort).not.toHaveBeenCalled();
    await client.abortGeneration("b");
    expect(abort).toHaveBeenCalledWith("b");
    setBridge(undefined);
    await expect(client.abortGeneration("c")).resolves.toBeUndefined();
  });
});

describe("browser fallbacks", () => {
  it("returns safe defaults without a desktop bridge", async () => {
    expect(await client.listModels()).toEqual([]);
    expect(await client.downloadModel("t")).toEqual({
      ok: false,
      error: "Model download requires the desktop app.",
    });
    expect(client.subscribeDownload(vi.fn())()).toBeUndefined();
    expect((await client.installSpeechRuntime()).ok).toBe(false);
    expect(client.subscribeSpeechInstall(vi.fn())()).toBeUndefined();
    expect(await client.getSpeechRuntimeStatus()).toBeNull();
    expect(await client.getTexRuntimeStatus()).toBeNull();
    expect(await client.installTexRuntime()).toEqual({
      ok: false,
      error: "PDF builder install requires the desktop app.",
    });
    expect(client.subscribeTexInstall(vi.fn())()).toBeUndefined();
    expect(await client.detectOllama("http://x")).toEqual({ available: false, models: [] });
    expect(await client.getSystemCapabilities()).toBeNull();
    expect((await client.getTierAvailability("fast" as never)).state).toBe("unsupported");
    expect(await client.importModel()).toBeNull();
    expect(await client.inspectLocalModel("m.gguf")).toBeNull();
  });

  it("treats a bridge missing optional methods like the browser", async () => {
    setBridge({});
    expect((await client.installSpeechRuntime()).ok).toBe(false);
    expect((await client.installTexRuntime()).ok).toBe(false);
    expect(await client.getSpeechRuntimeStatus()).toBeNull();
    expect(client.subscribeTexInstall(vi.fn())).toBeTypeOf("function");
    expect(client.subscribeSpeechInstall(vi.fn())).toBeTypeOf("function");
    expect(await client.importModel()).toBeNull();
  });
});

describe("desktop bridge delegation", () => {
  it("forwards every call to the bridge", async () => {
    const unsub = () => {};
    const status = { state: "ready" } as never;
    const bridge: Partial<AiBridge> = {
      listModels: vi.fn(async () => [{ fileName: "m" }] as never),
      downloadModel: vi.fn(async () => ({ ok: true })),
      subscribeDownload: vi.fn(() => unsub),
      installSpeechRuntime: vi.fn(async () => ({ ok: true })),
      subscribeSpeechInstall: vi.fn(() => unsub),
      getSpeechRuntimeStatus: vi.fn(async () => status),
      getTexRuntimeStatus: vi.fn(async () => status),
      installTexRuntime: vi.fn(async () => ({ ok: true })),
      subscribeTexInstall: vi.fn(() => unsub),
      detectOllama: vi.fn(async () => ({ available: true, models: ["llama"] })),
      getSystemCapabilities: vi.fn(async () => ({ cpuCount: 4 }) as never),
      getTierAvailability: vi.fn(async () => ({ state: "available" }) as never),
      importModel: vi.fn(async () => ({ fileName: "i" }) as never),
      inspectLocalModel: vi.fn(async () => ({ fileName: "j" }) as never),
    };
    setBridge(bridge);
    expect(await client.listModels()).toEqual([{ fileName: "m" }]);
    expect(await client.downloadModel("tier")).toEqual({ ok: true });
    expect(bridge.downloadModel).toHaveBeenCalledWith("tier");
    expect(client.subscribeDownload(vi.fn())).toBe(unsub);
    expect(await client.installSpeechRuntime()).toEqual({ ok: true });
    expect(client.subscribeSpeechInstall(vi.fn())).toBe(unsub);
    expect(await client.getSpeechRuntimeStatus()).toBe(status);
    expect(await client.getTexRuntimeStatus()).toBe(status);
    expect(await client.installTexRuntime()).toEqual({ ok: true });
    expect(client.subscribeTexInstall(vi.fn())).toBe(unsub);
    expect(await client.detectOllama("http://o")).toEqual({ available: true, models: ["llama"] });
    expect(bridge.detectOllama).toHaveBeenCalledWith("http://o");
    expect(await client.getSystemCapabilities()).toEqual({ cpuCount: 4 });
    expect(await client.getTierAvailability("t" as never)).toEqual({ state: "available" });
    expect(await client.importModel()).toEqual({ fileName: "i" });
    expect(await client.inspectLocalModel("j")).toEqual({ fileName: "j" });
    expect(bridge.inspectLocalModel).toHaveBeenCalledWith("j");
  });
});
