// Local speech-to-text discovery.
//
// The chat AI ("LatexDo AI" from setup) is a text-only local LLM and cannot
// transcribe audio. Speech-to-text needs a whisper-class server. Many local
// options expose an OpenAI-compatible endpoint:
//   - whisper.cpp server            (http://localhost:8080)
//   - LM Studio                      (http://localhost:1234)
//   - faster-whisper-server / etc.   (http://localhost:8000)
// This probes only loopback addresses on common ports and reports which ones
// respond, so the voice settings popover can configure them in one click.

export interface LocalTranscriptionServer {
  /** Human-readable description, e.g. "LM Studio · localhost:1234". */
  label: string;
  /** Base URL including the /v1 suffix. */
  baseUrl: string;
  /** Model ids the server advertises (may be whisper- or chat-only). */
  models: string[];
  /** First advertised model that looks like a speech model, if any. */
  speechModel?: string;
}

const CANDIDATES: ReadonlyArray<{ name: string; baseUrl: string }> = [
  { name: "LM Studio", baseUrl: "http://localhost:1234/v1" },
  { name: "whisper.cpp server", baseUrl: "http://localhost:8080/v1" },
  { name: "faster-whisper server", baseUrl: "http://localhost:8000/v1" },
];

export function looksLikeSpeechModel(modelName: string): boolean {
  const name = modelName.toLowerCase();
  return (
    name.includes("whisper") ||
    name.includes("transcribe") ||
    name.includes("distil") ||
    name.includes("speech")
  );
}

/** Parse the OpenAI-style /v1/models payload into model ids. */
function extractModelIds(data: unknown): string[] {
  const list = (data as { data?: unknown })?.data;
  if (Array.isArray(list)) {
    return list
      .map((m) =>
        typeof (m as { id?: unknown })?.id === "string"
          ? ((m as { id: string }).id as string)
          : "",
      )
      .filter(Boolean);
  }
  const models = (data as { models?: unknown })?.models;
  if (Array.isArray(models)) {
    return models
      .map((m) =>
        typeof (m as { id?: unknown })?.id === "string"
          ? ((m as { id: string }).id as string)
          : "",
      )
      .filter(Boolean);
  }
  return [];
}

export interface LocalTranscriptionOptions {
  /** Skip host prefixes that are not loopback (defense in depth). */
  allowNonLoopback?: boolean;
  /** Per-probe timeout in milliseconds. */
  timeoutMs?: number;
}

/** How long each probe is allowed to wait. */
const defaultProbeTimeoutMs = 1500;

function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

async function probe(
  baseUrl: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<string[]> {
  const res = await fetch(`${baseUrl}/models`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!res.ok) return [];
  return extractModelIds(await res.json());
}

/**
 * Detect local OpenAI-compatible speech servers. Never touches a non-loopback
 * address. Returns the servers that answered, ordered for "pick this one".
 */
export async function detectLocalTranscriptionServers(
  options: LocalTranscriptionOptions = {},
): Promise<LocalTranscriptionServer[]> {
  const timeoutMs = options.timeoutMs ?? defaultProbeTimeoutMs;
  const allowNonLoopback = options.allowNonLoopback ?? false;

  const seen = new Set<string>();
  const results = await Promise.all(
    CANDIDATES.map(async (candidate) => {
      if (!allowNonLoopback && !isLoopbackUrl(candidate.baseUrl)) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const models = await probe(candidate.baseUrl, timeoutMs, controller.signal);
        const key = candidate.baseUrl;
        if (seen.has(key)) return null;
        seen.add(key);
        const speechModel = models.find(looksLikeSpeechModel);
        return {
          label: `${candidate.name} · ${candidate.baseUrl}`,
          baseUrl: candidate.baseUrl,
          models,
          ...(speechModel ? { speechModel } : {}),
        } satisfies LocalTranscriptionServer;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return results.filter((r): r is LocalTranscriptionServer => r !== null);
}
