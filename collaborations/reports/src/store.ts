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

/** Report counts for the admin dashboard; every count is exact, not sampled. */
export interface ReportStats {
  days: number;
  generatedAt: number;
  issuesByStatus: Record<IssueStatus, number>;
  /** One row per UTC day in the window, oldest first, zeros included. */
  daily: Array<{ day: string; reports: number; newIssues: number }>;
  byVersion: Array<{ key: string; reports: number }>;
  byPlatform: Array<{ key: string; reports: number }>;
  byCategory: Array<{ key: string; reports: number }>;
  /** The problems reported most in the window. */
  top: Array<{
    fingerprint: string;
    title: string;
    status: IssueStatus;
    reports: number;
  }>;
  totals: { reports: number; reporters: number; samples: number };
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
      -- Every accepted report, counted per UTC day: samples are capped per
      -- problem, so charts cannot be drawn from them.
      CREATE TABLE IF NOT EXISTS daily_counts (
        day INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        app_version TEXT NOT NULL,
        platform TEXT NOT NULL,
        reports INTEGER NOT NULL,
        PRIMARY KEY (day, fingerprint, app_version, platform)
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.backfillDailyCounts();
  }

  /**
   * Once: counts the reports received before daily_counts existed, so the
   * charts include them. Kept samples count on the day they arrived; reports
   * beyond the kept samples go on their problem's last-seen day, with its
   * last version. Nothing already counted is counted twice.
   */
  private backfillDailyCounts(): void {
    const done = this.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'daily_backfill'")
      .toArray()[0];
    if (done) return;
    this.ctx.storage.transactionSync(() => {
      // Samples from days with nothing counted yet (before the counter existed).
      this.sql.exec(
        `INSERT INTO daily_counts (day, fingerprint, app_version, platform, reports)
         SELECT CAST(received_at / ? AS INTEGER) AS day, fingerprint, app_version, platform, COUNT(*)
         FROM reports
         WHERE CAST(received_at / ? AS INTEGER) < COALESCE((SELECT MIN(day) FROM daily_counts), 1e15)
         GROUP BY day, fingerprint, app_version, platform
         ON CONFLICT(day, fingerprint, app_version, platform) DO UPDATE SET reports = reports + excluded.reports`,
        dayMs,
        dayMs,
      );
      // Whatever each problem still lacks: reports whose samples were dropped.
      const missing = this.sql
        .exec<{
          fingerprint: string;
          last_seen: number;
          last_version: string;
          missing: number;
          platform: string | null;
        }>(
          `SELECT issues.fingerprint, issues.last_seen, issues.last_version,
             issues.reports - COALESCE((SELECT SUM(reports) FROM daily_counts
               WHERE daily_counts.fingerprint = issues.fingerprint), 0) AS missing,
             (SELECT platform FROM reports WHERE reports.fingerprint = issues.fingerprint
               ORDER BY received_at DESC LIMIT 1) AS platform
           FROM issues`,
        )
        .toArray()
        .filter((row) => row.missing > 0);
      for (const row of missing) {
        this.sql.exec(
          `INSERT INTO daily_counts (day, fingerprint, app_version, platform, reports)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(day, fingerprint, app_version, platform) DO UPDATE SET reports = reports + excluded.reports`,
          Math.floor(row.last_seen / dayMs),
          row.fingerprint,
          row.last_version,
          row.platform ?? "unknown",
          row.missing,
        );
      }
      this.sql.exec(
        "INSERT INTO meta (key, value) VALUES ('daily_backfill', ?)",
        String(Date.now()),
      );
    });
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
      `INSERT INTO daily_counts (day, fingerprint, app_version, platform, reports)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(day, fingerprint, app_version, platform) DO UPDATE SET reports = reports + 1`,
      Math.floor(now / dayMs),
      report.fingerprint,
      version,
      report.environment.platform,
    );
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

  stats(days: number, now = Date.now()): ReportStats {
    const today = Math.floor(now / dayMs);
    const firstDay = today - days + 1;
    const grouped = (column: "app_version" | "platform") =>
      this.sql
        .exec<{ key: string; reports: number }>(
          `SELECT ${column} AS key, SUM(reports) AS reports FROM daily_counts
           WHERE day >= ? GROUP BY ${column} ORDER BY reports DESC LIMIT 12`,
          firstDay,
        )
        .toArray();

    const issuesByStatus: Record<IssueStatus, number> = {
      open: 0,
      fixed: 0,
      ignored: 0,
      regressed: 0,
    };
    for (const row of this.sql
      .exec<{
        status: IssueStatus;
        n: number;
      }>("SELECT status, COUNT(*) AS n FROM issues GROUP BY status")
      .toArray()) {
      issuesByStatus[row.status] = row.n;
    }

    const reportsByDay = new Map(
      this.sql
        .exec<{ day: number; reports: number }>(
          "SELECT day, SUM(reports) AS reports FROM daily_counts WHERE day >= ? GROUP BY day",
          firstDay,
        )
        .toArray()
        .map((row) => [row.day, row.reports]),
    );
    const newIssuesByDay = new Map(
      this.sql
        .exec<{ day: number; n: number }>(
          "SELECT CAST(first_seen / ? AS INTEGER) AS day, COUNT(*) AS n FROM issues WHERE first_seen >= ? GROUP BY day",
          dayMs,
          firstDay * dayMs,
        )
        .toArray()
        .map((row) => [row.day, row.n]),
    );
    const daily: ReportStats["daily"] = [];
    for (let day = firstDay; day <= today; day += 1) {
      daily.push({
        day: new Date(day * dayMs).toISOString().slice(0, 10),
        reports: reportsByDay.get(day) ?? 0,
        newIssues: newIssuesByDay.get(day) ?? 0,
      });
    }

    const byCategory = this.sql
      .exec<{ key: string; reports: number }>(
        `SELECT issues.category AS key, SUM(daily_counts.reports) AS reports
         FROM daily_counts JOIN issues USING (fingerprint)
         WHERE daily_counts.day >= ? GROUP BY issues.category ORDER BY reports DESC`,
        firstDay,
      )
      .toArray();
    const top = this.sql
      .exec<{
        fingerprint: string;
        title: string;
        status: IssueStatus;
        reports: number;
      }>(
        `SELECT issues.fingerprint AS fingerprint, issues.title AS title, issues.status AS status,
           SUM(daily_counts.reports) AS reports
         FROM daily_counts JOIN issues USING (fingerprint)
         WHERE daily_counts.day >= ?
         GROUP BY issues.fingerprint ORDER BY reports DESC LIMIT 8`,
        firstDay,
      )
      .toArray();
    const totals = this.sql
      .exec<{
        reports: number | null;
        reporters: number | null;
      }>("SELECT SUM(reports) AS reports, SUM(reporters) AS reporters FROM issues")
      .one();
    const samples = this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM reports")
      .one().n;

    return {
      days,
      generatedAt: now,
      issuesByStatus,
      daily,
      byVersion: grouped("app_version"),
      byPlatform: grouped("platform"),
      byCategory,
      top,
      totals: {
        reports: totals.reports ?? 0,
        reporters: totals.reporters ?? 0,
        samples,
      },
    };
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    this.sql.exec(
      "DELETE FROM reports WHERE received_at < ?",
      now - reportLimits.reportLifetimeMs,
    );
    this.sql.exec(
      "DELETE FROM daily_counts WHERE day < ?",
      Math.floor((now - reportLimits.issueLifetimeMs) / dayMs),
    );
    const stale = this.sql
      .exec<{
        fingerprint: string;
      }>(
        "SELECT fingerprint FROM issues WHERE last_seen < ?",
        now - reportLimits.issueLifetimeMs,
      )
      .toArray();
    for (const { fingerprint } of stale) {
      this.sql.exec("DELETE FROM reporters WHERE fingerprint = ?", fingerprint);
      this.sql.exec("DELETE FROM issues WHERE fingerprint = ?", fingerprint);
    }
    await this.ctx.storage.setAlarm(now + dayMs);
  }
}
