import { AiIcon } from "./AiIcon";
import React from "react";
import { AiMessageMarkdown } from "./AiMessageMarkdown";
import {
  ArrowUp,
  Square,
  Plus,
  Maximize2,
  Minimize2,
  Settings2,
  Wrench,
  Check,
  X,
  ShieldCheck,
  AlertTriangle,
  CircleSlash,
  Trash2,
  Shapes,
  ChevronDown,
} from "lucide-react";
import type { AiConfig } from "../features/ai/aiConfig";
import type { AgentContext, EditProposal } from "../features/ai/aiTools";
import { findLocalModel } from "../features/ai/aiModels";
import { findCloudProvider } from "../features/ai/cloudProviders";
import { findLatexDoAiTier } from "../features/ai/product/latexDoAiTiers";
import { useAiAgent } from "../features/ai/useAiAgent";
import { containsTikz } from "../features/tikz/tikzSnippet";
import { emitProductEvent } from "../features/onboarding/core/ProductEvents";
import {
  detectTrigger,
  filterCommandSuggestions,
  filterFileSuggestions,
  type MentionTrigger,
} from "../features/ai/aiMentions";
import {
  buildSelectionMessageText,
  type AiComposerSelectionContext,
} from "../features/ai/selectionAi";
import {
  createTranscriptionProvider,
  openAiVoiceCredentialId,
} from "../features/voice/transcription";
import { createTranscriptCleanup } from "../features/voice/transcriptCleanup";
import type { VoiceDictationStatus } from "../features/voice/types";
import { useVoiceDictation } from "../features/voice/useVoiceDictation";
import {
  voiceSttCredentialId,
  defaultLocalTranscriptionBaseUrl,
} from "../features/voice/voiceSettings";
import { useVoiceSettings } from "../features/voice/useVoiceSettings";
import { VoiceDictationButton } from "./VoiceDictationButton";
import { VoiceRecordingBar, isVoiceBarStatus } from "./VoiceRecordingBar";
import { LocalSpeechInstallCard } from "./LocalSpeechInstallCard";
import { useLocalSpeechInstall } from "../features/voice/useLocalSpeechInstall";

interface Suggestion {
  /** Text inserted after the trigger character. */
  value: string;
  /** Secondary line (command hint or file directory). */
  hint?: string;
}

interface SuggestState {
  trigger: MentionTrigger;
  items: Suggestion[];
}

/** Imperative handle exposed via apiRef so App can propose edits and attach selections. */
export interface AiSidebarApi {
  proposeEdit(proposal: EditProposal): Promise<boolean>;
  appendSelectionContext(selection: AiComposerSelectionContext): void;
  /** Type `@` in the composer and open the project-file picker. */
  startFileMention(): void;
  /**
   * Sends a prepared request: the model gets `prompt`, the chat shows
   * `displayText`. False when no provider is set up or a reply is running.
   */
  sendPrompt(prompt: string, displayText: string): boolean;
}

interface AiSidebarProps {
  workspaceTarget?: {
    value: string;
    tabs: { id: string; label: string }[];
    activeLabel: string;
    onChange: (id: string) => void;
  };
  config: AiConfig;
  ctx: AgentContext;
  isDesktop: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenSettings: () => void;
  onOpenExternal?: (url: string) => void;
  storageKey?: string;
  /** Pass only for the active chat pane so App can drive selection-AI workflows. */
  apiRef?: React.MutableRefObject<AiSidebarApi | null>;
  /** Puts a TikZ figure from an answer into the document and previews it. */
  onInsertFigure?: (code: string) => void;
}

/** The TikZ code blocks of an answer, in order. */
export function tikzBlocksIn(text: string): string[] {
  return [...text.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)]
    .map((match) => match[1].trim())
    .filter(containsTikz);
}

const editKindLabel: Record<string, string> = {
  "replace-selection": "Replace selection",
  "insert-at-cursor": "Insert at cursor",
  "replace-file": "Overwrite file",
};

/** Empty-chat greeting, by first name when the profile has one. */
function greeting(userName: string): string {
  const firstName = userName.trim().split(/\s+/)[0];
  return firstName ? `Nice to see you, ${firstName}.` : "What are we writing today?";
}

function providerLabel(config: AiConfig): string {
  if (config.provider === "local" && config.selection.mode === "latexdo") {
    return findLatexDoAiTier(config.selection.tier)?.name ?? "LatexDo AI";
  }
  switch (config.provider) {
    case "local":
      return findLocalModel(config.modelId)?.name ?? "Local model";
    case "ollama":
      return `Ollama · ${config.ollamaModel}`;
    case "cloud":
      return `Cloud · ${config.cloud.model}`;
    default:
      return "AI off";
  }
}

export function isAiConfigured(config: AiConfig, isDesktop: boolean): boolean {
  if (config.provider === "off") return false;
  if (config.provider === "cloud") return config.cloud.credentialConfigured;
  if (!isDesktop) return false; // local/ollama need desktop
  if (config.provider === "local") return config.modelDownloaded;
  return true; // ollama
}

function openAiSpeechCredentialId(config: AiConfig): string {
  return config.cloud.providerId === "openai"
    ? config.cloud.credentialId
    : openAiVoiceCredentialId;
}

export const AiSidebar: React.FC<AiSidebarProps> = ({
  config,
  workspaceTarget,
  ctx,
  isDesktop,
  expanded,
  onToggleExpanded,
  onOpenSettings,
  onOpenExternal,
  storageKey,
  apiRef,
  onInsertFigure,
}) => {
  const {
    messages,
    isRunning,
    status,
    send,
    abort,
    reset,
    pendingApproval,
    resolveApproval,
    proposeEdit,
  } = useAiAgent(config, ctx, storageKey);
  const [input, setInput] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const configured = isAiConfigured(config, isDesktop);
  const canClearChat =
    messages.length > 0 || isRunning || Boolean(status) || Boolean(pendingApproval);
  const cloudProvider =
    config.provider === "cloud" ? findCloudProvider(config.cloud.providerId) : null;

  // Selection context for Ask AI about Selection workflow.
  const [composerSelection, setComposerSelection] =
    React.useState<AiComposerSelectionContext | null>(null);

  // Voice dictation: when a dictation finishes, place the transcript straight
  // into the AI composer so the user can review and send it as a chat prompt.
  const [voiceSettings, saveVoiceSettingsState] = useVoiceSettings();

  const sttEndpoint = voiceSettings.sttBaseUrl.trim();
  const transcriptionProvider = React.useMemo(() => {
    if (voiceSettings.sttMode === "openai") {
      return createTranscriptionProvider(config, {
        mode: "openai",
        model: voiceSettings.cloudTranscriptionModel,
        credentialId: openAiSpeechCredentialId(config),
      });
    }
    return createTranscriptionProvider(config, {
      mode: "local",
      model: voiceSettings.transcriptionModel,
      baseUrl: sttEndpoint || undefined,
      credentialId: sttEndpoint ? voiceSttCredentialId : undefined,
    });
  }, [config, voiceSettings, sttEndpoint]);
  const cleanupProvider = React.useMemo(
    () => createTranscriptCleanup(config),
    [config],
  );
  const voiceStatusRef = React.useRef<VoiceDictationStatus>("idle");
  // Which bar button ended the recording: ↑ sends the transcript, ■ only
  // puts it in the composer for editing.
  const [voicePending, setVoicePending] = React.useState<"stop" | "send" | null>(null);
  const voicePendingRef = React.useRef<"stop" | "send" | null>(null);
  const setVoiceIntent = (intent: "stop" | "send" | null) => {
    voicePendingRef.current = intent;
    setVoicePending(intent);
  };
  const [suggest, setSuggest] = React.useState<SuggestState | null>(null);
  const [highlight, setHighlight] = React.useState(0);

  const insertVoiceTranscriptIntoComposer = React.useCallback((text: string) => {
    const transcript = text.trim();
    if (!transcript) return;
    let nextCaret = 0;
    setInput((prev) => {
      const ta = inputRef.current;
      const rawStart = ta?.selectionStart ?? prev.length;
      const rawEnd = ta?.selectionEnd ?? rawStart;
      const start = Math.max(0, Math.min(prev.length, rawStart));
      const end = Math.max(start, Math.min(prev.length, rawEnd));
      const before = prev.slice(0, start);
      const after = prev.slice(end);
      const leading = before && !/\s$/.test(before) ? " " : "";
      const trailing = after && !/^\s/.test(after) ? " " : "";
      const insertion = `${leading}${transcript}${trailing}`;
      nextCaret = before.length + insertion.length;
      return `${before}${insertion}${after}`;
    });
    setSuggest(null);
    emitProductEvent({ type: "voice:inserted" });
    requestAnimationFrame(() => {
      const ta = inputRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextCaret, nextCaret);
    });
  }, []);

  const voice = useVoiceDictation({
    transcriptMode: voiceSettings.transcriptMode,
    maxDurationMs: voiceSettings.maxDurationMs,
    transcriptionProvider,
    cleanup: voiceSettings.transcriptMode === "clean" ? cleanupProvider : null,
    onTranscript: (text) => {
      const sendNow = voicePendingRef.current === "send" && !isRunning;
      setVoiceIntent(null);
      if (sendNow) {
        const typed = (inputRef.current?.value ?? input).trim();
        submitText(typed ? `${typed} ${text.trim()}` : text.trim());
        return;
      }
      insertVoiceTranscriptIntoComposer(text);
    },
    onError: (voiceError) => {
      setVoiceIntent(null);
      emitProductEvent({ type: "voice:failed", code: voiceError.code });
    },
    onStatusChange: (next) => {
      const prev = voiceStatusRef.current;
      if (next === "recording" && prev !== "recording") {
        emitProductEvent({ type: "voice:started" });
      }
      if (next === "success") {
        emitProductEvent({ type: "voice:completed" });
      }
      if (
        (prev === "recording" ||
          prev === "processing" ||
          prev === "transcribing" ||
          prev === "cleaning") &&
        next === "idle"
      ) {
        emitProductEvent({ type: "voice:cancelled" });
      }
      voiceStatusRef.current = next;
    },
  });
  // Local speech is installed on demand: the mic offers the download instead
  // of failing after a recording that then cannot be transcribed.
  const localSpeech = useLocalSpeechInstall();
  const [speechPromptOpen, setSpeechPromptOpen] = React.useState(false);
  // The bundled server answers on the default endpoint; a custom local server
  // the person runs themselves needs no install.
  const usesBundledSpeech =
    voiceSettings.sttMode !== "openai" &&
    (!sttEndpoint ||
      sttEndpoint.replace(/\/$/, "") === defaultLocalTranscriptionBaseUrl);
  const voiceBarVisible = isVoiceBarStatus(voice.status);
  const voiceNeedsInstall =
    voice.error?.cause === "missing-runtime" || voice.error?.cause === "missing-model";
  const handleVoiceStart = () => {
    void (async () => {
      if (usesBundledSpeech && isDesktop) {
        const status = await localSpeech.refresh();
        if (status.phase === "missing") {
          setSpeechPromptOpen(true);
          return;
        }
      }
      setSpeechPromptOpen(false);
      void voice.start();
    })();
  };
  const installLocalSpeech = () => {
    setSpeechPromptOpen(true);
    void localSpeech.install().then((ok) => {
      if (!ok) return;
      setSpeechPromptOpen(false);
      void voice.start();
    });
  };
  React.useEffect(() => {
    if (voiceNeedsInstall) {
      setSpeechPromptOpen(true);
      void localSpeech.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceNeedsInstall]);

  // Imperative handle: App calls these via apiRef.
  const appendSelectionContext = React.useCallback(
    (sel: AiComposerSelectionContext) => {
      setComposerSelection(sel);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    },
    [],
  );

  // `@` file mentions and `\` quick commands: an autocomplete popup driven by
  // the caret position. Project files are (re)fetched when a file popup opens.
  const filesRef = React.useRef<string[]>([]);
  const filesLoading = React.useRef(false);

  const refreshFiles = React.useCallback(
    (onLoaded?: () => void) => {
      if (filesLoading.current) return;
      filesLoading.current = true;
      ctx
        .listFiles()
        .then((files) => {
          filesRef.current = files;
          onLoaded?.();
        })
        .catch(() => {
          filesRef.current = [];
        })
        .finally(() => {
          filesLoading.current = false;
        });
    },
    [ctx],
  );

  const updateSuggestions = React.useCallback(
    (value: string, caret: number) => {
      const trigger = detectTrigger(value, caret);
      if (!trigger) {
        setSuggest(null);
        return;
      }
      let items: Suggestion[];
      if (trigger.kind === "file") {
        if (filesRef.current.length === 0) {
          // The first `@` lands before the file list does: reopen the popup
          // for the current caret once the files arrive.
          refreshFiles(() => {
            const ta = inputRef.current;
            if (!ta || document.activeElement !== ta) return;
            const current = detectTrigger(ta.value, ta.selectionStart ?? 0);
            if (current?.kind !== "file") return;
            const loaded = filterFileSuggestions(filesRef.current, current.query).map(
              (path) => ({ value: path }),
            );
            setSuggest(loaded.length ? { trigger: current, items: loaded } : null);
            setHighlight(0);
          });
        }
        items = filterFileSuggestions(filesRef.current, trigger.query).map((path) => ({
          value: path,
        }));
      } else {
        items = filterCommandSuggestions(trigger.query).map((c) => ({
          value: c.name,
          hint: c.hint,
        }));
      }
      setSuggest(items.length ? { trigger, items } : null);
      setHighlight(0);
    },
    [refreshFiles],
  );

  // "+" starts an @ mention so the file picker opens at the caret.
  const attachFile = () => {
    const ta = inputRef.current;
    const start = ta?.selectionStart ?? input.length;
    const end = ta?.selectionEnd ?? start;
    const before = input.slice(0, start);
    const insertion = before && !/\s$/.test(before) ? " @" : "@";
    const next = `${before}${insertion}${input.slice(end)}`;
    const caret = before.length + insertion.length;
    setInput(next);
    updateSuggestions(next, caret);
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(caret, caret);
    });
  };

  const acceptSuggestion = React.useCallback(
    (item: Suggestion, trigger: MentionTrigger) => {
      const mark = trigger.kind === "file" ? "@" : "\\";
      const prefix = `${input.slice(0, trigger.start)}${mark}${item.value} `;
      setInput(prefix + input.slice(trigger.end));
      setSuggest(null);
      emitProductEvent(
        trigger.kind === "file"
          ? { type: "ai:file-context-attached", path: item.value }
          : { type: "ai:command-selected", command: item.value },
      );
      requestAnimationFrame(() => {
        const ta = inputRef.current;
        if (!ta) return;
        ta.focus();
        ta.selectionStart = ta.selectionEnd = prefix.length;
      });
    },
    [input],
  );

  const startFileMention = React.useCallback(() => {
    const prev = inputRef.current?.value ?? "";
    const next = /(^|[\s([{])@$/.test(prev)
      ? prev
      : `${prev}${prev && !/\s$/.test(prev) ? " " : ""}@`;
    setInput(next);
    requestAnimationFrame(() => {
      const ta = inputRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(next.length, next.length);
      updateSuggestions(next, next.length);
    });
  }, [updateSuggestions]);

  const sendPrompt = React.useCallback(
    (prompt: string, displayText: string) => {
      if (!configured || isRunning) return false;
      void send(prompt, { displayText });
      return true;
    },
    [configured, isRunning, send],
  );

  // Expose the imperative handle to App via apiRef.
  React.useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      proposeEdit,
      appendSelectionContext,
      startFileMention,
      sendPrompt,
    };
    return () => {
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposeEdit, appendSelectionContext, startFileMention, sendPrompt]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const submit = () => submitText(input.trim());

  function submitText(text: string) {
    if (isRunning) return;
    // Compose message: selection context (if attached) + user's own text.
    const block = composerSelection ? buildSelectionMessageText(composerSelection) : "";
    const fullMessage = block ? (text ? `${block}\n\n${text}` : block) : text;
    if (!fullMessage) return;
    setInput("");
    setSuggest(null);
    void send(fullMessage);
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggest) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setHighlight((h) => (h + delta + suggest.items.length) % suggest.items.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        acceptSuggestion(suggest.items[highlight], suggest.trigger);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSuggest(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className={`ai-sidebar ${configured && messages.length === 0 ? "is-empty" : ""}`}
    >
      {/* One row: target tab, model and approval state beside the actions. */}
      <div className="ai-sidebar-header">
        <div className="ai-sidebar-context">
          {workspaceTarget ? (
            <select
              className="ai-workspace-target"
              aria-label="AI target tab"
              title="Work with tab"
              value={workspaceTarget.value}
              disabled={isRunning}
              onChange={(event) => {
                setComposerSelection(null);
                workspaceTarget.onChange(event.target.value);
              }}
            >
              <option value="active">Active tab · {workspaceTarget.activeLabel}</option>
              {workspaceTarget.tabs.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.label}
                </option>
              ))}
              {workspaceTarget.value !== "active" &&
              !workspaceTarget.tabs.some((tab) => tab.id === workspaceTarget.value) ? (
                <option value={workspaceTarget.value}>
                  Closed tab — choose a target
                </option>
              ) : null}
            </select>
          ) : (
            <AiIcon size={15} />
          )}
          <span className="ai-sidebar-model" title={providerLabel(config)}>
            {providerLabel(config)}
          </span>
          <span
            className="ai-approval-badge"
            role="img"
            aria-label="Approval required"
            title="Approval required: the assistant must ask before applying edits or writing files."
          >
            <ShieldCheck size={13} />
          </span>
        </div>
        <div className="ai-sidebar-actions">
          <button
            className="small-icon"
            title={expanded ? "Collapse AI chat" : "Expand AI chat"}
            aria-label={expanded ? "Collapse AI chat" : "Expand AI chat"}
            aria-pressed={expanded}
            onClick={onToggleExpanded}
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button className="small-icon" title="New chat" onClick={reset}>
            <Plus size={15} />
          </button>
          <button
            type="button"
            className="small-icon"
            title="Clear chat"
            aria-label="Clear chat"
            onClick={reset}
            disabled={!canClearChat}
          >
            <Trash2 size={14} />
          </button>
          <button className="small-icon" title="AI settings" onClick={onOpenSettings}>
            <Settings2 size={15} />
          </button>
        </div>
      </div>

      {!configured ? (
        <div className="ai-sidebar-empty">
          <CircleSlash size={30} />
          <p>AI isn't ready yet.</p>
          <p className="sub-text">
            {config.provider === "cloud"
              ? "Add your API key in AI settings."
              : !isDesktop
                ? "Local models need the desktop app. Switch to a cloud provider for the browser."
                : "Download a model to get started."}
          </p>
          <button className="ai-wizard-primary" onClick={onOpenSettings}>
            Open AI settings
          </button>
          {config.provider === "cloud" && cloudProvider?.apiKeyUrl ? (
            <button
              type="button"
              className="cloud-form-link"
              onClick={() => onOpenExternal?.(cloudProvider.apiKeyUrl)}
            >
              Get API key
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="ai-sidebar-messages" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="ai-empty-greeting">
                <h2>{greeting(config.userName)}</h2>
                <p className="ai-sidebar-hints-tip">
                  Type <code>@</code> to attach a project file, or <code>\</code> for
                  quick commands.
                </p>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`ai-msg ai-msg-${m.role}`}>
                {m.role === "assistant" && m.activity.length > 0 && (
                  <div className="ai-msg-activity">
                    {m.activity.map((a, i) => (
                      <div
                        key={i}
                        className={`ai-tool-chip ${a.ok ? "" : "error"}`}
                        title={a.summary}
                      >
                        {a.ok ? <Wrench size={11} /> : <AlertTriangle size={11} />}
                        <span>{a.name}</span>
                        {a.ok && <Check size={11} />}
                      </div>
                    ))}
                  </div>
                )}
                <div className="ai-msg-text">
                  {m.role === "assistant" ? (
                    <AiMessageMarkdown
                      text={m.text || (m.pending ? "…" : "")}
                      onOpenExternal={onOpenExternal}
                    />
                  ) : (
                    m.text
                  )}
                </div>
                {m.role === "assistant" && !m.pending && onInsertFigure
                  ? tikzBlocksIn(m.text).map((code, index, blocks) => (
                      <button
                        key={index}
                        type="button"
                        className="ai-insert-figure"
                        onClick={() => onInsertFigure(code)}
                        title="Insert this figure at the cursor and show it in the PDF preview"
                      >
                        <Shapes size={12} />
                        {blocks.length > 1
                          ? `Insert figure ${index + 1}`
                          : "Insert figure"}
                      </button>
                    ))
                  : null}
              </div>
            ))}
            {isRunning && status && <div className="ai-sidebar-status">{status}</div>}
          </div>

          {pendingApproval && (
            <div className="ai-approval">
              <div className="ai-approval-head">
                <ShieldCheck size={14} />
                <span>
                  {pendingApproval.source === "reformulate"
                    ? "Reformulate selection"
                    : (editKindLabel[pendingApproval.kind] ?? "Apply change")}{" "}
                  · {pendingApproval.path}
                </span>
              </div>
              {pendingApproval.oldText != null &&
                pendingApproval.kind !== "insert-at-cursor" && (
                  <pre className="ai-approval-diff old">
                    {pendingApproval.oldText.slice(0, 600)}
                  </pre>
                )}
              <pre className="ai-approval-diff new">
                {pendingApproval.newText.slice(0, 600)}
              </pre>
              {pendingApproval.preambleLines?.length ? (
                <div className="ai-approval-preamble">
                  <span>Also adds to the preamble</span>
                  <pre>{pendingApproval.preambleLines.join("\n")}</pre>
                </div>
              ) : null}
              <div className="ai-approval-actions">
                <button
                  className="ai-approval-decline"
                  onClick={() => resolveApproval(false)}
                >
                  <X size={13} /> Decline
                </button>
                <button
                  className="ai-approval-approve"
                  onClick={() => resolveApproval(true)}
                >
                  <Check size={13} /> Approve
                </button>
              </div>
            </div>
          )}

          <div className="ai-sidebar-input" data-tour-id="ai-composer">
            {composerSelection && (
              <div className="ai-selection-context">
                <div className="ai-selection-chip">
                  <span className="ai-selection-chip-label">
                    Selection: {composerSelection.filePath} · lines{" "}
                    {composerSelection.startLine}–{composerSelection.endLine}
                  </span>
                  <button
                    type="button"
                    className="ai-selection-chip-remove"
                    onClick={() => setComposerSelection(null)}
                    title="Remove selection context"
                    aria-label="Remove selection context"
                  >
                    ×
                  </button>
                </div>
                <pre className="ai-selection-chip-preview">
                  {composerSelection.text.slice(0, 200)}
                  {composerSelection.text.length > 200 ? "…" : ""}
                </pre>
              </div>
            )}
            {suggest && (
              <div
                className="ai-mention-popup"
                role="listbox"
                data-tour-id="ai-context-suggestions"
              >
                <div className="ai-mention-popup-title">
                  {suggest.trigger.kind === "file"
                    ? "Attach a project file"
                    : "Quick commands"}
                </div>
                {suggest.items.map((item, i) => (
                  <button
                    key={item.value}
                    role="option"
                    aria-selected={i === highlight}
                    className={`ai-mention-item ${i === highlight ? "active" : ""}`}
                    onMouseEnter={() => setHighlight(i)}
                    // onMouseDown so the textarea keeps focus.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      acceptSuggestion(item, suggest.trigger);
                    }}
                  >
                    <span className="ai-mention-value">
                      {suggest.trigger.kind === "file" ? "@" : "\\"}
                      {item.value}
                    </span>
                    {item.hint && <span className="ai-mention-hint">{item.hint}</span>}
                  </button>
                ))}
              </div>
            )}
            {speechPromptOpen ? (
              <LocalSpeechInstallCard
                state={localSpeech.state}
                onInstall={installLocalSpeech}
                onUseOpenAi={() => {
                  saveVoiceSettingsState({ ...voiceSettings, sttMode: "openai" });
                  setSpeechPromptOpen(false);
                }}
                onDismiss={() => setSpeechPromptOpen(false)}
              />
            ) : null}
            <div className={`ai-composer-box${voiceBarVisible ? " is-voice" : ""}`}>
              <textarea
                ref={inputRef}
                value={input}
                placeholder={
                  composerSelection ? "Ask about the selection…" : "Ask the AI anything"
                }
                rows={1}
                onChange={(e) => {
                  setInput(e.target.value);
                  updateSuggestions(e.target.value, e.target.selectionStart ?? 0);
                }}
                onSelect={(e) => {
                  const ta = e.currentTarget;
                  updateSuggestions(ta.value, ta.selectionStart ?? 0);
                }}
                onBlur={() => setSuggest(null)}
                onKeyDown={onInputKeyDown}
              />
              {voiceBarVisible ? (
                <VoiceRecordingBar
                  status={voice.status}
                  levels={voice.levels}
                  durationMs={voice.durationMs}
                  canSend={!isRunning}
                  pending={voicePending}
                  onCancel={() => {
                    setVoiceIntent(null);
                    voice.cancel();
                  }}
                  onStop={() => {
                    setVoiceIntent("stop");
                    void voice.stop();
                  }}
                  onSend={() => {
                    setVoiceIntent("send");
                    void voice.stop();
                  }}
                />
              ) : (
                <div className="ai-composer-toolbar">
                  <button
                    type="button"
                    className="ai-composer-plus"
                    onClick={attachFile}
                    title="Attach a project file (@)"
                    aria-label="Attach a project file"
                  >
                    <Plus size={17} />
                  </button>
                  <button
                    type="button"
                    className="ai-composer-model"
                    onClick={onOpenSettings}
                    title={`${providerLabel(config)} — change model`}
                    aria-label={`Model: ${providerLabel(config)}. Change model`}
                  >
                    <span>{providerLabel(config)}</span>
                    <ChevronDown size={13} aria-hidden="true" />
                  </button>
                  <div className="ai-composer-voice-controls">
                    <VoiceDictationButton
                      status={voice.status}
                      error={speechPromptOpen ? null : voice.error}
                      durationMs={voice.durationMs}
                      onStart={handleVoiceStart}
                      onStop={() => void voice.stop()}
                      onCancel={voice.cancel}
                      onOpenSettings={onOpenSettings}
                    />
                  </div>
                  {isRunning ? (
                    <button
                      className="ai-send-button stop"
                      onClick={abort}
                      title="Stop"
                    >
                      <Square size={15} />
                    </button>
                  ) : (
                    <button
                      className="ai-send-button"
                      onClick={submit}
                      disabled={!input.trim() && !composerSelection}
                      title="Send"
                    >
                      <ArrowUp size={16} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
