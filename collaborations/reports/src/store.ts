/*
 * Every crash report, grouped by problem. One SQLite-backed Durable Object
 * holds them all: reports are rare (the app only sends real bugs, once per
 * problem per version), so a single instance is plenty on the free plan.
 *
 * No IP addresses are stored, and the reporter's random install id only as a
 * hash, to count how many different people hit a problem.
 */

import { DurableObject } from "cloudflare:workers";
import { compareVersions, reportLimits, type StoredReport } from "./report";

export type IssueStatus = "open" | "fixed" | "ignored" | "regressed";

export interface IssueSummary {
  fingerprint: string;
  title: string;
  category: string;
  kind: string;
  status: IssueStatus;
  firstSeen: number;
  lastSeen: number;
  occurrences: number;
  reports: number;
  reporters: number;
  firstVersion: string;
  lastVersion: string;
  fixedIn: string | null;
  githubIssue: string | null;
}

export interface IngestResult {
  id: string;
  known: boolean;
  occurrences: number;
  reporters: number;
  status: IssueStatus;
  fixedIn?: string;
}

interface IssueRow {
  fingerprint: string;
  title: string;
  category: string;
  kind: string;
  status: IssueStatus;
  first_seen: number;
  last_seen: number;
  occurrences: number;
  reports: number;
  reporters: number;
  first_version: string;
  last_version: string;
  fixed_in: string | null;
  github_issue: string | null;
  [key: string]: SqlStorageValue;
}

function summary(row: IssueRow): IssueSummary {
  return {
    fingerprint: row.fingerprint,
    title: row.title,
    category: row.category,
    kind: row.kind,
    status: row.status,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    occurrences: row.occurrences,
    reports: row.reports,
    reporters: row.reporters,
    firstVersion: row.first_version,
    lastVersion: row.last_version,
    fixedIn: row.fixed_in,
    githubIssue: row.github_issue,
  };
}

const dayMs = 24 * 60 * 60 * 1000;

export class ReportStore extends DurableObject<Record<string, unknown>> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS issues (
        fingerprint TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        occurrences INTEGER NOT NULL,
        reports INTEGER NOT NULL,
        reporters INTEGER NOT NULL,
        first_version TEXT NOT NULL,
        last_version TEXT NOT NULL,
        fixed_in TEXT,
        github_issue TEXT
      );
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        app_version TEXT NOT NULL,
        platform TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reports_by_issue ON reports (fingerprint, received_at);
      CREATE INDEX IF NOT EXISTS reports_by_time ON reports (received_at);
      CREATE TABLE IF NOT EXISTS reporters (
        fingerprint TEXT NOT NULL,
        reporter TEXT NOT NULL,
        PRIMARY KEY (fingerprint, reporter)
      );
    `);
  }

  private issueRow(fingerprint: string): IssueRow | null {
    return (
      this.sql
        .exec<IssueRow>("SELECT * FROM issues WHERE fingerprint = ?", fingerprint)
        .toArray()[0] ?? null
    );
  }

  private result(id: string, known: boolean, row: IssueRow): IngestResult {
    return {
      id,
      known,
      occurrences: row.reports,
      reporters: row.reporters,
      status: row.status,
      ...(row.fixed_in ? { fixedIn: row.fixed_in } : {}),
    };
  }

  async ingest(report: StoredReport, reporterHash: string): Promise<IngestResult> {
    const now = Date.now();
    const existingIssue = this.issueRow(report.fingerprint);
    // The app retries after a network failure: the same report counts once.
    if (
      existingIssue &&
      this.sql.exec("SELECT 1 FROM reports WHERE id = ?", report.id).toArray().length
    ) {
      return this.result(report.id, true, existingIssue);
    }

    const version = report.environment.appVersion;
    if (!existingIssue) {
      this.sql.exec(
        `INSERT INTO issues (fingerprint, title, category, kind, first_seen, last_seen,
           occurrences, reports, reporters, first_version, last_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
        report.fingerprint,
        report.title,
        report.category,
        report.kind,
        now,
        now,
        report.occurrences,
        version,
        version,
      );
    } else {
      // Seen again in a version that should have the fix: it came back.
      const regressed =
        existingIssue.status === "fixed" &&
        existingIssue.fixed_in !== null &&
        compareVersions(version, existingIssue.fixed_in) >= 0;
      this.sql.exec(
        `UPDATE issues SET last_seen = ?, occurrences = occurrences + ?, reports = reports + 1,
           last_version = CASE WHEN ? THEN ? ELSE last_version END,
           status = CASE WHEN ? THEN 'regressed' ELSE status END
         WHERE fingerprint = ?`,
        now,
        report.occurrences,
        compareVersions(version, existingIssue.last_version) >= 0 ? 1 : 0,
        version,
        regressed ? 1 : 0,
        report.fingerprint,
      );
    }

    const newReporter = this.sql
      .exec(
        "INSERT OR IGNORE INTO reporters (fingerprint, reporter) VALUES (?, ?) RETURNING 1",
        report.fingerprint,
        reporterHash,
      )
      .toArray().length;
    if (newReporter) {
      this.sql.exec(
        "UPDATE issues SET reporters = reporters + 1 WHERE fingerprint = ?",
        report.fingerprint,
      );
    }

    this.sql.exec(
      "INSERT INTO reports (id, fingerprint, received_at, app_version, platform, payload) VALUES (?, ?, ?, ?, ?, ?)",
      report.id,
      report.fingerprint,
      now,
      version,
      report.environment.platform,
      JSON.stringify(report),
    );
    // Keep the newest samples of each problem, and a bounded total.
    this.sql.exec(
      `DELETE FROM reports WHERE fingerprint = ? AND id NOT IN (
         SELECT id FROM reports WHERE fingerprint = ? ORDER BY received_at DESC LIMIT ?)`,
      report.fingerprint,
      report.fingerprint,
      reportLimits.samplesPerIssue,
    );
    const total = this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM reports")
      .one().n;
    if (total > reportLimits.maxReports) {
      this.sql.exec(
        "DELETE FROM reports WHERE id IN (SELECT id FROM reports ORDER BY received_at ASC LIMIT ?)",
        total - reportLimits.maxReports,
      );
    }

    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(now + dayMs);
    }
    return this.result(
      report.id,
      Boolean(existingIssue),
      this.issueRow(report.fingerprint)!,
    );
  }

  listIssues(status: IssueStatus | null, limit: number): IssueSummary[] {
    const rows = status
      ? this.sql.exec<IssueRow>(
          "SELECT * FROM issues WHERE status = ? ORDER BY last_seen DESC LIMIT ?",
          status,
          limit,
        )
      : this.sql.exec<IssueRow>(
          "SELECT * FROM issues ORDER BY last_seen DESC LIMIT ?",
          limit,
        );
    return rows.toArray().map(summary);
  }

  issue(fingerprint: string): { issue: IssueSummary; samples: StoredReport[] } | null {
    const row = this.issueRow(fingerprint);
    if (!row) return null;
    const samples = this.sql
      .exec<{ payload: string }>(
        "SELECT payload FROM reports WHERE fingerprint = ? ORDER BY received_at DESC",
        fingerprint,
      )
      .toArray()
      .map((sample) => JSON.parse(sample.payload) as StoredReport);
    return { issue: summary(row), samples };
  }

  updateIssue(
    fingerprint: string,
    changes: {
      status?: IssueStatus;
      fixedIn?: string | null;
      githubIssue?: string | null;
    },
  ): IssueSummary | null {
    const row = this.issueRow(fingerprint);
    if (!row) return null;
    this.sql.exec(
      "UPDATE issues SET status = ?, fixed_in = ?, github_issue = ? WHERE fingerprint = ?",
      changes.status ?? row.status,
      changes.fixedIn === undefined ? row.fixed_in : changes.fixedIn,
      changes.githubIssue === undefined ? row.github_issue : changes.githubIssue,
      fingerprint,
    );
    return summary(this.issueRow(fingerprint)!);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    this.sql.exec(
      "DELETE FROM reports WHERE received_at < ?",
      now - reportLimits.reportLifetimeMs,
    );
    const stale = this.sql
      .exec<{
        fingerprint: string;
      }>("SELECT fingerprint FROM issues WHERE last_seen < ?", now - reportLimits.issueLifetimeMs)
      .toArray();
    for (const { fingerprint } of stale) {
      this.sql.exec("DELETE FROM reporters WHERE fingerprint = ?", fingerprint);
      this.sql.exec("DELETE FROM issues WHERE fingerprint = ?", fingerprint);
    }
    await this.ctx.storage.setAlarm(now + dayMs);
  }
}
