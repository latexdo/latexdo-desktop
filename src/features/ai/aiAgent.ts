// Renderer-side agent loop. Provider-agnostic: it drives a single-step
// `generate` function (which talks to main over IPC) and executes any tool
// calls locally, looping until the model produces a plain-text answer or we hit
// the step budget.

import type { ChatMessage, GenerationStep, ToolCall, ToolSchema } from "./aiTypes";
import {
  agentToolSchemas,
  executeTool,
  isMutatingAgentTool,
  unavailableToolMessage,
  type AgentContext,
  type AgentToolCapabilities,
} from "./aiTools";

export type AgentEvent =
  | { type: "assistant-token"; text: string }
  | { type: "thinking" }
  | { type: "assistant-message"; text: string }
  | { type: "tool-start"; call: ToolCall }
  | {
      type: "tool-result";
      callId: string;
      name: string;
      content: string;
      ok: boolean;
    }
  | { type: "step"; index: number }
  | { type: "done"; reason: "completed" | "max-steps" | "aborted" }
  | { type: "error"; message: string };

export type GenerateStepFn = (
  messages: ChatMessage[],
  tools: ToolSchema[],
  onToken: (text: string) => void,
  onThinking?: () => void,
) => Promise<GenerationStep>;

export interface RunAgentArgs {
  messages: ChatMessage[];
  ctx: AgentContext;
  tools?: ToolSchema[];
  toolCapabilities?: AgentToolCapabilities;
  generate: GenerateStepFn;
  autoApprove: boolean;
  maxSteps: number;
  /** Remind the model once when it describes a requested change without making it. */
  nudgeUnappliedChanges?: boolean;
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => void;
}

/**
 * Try to recover a tool call from a plain-text JSON protocol response.
 * Tolerates the shapes small models actually emit: markdown code fences,
 * OpenAI-style {"name": …, "arguments": …}, and prose around the object.
 */
export function parseJsonToolCall(text: string): ToolCall | null {
  // Strip ```json … ``` fences before hunting for the object.
  const unfenced = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim();
  const simpleCall = unfenced.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*\))?$/);
  if (simpleCall && agentToolSchemas.some((tool) => tool.name === simpleCall[1])) {
    return {
      id: `call_${Math.random().toString(36).slice(2, 10)}`,
      name: simpleCall[1],
      args: {},
    };
  }
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(unfenced.slice(start, end + 1)) as {
      tool?: unknown;
      args?: unknown;
      name?: unknown;
      arguments?: unknown;
    };
    const name =
      typeof obj.tool === "string"
        ? obj.tool
        : typeof obj.name === "string"
          ? obj.name
          : null;
    if (!name) return null;
    const rawArgs = obj.tool != null ? obj.args : (obj.arguments ?? obj.args);
    return {
      id: `call_${Math.random().toString(36).slice(2, 10)}`,
      name,
      args:
        rawArgs && typeof rawArgs === "object"
          ? (rawArgs as Record<string, unknown>)
          : {},
    };
  } catch {
    return null;
  }
}

export function looksLikeProjectAccessRefusal(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  const deniesAccess =
    /\b(?:do not|don't|dont|cannot|can't|cant|won't|wont)\s+(?:currently\s+)?(?:have\s+)?access\b/i.test(
      normalized,
    ) ||
    /\b(?:cannot|can't|cant)\s+(?:access|read|view|open|inspect)\b/i.test(normalized);

  // Small models often don't refuse outright — they deflect by asking the user
  // to paste content that is already in the project ("Please provide the text
  // of the first paragraph…").
  const asksUserToSupply =
    /\b(?:please|could you|can you|i(?:'| a)m going to need you to|i need you to|i(?:'l| wi)l?l need(?: you)?(?: to)?)\s+(?:share|upload|provide|paste|send)\b/i.test(
      normalized,
    ) ||
    /\b(?:share|upload|provide|paste|send)\s+(?:me\s+)?(?:the|your|that|this)\b/i.test(
      normalized,
    );

  if (!deniesAccess && !asksUserToSupply) return false;

  const projectContext =
    /\b(?:current|conversation|discussion|topic|file|files|document|documents|text|contents?|paragraphs?|sections?|abstract|chapters?|project|workspace|latex|tex|bib|bibliography|publication|publications|paper|papers|citation|citations|reference|references)\b/i.test(
      normalized,
    );

  return projectContext || (deniesAccess && asksUserToSupply);
}

/**
 * True when the user asked for a change to their files, as opposed to an
 * explanation: "fix the build", "rewrite the abstract", "add a table".
 */
export function asksForChange(text: string): boolean {
  return /\b(fix|repair|correct|resolve|change|update|rewrite|rephrase|replace|apply|add|insert|remove|delete|rename|convert|translate|shorten|expand)\b/i.test(
    text.replace(/<editor_context>[\s\S]*?<\/editor_context>/g, ""),
  );
}

export async function runAgent(args: RunAgentArgs): Promise<ChatMessage[]> {
  const { ctx, generate, autoApprove, maxSteps, signal, onEvent } = args;
  const messages = [...args.messages];
  const tools = args.tools ?? agentToolSchemas;
  const availableToolNames = new Set(tools.map((tool) => tool.name));
  let retriedProjectAccessRefusal = false;
  let nudgedUnappliedChange = false;
  let changedFiles = false;
  const lastUserText =
    [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const canEdit = tools.some((tool) => isMutatingAgentTool(tool.name));
  // Calls that failed this turn, keyed by name and arguments. Repeating one
  // fails the same way, so the model is told to change approach instead.
  const failedCalls = new Map<string, string>();
  const callKey = (call: ToolCall) => `${call.name}:${JSON.stringify(call.args)}`;

  for (let step = 0; step < maxSteps; step += 1) {
    if (signal?.aborted) {
      onEvent({ type: "done", reason: "aborted" });
      return messages;
    }
    onEvent({ type: "step", index: step });

    let result: GenerationStep;
    try {
      result = await generate(
        messages,
        tools,
        (token) => onEvent({ type: "assistant-token", text: token }),
        () => onEvent({ type: "thinking" }),
      );
    } catch (error) {
      onEvent({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      return messages;
    }

    if (signal?.aborted) {
      onEvent({ type: "done", reason: "aborted" });
      return messages;
    }

    if (result.type === "error") {
      onEvent({ type: "error", message: result.content });
      return messages;
    }

    // Some local models signal tools via JSON text instead of the tool channel.
    let toolCalls: ToolCall[] | null = null;
    if (result.type === "tool_calls") {
      toolCalls = result.toolCalls;
    } else if (result.type === "text") {
      const recovered = parseJsonToolCall(result.content);
      if (recovered) toolCalls = [recovered];
    }

    if (!toolCalls || toolCalls.length === 0) {
      const finalText =
        result.content.trim() +
        (result.truncated
          ? "\n\n_(The reply reached the output limit and was cut off. Ask me to continue.)_"
          : "");
      if (
        !retriedProjectAccessRefusal &&
        step + 1 < maxSteps &&
        looksLikeProjectAccessRefusal(finalText)
      ) {
        retriedProjectAccessRefusal = true;
        messages.push({ role: "assistant", content: finalText });
        messages.push({
          role: "user",
          content:
            "Correction: you are embedded in LatexDo and already have the project context. Never ask me to paste, share, or provide text. If the active document's content is included in your system prompt, answer directly from it now. Otherwise call read_file or get_active_document, then answer from what you read.",
        });
        continue;
      }
      // Small models often describe a fix instead of making it. One reminder
      // per turn, only when the user asked for a change and nothing changed.
      if (
        !nudgedUnappliedChange &&
        args.nudgeUnappliedChanges &&
        canEdit &&
        !changedFiles &&
        step + 1 < maxSteps &&
        asksForChange(lastUserText)
      ) {
        nudgedUnappliedChange = true;
        messages.push({ role: "assistant", content: finalText });
        messages.push({
          role: "user",
          content:
            "You have not changed any file yet. Make the change now with a tool (replace_in_file for part of a file), then compile if it affects the build. If no change is needed, say so in one sentence.",
        });
        continue;
      }
      onEvent({ type: "assistant-message", text: finalText });
      messages.push({
        role: "assistant",
        content: finalText,
        providerContent: result.type === "text" ? result.providerContent : undefined,
      });
      onEvent({ type: "done", reason: "completed" });
      return messages;
    }

    // Record the assistant turn that requested tools, exactly as the provider
    // produced it, so the next step continues the same reasoning.
    messages.push({
      role: "assistant",
      content: result.content,
      toolCalls,
      providerContent:
        result.type === "tool_calls" ? result.providerContent : undefined,
    });

    const truncated = result.type === "tool_calls" && result.truncated;
    const runCall = async (call: ToolCall) => {
      if (truncated) {
        return {
          ok: false,
          content:
            "Not run: the output limit cut this call off, so its arguments are incomplete. Retry with a smaller change, for example edit_selection on one passage or several smaller writes.",
        };
      }
      const previousFailure = failedCalls.get(callKey(call));
      if (previousFailure) {
        return {
          ok: false,
          content: `You already made this exact ${call.name} call and it failed: ${previousFailure.slice(0, 300)}\nRepeating it fails again. Change approach: read the file again and copy the text exactly, try a different tool, or explain the problem to the user.`,
        };
      }
      if (!availableToolNames.has(call.name)) {
        return {
          ok: false,
          content: args.toolCapabilities
            ? unavailableToolMessage(call.name, args.toolCapabilities)
            : "That tool is not available right now. Continue without it, or tell the user which AI setting enables it.",
        };
      }
      onEvent({ type: "tool-start", call });
      return executeTool(call.name, call.args, ctx, { autoApprove });
    };

    // Reads run together; anything that edits or needs approval runs in order.
    const parallel =
      toolCalls.length > 1 &&
      toolCalls.every(
        (call) => !isMutatingAgentTool(call.name) && call.name !== "compile",
      );
    const results: Array<{ ok: boolean; content: string }> = [];
    if (parallel) {
      results.push(...(await Promise.all(toolCalls.map(runCall))));
    } else {
      for (const call of toolCalls) {
        if (signal?.aborted) break;
        results.push(await runCall(call));
      }
    }
    toolCalls.forEach((call, index) => {
      // Every call gets a result, even after a stop, so the transcript stays
      // valid for the next request.
      const toolResult = results[index] ?? {
        ok: false,
        content: "Stopped by the user.",
      };
      if (!toolResult.ok) {
        failedCalls.set(callKey(call), toolResult.content);
      } else if (isMutatingAgentTool(call.name)) {
        // The project changed, so earlier failures may now succeed.
        failedCalls.clear();
        if (!/declined/i.test(toolResult.content)) changedFiles = true;
      }
      onEvent({
        type: "tool-result",
        callId: call.id,
        name: call.name,
        content: toolResult.content,
        ok: toolResult.ok,
      });
      messages.push({
        role: "tool",
        content: toolResult.content,
        toolCallId: call.id,
        name: call.name,
      });
    });
    if (signal?.aborted) {
      onEvent({ type: "done", reason: "aborted" });
      return messages;
    }
  }

  onEvent({ type: "done", reason: "max-steps" });
  return messages;
}
