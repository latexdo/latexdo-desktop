/*
 * Records this person's edits to one shared file as history changes. Typing
 * is grouped into one change until a pause (or a few minutes at most). When
 * someone else's edit arrives mid-way, the change is closed just before it,
 * so every change holds one person's work only.
 */

import type { HistoryChange } from "../../types";
import { diffLines } from "./lineDiff";

export interface TextTransaction {
  kind: "local" | "remote";
  before: string;
  after: string;
}

export interface HistoryRecorderOptions {
  path: string;
  onChange: (change: HistoryChange) => void;
  /** A pause this long ends a change… */
  idleMs?: number;
  /** …and no change lasts longer than this. */
  maxMs?: number;
  now?: () => number;
}

export class HistoryRecorder {
  private readonly path: string;
  private readonly onChange: (change: HistoryChange) => void;
  private readonly idleMs: number;
  private readonly maxMs: number;
  private readonly now: () => number;
  private base: string | null = null;
  private latest = "";
  private startedAt = 0;
  private lastAt = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: HistoryRecorderOptions) {
    this.path = options.path;
    this.onChange = options.onChange;
    this.idleMs = options.idleMs ?? 30_000;
    this.maxMs = options.maxMs ?? 5 * 60_000;
    this.now = options.now ?? Date.now;
  }

  record(transaction: TextTransaction): void {
    if (transaction.kind === "remote") {
      // Close my change on the text exactly as it was before theirs.
      if (this.base !== null) this.flush(transaction.before);
      return;
    }
    if (this.base === null) {
      this.base = transaction.before;
      this.startedAt = this.now();
      this.maxTimer = setTimeout(() => this.flush(), this.maxMs);
    }
    this.latest = transaction.after;
    this.lastAt = this.now();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.flush(), this.idleMs);
  }

  /** Ends the current change (if any) and hands it over. */
  flush(current = this.latest): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.idleTimer = null;
    this.maxTimer = null;
    const base = this.base;
    this.base = null;
    if (base === null) return;
    const diff = diffLines(base, current);
    if (!diff.hunks.length) return;
    this.onChange({
      path: this.path,
      startedAt: this.startedAt,
      endedAt: this.lastAt,
      added: diff.added,
      removed: diff.removed,
      hunks: diff.hunks,
    });
  }

  /** The file is closed: keep what was written. */
  dispose(): void {
    this.flush();
  }
}

/**
 * Sends recorded changes in batches, about once a minute at most, so a busy
 * writer costs one request a minute rather than one per pause.
 */
export class HistoryUploader {
  private queue: HistoryChange[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;

  constructor(
    private readonly send: (changes: HistoryChange[]) => Promise<void>,
    private readonly batchMs = 60_000,
    private readonly maxQueue = 200,
  ) {}

  add(change: HistoryChange): void {
    this.queue.push(change);
    // Offline for long: keep the most recent changes.
    if (this.queue.length > this.maxQueue)
      this.queue.splice(0, this.queue.length - this.maxQueue);
    if (this.queue.length >= 20) void this.flush();
    else if (!this.timer)
      this.timer = setTimeout(() => void this.flush(), this.batchMs);
  }

  /** Sends what is waiting now (closing a project, the window going away). */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.sending || !this.queue.length) return;
    const batch = this.queue.splice(0, 50);
    this.sending = true;
    try {
      await this.send(batch);
    } catch {
      // Not lost: tried again with the next batch.
      this.queue.unshift(...batch);
      if (!this.timer) this.timer = setTimeout(() => void this.flush(), this.batchMs);
    } finally {
      this.sending = false;
    }
    if (this.queue.length && !this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.batchMs);
    }
  }

  get pending(): number {
    return this.queue.length;
  }
}
