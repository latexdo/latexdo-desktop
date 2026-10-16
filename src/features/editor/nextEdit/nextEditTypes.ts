export type EditOrigin =
  | "user"
  | "next-edit"
  | "undo"
  | "redo"
  | "remote"
  | "programmatic";

export type NextEditSource = "pattern" | "semantic";
export type NextEditKind = "replace" | "delete" | "insert";
export type SupportedNextEditLanguage = "latex" | "bibtex" | "text";

export interface DocumentSnapshot {
  documentKey: string;
  revision: number;
  text: string;
  language: SupportedNextEditLanguage;
}

export interface NormalizedEdit {
  id: string;
  documentKey: string;
  revisionBefore: number;
  revisionAfter: number;
  origin: EditOrigin;

  startOffsetBefore: number;
  endOffsetBefore: number;
  oldText: string;
  newText: string;

  beforeContext: string;
  afterContext: string;

  cursorOffsetAfter: number;
  timestamp: number;
}

export interface NextEditCandidate {
  id: string;
  documentKey: string;
  source: NextEditSource;

  startOffset: number;
  endOffset: number;
  expectedText: string;
  replacementText: string;

  confidence: number;
  reason: string;

  basedOnRevision: number;
  patternId?: string;
  modelRequestId?: string;
  debug?: NextEditDebugScore;
}

export interface NextEditDebugScore {
  total: number;
  features: Record<string, number>;
}

export interface PatternExample {
  id: string;
  startOffsetBefore: number;
  endOffsetBefore: number;
  cursorOffsetAfter: number;
  oldText: string;
  newText: string;
  beforeContext: string;
  afterContext: string;
  timestamp: number;
  latexContext: LatexContextSignals;
}

export interface InsertionAnchor {
  leftAnchor: string;
  rightAnchor: string;
  leftToken: string;
  rightToken: string;
  leftClass: AnchorTokenClass;
  rightClass: AnchorTokenClass;
}

export type AnchorTokenClass =
  | "word"
  | "command"
  | "space"
  | "newline"
  | "punctuation"
  | "boundary";

export interface EditPattern {
  id: string;
  documentKey: string;
  kind: NextEditKind;
  signature: string;
  oldText: string;
  newText: string;
  examples: PatternExample[];
  createdAt: number;
  lastSeenAt: number;
  accepts: number;
  dismissals: number;
  insertionAnchor?: InsertionAnchor;
}

export interface LatexContextSignals {
  indentation: string;
  section: string;
  environment: string;
  command: string;
  inMath: boolean;
  inComment: boolean;
}

export interface PatternRawCandidate {
  id: string;
  documentKey: string;
  kind: NextEditKind;
  startOffset: number;
  endOffset: number;
  expectedText: string;
  replacementText: string;
  basedOnRevision: number;
  patternId: string;
  pattern: EditPattern;
  beforeContext: string;
  afterContext: string;
  latexContext: LatexContextSignals;
}

export interface RankingWeights {
  base: number;
  prefixSimilarity: number;
  suffixSimilarity: number;
  structuralSimilarity: number;
  direction: number;
  proximity: number;
  specificity: number;
  acceptancePrior: number;
  dismissalPrior: number;
  modelAgreement: number;
}

export interface RankingThresholds {
  show: number;
  autoChain: number;
}

export interface RankingConfig {
  weights: RankingWeights;
  thresholds: RankingThresholds;
  dismissalCooldownMs: number;
}

export interface DocumentEditSession {
  documentKey: string;
  revision: number;
  recentEdits: NormalizedEdit[];
  acceptedPredictionIds: Set<string>;
  dismissedPatternIds: Map<string, number>;
}

export type DismissReason =
  | "explicit"
  | "typed"
  | "cursor"
  | "selection-overlap"
  | "stale"
  | "document-change"
  | "file-switch"
  | "disposed"
  | "semantic-replaced";

export interface SemanticNextEditInput {
  snapshot: DocumentSnapshot;
  cursorOffset: number;
  recentEdits: NormalizedEdit[];
  deterministicCandidates: NextEditCandidate[];
  requestId: string;
  basedOnRevision: number;
}

export interface SemanticNextEditPredictor {
  predict(
    input: SemanticNextEditInput,
    signal: AbortSignal,
  ): Promise<NextEditCandidate | null>;
}

export interface NextEditControllerOptions {
  now?: () => number;
  semanticPredictor?: SemanticNextEditPredictor;
  semanticEnabled?: boolean;
  semanticDebounceMs?: number;
  onSuggestionChanged?: (candidate: NextEditCandidate | null) => void;
}

export interface NextEditConfig {
  enabled: boolean;
  semanticEnabled: boolean;
  useInlineModel: boolean;
}

export const defaultNextEditConfig: NextEditConfig = {
  enabled: true,
  semanticEnabled: false,
  useInlineModel: true,
};

export const nextEditConfigStorageKey = "latexdo.next-edit.config.v1";

export const CONTEXT_BEFORE_CHARS = 160;
export const CONTEXT_AFTER_CHARS = 160;
export const MAX_LEARNED_OLD_TEXT = 512;
export const MAX_LEARNED_NEW_TEXT = 512;
export const MAX_CONTEXT_CHARS = 320;
export const MAX_RECENT_EDITS = 80;
export const EDIT_TTL_MS = 20 * 60_000;
export const DISMISS_COOLDOWN_MS = 30_000;
export const MIN_MANUAL_EXAMPLES = 2;
export const MAX_RAW_CANDIDATES_PER_PATTERN = 64;
export const MAX_DETERMINISTIC_SCAN_CHARS = 2_000_000;
export const MAX_SEMANTIC_REPLACEMENT_TEXT = 512;

export const defaultRankingConfig: RankingConfig = {
  weights: {
    base: 0.4,
    prefixSimilarity: 0.15,
    suffixSimilarity: 0.15,
    structuralSimilarity: 0.1,
    direction: 0.1,
    proximity: 0.1,
    specificity: 0.12,
    acceptancePrior: 0.1,
    dismissalPrior: 0.2,
    modelAgreement: 0.08,
  },
  thresholds: {
    show: 0.68,
    autoChain: 0.8,
  },
  dismissalCooldownMs: DISMISS_COOLDOWN_MS,
};

let nextEditIdCounter = 0;

export function createNextEditId(prefix: string): string {
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${(++nextEditIdCounter).toString(36)}`;
  return `${prefix}-${randomId}`;
}
