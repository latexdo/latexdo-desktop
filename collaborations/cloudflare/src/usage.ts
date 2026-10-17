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
      this.sql.exec<{ total: number | null }>("SELECT SUM(bytes) AS total FROM projects").one()
        .total ?? 0
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

  allows(incomingBytes: number): boolean {
    return this.total() + Math.max(0, incomingBytes) <= limits.maxAccountBytes;
  }
}
