// Cloud provider, implemented entirely in the renderer so it works in BOTH the
// Electron and browser builds (the browser build has no Node runtime for a
// local model). Claude goes through the official Anthropic SDK; every other
// vendor speaks the OpenAI-compatible chat API. Both stream.

import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  MessageCreateParamsNonStreaming as BetaMessageCreateParamsNonStreaming,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { claudeModelTraits } from "./claudeModels";
import type {
  ChatMessage,
  GenerateRequest,
  GenerationStep,
  ToolCall,
  ToolSchema,
} from "./aiTypes";

/** What the UI shows while a step runs without visible text yet. */
export type GenerationActivity = "thinking";

const inFlight = new Map<string, AbortController>();

/** Cancels a cloud request started with this id; no-op when none is running. */
export function abortCloudGeneration(requestId: string): boolean {
  const controller = inFlight.get(requestId);
  if (!controller) return false;
  controller.abort();
  inFlight.delete(requestId);
  return true;
}

function toJsonSchema(tool: ToolSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [key, param] of Object.entries(tool.params)) {
    properties[key] = param.enum
      ? { type: param.type, description: param.description, enum: param.enum }
      : { type: param.type, description: param.description };
  }
  return { type: "object", properties, required: tool.required };
}

const defaultMaxTokens = 16_000;

// ---- Anthropic ----------------------------------------------------------

const anthropicDefaultBaseUrl = "https://api.anthropic.com";

// Models that may decline under safety classifiers and accept server-side
// fallback routing on the first-party API.
const fallbackModels = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;

function isThinkingBlock(block: unknown): boolean {
  const type = (block as { type?: string } | null)?.type;
  return type === "thinking" || type === "redacted_thinking";
}

/** Index of the message that started the current turn: the last user message. */
function currentTurnStart(messages: ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return index;
  }
  return 0;
}

function assistantBlocks(
  message: ChatMessage,
  keepThinking: boolean,
): BetaContentBlockParam[] {
  if (Array.isArray(message.providerContent)) {
    // Replayed verbatim so Claude keeps the reasoning behind its tool calls.
    // Earlier turns drop their thinking: removing a leading run of thinking
    // blocks keeps the rest of the conversation valid.
    return (message.providerContent as BetaContentBlockParam[]).filter(
      (block) => keepThinking || !isThinkingBlock(block),
    );
  }
  const blocks: BetaContentBlockParam[] = [];
  if (message.content.trim()) blocks.push({ type: "text", text: message.content });
  for (const call of message.toolCalls ?? []) {
    blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.args });
  }
  return blocks;
}

/**
 * Builds Claude's message list: tool results of one step share a single user
 * message (split results teach the model to stop calling tools in parallel),
 * and the history always starts with a user turn.
 */
export function toAnthropicMessages(messages: ChatMessage[]): BetaMessageParam[] {
  const conversation = messages.filter((message) => message.role !== "system");
  const turnStart = currentTurnStart(conversation);
  const result: BetaMessageParam[] = [];
  conversation.forEach((message, index) => {
    if (message.role === "tool") {
      const block: BetaToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: message.toolCallId ?? "",
        content: message.content || "(empty result)",
      };
      const previous = result[result.length - 1];
      if (
        previous?.role === "user" &&
        Array.isArray(previous.content) &&
        previous.content.every((part) => part.type === "tool_result")
      ) {
        previous.content.push(block);
      } else {
        result.push({ role: "user", content: [block] });
      }
      return;
    }
    if (message.role === "assistant") {
      const blocks = assistantBlocks(message, index > turnStart);
      if (blocks.length === 0) return;
      result.push({ role: "assistant", content: blocks });
      return;
    }
    if (!message.content.trim()) return;
    result.push({ role: "user", content: message.content });
  });
  while (result.length && result[0].role !== "user") result.shift();
  // A tool result needs its tool_use right before it; drop orphans left by a
  // trimmed history.
  if (
    result[0] &&
    Array.isArray(result[0].content) &&
    result[0].content.some((part) => part.type === "tool_result")
  ) {
    result.shift();
    while (result.length && result[0].role !== "user") result.shift();
  }
  return result;
}

function anthropicErrorMessage(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Claude rejected the API key. Check it in AI settings.";
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return "This API key cannot use the selected Claude model. Pick another model or check your Anthropic plan.";
  }
  if (error instanceof Anthropic.NotFoundError) {
    return "The selected Claude model was not found. Pick another model in AI settings.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Claude is rate-limiting this API key. Wait a moment and try again.";
  }
  if (error instanceof Anthropic.InternalServerError) {
    return "Claude is temporarily overloaded. Try again in a moment.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Could not reach Claude. Check your internet connection.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Claude API ${error.status ?? ""}: ${error.message}`.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

async function generateAnthropic(
  req: GenerateRequest,
  onToken: (text: string) => void,
  onActivity: (activity: GenerationActivity) => void,
  signal: AbortSignal,
): Promise<GenerationStep> {
  const { cloudApiKey, cloudModel, cloudBaseUrl } = req.options;
  const model = cloudModel || "claude-opus-5-5";
  const baseURL = cloudBaseUrl || anthropicDefaultBaseUrl;
  const traits = claudeModelTraits(model);
  const client = new Anthropic({
    apiKey: cloudApiKey ?? "",
    baseURL,
    // The key belongs to the user and stays on their machine.
    dangerouslyAllowBrowser: true,
  });

  const system = req.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const messages = toAnthropicMessages(req.messages);
  const tools: BetaToolUnion[] = req.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: toJsonSchema(tool) as BetaTool["input_schema"],
  }));

  const betas: string[] = [];
  const body: BetaMessageCreateParamsNonStreaming = {
    model,
    max_tokens: Math.max(
      req.options.maxTokens ?? defaultMaxTokens,
      // Thinking spends from the same budget as the reply.
      traits.adaptiveThinking ? 4_096 : 1,
    ),
    messages,
    // Caches the conversation so each agent step re-reads it at a tenth of
    // the price; the system prompt and tools are cached with it.
    cache_control: { type: "ephemeral" },
  };
  if (system) {
    body.system = [
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
    ];
  }
  if (tools.length) body.tools = tools;
  if (traits.sampling && typeof req.options.temperature === "number") {
    body.temperature = req.options.temperature;
  }
  if (traits.adaptiveThinking) {
    body.thinking = traits.thinkingBinding
      ? { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } }
      : { type: "adaptive" };
    body.output_config = { effort: req.options.effort ?? "medium" };
    if (traits.thinkingBinding) betas.push("thinking-binding-controls-2026-08-01");
  }
  if (traits.contextEditing && tools.length) {
    // Clears old tool results server-side once a session grows large; unlike
    // trimming history here, this keeps the conversation valid for thinking.
    body.context_management = { edits: [{ type: "clear_tool_uses_20250919" }] };
    betas.push("context-management-2025-06-27");
  }
  if (baseURL === anthropicDefaultBaseUrl && fallbackModels.test(model)) {
    body.fallbacks = "default";
    betas.push("server-side-fallback-2026-07-01");
  }
  if (betas.length) body.betas = betas;

  try {
    const stream = client.beta.messages.stream(body, { signal });
    stream.on("streamEvent", (event) => {
      if (
        event.type === "content_block_start" &&
        (event.content_block.type === "thinking" ||
          event.content_block.type === "redacted_thinking")
      ) {
        onActivity("thinking");
      }
    });
    stream.on("text", (delta) => onToken(delta));
    const message = await stream.finalMessage();
    return anthropicStep(message.content, message.stop_reason, message.stop_details);
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError || signal.aborted) {
      return { type: "text", content: "" };
    }
    return { type: "error", content: anthropicErrorMessage(error) };
  }
}

function anthropicStep(
  content: BetaContentBlock[],
  stopReason: string | null,
  stopDetails: { category?: string | null; explanation?: string | null } | null,
): GenerationStep {
  if (stopReason === "refusal") {
    const reason = stopDetails?.explanation || stopDetails?.category;
    return {
      type: "error",
      content: `Claude declined this request${reason ? ` (${reason})` : ""}. Rephrase it or try another model.`,
    };
  }
  if (stopReason === "model_context_window_exceeded") {
    return {
      type: "error",
      content: "This conversation is too long for the model. Start a new chat.",
    };
  }
  const truncated = stopReason === "max_tokens";
  const text = content
    .filter(
      (block): block is Extract<BetaContentBlock, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("");
  const toolCalls: ToolCall[] = content
    .filter(
      (block): block is Extract<BetaContentBlock, { type: "tool_use" }> =>
        block.type === "tool_use",
    )
    .map((block) => ({
      id: block.id,
      name: block.name,
      args: (block.input ?? {}) as Record<string, unknown>,
    }));
  // Only what Claude needs replayed: thinking, text and tool calls.
  const providerContent = content.filter(
    (block) =>
      block.type === "thinking" ||
      block.type === "redacted_thinking" ||
      block.type === "text" ||
      block.type === "tool_use",
  );
  if (toolCalls.length) {
    return { type: "tool_calls", content: text, toolCalls, truncated, providerContent };
  }
  return { type: "text", content: text, truncated, providerContent };
}

// ---- OpenAI-compatible --------------------------------------------------

const openAiDefaultBaseUrl = "https://api.openai.com/v1";

function isOfficialOpenAi(baseUrl: string): boolean {
  return /^https:\/\/api\.openai\.com\//.test(`${baseUrl.replace(/\/$/, "")}/`);
}

/**
 * Keeps an OpenAI-compatible request inside a character budget by blanking
 * the oldest tool results first. Recent results stay intact.
 */
export function fitToolResults(
  messages: ChatMessage[],
  budgetChars: number,
  keepRecent = 4,
): ChatMessage[] {
  let total = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (total <= budgetChars) return messages;
  const toolIndexes = messages
    .map((message, index) => (message.role === "tool" ? index : -1))
    .filter((index) => index >= 0);
  const clearable = toolIndexes.slice(0, Math.max(0, toolIndexes.length - keepRecent));
  const result = [...messages];
  for (const index of clearable) {
    if (total <= budgetChars) break;
    const placeholder =
      "[Earlier tool result cleared to save context. Call the tool again if you need it.]";
    total -= result[index].content.length - placeholder.length;
    result[index] = { ...result[index], content: placeholder };
  }
  return result;
}

function openAiMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function safeParse(json: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(json || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return null;
  }
}

interface OpenAiChoice {
  delta?: {
    content?: string | null;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  message?: {
    content?: string | null;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  };
  finish_reason?: string | null;
}

async function generateOpenAi(
  req: GenerateRequest,
  onToken: (text: string) => void,
  signal: AbortSignal,
): Promise<GenerationStep> {
  const { cloudApiKey, cloudModel, cloudBaseUrl } = req.options;
  const base = (cloudBaseUrl || openAiDefaultBaseUrl).replace(/\/$/, "");
  const official = isOfficialOpenAi(base);
  const maxTokens = req.options.maxTokens ?? defaultMaxTokens;
  const tools = req.tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toJsonSchema(tool),
    },
  }));

  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cloudApiKey ?? ""}`,
      },
      body: JSON.stringify({
        model: cloudModel || "gpt-4o-mini",
        stream: true,
        // OpenAI's current models reject `max_tokens` and custom sampling;
        // other compatible APIs still expect the classic fields.
        ...(official
          ? { max_completion_tokens: maxTokens }
          : { max_tokens: maxTokens, temperature: req.options.temperature ?? 0.3 }),
        tools: tools.length ? tools : undefined,
        messages: fitToolResults(req.messages, 400_000).map(openAiMessage),
      }),
    });
  } catch (error) {
    if (signal.aborted) return { type: "text", content: "" };
    return {
      type: "error",
      content: `Could not reach the AI provider: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!res.ok) {
    return { type: "error", content: `AI provider ${res.status}: ${await res.text()}` };
  }

  let text = "";
  let finishReason: string | null | undefined = null;
  const calls = new Map<number, { id: string; name: string; args: string }>();
  const absorb = (choice: OpenAiChoice | undefined) => {
    if (!choice) return;
    finishReason = choice.finish_reason ?? finishReason;
    const content = choice.delta?.content ?? choice.message?.content;
    if (content) {
      text += content;
      onToken(content);
    }
    for (const [position, call] of (choice.delta?.tool_calls ?? []).entries()) {
      const index = call.index ?? position;
      const current = calls.get(index) ?? { id: "", name: "", args: "" };
      current.id ||= call.id ?? "";
      current.name += call.function?.name ?? "";
      current.args += call.function?.arguments ?? "";
      calls.set(index, current);
    }
    for (const [index, call] of (choice.message?.tool_calls ?? []).entries()) {
      calls.set(index, {
        id: call.id,
        name: call.function.name,
        args: call.function.arguments,
      });
    }
  };

  try {
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("event-stream") || !res.body) {
      // A provider that ignored `stream: true` answers with one JSON body.
      const data = (await res.json()) as { choices?: OpenAiChoice[] };
      absorb(data.choices?.[0]);
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const data = line.trim().replace(/^data:\s*/, "");
          if (!line.trim().startsWith("data:") || data === "[DONE]") continue;
          let chunk: { choices?: OpenAiChoice[] };
          try {
            chunk = JSON.parse(data) as { choices?: OpenAiChoice[] };
          } catch {
            continue; // keep-alive or a provider's non-JSON comment line
          }
          absorb(chunk.choices?.[0]);
        }
      }
    }
  } catch (error) {
    if (signal.aborted) return { type: "text", content: text };
    return {
      type: "error",
      content: `The AI provider's response was interrupted: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (finishReason === "content_filter") {
    return {
      type: "error",
      content:
        "The provider's content filter blocked this reply. Rephrase the request.",
    };
  }
  const truncated = finishReason === "length";
  if (calls.size) {
    const toolCalls: ToolCall[] = [];
    let incomplete = truncated;
    for (const [index, call] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      const args = safeParse(call.args);
      if (!args) incomplete = true;
      toolCalls.push({
        id: call.id || `call_${index}_${Date.now().toString(36)}`,
        name: call.name,
        args: args ?? {},
      });
    }
    return { type: "tool_calls", content: text, toolCalls, truncated: incomplete };
  }
  return { type: "text", content: text, truncated };
}

// ---- Model discovery ----------------------------------------------------

/**
 * Model ids the provider offers this key, newest catalogs straight from the
 * source, so the picker never goes stale. Empty when the list is unavailable.
 */
export async function listCloudModels(options: {
  vendor: string;
  baseUrl: string;
  apiKey: string;
}): Promise<string[]> {
  try {
    if (options.vendor === "anthropic") {
      const client = new Anthropic({
        apiKey: options.apiKey,
        baseURL: options.baseUrl || anthropicDefaultBaseUrl,
        dangerouslyAllowBrowser: true,
        maxRetries: 0,
      });
      const ids: string[] = [];
      for await (const model of client.models.list({ limit: 100 })) ids.push(model.id);
      return ids;
    }
    const base = (options.baseUrl || openAiDefaultBaseUrl).replace(/\/$/, "");
    const res = await fetch(`${base}/models`, {
      headers: { authorization: `Bearer ${options.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id?: unknown }> };
    return (data.data ?? [])
      .map((entry) =>
        typeof entry.id === "string" ? entry.id.replace(/^models\//, "") : "",
      )
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

// ---- Entry point --------------------------------------------------------

export async function generateStepCloud(
  req: GenerateRequest,
  onToken: (text: string) => void,
  onActivity: (activity: GenerationActivity) => void = () => {},
): Promise<GenerationStep> {
  const controller = new AbortController();
  inFlight.set(req.requestId, controller);
  try {
    const vendor = req.options.cloudVendor ?? "anthropic";
    if (vendor === "anthropic") {
      return await generateAnthropic(req, onToken, onActivity, controller.signal);
    }
    return await generateOpenAi(req, onToken, controller.signal);
  } finally {
    if (inFlight.get(req.requestId) === controller) inFlight.delete(req.requestId);
  }
}
