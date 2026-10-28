import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import type { AiConfig } from "./aiConfig";
import {
  availableAgentToolSchemas,
  type AgentContext,
  type EditProposal,
} from "./aiTools";
import type {
  ChatMessage,
  GenerateRequest,
  GenerationStep,
  ToolSchema,
} from "./aiTypes";
import { buildSystemPrompt, buildTurnContext } from "./aiSystemPrompt";
import { buildResearchContext } from "./researcherProfile";
import { fitToolResults } from "./aiCloud";
import { getCustomDictionaryWords } from "../proofreading/customDictionary";
import { generateStep, abortGeneration } from "./aiClient";
import { runAgent, type AgentEvent } from "./aiAgent";
import { resolveAiRuntime } from "./product/aiRuntimeResolver";
import {
  attachMentionedFiles,
  expandSlashCommand,
  extractFileMentions,
} from "./aiMentions";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Interleaved tool activity for display. */
  activity: { name: string; ok: boolean; summary: string }[];
  pending?: boolean;
}

interface PersistedAiAgentState {
  version: 1;
  messages: UiMessage[];
  history: ChatMessage[];
  updatedAt: number;
}

const maxPersistedUiMessages = 80;
const maxPersistedHistoryMessages = 80;
const maxPersistedContentLength = 12_000;

const accessDenied = (setting: string) =>
  Promise.reject(new Error(`${setting} access is disabled in AI settings.`));
const noProjectOpen = <T>() =>
  Promise.reject<T>(new Error("No LatexDo project is open."));

function newId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function trimText(value: string): string {
  return value.length > maxPersistedContentLength
    ? `${value.slice(0, maxPersistedContentLength)}\n\n[trimmed]`
    : value;
}

function normalizeUiMessage(raw: unknown): UiMessage | null {
  const value = raw as Partial<UiMessage>;
  if (
    typeof value.id !== "string" ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.text !== "string"
  ) {
    return null;
  }
  const activity = Array.isArray(value.activity)
    ? value.activity
        .map((item) => {
          const activityItem = item as Partial<UiMessage["activity"][number]>;
          if (
            typeof activityItem.name !== "string" ||
            typeof activityItem.ok !== "boolean" ||
            typeof activityItem.summary !== "string"
          ) {
            return null;
          }
          return {
            name: activityItem.name.slice(0, 120),
            ok: activityItem.ok,
            summary: trimText(activityItem.summary).slice(0, 400),
          };
        })
        .filter((item): item is UiMessage["activity"][number] => item !== null)
    : [];
  return {
    id: value.id,
    role: value.role,
    text: trimText(value.text),
    activity,
    pending: false,
  };
}

function normalizeChatMessage(raw: unknown): ChatMessage | null {
  const value = raw as Partial<ChatMessage>;
  if (
    (value.role !== "system" &&
      value.role !== "user" &&
      value.role !== "assistant" &&
      value.role !== "tool") ||
    typeof value.content !== "string"
  ) {
    return null;
  }
  return {
    role: value.role,
    content: trimText(value.content),
    toolCalls: Array.isArray(value.toolCalls) ? value.toolCalls : undefined,
    toolCallId: typeof value.toolCallId === "string" ? value.toolCallId : undefined,
    name: typeof value.name === "string" ? value.name : undefined,
  };
}

/**
 * Keeps the system prompt and the most recent messages. The kept part starts
 * on a user message so no tool result is separated from its call.
 */
export function trimHistory(history: ChatMessage[], max: number): ChatMessage[] {
  const system = history[0]?.role === "system" ? history[0] : null;
  const rest = system ? history.slice(1) : history;
  let tail = rest.slice(-Math.max(1, max - (system ? 1 : 0)));
  const firstUser = tail.findIndex((message) => message.role === "user");
  tail = firstUser === -1 ? [] : tail.slice(firstUser);
  return system ? [system, ...tail] : tail;
}

function loadPersistedState(storageKey?: string): PersistedAiAgentState | null {
  if (!storageKey) return null;
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "null",
    ) as Partial<PersistedAiAgentState> | null;
    if (!raw || raw.version !== 1) return null;
    const messages = Array.isArray(raw.messages)
      ? raw.messages
          .map(normalizeUiMessage)
          .filter((message): message is UiMessage => message !== null)
          .slice(-maxPersistedUiMessages)
      : [];
    const history = Array.isArray(raw.history)
      ? trimHistory(
          raw.history
            .map(normalizeChatMessage)
            .filter((message): message is ChatMessage => message !== null),
          maxPersistedHistoryMessages,
        )
      : [];
    return {
      version: 1,
      messages,
      history,
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function savePersistedState(
  storageKey: string | undefined,
  messages: UiMessage[],
  history: ChatMessage[],
): void {
  if (!storageKey) return;
  const payload: PersistedAiAgentState = {
    version: 1,
    messages: messages
      .map(normalizeUiMessage)
      .filter((message): message is UiMessage => message !== null)
      .slice(-maxPersistedUiMessages),
    history: trimHistory(
      history
        .map(normalizeChatMessage)
        .filter((message): message is ChatMessage => message !== null),
      maxPersistedHistoryMessages,
    ),
    updatedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // Ignore quota/private-mode failures; chat still works for this session.
  }
}

function clearPersistedState(storageKey?: string): void {
  if (!storageKey) return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore localStorage failures.
  }
}

export function supportsNativeTools(config: AiConfig): boolean {
  const runtime = resolveAiRuntime(config);
  if (runtime.provider === "cloud") return true;
  if (runtime.provider === "ollama") return true;
  // The local runtime calls tools in the model's own format, with arguments
  // constrained by a grammar.
  return runtime.provider === "local";
}

/** Characters of history a local model gets; older tool results go first. */
const localHistoryBudgetChars = 60_000;

function buildRequest(
  config: AiConfig,
  requestId: string,
  messages: ChatMessage[],
  tools: ToolSchema[],
): GenerateRequest {
  const runtime = resolveAiRuntime(config);
  const local = runtime.provider === "local" || runtime.provider === "ollama";
  return {
    requestId,
    provider: runtime.provider,
    // Claude clears old tool results server-side; local models get a budget.
    messages: local ? fitToolResults(messages, localHistoryBudgetChars) : messages,
    tools,
    options: {
      modelId: runtime.provider === "local" ? runtime.modelId : config.modelId,
      fileName: runtime.provider === "local" ? runtime.fileName : undefined,
      // Agent turns read, edit and debug LaTeX: worth the deeper reasoning.
      effort: "high",
      maxTokens: local ? 4096 : 32_000,
      ollamaBaseUrl:
        runtime.provider === "ollama" ? runtime.baseUrl : config.ollamaBaseUrl,
      ollamaModel: runtime.provider === "ollama" ? runtime.model : config.ollamaModel,
      cloudVendor: config.cloud.vendor,
      cloudBaseUrl:
        runtime.provider === "cloud" ? runtime.baseUrl : config.cloud.baseUrl,
      cloudModel: runtime.provider === "cloud" ? runtime.model : config.cloud.model,
      cloudCredentialId:
        runtime.provider === "cloud" ? runtime.credentialId : config.cloud.credentialId,
    },
  };
}

interface SendOptions {
  displayText?: string;
}

export function useAiAgent(config: AiConfig, ctx: AgentContext, storageKey?: string) {
  const persistedStateRef = useRef<PersistedAiAgentState | null>(null);
  if (persistedStateRef.current === null) {
    persistedStateRef.current = loadPersistedState(storageKey) ?? {
      version: 1,
      messages: [],
      history: [],
      updatedAt: 0,
    };
  }
  const [messages, setMessagesState] = useState<UiMessage[]>(
    () => persistedStateRef.current?.messages ?? [],
  );
  const messagesRef = useRef<UiMessage[]>(messages);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const activeRequestId = useRef<string>("");
  // The full model-facing transcript, kept in parallel to the UI messages.
  const historyRef = useRef<ChatMessage[]>(persistedStateRef.current?.history ?? []);
  // The project listing an earlier turn sent; unchanged listings aren't resent.
  const lastSentFilesRef = useRef<string[] | null>(null);

  const setMessages = useCallback((next: SetStateAction<UiMessage[]>) => {
    setMessagesState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      messagesRef.current = resolved;
      return resolved;
    });
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
    if (!storageKey) return;
    const timer = window.setTimeout(() => {
      savePersistedState(storageKey, messages, historyRef.current);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [messages, storageKey]);

  // Step-by-step approval: in "ask" mode the agent pauses on each mutating
  // action until the user approves or declines.
  const [pendingApproval, setPendingApproval] = useState<EditProposal | null>(null);
  const approvalResolverRef = useRef<((ok: boolean) => void) | null>(null);

  const resolveApproval = useCallback((ok: boolean) => {
    const resolve = approvalResolverRef.current;
    approvalResolverRef.current = null;
    setPendingApproval(null);
    resolve?.(ok);
  }, []);

  const requestApprovalInteractive = useCallback(
    (proposal: EditProposal): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        approvalResolverRef.current = resolve;
        setPendingApproval(proposal);
        setStatus("Waiting for your approval…");
      }),
    [],
  );

  const clearPendingApproval = useCallback((approved: boolean) => {
    const resolve = approvalResolverRef.current;
    approvalResolverRef.current = null;
    setPendingApproval(null);
    resolve?.(approved);
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    if (activeRequestId.current) void abortGeneration(activeRequestId.current);
    clearPendingApproval(false);
    setIsRunning(false);
    setStatus("Stopped.");
  }, [clearPendingApproval]);

  const send = useCallback(
    async (userText: string, options?: SendOptions) => {
      const text = userText.trim();
      if (!text || isRunning) return;
      const displayText = options?.displayText?.trim() || text;

      const access = config.access;
      const hasProject = ctx.hasProject?.() ?? true;
      // Give the model the project layout up front so it can answer questions
      // about any file in the project without being told which one.
      let projectFiles: string[] = [];
      if (hasProject && access.projectFiles) {
        try {
          projectFiles = await ctx.listFiles();
        } catch {
          projectFiles = [];
        }
      }
      const sel = access.currentEditor
        ? ctx.selection()
        : { text: "", hasSelection: false };
      // Small local models are unreliable at tool calling, so inline the open
      // document into the system prompt (replaced each turn, so only one copy
      // ever lives in the transcript). Tool-capable providers read on demand.
      const nativeTools = supportsNativeTools(config);
      const runtimeProvider = resolveAiRuntime(config).provider;
      const runtimeIsLocal =
        runtimeProvider === "local" || runtimeProvider === "ollama";
      const activePath = access.currentEditor ? ctx.activeFilePath() : null;
      const activeDocument =
        !nativeTools && activePath
          ? { path: activePath, text: ctx.documentText() }
          : null;
      const toolCapabilities = {
        hasKnowledgeGraph:
          access.currentEditor && ctx.workspaceTab?.()?.kind === "knowledge-graph",
        hasProject,
        hasActiveDocument: Boolean(activePath),
        hasSelection: sel.hasSelection,
        access,
      };
      const availableTools = availableAgentToolSchemas(toolCapabilities);
      const system = buildSystemPrompt({
        perTurnContext: true,
        userName: config.userName || config.profile.displayName,
        projectName: ctx.projectName(),
        hasProject,
        activeFilePath: activePath,
        hasSelection: sel.hasSelection,
        providerSupportsNativeTools: nativeTools,
        availableTools,
        access,
        researchContext: access.researcherProfile
          ? buildResearchContext(config.profile)
          : null,
        projectFiles: access.projectFiles ? projectFiles : null,
        activeDocument,
        workspaceTab: access.currentEditor ? ctx.workspaceTab?.() : null,
        customWords: getCustomDictionaryWords(),
      });

      // `\command` expands to its full instruction; `@file` mentions get the
      // referenced files' contents attached to the model-facing message. The
      // UI keeps showing exactly what the user typed.
      const mentions = extractFileMentions(text, projectFiles);
      const modelText = await attachMentionedFiles(
        expandSlashCommand(text),
        mentions,
        ctx.readFile,
      );

      if (!access.chatHistory) {
        historyRef.current = [];
      }

      // The system prompt stays the same for the whole conversation so the
      // provider's cache and Claude's reasoning stay valid; what changes per
      // turn travels in the user's message.
      if (historyRef.current[0]?.role !== "system") {
        historyRef.current.unshift({ role: "system", content: system });
      } else if (historyRef.current[0].content !== system) {
        historyRef.current[0] = { role: "system", content: system };
      }
      const turnContext = buildTurnContext(
        {
          hasProject,
          activeFilePath: activePath,
          hasSelection: sel.hasSelection,
          projectFiles: access.projectFiles ? projectFiles : null,
          activeDocument,
        },
        lastSentFilesRef.current,
      );
      lastSentFilesRef.current = access.projectFiles ? projectFiles : null;
      historyRef.current.push({
        role: "user",
        content: `${turnContext}\n\n${modelText}`,
      });

      const userMsg: UiMessage = {
        id: newId(),
        role: "user",
        text: displayText,
        activity: [],
      };
      const assistantMsg: UiMessage = {
        id: newId(),
        role: "assistant",
        text: "",
        activity: [],
        pending: true,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      const controller = new AbortController();
      abortRef.current = controller;
      setIsRunning(true);
      setStatus("Thinking…");

      const patchAssistant = (patch: (m: UiMessage) => UiMessage) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? patch(m) : m)),
        );

      const generate = async (
        msgs: ChatMessage[],
        tools: ToolSchema[],
        onToken: (t: string) => void,
        onThinking?: () => void,
      ): Promise<GenerationStep> => {
        const requestId = newId();
        activeRequestId.current = requestId;
        const req = buildRequest(config, requestId, msgs, tools);
        return generateStep(req, onToken, () => onThinking?.());
      };

      const onEvent = (event: AgentEvent) => {
        switch (event.type) {
          case "assistant-token":
            setStatus("");
            patchAssistant((m) => ({ ...m, text: m.text + event.text }));
            break;
          case "thinking":
            setStatus("Thinking…");
            break;
          case "assistant-message":
            patchAssistant((m) => ({ ...m, text: event.text, pending: false }));
            break;
          case "tool-start":
            setStatus(`Running ${event.call.name}…`);
            break;
          case "tool-result":
            patchAssistant((m) => ({
              ...m,
              activity: [
                ...m.activity,
                {
                  name: event.name,
                  ok: event.ok,
                  summary: event.content.slice(0, 200),
                },
              ],
            }));
            break;
          case "error":
            patchAssistant((m) => ({
              ...m,
              text: (m.text ? m.text + "\n\n" : "") + `⚠️ ${event.message}`,
              pending: false,
            }));
            break;
          case "done":
            patchAssistant((m) => ({
              ...m,
              text:
                event.reason === "max-steps"
                  ? `${m.text ? `${m.text}\n\n` : ""}_I paused after ${config.maxAgentSteps} steps. Say "continue" to let me keep going._`
                  : m.text,
              pending: false,
            }));
            break;
        }
      };

      // Approvals go through the sidebar UI unless the user turned them off
      // in AI settings; then autoApprove skips requestApproval.
      const effectiveCtx: AgentContext = {
        ...ctx,
        hasProject: () => hasProject,
        activeFilePath: () => (access.currentEditor ? ctx.activeFilePath() : null),
        listFiles: () =>
          hasProject && access.projectFiles
            ? ctx.listFiles()
            : hasProject
              ? accessDenied("Project files")
              : noProjectOpen(),
        readFile: (path) =>
          hasProject && access.projectFiles
            ? ctx.readFile(path)
            : hasProject
              ? accessDenied("Project files")
              : noProjectOpen(),
        writeFile: (path, content) =>
          hasProject && access.projectFiles
            ? ctx.writeFile(path, content)
            : hasProject
              ? accessDenied("Project files")
              : noProjectOpen(),
        documentText: () => (access.currentEditor ? ctx.documentText() : ""),
        selection: () =>
          access.currentEditor ? ctx.selection() : { text: "", hasSelection: false },
        applyEdit: (proposal) =>
          access.currentEditor
            ? ctx.applyEdit(proposal)
            : accessDenied("Current editor"),
        insertCitation: (query) =>
          access.bibliography
            ? ctx.insertCitation(query)
            : accessDenied("Bibliography"),
        recommendCitations: (passage) =>
          access.bibliography
            ? ctx.recommendCitations(passage)
            : accessDenied("Bibliography"),
        requestApproval: requestApprovalInteractive,
      };

      try {
        const updatedHistory = await runAgent({
          messages: historyRef.current,
          ctx: effectiveCtx,
          tools: availableTools,
          toolCapabilities,
          generate,
          autoApprove: config.autoApproveEdits,
          maxSteps: config.maxAgentSteps,
          // On-device models need the reminder; cloud models apply changes.
          nudgeUnappliedChanges: runtimeIsLocal,
          signal: controller.signal,
          onEvent,
        });
        historyRef.current = access.chatHistory ? updatedHistory : [];
        savePersistedState(storageKey, messagesRef.current, historyRef.current);
      } finally {
        setIsRunning(false);
        setStatus("");
        abortRef.current = null;
      }
    },
    [config, ctx, isRunning, requestApprovalInteractive, setMessages, storageKey],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    if (activeRequestId.current) void abortGeneration(activeRequestId.current);
    abortRef.current = null;
    activeRequestId.current = "";
    clearPendingApproval(false);
    historyRef.current = [];
    lastSentFilesRef.current = null;
    setMessages([]);
    clearPersistedState(storageKey);
    setIsRunning(false);
    setStatus("");
  }, [clearPendingApproval, setMessages, storageKey]);

  return {
    messages,
    isRunning,
    status,
    send,
    abort,
    reset,
    pendingApproval,
    resolveApproval,
    /** Expose approval for external selection-AI workflows (reformulate). */
    proposeEdit: requestApprovalInteractive,
  };
}
