// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectOllama, generateOllamaStep } from "./ollama.js";
const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});
function stream(parts: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    }),
  );
}
describe("Ollama transport", () => {
  it("detects available models and tolerates missing models", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ models: [{ name: "qwen" }] }))
      .mockResolvedValueOnce(Response.json({}));
    expect(await detectOllama("http://localhost:11434/")).toEqual({
      available: true,
      models: ["qwen"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(await detectOllama("local")).toEqual({ available: true, models: [] });
  });
  it("treats HTTP failures and unreachable daemons as unavailable", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("offline", { status: 503 }))
      .mockRejectedValueOnce(new Error("offline"));
    for (let i = 0; i < 2; i++)
      expect(await detectOllama("local")).toEqual({ available: false, models: [] });
  });
  it("reassembles split NDJSON and announces thinking only once", async () => {
    fetchMock.mockResolvedValue(
      stream([
        '{"message":{"thinking":"hmm"}}\n\n{"message":{"thinking":"again","content":"Hel',
        'lo"}}\n{"message":{"content":" world"},"done":true,"done_reason":"length"}',
      ]),
    );
    const token = vi.fn(),
      activity = vi.fn();
    expect(
      await generateOllamaStep(
        "http://localhost/",
        "qwen",
        [{ role: "user", content: "Hi" }],
        [],
        token,
        undefined,
        { maxTokens: 32, onActivity: activity },
      ),
    ).toEqual({ type: "text", content: "Hello world", truncated: true });
    expect(token.mock.calls).toEqual([["Hello"], [" world"]]);
    expect(activity).toHaveBeenCalledExactlyOnceWith("thinking");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: "qwen",
      stream: true,
      options: { num_ctx: 16384, num_predict: 32 },
    });
  });
  it("serializes tool schemas and correlates tool results with function names", async () => {
    fetchMock.mockResolvedValue(
      stream([
        JSON.stringify({
          message: {
            tool_calls: [
              { function: { name: "read", arguments: { path: "a" } } },
              { function: { name: "compile" } },
            ],
          },
          done: true,
        }),
      ]),
    );
    const result = await generateOllamaStep(
      "local",
      "qwen",
      [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "1", name: "read", args: { path: "a" } }],
        },
        { role: "tool", content: "text", toolCallId: "1" },
        { role: "tool", content: "ok", name: "compile" },
        { role: "tool", content: "unknown" },
      ],
      [
        {
          name: "read",
          description: "Read",
          params: {
            path: { type: "string", description: "Path" },
            mode: { type: "string", description: "Mode", enum: ["text"] },
          },
          required: ["path"],
        },
      ],
      vi.fn(),
    );
    expect(result).toMatchObject({
      type: "tool_calls",
      toolCalls: [
        { name: "read", args: { path: "a" } },
        { name: "compile", args: {} },
      ],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1].tool_name).toBe("read");
    expect(body.messages[2].tool_name).toBe("compile");
    expect(body.tools[0].function.parameters.properties.mode.enum).toEqual(["text"]);
    expect(body.options.num_predict).toBe(4096);
  });
  it("accepts a non-streaming response body", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: null,
      json: async () => ({ message: { content: "answer" }, done: true }),
    });
    expect(await generateOllamaStep("local", "qwen", [], [], vi.fn())).toEqual({
      type: "text",
      content: "answer",
      truncated: false,
    });
  });
  it.each(["malformed", '{"error":"model missing"}\n'])(
    "reports invalid streams: %s",
    async (input) => {
      fetchMock.mockResolvedValue(stream([input]));
      expect(await generateOllamaStep("local", "qwen", [], [], vi.fn())).toMatchObject({
        type: "error",
        content: expect.stringContaining("Ollama error:"),
      });
    },
  );
  it("reports HTTP and non-Error transport failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad model", { status: 404 }));
    expect(await generateOllamaStep("local", "qwen", [], [], vi.fn())).toEqual({
      type: "error",
      content: "Ollama 404: bad model",
    });
    fetchMock.mockRejectedValue("offline");
    expect(await generateOllamaStep("local", "qwen", [], [], vi.fn())).toEqual({
      type: "error",
      content: "Ollama error: offline",
    });
  });
  it("returns accumulated text on cancellation", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(
      stream(['{"message":{"content":"partial"}}\n', '{"error":"cancelled"}']),
    );
    const onToken = () => controller.abort();
    expect(
      await generateOllamaStep("local", "qwen", [], [], onToken, controller.signal),
    ).toEqual({ type: "text", content: "partial" });
  });
});
