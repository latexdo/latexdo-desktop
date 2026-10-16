// Ollama backend: talks to a local Ollama daemon over HTTP. Routed through the
// main process (not the renderer) so hosted/browser builds don't hit
// mixed-content blocking. Uses Ollama's native tool-calling.

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
  toolCallId?: string;
}

interface ToolSchema {
  name: string;
  description: string;
  params: Record<string, { type: string; description: string; enum?: string[] }>;
  required: string[];
}

type GenerationStep =
  | { type: "text"; content: string; truncated?: boolean }
  | {
      type: "tool_calls";
      content: string;
      truncated?: boolean;
      toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
    }
  | { type: "error"; content: string };

export async function detectOllama(
  baseUrl: string,
): Promise<{ available: boolean; models: string[] }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return { available: false, models: [] };
    const data = (await res.json()) as { models?: { name: string }[] };
    return { available: true, models: (data.models ?? []).map((m) => m.name) };
  } catch {
    return { available: false, models: [] };
  }
}

function toOllamaTools(tools: ToolSchema[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(t.params).map(([k, p]) => [
            k,
            p.enum
              ? { type: p.type, description: p.description, enum: p.enum }
              : { type: p.type, description: p.description },
          ]),
        ),
        required: t.required,
      },
    },
  }));
}

function toOllamaMessages(messages: ChatMessage[]): unknown[] {
  const names = new Map<string, string>();
  return messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool",
        content: m.content,
        tool_name: m.name ?? (m.toolCallId ? names.get(m.toolCallId) : undefined),
      };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      for (const call of m.toolCalls) names.set(call.id, call.name);
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls.map((c) => ({
          function: { name: c.name, arguments: c.args },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

interface OllamaChunk {
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  };
  done?: boolean;
  done_reason?: string;
  error?: string;
}

/**
 * Ollama's default context window is a few thousand tokens and it silently
 * drops the start of longer prompts, which loses the system prompt first.
 */
const ollamaContextTokens = 16_384;

export async function generateOllamaStep(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  tools: ToolSchema[],
  onToken: (t: string) => void,
  signal?: AbortSignal,
  options: { maxTokens?: number; onActivity?: (activity: "thinking") => void } = {},
): Promise<GenerationStep> {
  let text = "";
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        stream: true,
        messages: toOllamaMessages(messages),
        tools: tools.length ? toOllamaTools(tools) : undefined,
        options: {
          num_ctx: ollamaContextTokens,
          num_predict: options.maxTokens ?? 4096,
        },
      }),
    });
    if (!res.ok) {
      return {
        type: "error",
        content: `Ollama ${res.status}: ${await res.text()}`,
      };
    }
    const calls: { function: { name: string; arguments: Record<string, unknown> } }[] =
      [];
    let doneReason = "";
    let announcedThinking = false;
    const absorb = (chunk: OllamaChunk) => {
      if (chunk.error) throw new Error(chunk.error);
      if (chunk.message?.thinking && !announcedThinking) {
        announcedThinking = true;
        options.onActivity?.("thinking");
      }
      if (chunk.message?.content) {
        text += chunk.message.content;
        onToken(chunk.message.content);
      }
      calls.push(...(chunk.message?.tool_calls ?? []));
      if (chunk.done) doneReason = chunk.done_reason ?? "";
    };
    if (!res.body) {
      absorb((await res.json()) as OllamaChunk);
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
          if (line.trim()) absorb(JSON.parse(line) as OllamaChunk);
        }
      }
      if (buffer.trim()) absorb(JSON.parse(buffer) as OllamaChunk);
    }
    const truncated = doneReason === "length";
    if (calls.length) {
      return {
        type: "tool_calls",
        content: text,
        truncated,
        toolCalls: calls.map((c, i) => ({
          id: `call_${Date.now()}_${i}`,
          name: c.function.name,
          args: c.function.arguments ?? {},
        })),
      };
    }
    return { type: "text", content: text, truncated };
  } catch (error) {
    if (signal?.aborted) return { type: "text", content: text };
    return {
      type: "error",
      content: `Ollama error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
