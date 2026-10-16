// Shared types for the AI agent: chat messages, tool schemas, and the
// single-step generation protocol used across all providers (local / ollama /
// cloud). The agent loop lives in the renderer (aiAgent.ts); providers only
// implement one "generate one step" call and return either assistant text or a
// batch of tool calls.

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed arguments object. */
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on assistant messages that requested tools. */
  toolCalls?: ToolCall[];
  /** Present on tool-result messages; links back to the ToolCall id. */
  toolCallId?: string;
  /** Optional label for UI (e.g. the tool name that produced a result). */
  name?: string;
  /**
   * The provider's own record of an assistant turn, replayed verbatim on the
   * next step of the same tool loop: Claude's signed thinking blocks, or the
   * local runtime's thought segments and raw function calls. Never persisted.
   */
  providerContent?: unknown;
}

/**
 * How hard the model should think. Agent turns use "high", rewrites "medium",
 * and latency-sensitive helpers (completions, commit messages) "low".
 */
export type AiEffort = "low" | "medium" | "high";

/** JSON-schema-ish parameter description for a tool. */
export interface ToolParam {
  type: "string" | "number" | "boolean" | "integer";
  description: string;
  enum?: string[];
}

export interface ToolSchema {
  name: string;
  description: string;
  params: Record<string, ToolParam>;
  required: string[];
}

/** Result the renderer sends back after executing a tool. */
export interface ToolResult {
  ok: boolean;
  /** Human/model-readable payload (stringified for the model). */
  content: string;
  /** Optional structured data for the UI (e.g. a diff to render). */
  ui?: unknown;
}

/** One decoded generation step returned by a provider. */
export type GenerationStep =
  | {
      type: "text";
      content: string;
      /** True when the reply hit the output limit and was cut off. */
      truncated?: boolean;
      providerContent?: unknown;
    }
  | {
      type: "tool_calls";
      content: string;
      toolCalls: ToolCall[];
      /** True when output ran out mid-call: the arguments are incomplete. */
      truncated?: boolean;
      providerContent?: unknown;
    }
  | { type: "error"; content: string };

/** Streaming delta pushed from main -> renderer during generation. */
export interface GenerationDelta {
  /** Correlates deltas to a single ai:generate request. */
  requestId: string;
  kind: "token" | "done" | "error";
  text?: string;
  step?: GenerationStep;
}

/** Request payload sent renderer -> main for one generation step. */
export interface GenerateRequest {
  requestId: string;
  provider: "local" | "ollama" | "cloud";
  messages: ChatMessage[];
  tools: ToolSchema[];
  options: {
    modelId?: string;
    /** GGUF file name (for the main process to resolve under the models dir). */
    fileName?: string;
    modelPath?: string;
    temperature?: number;
    maxTokens?: number;
    effort?: AiEffort;
    // provider-specific config
    ollamaBaseUrl?: string;
    ollamaModel?: string;
    cloudVendor?: string;
    cloudBaseUrl?: string;
    cloudModel?: string;
    cloudApiKey?: string;
    /**
     * Desktop builds resolve the cloud secret from the main-process OS vault at
     * request time. When set, it takes precedence over `cloudApiKey`.
     */
    cloudCredentialId?: string;
  };
}

export interface ModelStatus {
  id: string;
  fileName: string;
  downloaded: boolean;
  path: string | null;
  sizeBytes: number | null;
  manifest?: ImportedModelManifest;
}

export interface DownloadProgress {
  modelId: string;
  receivedBytes: number;
  totalBytes: number | null;
  done: boolean;
  error?: string;
  /** Download stage. "verifying" runs after the network transfer completes. */
  stage?: "downloading" | "verifying";
}

export interface SpeechInstallProgress {
  stage:
    | "checking"
    | "downloading-runtime"
    | "downloading-model"
    | "verifying"
    | "installing"
    | "ready";
  receivedBytes: number;
  totalBytes: number | null;
  done: boolean;
  error?: string;
  message?: string;
}

export interface AiSystemCapabilities {
  totalRamBytes: number;
  freeRamBytes: number;
  totalStorageBytes: number | null;
  freeStorageBytes: number | null;
  modelStoragePath: string | null;
  platform: string;
  arch: string;
  cpuCount: number;
  localAiAvailable: boolean;
}

export type TierAvailability =
  | { state: "available" }
  | {
      state: "memory-pressure";
      requiredAvailableBytes: number;
      availableBytes: number;
    }
  | {
      state: "storage-pressure";
      requiredAvailableStorageBytes: number;
      availableStorageBytes: number;
    }
  | {
      state: "unsupported";
      reason: string;
      requiredSystemRamBytes?: number;
      detectedSystemRamBytes?: number;
    };

export type ToolSupport = "native" | "prompt-fallback" | "unknown" | "unsupported";

export interface ImportedModelManifest {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  path: string | null;
  downloaded: boolean;
  sizeBytes: number;
  modelName?: string;
  architecture?: string;
  parameterCount?: number;
  contextLength?: number;
  quantization?: string;
  compatibility: {
    state: "compatible" | "memory-pressure" | "unsupported" | "unknown";
    estimatedRamBytes?: number;
    estimatedVramBytes?: number;
    availableRamBytes?: number;
    reason?: string;
    checkedAt: string;
  };
  capabilities: {
    toolUse: ToolSupport;
  };
}

export interface TexInstallProgress {
  stage: "checking" | "downloading" | "verifying" | "installing" | "ready";
  receivedBytes: number;
  totalBytes: number | null;
  done: boolean;
  error?: string;
  message?: string;
}

/** Whether a setup dependency is already on this computer, and its download size. */
export interface SetupRuntimeStatus {
  installed: boolean;
  /** False when LatexDo cannot install it automatically on this platform. */
  supported?: boolean;
  downloadBytes: number | null;
}
