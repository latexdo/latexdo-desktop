// Request-shape rules for Claude models. Newer models removed sampling
// parameters and budgeted thinking, so one request body does not fit every
// model: unknown or older ids fall back to the classic shape.

export interface ClaudeModelTraits {
  /** Accepts `temperature` (removed from Opus 4.7, Sonnet 5 and later). */
  sampling: boolean;
  /** Supports `thinking: {type: "adaptive"}` and `output_config.effort`. */
  adaptiveThinking: boolean;
  /** Runs the preserved-thinking check, so the block-binding control applies. */
  thinkingBinding: boolean;
  /** Supports server-side context editing (clearing old tool results). */
  contextEditing: boolean;
}

const classic: ClaudeModelTraits = {
  sampling: true,
  adaptiveThinking: false,
  thinkingBinding: false,
  contextEditing: false,
};

/** Parses ids such as `claude-opus-5-5`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`. */
function parseClaudeModel(model: string): { family: string; version: number } | null {
  const match =
    /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(
      model.toLowerCase(),
    );
  if (!match) return null;
  const major = Number(match[2]);
  const minor = match[3] ? Number(match[3]) : 0;
  return { family: match[1], version: major + minor / 10 };
}

export function claudeModelTraits(model: string): ClaudeModelTraits {
  const parsed = parseClaudeModel(model);
  if (!parsed) return classic;
  const { family, version } = parsed;
  if (family === "fable" || family === "mythos") {
    return {
      sampling: false,
      adaptiveThinking: true,
      thinkingBinding: version >= 5.1,
      contextEditing: true,
    };
  }
  if (version < 4.6) return classic;
  return {
    sampling: version < 4.7,
    adaptiveThinking: true,
    thinkingBinding: version >= 5.5,
    contextEditing: true,
  };
}
