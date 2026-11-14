/*
 * An account-wide meter of how much the shared projects store. The free plan
 * gives 5 GB in total; this keeps a safety margin so one person cannot fill
 * it for everyone (uploads and new projects are refused near the limit).
 */

import { DurableObject } from "cloudflare:workers";
import { limits } from "./shared";

export class UsageMeter extends DurableObject<Record<string, unknown>> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, bytes INTEGER NOT NULL)",
    );
    // The files alone, without the edit history: what the project limit
    // counts. Added later, so older rows may not have it yet.
    try {
      this.sql.exec("ALTER TABLE projects ADD COLUMN content_bytes INTEGER");
    } catch {
      // Already there.
    }
    // Uploads refused for being over the project limit, counted per day.
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS refusals (day TEXT PRIMARY KEY, count INTEGER NOT NULL)",
    );
  }

  private total(): number {
    return (
      this.sql
        .exec<{ total: number | null }>("SELECT SUM(bytes) AS total FROM projects")
        .one().total ?? 0
    );
  }

  report(projectId: string, bytes: number, contentBytes?: number): void {
    if (!/^project_[0-9a-f]{32}$/.test(projectId) || !Number.isFinite(bytes)) return;
    if (bytes <= 0) {
      this.sql.exec("DELETE FROM projects WHERE id = ?", projectId);
      return;
    }
    const content =
      typeof contentBytes === "number" && Number.isFinite(contentBytes)
        ? Math.max(0, Math.round(contentBytes))
        : null;
    this.sql.exec(
      "INSERT INTO projects (id, bytes, content_bytes) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET bytes = excluded.bytes, content_bytes = excluded.content_bytes",
      projectId,
      Math.round(bytes),
      content,
    );
  }

  /** One upload refused for being over the project limit (a count only). */
  recordRefusal(): void {
    const today = new Date().toISOString().slice(0, 10);
    this.sql.exec(
      "INSERT INTO refusals (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1",
      today,
    );
    const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    this.sql.exec("DELETE FROM refusals WHERE day < ?", cutoff);
  }

  /** Totals for the admin dashboard: sizes only, never names or content. */
  stats(): {
    usedBytes: number;
    limitBytes: number;
    projects: number;
    largest: Array<{ id: string; bytes: number; contentBytes: number }>;
    projectLimitBytes: number;
    editHeadroomBytes: number;
    nearLimit: number;
    overLimit: number;
    refusals: Array<{ day: string; count: number }>;
  } {
    const projects = this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM projects")
      .one().n;
    // What the limit counts: the files (older rows only know the total).
    const content = "COALESCE(content_bytes, bytes)";
    const largest = this.sql
      .exec<{ id: string; bytes: number; content: number }>(
        `SELECT id, bytes, ${content} AS content FROM projects ORDER BY content DESC LIMIT 10`,
      )
      .toArray()
      .map((row) => ({ id: row.id, bytes: row.bytes, contentBytes: row.content }));
    const count = (where: string, ...values: number[]) =>
      this.sql
        .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM projects WHERE ${where}`, ...values)
        .one().n;
    const nearFrom = Math.round(limits.maxProjectBytes * limits.nearProjectLimitShare);
    const since = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
    const refusals = this.sql
      .exec<{ day: string; count: number }>(
        "SELECT day, count FROM refusals WHERE day >= ? ORDER BY day",
        since,
      )
      .toArray()
      .map((row) => ({ day: row.day, count: row.count }));
    return {
      usedBytes: this.total(),
      limitBytes: limits.maxAccountBytes,
      projects,
      largest,
      projectLimitBytes: limits.maxProjectBytes,
      editHeadroomBytes: limits.editHeadroomBytes,
      nearLimit: count(
        `${content} >= ? AND ${content} <= ?`,
        nearFrom,
        limits.maxProjectBytes,
      ),
      overLimit: count(`${content} > ?`, limits.maxProjectBytes),
      refusals,
    };
  }

  allows(incomingBytes: number): boolean {
    return this.total() + Math.max(0, incomingBytes) <= limits.maxAccountBytes;
  }
}
