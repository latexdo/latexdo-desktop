// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  local: vi.fn(),
  ollama: vi.fn(),
  detect: vi.fn(),
  download: vi.fn(),
  exists: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  manifests: vi.fn(),
  find: vi.fn(),
  inspect: vi.fn(),
  import: vi.fn(),
  credentials: {
    set: vi.fn(),
    get: vi.fn(),
    has: vi.fn(),
    delete: vi.fn(),
    supported: vi.fn(),
  },
  speech: vi.fn(),
  install: vi.fn(),
  dialog: vi.fn(),
  window: vi.fn(),
  system: {
    totalRamBytes: 64 * 1024 ** 3,
    freeRamBytes: 60 * 1024 ** 3,
    totalStorageBytes: 1024 ** 4,
    freeStorageBytes: 1024 ** 4,
    localAiAvailable: true,
  },
}));
vi.mock("../trustedIpc.js", () => ({
  ipcMain: {
    handle: (name: string, fn: (...args: any[]) => any) => mocks.handlers.set(name, fn),
  },
}));
vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: mocks.window },
  dialog: { showOpenDialog: mocks.dialog },
}));
vi.mock("./localLlm.js", () => ({
  generateLocalStep: mocks.local,
  unloadLocalModel: async () => undefined,
}));
vi.mock("./ollama.js", () => ({
  generateOllamaStep: mocks.ollama,
  detectOllama: mocks.detect,
}));
vi.mock("./models.js", () => ({
  deleteModelFile: mocks.remove,
  downloadModelFile: mocks.download,
  listModelFiles: mocks.list,
  modelExists: mocks.exists,
  modelPath: (name: string) => `/test-unavailable-models/${name}`,
}));
vi.mock("./importedModels.js", () => ({
  evaluateImportedModelCompatibility: vi.fn(),
  findImportedModelManifest: mocks.find,
  importGgufModel: mocks.import,
  inspectInstalledGgufModel: mocks.inspect,
  readImportedModelManifests: mocks.manifests,
}));
vi.mock("./systemCapabilities.js", () => ({
  getAiSystemCapabilities: () => mocks.system,
}));
vi.mock("./secretStorage.js", () => ({
  deleteCredential: mocks.credentials.delete,
  getCredential: mocks.credentials.get,
  hasCredential: mocks.credentials.has,
  isCredentialStorageAvailable: mocks.credentials.supported,
  setCredential: mocks.credentials.set,
}));
vi.mock("../voiceStt.js", () => ({ ensureBundledSpeechServer: mocks.speech }));
vi.mock("../speechRuntime.js", () => ({ installSpeechRuntime: mocks.install }));
import { registerAiIpc } from "./aiIpc.js";
import { latexDoAiTiers } from "./productTiers.js";
const sender = { isDestroyed: vi.fn(() => false), send: vi.fn() };
function call(name: string, ...args: unknown[]) {
  return mocks.handlers.get(name)!({ sender }, ...args);
}
const request = (
  provider = "local",
  options: Record<string, unknown> = { fileName: "custom.gguf" },
) => ({
  requestId: "request-1",
  provider,
  messages: [{ role: "user", content: "Hi" }],
  tools: [],
  options,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.handlers.clear();
  registerAiIpc();
  mocks.system.totalRamBytes = 64 * 1024 ** 3;
  mocks.system.freeRamBytes = 60 * 1024 ** 3;
  mocks.system.freeStorageBytes = 1024 ** 4;
  mocks.system.localAiAvailable = true;
  mocks.exists.mockResolvedValue(false);
  mocks.find.mockResolvedValue(null);
  mocks.manifests.mockResolvedValue([]);
  sender.isDestroyed.mockReturnValue(false);
});
describe("AI IPC generation and credentials", () => {
  it("streams local tokens, forwards model options and clears finished cancellation requests", async () => {
    let signal: AbortSignal | undefined;
    mocks.local.mockImplementation(async (messages, options, onToken, s) => {
      expect(messages).toEqual(request().messages);
      expect(options).toMatchObject({
        fileName: "custom.gguf",
        temperature: 0.2,
        maxTokens: 50,
      });
      signal = s;
      onToken("Hello");
      return { type: "text", content: "Hello" };
    });
    expect(
      await call(
        "ai:generate-step",
        request("local", { fileName: "custom.gguf", temperature: 0.2, maxTokens: 50 }),
      ),
    ).toEqual({ type: "text", content: "Hello" });
    expect(sender.send).toHaveBeenCalledWith("ai:token", {
      requestId: "request-1",
      text: "Hello",
    });
    await call("ai:abort", "request-1");
    expect(signal?.aborted).toBe(false);
  });
  it("aborts an in-flight Ollama request and honors its defaults", async () => {
    let ready!: () => void;
    const started = new Promise<void>((r) => (ready = r));
    mocks.ollama.mockImplementation(
      async (url, model, _messages, _tools, onToken, signal) => {
        expect(url).toBe("http://127.0.0.1:11434");
        expect(model).toBe("qwen2.5-coder:3b");
        sender.isDestroyed.mockReturnValue(true);
        onToken("ignored");
        ready();
        await new Promise<void>((r) =>
          signal.addEventListener("abort", () => r(), { once: true }),
        );
        return { type: "error", content: "aborted" };
      },
    );
    const pending = call("ai:generate-step", request("ollama", {}));
    await started;
    await call("ai:abort", "request-1");
    expect(await pending).toMatchObject({ content: "aborted" });
    expect(sender.send).not.toHaveBeenCalled();
  });
  it("rejects missing models and renderer-owned cloud generation", async () => {
    expect(await call("ai:generate-step", request("local", {}))).toMatchObject({
      type: "error",
      content: expect.stringContaining("No local model"),
    });
    expect(await call("ai:generate-step", request("cloud"))).toMatchObject({
      type: "error",
      content: expect.stringContaining("renderer"),
    });
    expect(mocks.local).not.toHaveBeenCalled();
  });
  it.each([
    { state: "unsupported", reason: "Unsupported architecture" },
    { state: "unsupported" },
    {
      state: "memory-pressure",
      estimatedRamBytes: 8 * 1024 ** 3,
      availableRamBytes: 1,
    },
    { state: "memory-pressure" },
  ])(
    "blocks imported-model generation with compatibility %j",
    async (compatibility) => {
      mocks.find.mockResolvedValue({ compatibility });
      expect(await call("ai:generate-step", request())).toMatchObject({
        type: "error",
        content: expect.any(String),
      });
      expect(mocks.local).not.toHaveBeenCalled();
    },
  );
  it.each([
    "ai:credential-get",
    "ai:credential-has",
    "ai:credential-delete",
    "ai:credential-set",
  ])("validates credential identifiers on %s", async (channel) => {
    for (const id of [null, "", "../key", "with spaces", "x".repeat(129)])
      await expect(call(channel, id, "secret")).rejects.toThrow("identifier");
  });
  it("stores and retrieves credentials only through the secure backend", async () => {
    mocks.credentials.supported.mockReturnValue(true);
    mocks.credentials.get.mockResolvedValue("secret");
    mocks.credentials.has.mockResolvedValue(true);
    expect(await call("ai:credentials-supported")).toBe(true);
    expect(await call("ai:credential-set", "provider-1", "secret")).toEqual({
      ok: true,
    });
    expect(mocks.credentials.set).toHaveBeenCalledWith("provider-1", "secret");
    expect(await call("ai:credential-get", "provider-1")).toBe("secret");
    expect(await call("ai:credential-has", "provider-1")).toBe(true);
    expect(await call("ai:credential-delete", "provider-1")).toEqual({ ok: true });
    expect(mocks.credentials.delete).toHaveBeenCalledWith("provider-1");
    await expect(call("ai:credential-set", "provider", {})).rejects.toThrow("payload");
  });
});
describe("catalog downloads and local model management", () => {
  const tier = latexDoAiTiers[0];
  it.each([null, {}, "", "unknown"])(
    "rejects untrusted catalog selection %j",
    async (value) => {
      expect(await call("ai:download-model", value)).toMatchObject({ ok: false });
      expect(mocks.download).not.toHaveBeenCalled();
    },
  );
  it("pins downloaded bytes to catalog integrity metadata and reports progress", async () => {
    mocks.download.mockImplementation(async (_url, _name, options) => {
      options.onProgress(10, 100);
      options.onStage("verifying");
    });
    expect(await call("ai:download-model", ` ${tier.id} `)).toEqual({ ok: true });
    expect(mocks.download).toHaveBeenCalledWith(
      tier.runtime.downloadUrl,
      tier.runtime.fileName,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      {
        sizeRangeBytes: tier.runtime.expectedSizeRangeBytes,
        expectedSha256: tier.runtime.expectedSha256,
      },
    );
    expect(sender.send).toHaveBeenCalledWith(
      "ai:download-progress",
      expect.objectContaining({ receivedBytes: 10, totalBytes: 100, done: false }),
    );
    expect(sender.send).toHaveBeenLastCalledWith(
      "ai:download-progress",
      expect.objectContaining({ done: true }),
    );
  });
  it("reuses an installed model and reports download errors without leaving a lock", async () => {
    mocks.exists.mockResolvedValueOnce(true);
    expect(await call("ai:download-model", tier.id)).toEqual({ ok: true });
    expect(mocks.download).not.toHaveBeenCalled();
    mocks.download.mockRejectedValueOnce(new Error("checksum mismatch"));
    expect(await call("ai:download-model", tier.id)).toEqual({
      ok: false,
      error: "checksum mismatch",
    });
    expect(await call("ai:download-model", tier.id)).toEqual({ ok: true });
  });
  it("rejects concurrent downloads and cancels the active request", async () => {
    let ready!: () => void;
    const started = new Promise<void>((r) => (ready = r));
    mocks.download.mockImplementation(async (_url, _name, options) => {
      ready();
      await new Promise<void>((_r, reject) =>
        options.signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        }),
      );
    });
    const first = call("ai:download-model", tier.id);
    await started;
    expect(await call("ai:download-model", tier.id)).toMatchObject({
      ok: false,
      error: expect.stringContaining("already"),
    });
    await call("ai:cancel-download", tier.id);
    expect(await first).toEqual({ ok: false, error: "cancelled" });
  });
  it.each(["ram", "free", "storage", "runtime"])(
    "blocks unavailable tiers due to %s",
    async (reason) => {
      if (reason === "ram") mocks.system.totalRamBytes = 1;
      if (reason === "free") mocks.system.freeRamBytes = 1;
      if (reason === "storage") mocks.system.freeStorageBytes = 1;
      if (reason === "runtime") mocks.system.localAiAvailable = false;
      expect(await call("ai:download-model", tier.id)).toMatchObject({
        ok: false,
        error: expect.any(String),
      });
      expect(mocks.download).not.toHaveBeenCalled();
      expect(await call("ai:tier-availability", tier.id)).not.toEqual({
        state: "available",
      });
      if (reason !== "storage")
        expect(
          await call(
            "ai:generate-step",
            request("local", {
              fileName: tier.runtime.fileName,
              modelId: tier.runtime.modelId,
            }),
          ),
        ).toMatchObject({ type: "error" });
    },
  );
  it("lists manifests and resolves, inspects and deletes local models", async () => {
    mocks.list.mockResolvedValue([
      { fileName: "a.gguf", path: "/models/a.gguf", sizeBytes: 123 },
    ]);
    mocks.manifests.mockResolvedValue([{ fileName: "a.gguf", modelName: "A" }]);
    expect(await call("ai:list-models")).toEqual([
      expect.objectContaining({
        id: "a.gguf",
        downloaded: true,
        manifest: { fileName: "a.gguf", modelName: "A" },
      }),
    ]);
    expect(await call("ai:model-path", "a.gguf")).toBeNull();
    mocks.exists.mockResolvedValueOnce(true);
    expect(await call("ai:model-path", "a.gguf")).toBe(
      "/test-unavailable-models/a.gguf",
    );
    await call("ai:delete-model", "a.gguf");
    expect(mocks.remove).toHaveBeenCalledWith("a.gguf");
    mocks.inspect.mockResolvedValue({ name: "A" });
    expect(await call("ai:inspect-local-model", "a.gguf")).toEqual({ name: "A" });
    expect(await call("ai:tier-availability", "unknown")).toMatchObject({
      state: "unsupported",
    });
    expect(await call("ai:system-capabilities")).toEqual(mocks.system);
  });
  it("imports the selected file and handles both dialog cancellation forms", async () => {
    mocks.dialog
      .mockResolvedValueOnce({ canceled: true, filePaths: [] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ["/selected.gguf"] });
    expect(await call("ai:import-model")).toBeNull();
    expect(await call("ai:import-model")).toBeNull();
    mocks.window.mockReturnValue({ id: 1 });
    mocks.import.mockResolvedValue({ fileName: "selected.gguf" });
    expect(await call("ai:import-model")).toEqual({ fileName: "selected.gguf" });
    expect(mocks.import).toHaveBeenCalledWith("/selected.gguf");
  });
});
describe("speech service IPC", () => {
  it.each([
    null,
    [],
    { baseUrl: 42, model: false },
    { baseUrl: "http://127.0.0.1:9000", model: "tiny" },
  ])("sanitizes speech options %j", async (options) => {
    mocks.speech.mockResolvedValue({ ok: true });
    expect(await call("ai:ensure-speech-server", options)).toEqual({ ok: true });
    expect(mocks.speech).toHaveBeenCalledWith(
      options && !Array.isArray(options) && typeof options.baseUrl === "string"
        ? options
        : { baseUrl: undefined, model: undefined },
    );
  });
  it("reports installation progress and releases the lock after success or failure", async () => {
    mocks.install.mockImplementationOnce(async (options) => {
      expect(await call("ai:install-speech-runtime")).toMatchObject({ ok: false });
      options.onProgress({ stage: "downloading", receivedBytes: 10 });
    });
    expect(await call("ai:install-speech-runtime")).toEqual({ ok: true });
    expect(sender.send).toHaveBeenCalledWith("ai:speech-install-progress", {
      stage: "downloading",
      receivedBytes: 10,
    });
    mocks.install.mockRejectedValueOnce("offline");
    expect(await call("ai:install-speech-runtime")).toEqual({
      ok: false,
      error: "offline",
    });
    expect(sender.send).toHaveBeenLastCalledWith(
      "ai:speech-install-progress",
      expect.objectContaining({ done: true, error: "offline" }),
    );
    mocks.detect.mockResolvedValue({ models: [] });
    expect(await call("ai:detect-ollama", "http://localhost:11434")).toEqual({
      models: [],
    });
    expect(mocks.detect).toHaveBeenCalledWith("http://localhost:11434");
  });
});
