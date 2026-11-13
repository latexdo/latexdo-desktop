/*
 * LatexDo's crash-report server, a sibling of the collaboration server
 * (../cloudflare): the desktop app posts crashes and bugs the person chose to
 * send; maintainers list and triage them with an admin token.
 *
 *   POST  /api/reports              a report from the app (no auth, rate limited)
 *   GET   /api/issues?status=&limit=  problems, newest first      (admin)
 *   GET   /api/issues/:fingerprint  one problem with its samples (admin)
 *   PATCH /api/issues/:fingerprint  {status, fixedIn, githubIssue} (admin)
 *   GET   /api/stats?days=30        counts per day, version, platform (admin)
 */

import { ReportStore, type IssueStatus } from "./store";
import { ReportError, parseSubmission, reportLimits } from "./report";

export { ReportStore };

interface Env {
  REPORTS: DurableObjectNamespace<ReportStore>;
  /** Per-address limit on new reports, counted across Cloudflare's network. */
  SUBMISSIONS?: RateLimit;
  /** `wrangler secret put ADMIN_TOKEN`; without it the admin API is off. */
  ADMIN_TOKEN?: string;
}

const securityHeaders: Record<string, string> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(status: number, body: unknown): Response {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: { ...securityHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof ReportError) {
    return json(error.status, {
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
  console.error(error);
  return json(500, { error: "Internal report server error." });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sameSecret(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

// A per-location fallback when the rate-limiting binding is unavailable.
const windows = new Map<string, { count: number; resetAt: number }>();
const perMinute = 10;

async function allow(env: Env, ip: string): Promise<boolean> {
  const now = Date.now();
  let bucket = windows.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    if (windows.size > 50_000) windows.clear();
    bucket = { count: 0, resetAt: now + 60_000 };
    windows.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > perMinute) return false;
  try {
    if (env.SUBMISSIONS && !(await env.SUBMISSIONS.limit({ key: ip })).success)
      return false;
  } catch {
    // Best effort; the local window above still applies.
  }
  return true;
}

async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > reportLimits.maxBodyBytes)
    throw new ReportError(413, "The report is too large.");
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) {
    throw new ReportError(415, "Reports are sent as JSON.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > reportLimits.maxBodyBytes) {
    throw new ReportError(413, "The report is too large.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ReportError(400, "The report is not valid JSON.");
  }
}

function requireAdmin(request: Request, env: Env): void {
  // Without a token the admin API does not exist, rather than being open.
  if (!env.ADMIN_TOKEN) throw new ReportError(404, "Route not found.");
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !sameSecret(token, env.ADMIN_TOKEN)) {
    throw new ReportError(401, "Admin token required.");
  }
}

const statuses = new Set<IssueStatus>(["open", "fixed", "ignored", "regressed"]);

function store(env: Env) {
  return env.REPORTS.get(env.REPORTS.idFromName("global"));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

      if (url.pathname === "/" || (parts[0] === "api" && parts[1] === "health")) {
        return json(200, { ok: true, product: "LatexDo crash reports", version: 1 });
      }
      // Only the app's main process posts here: no browser preflights.
      if (request.method === "OPTIONS")
        throw new ReportError(405, "Method not allowed.");
      if (parts[0] !== "api") throw new ReportError(404, "Route not found.");

      if (parts[1] === "reports" && parts.length === 2) {
        if (request.method !== "POST")
          throw new ReportError(405, "Method not allowed.");
        const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
        if (!(await allow(env, ip))) {
          throw new ReportError(429, "Too many reports. Please try again in a minute.");
        }
        const { report, reporter } = parseSubmission(await readJson(request));
        const result = await store(env).ingest(
          report,
          await sha256Hex(`reporter:${reporter}`),
        );
        return json(201, result);
      }

      if (parts[1] === "stats" && parts.length === 2) {
        requireAdmin(request, env);
        if (request.method !== "GET") throw new ReportError(405, "Method not allowed.");
        const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 365);
        return json(200, await store(env).stats(Math.floor(days)));
      }

      if (parts[1] === "issues") {
        requireAdmin(request, env);
        if (parts.length === 2 && request.method === "GET") {
          const status = url.searchParams.get("status");
          if (status && !statuses.has(status as IssueStatus)) {
            throw new ReportError(400, "Unknown status.");
          }
          const limit = Math.min(
            Math.max(Number(url.searchParams.get("limit")) || 50, 1),
            200,
          );
          return json(200, {
            issues: await store(env).listIssues((status as IssueStatus) || null, limit),
          });
        }
        if (parts.length === 3 && /^[0-9a-f]{16,64}$/.test(parts[2])) {
          if (request.method === "GET") {
            const found = await store(env).issue(parts[2]);
            if (!found) throw new ReportError(404, "Issue not found.");
            return json(200, found);
          }
          if (request.method === "PATCH") {
            const body = (await readJson(request)) as Record<string, unknown>;
            const changes: {
              status?: IssueStatus;
              fixedIn?: string | null;
              githubIssue?: string | null;
            } = {};
            if (body.status !== undefined) {
              if (!statuses.has(body.status as IssueStatus))
                throw new ReportError(400, "Unknown status.");
              changes.status = body.status as IssueStatus;
            }
            for (const key of ["fixedIn", "githubIssue"] as const) {
              const value = body[key];
              if (value === undefined) continue;
              if (value !== null && (typeof value !== "string" || value.length > 300)) {
                throw new ReportError(400, `Invalid ${key}.`);
              }
              changes[key] = value;
            }
            const updated = await store(env).updateIssue(parts[2], changes);
            if (!updated) throw new ReportError(404, "Issue not found.");
            return json(200, { issue: updated });
          }
          throw new ReportError(405, "Method not allowed.");
        }
      }
      throw new ReportError(404, "Route not found.");
    } catch (error) {
      return errorResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;
