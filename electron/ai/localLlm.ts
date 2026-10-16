// Local inference via node-llama-cpp. Loaded lazily and defensively so the app
// still boots if the native module isn't installed (e.g. web-only dev).
//
// The model and its context stay loaded between steps. An agent turn re-sends
// the whole conversation each step, and keeping the context sequence lets
// llama.cpp reuse everything it already evaluated, so a follow-up step only
// processes the new tool result instead of the full history. Agent work and
// quick helpers (ghost text, commit messages) get separate sequences so one
// never evicts the other's cache.
//
// Tools use the model's native function-calling format through the chat
// wrapper, with arguments constrained by a grammar, instead of asking a small
// model to hand-write JSON.

import { modelPath } from "./models.js";

interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  providerContent?: unknown;
}

interface ToolSchema {
  name: string;
  description: string;
  params: Record<
    string,
    {
      type: "string" | "number" | "boolean" | "integer";
      description: string;
      enum?: string[];
    }
  >;
  required: string[];
}

export type LocalEffort = "low" | "medium" | "high";

interface GenerateOptions {
  fileName: string;
  temperature?: number;
  maxTokens?: number;
  effort?: LocalEffort;
}

type GenerationStep =
  | { type: "text"; content: string; truncated?: boolean; providerContent?: unknown }
  | {
      type: "tool_calls";
      content: string;
      toolCalls: ToolCall[];
      truncated?: boolean;
      providerContent?: unknown;
    }
  | { type: "error"; content: string };

// node-llama-cpp has no bundled types until installed; keep these loose.
/* eslint-disable @typescript-eslint/no-explicit-any */
// Resolved via a variable specifier so `tsc` doesn't hard-fail when the
// optional native module isn't installed (web-only dev, CI without rebuild).
const nodeLlamaCppSpecifier = "node-llama-cpp";
async function importLlamaCpp(): Promise<any> {
  return import(/* @vite-ignore */ nodeLlamaCppSpecifier);
}

// ---- Chat history -------------------------------------------------------

/** What a local assistant turn carries for its replay on the next step. */
interface LocalProviderContent {
  kind: "llama";
  /** The model's full response: text and thought segments, in order. */
  response: unknown[];
  /** Raw function calls, replayed so the evaluated tokens match exactly. */
  rawCalls: unknown[];
}

function isLocalProviderContent(value: unknown): value is LocalProviderContent {
  return (
    !!value &&
    typeof value === "object" &&
    (value as LocalProviderContent).kind === "llama" &&
    Array.isArray((value as LocalProviderContent).response)
  );
}

export type LlamaHistoryItem =
  | { type: "system"; text: string }
  | { type: "user"; text: string }
  | { type: "model"; response: unknown[] };

/**
 * Maps the agent transcript to node-llama-cpp chat history. A tool round
 * (assistant call, tool results, the next assistant step) is one model turn
 * whose response holds the function calls with their results, the shape the
 * chat wrappers render back into the model's own tool format. Model turns
 * carry `response: [...]`; passing `text` there crashes the library.
 */
export function toLlamaHistory(messages: ChatMessage[]): LlamaHistoryItem[] {
  const systemPrompt = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const history: LlamaHistoryItem[] = [];
  if (systemPrompt) history.push({ type: "system", text: systemPrompt });

  let modelTurn: { type: "model"; response: unknown[] } | null = null;
  const pendingCalls = new Map<string, { result: unknown }>();
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "user") {
      modelTurn = null;
      history.push({ type: "user", text: message.content });
      continue;
    }
    if (message.role === "tool") {
      const call = message.toolCallId
        ? pendingCalls.get(message.toolCallId)
        : undefined;
      if (call) {
        call.result = message.content;
      } else {
        // A result without its call (a trimmed history): keep it readable.
        modelTurn = null;
        history.push({
          type: "user",
          text: `Tool ${message.name ?? ""} result:\n${message.content}`,
        });
      }
      continue;
    }
    if (!modelTurn) {
      modelTurn = { type: "model", response: [] };
      history.push(modelTurn);
    }
    const replay = isLocalProviderContent(message.providerContent)
      ? message.providerContent
      : null;
    if (replay) {
      modelTurn.response.push(...replay.response);
    } else if (message.content) {
      modelTurn.response.push(message.content);
    }
    for (const [index, toolCall] of (message.toolCalls ?? []).entries()) {
      const item: Record<string, unknown> = {
        type: "functionCall",
        name: toolCall.name,
        params: toolCall.args,
        result: "",
      };
      if (replay?.rawCalls[index]) item.rawCall = replay.rawCalls[index];
      modelTurn.response.push(item);
      pendingCalls.set(toolCall.id, item as { result: unknown });
    }
  }
  return history;
}

/** Tool schemas as grammar-constrained function definitions. */
export function toLlamaFunctions(tools: ToolSchema[]): Record<string, unknown> {
  const functions: Record<string, unknown> = {};
  for (const tool of tools) {
    const entries = Object.entries(tool.params);
    const properties: Record<string, unknown> = {};
    for (const [name, param] of entries) {
      const optional = !tool.required.includes(name);
      properties[name] = param.enum
        ? {
            enum: optional ? [...param.enum, null] : param.enum,
            description: param.description,
          }
        : {
            type: optional ? [param.type, "null"] : param.type,
            description: param.description,
          };
    }
    functions[tool.name] = {
      description: tool.description,
      params: entries.length ? { type: "object", properties } : undefined,
    };
  }
  return functions;
}

function cleanArgs(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object") return {};
  return Object.fromEntries(
    Object.entries(params as Record<string, unknown>).filter(
      ([, value]) => value !== null && value !== undefined,
    ),
  );
}

// ---- Engine -------------------------------------------------------------

interface Lane {
  chat: any;
  /** Serializes generations on this sequence. */
  queue: Promise<unknown>;
}

interface Engine {
  path: string;
  model: any;
  context: any;
  agent: Lane;
  quick: Lane;
}

let llamaPromise: Promise<any> | null = null;
let enginePromise: Promise<Engine> | null = null;
let enginePath: string | null = null;

async function getLlama(): Promise<any> {
  if (!llamaPromise) {
    llamaPromise = (async () => {
      const mod: any = await importLlamaCpp();
      return mod.getLlama();
    })();
    llamaPromise.catch(() => {
      llamaPromise = null;
    });
  }
  return llamaPromise;
}

async function createEngine(fullPath: string): Promise<Engine> {
  const mod: any = await importLlamaCpp();
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath: fullPath });
  let context: any;
  try {
    // As much context as memory allows, up to 32K: the system prompt, file
    // list and a few file reads fit without truncation.
    context = await model.createContext({
      sequences: 2,
      contextSize: { min: 4096, max: 32768 },
    });
  } catch {
    context = await model.createContext({
      sequences: 2,
      contextSize: { min: 2048, max: 8192 },
    });
  }
  const lane = (): Lane => ({
    chat: new mod.LlamaChat({ contextSequence: context.getSequence() }),
    queue: Promise.resolve(),
  });
  return { path: fullPath, model, context, agent: lane(), quick: lane() };
}

async function disposeEngine(engine: Engine): Promise<void> {
  for (const lane of [engine.agent, engine.quick]) {
    try {
      lane.chat.dispose?.({ disposeSequence: true });
    } catch {
      /* ignore */
    }
  }
  try {
    await engine.context.dispose();
  } catch {
    /* ignore */
  }
  try {
    await engine.model.dispose();
  } catch {
    /* ignore */
  }
}

async function getEngine(fileName: string): Promise<Engine> {
  const fullPath = modelPath(fileName);
  if (enginePromise && enginePath === fullPath) return enginePromise;
  const previous = enginePromise;
  enginePath = fullPath;
  enginePromise = (async () => {
    const old = previous ? await previous.catch(() => null) : null;
    if (old) await disposeEngine(old);
    return createEngine(fullPath);
  })();
  enginePromise.catch(() => {
    if (enginePath === fullPath) {
      enginePromise = null;
      enginePath = null;
    }
  });
  return enginePromise;
}

/** Releases the loaded model, e.g. before it is deleted from disk. */
export async function unloadLocalModel(): Promise<void> {
  const current = enginePromise;
  enginePromise = null;
  enginePath = null;
  const engine = await current?.catch(() => null);
  if (engine) await disposeEngine(engine);
}

// ---- Generation ---------------------------------------------------------

const thoughtBudgets: Record<LocalEffort, number> = {
  low: 0,
  medium: 512,
  high: 1024,
};

/** Sampling the model families recommend; caller temperatures still win. */
function samplingFor(wrapperName: string, thinking: boolean) {
  if (/qwen/i.test(wrapperName)) {
    return thinking
      ? { temperature: 0.6, topP: 0.95, topK: 20, minP: 0 }
      : { temperature: 0.7, topP: 0.8, topK: 20, minP: 0 };
  }
  return { temperature: 0.5, topP: 0.9, topK: 40, minP: 0.05 };
}

function newCallId(): string {
  return `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function generateLocalStep(
  messages: ChatMessage[],
  options: GenerateOptions,
  onToken: (text: string) => void,
  signal?: AbortSignal,
  tools: ToolSchema[] = [],
  onActivity: (activity: "thinking") => void = () => {},
): Promise<GenerationStep> {
  try {
    const engine = await getEngine(options.fileName);
    const maxTokens = options.maxTokens ?? 4096;
    const quick = tools.length === 0 && maxTokens <= 512;
    const lane = quick ? engine.quick : engine.agent;
    const effort = options.effort ?? (quick ? "low" : "medium");
    const thoughtTokens = thoughtBudgets[effort];
    const wrapperName = String(lane.chat.chatWrapper?.wrapperName ?? "");
    const sampling = samplingFor(wrapperName, thoughtTokens > 0);
    const history = toLlamaHistory(messages);
    if (history[history.length - 1]?.type === "system") {
      history.push({ type: "user", text: " " });
    }

    const run = lane.queue.then(async () => {
      let announcedThinking = false;
      const response = await lane.chat.generateResponse(history, {
        ...sampling,
        ...(typeof options.temperature === "number"
          ? { temperature: options.temperature }
          : {}),
        maxTokens,
        signal,
        stopOnAbortSignal: true,
        budgets: { thoughtTokens },
        ...(tools.length
          ? { functions: toLlamaFunctions(tools), documentFunctionParams: true }
          : {}),
        onTextChunk: (chunk: string) => onToken(chunk),
        onResponseChunk: (chunk: { type?: string; segmentType?: string }) => {
          if (
            !announcedThinking &&
            chunk.type === "segment" &&
            chunk.segmentType === "thought"
          ) {
            announcedThinking = true;
            onActivity("thinking");
          }
        },
      });
      return response;
    });
    lane.queue = run.catch(() => undefined);
    const response = await run;

    const text = String(response.response ?? "").trim();
    const truncated = response.metadata?.stopReason === "maxTokens";
    const functionCalls: Array<{
      functionName: string;
      params: unknown;
      raw: unknown;
    }> = response.functionCalls ?? [];
    const providerContent: LocalProviderContent = {
      kind: "llama",
      response: (response.fullResponse ?? []).filter(
        (part: unknown) => typeof part !== "string" || part.trim() !== "",
      ),
      rawCalls: functionCalls.map((call) => call.raw),
    };
    if (functionCalls.length) {
      return {
        type: "tool_calls",
        content: text,
        toolCalls: functionCalls.map((call) => ({
          id: newCallId(),
          name: call.functionName,
          args: cleanArgs(call.params),
        })),
        truncated,
        providerContent,
      };
    }
    return { type: "text", content: text, truncated, providerContent };
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError" || signal?.aborted) {
      return { type: "text", content: "" };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/Cannot find module 'node-llama-cpp'|ERR_MODULE_NOT_FOUND/.test(message)) {
      return {
        type: "error",
        content:
          "The local model runtime (node-llama-cpp) is not installed in this build. Run `npm install node-llama-cpp` and rebuild, or switch to a cloud provider.",
      };
    }
    return { type: "error", content: `Local model error: ${message}` };
  }
}
