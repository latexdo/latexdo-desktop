import { EditHistoryStore } from "./editHistory";
import { pickBestCandidate, rankCandidates } from "./candidateRanker";
import { PatternPredictor } from "./patternPredictor";
import {
  createNextEditId,
  defaultRankingConfig,
  type DismissReason,
  type DocumentSnapshot,
  type NextEditCandidate,
  type NextEditControllerOptions,
  type NormalizedEdit,
  type SemanticNextEditPredictor,
} from "./nextEditTypes";

type ControllerState = "idle" | "observing" | "predicting" | "showing" | "applying";

export class NextEditController {
  private readonly now: () => number;
  private readonly history: EditHistoryStore;
  private readonly patternPredictor: PatternPredictor;
  private readonly semanticPredictor: SemanticNextEditPredictor | null;
  private readonly semanticEnabled: boolean;
  private readonly semanticDebounceMs: number;
  private readonly onSuggestionChanged?: (candidate: NextEditCandidate | null) => void;
  private readonly suggestionListeners = new Set<
    (candidate: NextEditCandidate | null) => void
  >();
  private snapshot: DocumentSnapshot | null = null;
  private cursorOffset = 0;
  private suggestion: NextEditCandidate | null = null;
  private semanticTimer: ReturnType<typeof setTimeout> | null = null;
  private semanticAbort: AbortController | null = null;
  private activeSemanticRequestId: string | null = null;
  private disposed = false;
  private state: ControllerState = "idle";

  constructor(options: NextEditControllerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.history = new EditHistoryStore(this.now);
    this.patternPredictor = new PatternPredictor({ now: this.now });
    this.semanticPredictor = options.semanticPredictor ?? null;
    this.semanticEnabled = Boolean(
      options.semanticEnabled && options.semanticPredictor,
    );
    this.semanticDebounceMs = options.semanticDebounceMs ?? 220;
    this.onSuggestionChanged = options.onSuggestionChanged;
  }

  observeEdit(edit: NormalizedEdit): void {
    if (this.disposed) return;
    this.state = "observing";
    const session = this.history.recordEdit(edit);
    if (this.snapshot?.documentKey !== edit.documentKey) {
      this.clearSuggestion();
      return;
    }

    if (edit.origin === "user") {
      this.patternPredictor.observeEdit(edit, this.snapshot.language);
      this.publishBestPatternSuggestion();
      this.scheduleSemanticPrediction();
      return;
    }

    if (edit.origin === "next-edit") {
      this.publishBestPatternSuggestion();
      return;
    }

    if (this.suggestion && !this.validateCandidate(this.suggestion)) {
      this.dismissSuggestion("stale");
    }
    session.revision = Math.max(session.revision, edit.revisionAfter);
    this.cancelSemanticPrediction();
    this.state = this.suggestion ? "showing" : "idle";
  }

  onCursorMoved(offset: number): void {
    if (this.disposed) return;
    this.cursorOffset = Math.max(0, offset);
    if (this.suggestion && !this.validateCandidate(this.suggestion)) {
      this.dismissSuggestion("stale");
    }
    this.publishBestPatternSuggestion({ preserveSemanticSuggestion: true });
  }

  onSelectionChanged(startOffset: number, endOffset: number): void {
    if (this.disposed || !this.suggestion) return;
    const start = Math.min(startOffset, endOffset);
    const end = Math.max(startOffset, endOffset);
    if (
      start !== end &&
      rangesOverlap(start, end, this.suggestion.startOffset, this.suggestion.endOffset)
    ) {
      this.dismissSuggestion("selection-overlap");
    }
  }

  onDocumentChanged(snapshot: DocumentSnapshot): void {
    if (this.disposed) return;
    const switchedDocument =
      this.snapshot !== null && this.snapshot.documentKey !== snapshot.documentKey;
    this.snapshot = snapshot;
    this.history.updateRevision(snapshot.documentKey, snapshot.revision);
    this.cursorOffset = Math.min(this.cursorOffset, snapshot.text.length);
    this.cancelSemanticPrediction();

    if (switchedDocument) {
      this.dismissSuggestion("file-switch");
      return;
    }

    if (this.suggestion && !this.validateCandidate(this.suggestion)) {
      this.dismissSuggestion("document-change");
    }
  }

  getSuggestion(): NextEditCandidate | null {
    return this.suggestion;
  }

  subscribeSuggestionChanged(
    listener: (candidate: NextEditCandidate | null) => void,
  ): () => void {
    this.suggestionListeners.add(listener);
    listener(this.suggestion);
    return () => {
      this.suggestionListeners.delete(listener);
    };
  }

  acceptSuggestion(): NextEditCandidate | null {
    if (this.disposed || !this.suggestion) return null;
    const candidate = this.suggestion;
    if (!this.validateCandidate(candidate)) {
      this.dismissSuggestion("stale");
      return null;
    }

    this.state = "applying";
    this.history.recordAccepted(candidate.documentKey, candidate.id);
    this.patternPredictor.recordAccepted(candidate);
    this.clearSuggestion();
    this.cancelSemanticPrediction();
    return candidate;
  }

  dismissSuggestion(reason: DismissReason): void {
    if (!this.suggestion) return;
    const candidate = this.suggestion;
    if (reason === "explicit") {
      this.history.recordDismissed(
        candidate.documentKey,
        candidate.patternId ?? candidate.id,
      );
      this.patternPredictor.recordDismissed(candidate);
    }
    this.clearSuggestion();
    this.cancelSemanticPrediction();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dismissSuggestion("disposed");
    this.cancelSemanticPrediction();
    this.patternPredictor.clear();
    this.history.clear();
  }

  getDebugState(): ControllerState {
    return this.state;
  }

  private publishBestPatternSuggestion(
    options: { preserveSemanticSuggestion?: boolean } = {},
  ): void {
    const snapshot = this.snapshot;
    if (!snapshot) {
      this.clearSuggestion();
      return;
    }
    const semanticCandidates =
      options.preserveSemanticSuggestion &&
      this.suggestion?.source === "semantic" &&
      this.validateCandidate(this.suggestion)
        ? [this.suggestion]
        : [];
    const session = this.history.get(snapshot.documentKey);
    const patternCandidates = this.patternPredictor
      .predictRawCandidates(snapshot, session)
      .filter((candidate) =>
        this.textMatches(
          candidate.startOffset,
          candidate.endOffset,
          candidate.expectedText,
        ),
      );
    const candidate = pickBestCandidate({
      patternCandidates,
      semanticCandidates,
      session,
      cursorOffset: this.cursorOffset,
      revision: snapshot.revision,
      now: this.now(),
    });
    this.setSuggestion(candidate);
  }

  private scheduleSemanticPrediction(): void {
    if (!this.semanticEnabled || !this.semanticPredictor || !this.snapshot) return;
    if (
      this.suggestion &&
      this.suggestion.confidence >= defaultRankingConfig.thresholds.autoChain
    ) {
      return;
    }

    this.cancelSemanticPrediction();
    this.state = "predicting";
    this.semanticTimer = setTimeout(() => {
      void this.requestSemanticPrediction();
    }, this.semanticDebounceMs);
  }

  private async requestSemanticPrediction(): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot || !this.semanticPredictor || this.disposed) return;

    const requestId = createNextEditId("semantic");
    const abort = new AbortController();
    this.semanticAbort = abort;
    this.activeSemanticRequestId = requestId;

    const session = this.history.get(snapshot.documentKey);
    const patternCandidates = this.patternPredictor.predictRawCandidates(
      snapshot,
      session,
    );
    const deterministicCandidates = rankCandidates({
      patternCandidates,
      semanticCandidates: [],
      session,
      cursorOffset: this.cursorOffset,
      revision: snapshot.revision,
      now: this.now(),
    });

    let semanticCandidate: NextEditCandidate | null;
    try {
      semanticCandidate = await this.semanticPredictor.predict(
        {
          snapshot,
          cursorOffset: this.cursorOffset,
          recentEdits: session.recentEdits.slice(-8),
          deterministicCandidates: deterministicCandidates.slice(0, 8),
          requestId,
          basedOnRevision: snapshot.revision,
        },
        abort.signal,
      );
    } catch {
      semanticCandidate = null;
    }

    if (
      this.disposed ||
      abort.signal.aborted ||
      this.activeSemanticRequestId !== requestId ||
      this.snapshot?.documentKey !== snapshot.documentKey ||
      this.snapshot.revision !== snapshot.revision
    ) {
      return;
    }

    if (!semanticCandidate || !this.validateCandidate(semanticCandidate)) {
      this.state = this.suggestion ? "showing" : "idle";
      return;
    }

    const best = pickBestCandidate({
      patternCandidates,
      semanticCandidates: [semanticCandidate],
      session,
      cursorOffset: this.cursorOffset,
      revision: snapshot.revision,
      now: this.now(),
    });
    if (best) {
      this.setSuggestion(best);
    }
  }

  private cancelSemanticPrediction(): void {
    if (this.semanticTimer) {
      clearTimeout(this.semanticTimer);
      this.semanticTimer = null;
    }
    if (this.semanticAbort) {
      this.semanticAbort.abort();
      this.semanticAbort = null;
    }
    this.activeSemanticRequestId = null;
  }

  private validateCandidate(candidate: NextEditCandidate): boolean {
    const snapshot = this.snapshot;
    if (!snapshot) return false;
    if (candidate.documentKey !== snapshot.documentKey) return false;
    if (candidate.basedOnRevision !== snapshot.revision) return false;
    return this.textMatches(
      candidate.startOffset,
      candidate.endOffset,
      candidate.expectedText,
    );
  }

  private textMatches(
    startOffset: number,
    endOffset: number,
    expectedText: string,
  ): boolean {
    if (!this.snapshot) return false;
    if (startOffset < 0 || endOffset < startOffset) return false;
    if (endOffset > this.snapshot.text.length) return false;
    return this.snapshot.text.slice(startOffset, endOffset) === expectedText;
  }

  private setSuggestion(candidate: NextEditCandidate | null): void {
    const next = candidate && this.validateCandidate(candidate) ? candidate : null;
    const changed = this.suggestion?.id !== next?.id;
    this.suggestion = next;
    this.state = next ? "showing" : "idle";
    if (changed) {
      this.onSuggestionChanged?.(next);
      for (const listener of this.suggestionListeners) {
        listener(next);
      }
    }
  }

  private clearSuggestion(): void {
    this.setSuggestion(null);
  }
}

function rangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  if (startB === endB) return startA <= startB && startB <= endA;
  return startA < endB && startB < endA;
}
