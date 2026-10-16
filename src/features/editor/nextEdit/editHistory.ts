import {
  EDIT_TTL_MS,
  MAX_RECENT_EDITS,
  type DocumentEditSession,
  type EditOrigin,
  type NormalizedEdit,
} from "./nextEditTypes";

export class EditHistoryStore {
  private readonly sessions = new Map<string, DocumentEditSession>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly maxRecentEdits = MAX_RECENT_EDITS,
    private readonly editTtlMs = EDIT_TTL_MS,
  ) {}

  get(documentKey: string): DocumentEditSession {
    let session = this.sessions.get(documentKey);
    if (!session) {
      session = {
        documentKey,
        revision: 0,
        recentEdits: [],
        acceptedPredictionIds: new Set(),
        dismissedPatternIds: new Map(),
      };
      this.sessions.set(documentKey, session);
    }
    this.prune(session);
    return session;
  }

  updateRevision(documentKey: string, revision: number): DocumentEditSession {
    const session = this.get(documentKey);
    session.revision = Math.max(session.revision, revision);
    return session;
  }

  recordEdit(edit: NormalizedEdit): DocumentEditSession {
    const session = this.get(edit.documentKey);
    session.revision = Math.max(session.revision, edit.revisionAfter);
    session.recentEdits.push(edit);
    this.prune(session);
    return session;
  }

  recordAccepted(documentKey: string, candidateId: string): void {
    this.get(documentKey).acceptedPredictionIds.add(candidateId);
  }

  recordDismissed(
    documentKey: string,
    patternId: string,
    timestamp = this.now(),
  ): void {
    this.get(documentKey).dismissedPatternIds.set(patternId, timestamp);
  }

  recentManualEdits(documentKey: string): NormalizedEdit[] {
    return this.get(documentKey).recentEdits.filter((edit) => edit.origin === "user");
  }

  disposeDocument(documentKey: string): void {
    this.sessions.delete(documentKey);
  }

  clear(): void {
    this.sessions.clear();
  }

  private prune(session: DocumentEditSession): void {
    const minTimestamp = this.now() - this.editTtlMs;
    session.recentEdits = session.recentEdits
      .filter((edit) => edit.timestamp >= minTimestamp)
      .slice(-this.maxRecentEdits);

    for (const [patternId, timestamp] of session.dismissedPatternIds) {
      if (timestamp < minTimestamp) {
        session.dismissedPatternIds.delete(patternId);
      }
    }
  }
}

export function originCanTeach(origin: EditOrigin): boolean {
  return origin === "user";
}
