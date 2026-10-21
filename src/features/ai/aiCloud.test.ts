import { describe, it, expect, vi, afterEach } from "vitest";
import {
  abortCloudGeneration,
  fitToolResults,
  generateStepCloud,
  listCloudModels,
  toAnthropicMessages,
} from "./aiCloud";
import type { ChatMessage, GenerateRequest } from "./aiTypes";

function req(
  options: GenerateRequest["options"],
  messages: ChatMessage[] = [{ role: "user", content: "hi" }],
  tools: GenerateRequest["tools"] = [],
): GenerateRequest {
  return { requestId: "t", provider: "cloud", messages, tools, options };
}

function sse(events: Array<Record<string, unknown>>): Response {
  const body = events
    .map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** A streamed Claude reply made of the given content blocks. */
function claudeStream(
  blocks: Array<Record<string, unknown>>,
  stopReason = "end_turn",
): Response {
  const events: Array<Record<string, unknown>> = [
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
  ];
  blocks.forEach((block, index) => {
    if (block.type === "text") {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: block.text },
      });
    } else if (block.type === "tool_use") {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
      });
    } else if (block.type === "thinking") {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "thinking", thinking: "", signature: "" },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "signature_delta", signature: String(block.signature) },
      });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 5 },
  });
  events.push({ type: "message_stop" });
  return sse(events);
}

function stubFetch(response: () => Response) {
  const fetchMock = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(
  fetchMock: ReturnType<typeof vi.fn>,
  call = 0,
): Record<string, unknown> {
  const init = fetchMock.mock.calls[call][1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

function sentHeaders(fetchMock: ReturnType<typeof vi.fn>, call = 0): Headers {
  return new Headers((fetchMock.mock.calls[call][1] as RequestInit).headers);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Claude requests", () => {
  it("streams text through the Messages API with the user's key", async () => {
    const fetchMock = stubFetch(() => claudeStream([{ type: "text", text: "ok" }]));
    const tokens: string[] = [];
    const step = await generateStepCloud(
      req({
        cloudVendor: "anthropic",
        cloudModel: "claude-opus-5-5",
        cloudApiKey: "sk-ant",
      }),
      (token) => tokens.push(token),
    );

    expect(step).toMatchObject({ type: "text", content: "ok", truncated: false });
    expect(tokens).toEqual(["ok"]);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(String(url)).toContain("https://api.anthropic.com/v1/messages");
    expect(sentHeaders(fetchMock).get("x-api-key")).toBe("sk-ant");
  });

  it("uses adaptive thinking, effort and caching on current models, without sampling", async () => {
    const fetchMock = stubFetch(() => claudeStream([{ type: "text", text: "ok" }]));
    await generateStepCloud(
      req(
        {
          cloudVendor: "anthropic",
          cloudModel: "claude-opus-5-5",
          cloudApiKey: "k",
          temperature: 0,
          effort: "high",
        },
        [
          { role: "system", content: "You are LatexDo." },
          { role: "user", content: "hi" },
        ],
      ),
      () => {},
    );
    const body = sentBody(fetchMock);
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toEqual({
      type: "adaptive",
      block_binding: { prefix_mismatch_behavior: "drop_block" },
    });
    expect(body.output_config).toEqual({ effort: "high" });
    expect(body.cache_control).toEqual({ type: "ephemeral" });
    expect(body.system).toEqual([
      { type: "text", text: "You are LatexDo.", cache_control: { type: "ephemeral" } },
    ]);
    expect(body.max_tokens).toBe(16_000);
    expect(body.fallbacks).toBe("default");
    const betas = sentHeaders(fetchMock).get("anthropic-beta") ?? "";
    expect(betas).toContain("thinking-binding-controls-2026-08-01");
    expect(betas).toContain("server-side-fallback-2026-07-01");
  });

  it("keeps the classic request shape for older models", async () => {
    const fetchMock = stubFetch(() => claudeStream([{ type: "text", text: "ok" }]));
    await generateStepCloud(
      req({
        cloudVendor: "anthropic",
        cloudModel: "claude-haiku-4-5",
        cloudApiKey: "k",
        temperature: 0.2,
        maxTokens: 64,
      }),
      () => {},
    );
    const body = sentBody(fetchMock);
    expect(body.temperature).toBe(0.2);
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    expect(body.fallbacks).toBeUndefined();
    expect(body.max_tokens).toBe(64);
  });

  it("does not send server-side fallbacks through a custom base URL", async () => {
    const fetchMock = stubFetch(() => claudeStream([{ type: "text", text: "ok" }]));
    await generateStepCloud(
      req({
        cloudVendor: "anthropic",
        cloudModel: "claude-opus-5-5",
        cloudBaseUrl: "https://proxy.example.com",
        cloudApiKey: "k",
      }),
      () => {},
    );
    expect(sentBody(fetchMock).fallbacks).toBeUndefined();
  });

  it("returns tool calls with Claude's blocks for replay and flags cut-off output", async () => {
    stubFetch(() =>
      claudeStream(
        [
          { type: "thinking", signature: "sig" },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "read_file",
            input: { path: "main.tex" },
          },
        ],
        "max_tokens",
      ),
    );
    const thinking = vi.fn();
    const step = await generateStepCloud(
      req(
        { cloudVendor: "anthropic", cloudModel: "claude-sonnet-5-5", cloudApiKey: "k" },
        [{ role: "user", content: "read it" }],
        [
          {
            name: "read_file",
            description: "Read a file",
            params: { path: { type: "string", description: "Path" } },
            required: ["path"],
          },
        ],
      ),
      () => {},
      thinking,
    );
    expect(thinking).toHaveBeenCalledWith("thinking");
    expect(step).toMatchObject({
      type: "tool_calls",
      truncated: true,
      toolCalls: [{ id: "toolu_1", name: "read_file", args: { path: "main.tex" } }],
    });
    const blocks = (step as { providerContent: Array<{ type: string }> })
      .providerContent;
    expect(blocks.map((block) => block.type)).toEqual(["thinking", "tool_use"]);
  });

  it("explains a refusal instead of returning an empty answer", async () => {
    stubFetch(() => claudeStream([], "refusal"));
    const step = await generateStepCloud(
      req({
        cloudVendor: "anthropic",
        cloudModel: "claude-opus-5-5",
        cloudApiKey: "k",
      }),
      () => {},
    );
    expect(step).toMatchObject({
      type: "error",
      content: expect.stringContaining("declined"),
    });
  });

  it("turns an invalid key into a plain message", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "authentication_error", message: "invalid x-api-key" },
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    );
    const step = await generateStepCloud(
      req({
        cloudVendor: "anthropic",
        cloudModel: "claude-opus-5-5",
        cloudApiKey: "bad",
      }),
      () => {},
    );
    expect(step).toEqual({
      type: "error",
      content: "Claude rejected the API key. Check it in AI settings.",
    });
  });

  it("can be cancelled by request id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
          }),
      ),
    );
    const pending = generateStepCloud(
      req({
        cloudVendor: "anthropic",
        cloudModel: "claude-opus-5-5",
        cloudApiKey: "k",
      }),
      () => {},
    );
    await vi.waitFor(() => expect(abortCloudGeneration("t")).toBe(true));
    await expect(pending).resolves.toEqual({ type: "text", content: "" });
  });
});

describe("toAnthropicMessages", () => {
  const thinking = { type: "thinking", thinking: "", signature: "s" };

  it("puts one step's tool results in a single user message", () => {
    const messages = toAnthropicMessages([
      { role: "user", content: "read both" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "a", name: "read_file", args: { path: "a.tex" } },
          { id: "b", name: "read_file", args: { path: "b.tex" } },
        ],
      },
      { role: "tool", content: "A", toolCallId: "a" },
      { role: "tool", content: "B", toolCallId: "b" },
    ]);
    expect(messages).toHaveLength(3);
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "a", content: "A" },
        { type: "tool_result", tool_use_id: "b", content: "B" },
      ],
    });
  });

  it("replays thinking in the current turn and drops it from earlier turns", () => {
    const toolUse = { type: "tool_use", id: "x", name: "compile", input: {} };
    const messages = toAnthropicMessages([
      { role: "user", content: "first" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "x", name: "compile", args: {} }],
        providerContent: [thinking, toolUse],
      },
      { role: "tool", content: "ok", toolCallId: "x" },
      {
        role: "assistant",
        content: "Done.",
        providerContent: [thinking, { type: "text", text: "Done." }],
      },
      { role: "user", content: "second" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "y", name: "compile", args: {} }],
        providerContent: [thinking, { ...toolUse, id: "y" }],
      },
      { role: "tool", content: "ok", toolCallId: "y" },
    ]);
    const types = messages.map((message) =>
      Array.isArray(message.content)
        ? message.content.map((block) => block.type).join(",")
        : "text",
    );
    expect(types).toEqual([
      "text",
      "tool_use",
      "tool_result",
      "text",
      "text",
      "thinking,tool_use",
      "tool_result",
    ]);
  });

  it("starts on a user turn and drops orphaned tool results", () => {
    const messages = toAnthropicMessages([
      { role: "tool", content: "orphan", toolCallId: "gone" },
      { role: "assistant", content: "stale" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "" },
    ]);
    expect(messages).toEqual([{ role: "user", content: "hello" }]);
  });
});

describe("OpenAI-compatible requests", () => {
  function chunks(parts: Array<Record<string, unknown>>): Response {
    const body =
      parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("") +
      "data: [DONE]\n\n";
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  it("streams text with a Bearer token and honors baseUrl", async () => {
    const fetchMock = stubFetch(() =>
      chunks([
        { choices: [{ delta: { content: "o" } }] },
        { choices: [{ delta: { content: "k" }, finish_reason: "stop" }] },
      ]),
    );
    const tokens: string[] = [];
    const step = await generateStepCloud(
      req({
        cloudVendor: "openai",
        cloudBaseUrl: "https://api.groq.com/openai/v1",
        cloudModel: "llama-3.3-70b-versatile",
        cloudApiKey: "gsk_123",
      }),
      (token) => tokens.push(token),
    );
    expect(step).toEqual({ type: "text", content: "ok", truncated: false });
    expect(tokens).toEqual(["o", "k"]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer gsk_123",
    );
    const body = sentBody(fetchMock);
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(16_000);
  });

  it("uses max_completion_tokens and default sampling on OpenAI itself", async () => {
    const fetchMock = stubFetch(() =>
      chunks([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]),
    );
    await generateStepCloud(
      req({
        cloudVendor: "openai",
        cloudModel: "gpt-x",
        cloudApiKey: "k",
        temperature: 0,
      }),
      () => {},
    );
    const body = sentBody(fetchMock);
    expect(body.max_completion_tokens).toBe(16_000);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  it("assembles streamed tool calls and flags cut-off arguments", async () => {
    stubFetch(() =>
      chunks([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "c1",
                    function: { name: "read_file", arguments: '{"pa' },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: 'th":"a.tex"}' } }],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]),
    );
    const step = await generateStepCloud(
      req({ cloudVendor: "openai", cloudBaseUrl: "https://x/v1", cloudApiKey: "k" }),
      () => {},
    );
    expect(step).toEqual({
      type: "tool_calls",
      content: "",
      truncated: false,
      toolCalls: [{ id: "c1", name: "read_file", args: { path: "a.tex" } }],
    });

    stubFetch(() =>
      chunks([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "c2",
                    function: { name: "write_file", arguments: '{"pa' },
                  },
                ],
              },
              finish_reason: "length",
            },
          ],
        },
      ]),
    );
    const cut = await generateStepCloud(
      req({ cloudVendor: "openai", cloudBaseUrl: "https://x/v1", cloudApiKey: "k" }),
      () => {},
    );
    expect(cut).toMatchObject({ type: "tool_calls", truncated: true });
  });

  it("still accepts a provider that answers without streaming", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const step = await generateStepCloud(
      req({ cloudVendor: "openai", cloudBaseUrl: "https://x/v1", cloudApiKey: "k" }),
      () => {},
    );
    expect(step).toMatchObject({ type: "text", content: "ok" });
  });

  it("surfaces a non-2xx response as an error step", async () => {
    stubFetch(() => new Response("bad key", { status: 401 }));
    const step = await generateStepCloud(
      req({ cloudVendor: "openai", cloudBaseUrl: "https://x/v1", cloudApiKey: "k" }),
      () => {},
    );
    expect(step).toEqual({ type: "error", content: "AI provider 401: bad key" });
  });
});

describe("fitToolResults", () => {
  it("clears the oldest tool results first and keeps recent ones", () => {
    const big = "x".repeat(1000);
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      ...Array.from({ length: 6 }, (_, index) => ({
        role: "tool" as const,
        content: `${index}${big}`,
        toolCallId: String(index),
      })),
    ];
    const fitted = fitToolResults(messages, 4500, 2);
    expect(fitted[1].content).toContain("cleared");
    expect(fitted[6].content.startsWith("5")).toBe(true);
    expect(fitted[5].content.startsWith("4")).toBe(true);
    expect(fitToolResults(messages, 1_000_000)).toBe(messages);
  });
});

describe("listCloudModels", () => {
  it("reads an OpenAI-compatible model list", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ data: [{ id: "models/b" }, { id: "a" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      listCloudModels({ vendor: "openai", baseUrl: "https://x/v1", apiKey: "k" }),
    ).resolves.toEqual(["a", "b"]);
  });

  it("returns nothing when the provider has no list", async () => {
    stubFetch(() => new Response("nope", { status: 404 }));
    await expect(
      listCloudModels({ vendor: "openai", baseUrl: "https://x/v1", apiKey: "k" }),
    ).resolves.toEqual([]);
  });
});

describe("provider recovery and tool replay", () => {
  it.each([
    [403, "cannot use"],
    [404, "not found"],
    [429, "rate-limiting"],
    [500, "overloaded"],
    [400, "Claude API"],
  ])("explains Claude HTTP %s", async (status, expected) => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "api_error", message: "failed" },
          }),
          { status: Number(status), headers: { "content-type": "application/json" } },
        ),
    );
    expect(
      await generateStepCloud(
        req({
          cloudVendor: "anthropic",
          cloudApiKey: "key",
          cloudModel: "claude-opus-5-5",
        }),
        () => {},
      ),
    ).toMatchObject({
      type: "error",
      content: expect.stringContaining(String(expected)),
    });
  });
  it("lists Claude models through the authenticated SDK and tolerates discovery failures", async () => {
    const fetch = stubFetch(() =>
      Response.json({
        data: [
          {
            id: "claude-test",
            type: "model",
            display_name: "Test",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        has_more: false,
        first_id: "claude-test",
        last_id: "claude-test",
      }),
    );
    expect(
      await listCloudModels({ vendor: "anthropic", baseUrl: "", apiKey: "key" }),
    ).toEqual(["claude-test"]);
    expect(sentHeaders(fetch).get("x-api-key")).toBe("key");
    fetch.mockRejectedValue(new Error("offline"));
    expect(
      await listCloudModels({ vendor: "anthropic", baseUrl: "", apiKey: "key" }),
    ).toEqual([]);
    expect(
      await listCloudModels({ vendor: "openai", baseUrl: "", apiKey: "key" }),
    ).toEqual([]);
  });
  it("replays completed tool calls and parses nonstreaming tool replies", async () => {
    const fetch = stubFetch(() =>
      Response.json({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "next",
                  type: "function",
                  function: { name: "read_file", arguments: '{"path":"b.tex"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );
    const step = await generateStepCloud(
      req({ cloudVendor: "openai", cloudApiKey: "key" }, [
        { role: "user", content: "read" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "old", name: "read_file", args: { path: "a.tex" } }],
        },
        { role: "tool", toolCallId: "old", content: "source" },
      ]),
      () => {},
    );
    expect(step.type).toBe("tool_calls");
    expect(sentBody(fetch).messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          tool_call_id: "old",
          content: "source",
        }),
        expect.objectContaining({
          role: "assistant",
          tool_calls: [
            {
              id: "old",
              type: "function",
              function: { name: "read_file", arguments: '{"path":"a.tex"}' },
            },
          ],
        }),
      ]),
    );
  });
  it("ignores keepalives and explains filtered replies", async () => {
    stubFetch(
      () =>
        new Response(
          'data: keepalive\n\ndata: {"choices":[{"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n',
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    expect(
      await generateStepCloud(req({ cloudVendor: "openai" }), () => {}),
    ).toMatchObject({
      type: "error",
      content: expect.stringContaining("content filter"),
    });
  });
  it("reports connection failures and interrupted response bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(
      await generateStepCloud(req({ cloudVendor: "openai" }), () => {}),
    ).toMatchObject({ type: "error", content: expect.stringContaining("offline") });
    stubFetch(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("disconnected"));
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    expect(
      await generateStepCloud(req({ cloudVendor: "openai" }), () => {}),
    ).toMatchObject({ type: "error", content: expect.stringContaining("interrupted") });
  });
});
