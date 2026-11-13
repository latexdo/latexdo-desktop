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
  }

  private total(): number {
    return (
      this.sql
        .exec<{ total: number | null }>("SELECT SUM(bytes) AS total FROM projects")
        .one().total ?? 0
    );
  }

  report(projectId: string, bytes: number): void {
    if (!/^project_[0-9a-f]{32}$/.test(projectId) || !Number.isFinite(bytes)) return;
    if (bytes <= 0) {
      this.sql.exec("DELETE FROM projects WHERE id = ?", projectId);
      return;
    }
    this.sql.exec(
      "INSERT INTO projects (id, bytes) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET bytes = excluded.bytes",
      projectId,
      Math.round(bytes),
    );
  }

  /** Totals for the admin dashboard: sizes only, never names or content. */
  stats(): {
    usedBytes: number;
    limitBytes: number;
    projects: number;
    largest: Array<{ id: string; bytes: number }>;
  } {
    const projects = this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM projects")
      .one().n;
    const largest = this.sql
      .exec<{ id: string; bytes: number }>(
        "SELECT id, bytes FROM projects ORDER BY bytes DESC LIMIT 10",
      )
      .toArray()
      .map((row) => ({ id: row.id, bytes: row.bytes }));
    return {
      usedBytes: this.total(),
      limitBytes: limits.maxAccountBytes,
      projects,
      largest,
    };
  }

  allows(incomingBytes: number): boolean {
    return this.total() + Math.max(0, incomingBytes) <= limits.maxAccountBytes;
  }
}
