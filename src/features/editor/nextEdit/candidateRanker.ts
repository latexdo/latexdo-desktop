import {
  defaultRankingConfig,
  type DocumentEditSession,
  type EditPattern,
  type LatexContextSignals,
  type NextEditCandidate,
  type PatternExample,
  type PatternRawCandidate,
  type RankingConfig,
} from "./nextEditTypes";

export interface RankCandidatesInput {
  patternCandidates: PatternRawCandidate[];
  semanticCandidates?: NextEditCandidate[];
  session: DocumentEditSession;
  cursorOffset: number;
  revision: number;
  now?: number;
  config?: RankingConfig;
}

export function rankPatternCandidate(
  candidate: PatternRawCandidate,
  session: DocumentEditSession,
  cursorOffset: number,
  now = Date.now(),
  config = defaultRankingConfig,
): NextEditCandidate {
  const features = patternFeatureValues(candidate, session, cursorOffset, now, config);
  const weights = config.weights;
  const total = clamp01(
    weights.base +
      weights.prefixSimilarity * features.prefix +
      weights.suffixSimilarity * features.suffix +
      weights.structuralSimilarity * features.structure +
      weights.direction * features.direction +
      weights.proximity * features.proximity +
      weights.specificity * features.specificity +
      weights.acceptancePrior * features.acceptance +
      weights.dismissalPrior * -features.dismissal,
  );

  return {
    id: candidate.id,
    documentKey: candidate.documentKey,
    source: "pattern",
    startOffset: candidate.startOffset,
    endOffset: candidate.endOffset,
    expectedText: candidate.expectedText,
    replacementText: candidate.replacementText,
    confidence: total,
    reason: `${candidate.kind} pattern from ${candidate.pattern.examples.length} manual edits`,
    basedOnRevision: candidate.basedOnRevision,
    patternId: candidate.patternId,
    debug: {
      total,
      features,
    },
  };
}

export function rankCandidates({
  patternCandidates,
  semanticCandidates = [],
  session,
  cursorOffset,
  revision,
  now = Date.now(),
  config = defaultRankingConfig,
}: RankCandidatesInput): NextEditCandidate[] {
  const byEdit = new Map<string, NextEditCandidate>();

  for (const rawCandidate of patternCandidates) {
    if (rawCandidate.basedOnRevision !== revision) continue;
    mergeCandidate(
      byEdit,
      rankPatternCandidate(rawCandidate, session, cursorOffset, now, config),
      config,
    );
  }

  for (const semanticCandidate of semanticCandidates) {
    if (semanticCandidate.basedOnRevision !== revision) continue;
    mergeCandidate(byEdit, normalizeSemanticCandidate(semanticCandidate), config);
  }

  return [...byEdit.values()].sort((a, b) => {
    const confidenceDelta = b.confidence - a.confidence;
    if (confidenceDelta !== 0) return confidenceDelta;
    return a.startOffset - b.startOffset;
  });
}

export function pickBestCandidate(
  input: RankCandidatesInput,
): NextEditCandidate | null {
  const ranked = rankCandidates(input);
  return (
    ranked.find(
      (candidate) =>
        candidate.confidence >= (input.config ?? defaultRankingConfig).thresholds.show,
    ) ?? null
  );
}

export function commonSuffixSimilarity(a: string, b: string): number {
  const max = Math.min(a.length, b.length, 96);
  if (max === 0) return 0;
  let same = 0;
  while (same < max && a[a.length - 1 - same] === b[b.length - 1 - same]) {
    same += 1;
  }
  return same / max;
}

export function commonPrefixSimilarity(a: string, b: string): number {
  const max = Math.min(a.length, b.length, 96);
  if (max === 0) return 0;
  let same = 0;
  while (same < max && a[same] === b[same]) {
    same += 1;
  }
  return same / max;
}

function patternFeatureValues(
  candidate: PatternRawCandidate,
  session: DocumentEditSession,
  cursorOffset: number,
  now: number,
  config: RankingConfig,
): Record<string, number> {
  const examples = candidate.pattern.examples;
  return {
    prefix: maxExampleScore(examples, (example) =>
      commonSuffixSimilarity(candidate.beforeContext, example.beforeContext),
    ),
    suffix: maxExampleScore(examples, (example) =>
      commonPrefixSimilarity(candidate.afterContext, example.afterContext),
    ),
    structure: maxExampleScore(examples, (example) =>
      structuralSimilarity(candidate.latexContext, example.latexContext),
    ),
    direction: directionScore(candidate.startOffset, examples),
    proximity: proximityScore(
      candidate.startOffset,
      cursorOffset,
      examples[examples.length - 1]?.startOffsetBefore,
    ),
    specificity: specificityScore(candidate.pattern),
    acceptance: acceptancePrior(candidate.pattern),
    dismissal: dismissalPrior(candidate.pattern, session, now, config),
  };
}

function maxExampleScore(
  examples: PatternExample[],
  score: (example: PatternExample) => number,
): number {
  if (examples.length === 0) return 0;
  return Math.max(...examples.map(score));
}

function structuralSimilarity(
  candidate: LatexContextSignals,
  example: LatexContextSignals,
): number {
  const score =
    (candidate.indentation === example.indentation ? 0.12 : 0) +
    (candidate.section === example.section ? 0.16 : 0) +
    (candidate.environment === example.environment ? 0.32 : 0) +
    (candidate.command === example.command ? 0.12 : 0) +
    (candidate.inMath === example.inMath ? 0.16 : 0) +
    (candidate.inComment === example.inComment ? 0.12 : 0);
  if (
    candidate.environment &&
    example.environment &&
    candidate.environment !== example.environment
  ) {
    return Math.min(score, 0.45);
  }
  if (candidate.inComment !== example.inComment) return Math.min(score, 0.45);
  if (candidate.inMath !== example.inMath) return Math.min(score, 0.65);
  return score;
}

function directionScore(offset: number, examples: PatternExample[]): number {
  if (examples.length < 2) return 0.5;
  const recent = examples.slice(-2);
  const first = recent[0];
  const second = recent[1];
  if (!first || !second) return 0.5;
  if (second.startOffsetBefore > first.startOffsetBefore) {
    return offset >= second.startOffsetBefore ? 1 : 0;
  }
  if (second.startOffsetBefore < first.startOffsetBefore) {
    return offset <= second.startOffsetBefore ? 1 : 0;
  }
  return 0.5;
}

function proximityScore(
  offset: number,
  cursorOffset: number,
  lastEditOffset: number | undefined,
): number {
  const cursorDistance = Math.abs(offset - cursorOffset);
  const editDistance =
    lastEditOffset === undefined ? cursorDistance : Math.abs(offset - lastEditOffset);
  const nearest = Math.min(cursorDistance, editDistance);
  return 1 - Math.min(nearest, 2_000) / 2_000;
}

function specificityScore(pattern: EditPattern): number {
  const oldText = pattern.oldText.trim();
  if (!oldText) return 0;
  if (isLatexCommandToken(oldText)) return 1;
  if (pattern.oldText.includes("\n")) return 1;
  if (oldText.length >= 32) return 1;
  if (oldText.length >= 8) return 0.85;
  if (isWordToken(oldText) && oldText.length >= 4) return 0.75;
  return 0;
}

function acceptancePrior(pattern: EditPattern): number {
  if (pattern.accepts <= 0) return 0;
  return pattern.accepts / Math.max(1, pattern.examples.length + pattern.accepts);
}

function dismissalPrior(
  pattern: EditPattern,
  session: DocumentEditSession,
  now: number,
  config: RankingConfig,
): number {
  const explicitDismissal = session.dismissedPatternIds.get(pattern.id);
  const cooldownActive =
    explicitDismissal !== undefined &&
    now - explicitDismissal <= config.dismissalCooldownMs;
  const dismissalRate =
    pattern.dismissals <= 0
      ? 0
      : pattern.dismissals /
        Math.max(1, pattern.examples.length + pattern.accepts + pattern.dismissals);
  return Math.max(dismissalRate, cooldownActive ? 1 : 0);
}

function mergeCandidate(
  byEdit: Map<string, NextEditCandidate>,
  candidate: NextEditCandidate,
  config: RankingConfig,
): void {
  const key = candidateKey(candidate);
  const existing = byEdit.get(key);
  if (!existing) {
    byEdit.set(key, candidate);
    return;
  }

  const confidence = clamp01(
    Math.max(existing.confidence, candidate.confidence) + config.weights.modelAgreement,
  );
  byEdit.set(key, {
    ...existing,
    source: existing.source === "pattern" ? "pattern" : candidate.source,
    confidence,
    reason:
      existing.source === candidate.source
        ? existing.reason
        : `${existing.reason}; semantic agreement`,
    modelRequestId: existing.modelRequestId ?? candidate.modelRequestId,
    debug: existing.debug
      ? {
          total: confidence,
          features: {
            ...existing.debug.features,
            modelAgreement: 1,
          },
        }
      : undefined,
  });
}

function normalizeSemanticCandidate(candidate: NextEditCandidate): NextEditCandidate {
  return {
    ...candidate,
    source: "semantic",
    confidence: clamp01(candidate.confidence),
  };
}

function candidateKey(candidate: NextEditCandidate): string {
  return [
    candidate.documentKey,
    candidate.startOffset,
    candidate.endOffset,
    candidate.replacementText,
  ].join("\0");
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function isLatexCommandToken(text: string): boolean {
  return /^\\[A-Za-z]{2,}\*?$/.test(text);
}

function isWordToken(text: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(text);
}
