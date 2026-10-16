// Shared utilities for Selection → AI workflows:
//   1. Capture an immutable selection snapshot from the Monaco editor.
//   2. Reformulate the selection via the existing AI provider infrastructure.
//   3. Hand off a selection to the active AI chat for user-directed questions.
//
// The design principle: SELECTION → SNAPSHOT → AI → PROPOSAL → USER APPROVAL → EDIT.
// Monaco owns mutations. AI only produces proposals.

import type { AiConfig } from "./aiConfig";
import type { EditProposal } from "./aiTools";
import type { GenerateRequest, GenerationStep } from "./aiTypes";
import { generateStep } from "./aiClient";
import { resolveAiRuntime } from "./product/aiRuntimeResolver";
import {
  customDictionaryPromptSection,
  getCustomDictionaryWords,
} from "../proofreading/customDictionary";

/** Structural Monaco range; keeps tests and the editor decoupled from monaco types. */
export interface SelectionRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface MonacoEditorLike {
  getSelection(): SelectionRange | null;
  getModel(): {
    getValueInRange(range: SelectionRange): string;
    getVersionId(): number;
  } | null;
}

// ---------------------------------------------------------------------------
// Selection snapshot
// ---------------------------------------------------------------------------

/** An immutable snapshot of an editor selection, safe to keep across async gaps. */
export interface AiSelectionSnapshot {
  filePath: string;
  text: string;
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  documentVersionId: number;
}

interface MonacoEditorLike {
  getSelection(): SelectionRange | null;
  getModel(): {
    getValueInRange(range: SelectionRange): string;
    getVersionId(): number;
  } | null;
}

/**
 * Capture the current editor selection. Returns null when:
 * - no editor is mounted
 * - no selection exists
 * - selection is empty / whitespace-only
 * - no file path is available
 */
export function captureEditorSelection(
  editor: MonacoEditorLike | null,
  activeFilePath: string | null,
): AiSelectionSnapshot | null {
  if (!editor || !activeFilePath) return null;
  const model = editor.getModel();
  if (!model) return null;
  const selection = editor.getSelection();
  if (!selection) return null;
  const text = model.getValueInRange(selection);
  if (!text.trim()) return null;
  return {
    filePath: activeFilePath,
    text,
    range: {
      startLineNumber: selection.startLineNumber,
      startColumn: selection.startColumn,
      endLineNumber: selection.endLineNumber,
      endColumn: selection.endColumn,
    },
    documentVersionId: model.getVersionId(),
  };
}

// ---------------------------------------------------------------------------
// Reformulate with AI
// ---------------------------------------------------------------------------

const reformulationSystemPrompt = `You are a LaTeX writing assistant. Your task is to REFORMULATE the user's selected text.

Rules:
- Preserve the original meaning exactly.
- Improve clarity, flow, and writing quality.
- Preserve ALL valid LaTeX commands, environments, inline math ($...$), display math (\\[...\\], equation, etc.), citations (\\cite{...}, \\citep{...}, etc.), references (\\ref{...}, \\cref{...}, etc.), labels (\\label{...}), macros, escaped characters, and comments.
- Do NOT add unrelated information.
- Do NOT add new citations unless explicitly asked.
- Do NOT change mathematical notation or numerical values.
- Return ONLY the reformulated replacement text — no explanations, no markdown fences, no prefixes.
- The output must be directly usable as a drop-in replacement for the original selection.`;

/**
 * Build the user-facing message for a reformulation request.
 */
export function buildReformulationMessages(
  snapshot: AiSelectionSnapshot,
  customWords: readonly string[] = getCustomDictionaryWords(),
): { role: "system" | "user"; content: string }[] {
  const dictionary = customDictionaryPromptSection(customWords);
  return [
    {
      role: "system",
      content: dictionary
        ? `${reformulationSystemPrompt}\n- ${dictionary}`
        : reformulationSystemPrompt,
    },
    {
      role: "user",
      content: `Reformulate the following selected passage.\n\n---\n${snapshot.text}\n---`,
    },
  ];
}

/**
 * Maximum selection size we send for reformulation (characters).
 * Very large selections risk exceeding provider context limits.
 */
export const maxReformulationSelectionChars = 8_000;

/**
 * Returns an error message if the selection is too large, or null if OK.
 */
export function validateSelectionForReformulation(
  snapshot: AiSelectionSnapshot,
): string | null {
  if (snapshot.text.length > maxReformulationSelectionChars) {
    return `Selection is too large for reformulation (${snapshot.text.length} characters). Select a smaller passage.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Provider integration
// ---------------------------------------------------------------------------

/**
 * Run the reformulation through the existing AI provider infrastructure.
 * No tools, no agent loop — just selected text → proposed text.
 * Returns the request id (for cancellation) plus the generation step.
 */
export function newReformulationRequestId(): string {
  return `reform_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function performReformulation(
  config: AiConfig,
  snapshot: AiSelectionSnapshot,
  onToken?: (text: string) => void,
  // Pass an id to be able to abort the request while it is generating.
  requestId: string = newReformulationRequestId(),
): Promise<{ requestId: string; step: GenerationStep }> {
  const runtime = resolveAiRuntime(config);
  const messages = buildReformulationMessages(snapshot);
  const req: GenerateRequest = {
    requestId,
    provider: runtime.provider,
    messages,
    tools: [],
    options: {
      modelId: runtime.provider === "local" ? runtime.modelId : config.modelId,
      fileName: runtime.provider === "local" ? runtime.fileName : undefined,
      effort: "medium",
      // Room for the whole rewritten passage plus any reasoning.
      maxTokens: 12_000,
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
  const step = await generateStep(req, onToken ?? (() => {}));
  return { requestId, step };
}

// ---------------------------------------------------------------------------
// Proposal building
// ---------------------------------------------------------------------------

export interface ReformulationProposal extends EditProposal {
  source: "reformulate";
}

/**
 * Build an EditProposal from a reformulation result. Returns null if the
 * result is not usable (error, empty).
 */
export function buildReformulationProposal(
  snapshot: AiSelectionSnapshot,
  newText: string,
): ReformulationProposal | null {
  const trimmed = newText.trim();
  if (!trimmed) return null;
  return {
    path: snapshot.filePath,
    kind: "replace-selection",
    newText: trimmed,
    oldText: snapshot.text,
    source: "reformulate",
  };
}

// ---------------------------------------------------------------------------
// Apply proposal validation
// ---------------------------------------------------------------------------

/**
 * Verify that the range in the editor still contains the expected original text.
 * Returns true if safe to apply, false if the selection has changed.
 */
export function validateSnapshotRange(
  editor: {
    getSelection(): SelectionRange | null;
    getModel(): { getValueInRange(range: SelectionRange): string } | null;
  } | null,
  snapshot: AiSelectionSnapshot,
): boolean {
  if (!editor) return false;
  const model = editor.getModel();
  if (!model) return false;
  const currentSelection = editor.getSelection();
  if (!currentSelection) return false;

  if (
    currentSelection.startLineNumber !== snapshot.range.startLineNumber ||
    currentSelection.startColumn !== snapshot.range.startColumn ||
    currentSelection.endLineNumber !== snapshot.range.endLineNumber ||
    currentSelection.endColumn !== snapshot.range.endColumn
  ) {
    return false;
  }

  const currentText = model.getValueInRange(currentSelection);
  return currentText === snapshot.text;
}

// ---------------------------------------------------------------------------
// Chat handoff (Ask AI about Selection)
// ---------------------------------------------------------------------------

export interface AiComposerSelectionContext {
  type: "editor-selection";
  filePath: string;
  text: string;
  startLine: number;
  endLine: number;
}

/**
 * Build the message text to inject into the composer when a selection is attached.
 * Clearly delimited so the model and user can both see it.
 */
export function buildSelectionMessageText(ctx: AiComposerSelectionContext): string {
  const preview = ctx.text.length > 400 ? ctx.text.slice(0, 400) + "…" : ctx.text;
  return `--- Selection from ${ctx.filePath} (lines ${ctx.startLine}–${ctx.endLine}) ---\n${preview}\n--- End of selection ---`;
}
