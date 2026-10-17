/*
 * LatexDo's collaboration server on Cloudflare: the same HTTP + WebSocket API
 * as the self-hosted server (../server.mjs), backed by one Durable Object per
 * project, so shared projects stay online when their owner goes offline.
 */

import { DurableObject } from "cloudflare:workers";
import { ProjectRoom } from "./room";
import { UsageMeter } from "./usage";
import {
  HttpError,
  errorResponse,
  isProjectId,
  json,
  limits,
  newProjectId,
  projectIdFromShareToken,
  requestIdentity,
  sha256Hex,
} from "./shared";

export { ProjectRoom, UsageMeter };

interface Env {
  PROJECTS: DurableObjectNamespace<ProjectRoom>;
  OWNERS: DurableObjectNamespace<OwnerIndex>;
  USAGE: DurableObjectNamespace<UsageMeter>;
  /** Per-address request limit, counted across Cloudflare's network. */
  REQUESTS?: RateLimit;
  /** Per-address limit on new projects. */
  CREATES?: RateLimit;
}

/** The projects one person owns, so they reopen after a restart. */
export class OwnerIndex extends DurableObject<Record<string, unknown>> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL)",
    );
  }

  count(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM projects").one().n;
  }

  add(id: string, name: string): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO projects (id, name, created) VALUES (?, ?, ?)",
      id,
      name,
      Date.now(),
    );
  }

  list(): Array<{ id: string; name: string; updatedAt: number }> {
    return this.sql
      .exec<{ id: string; name: string; created: number }>(
        "SELECT id, name, created FROM projects ORDER BY created DESC",
      )
      .toArray()
      .map((row) => ({ id: row.id, name: row.name, updatedAt: row.created }));
  }
}

// A per-location fallback when the rate-limiting bindings are unavailable.
const windows = new Map<string, { count: number; creates: number; resetAt: number }>();

function localAllow(ip: string, create: boolean): boolean {
  const time = Date.now();
  let bucket = windows.get(ip);
  if (!bucket || bucket.resetAt <= time) {
    if (windows.size > 50_000) windows.clear();
    bucket = { count: 0, creates: 0, resetAt: time + 60_000 };
    windows.set(ip, bucket);
  }
  bucket.count += 1;
  if (create) bucket.creates += 1;
  return bucket.count <= 600 && (!create || bucket.creates <= 5);
}

async function allow(env: Env, ip: string, create = false): Promise<boolean> {
  if (!localAllow(ip, create)) return false;
  try {
    if (env.REQUESTS && !(await env.REQUESTS.limit({ key: ip })).success) return false;
    if (create && env.CREATES && !(await env.CREATES.limit({ key: ip })).success) return false;
  } catch {
    // The binding is best effort; the local window above still applies.
  }
  return true;
}

async function ownerIndex(env: Env, sessionId: string) {
  return env.OWNERS.get(env.OWNERS.idFromName(`owner:${await sha256Hex(sessionId)}`));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      const ip = request.headers.get("cf-connecting-ip") ?? "unknown";

      if (url.pathname === "/" || (parts[0] === "api" && parts[1] === "health")) {
        return json(200, {
          ok: true,
          product: "LatexDo collaborations",
          version: 3,
          encryption: "end-to-end",
          websocket: true,
        });
      }
      // Only the LatexDo app talks to this server: no browser preflights.
      if (request.method === "OPTIONS") throw new HttpError(405, "Method not allowed.");
      if (parts[0] !== "api") throw new HttpError(404, "Route not found.");
      if (!(await allow(env, ip))) {
        throw new HttpError(429, "Too many requests. Please slow down and try again.");
      }

      if (parts[1] === "projects" && parts.length === 2) {
        const identity = requestIdentity(request, url);
        const owners = await ownerIndex(env, identity.sessionId);
        if (request.method === "GET")
          return json(200, { projects: await owners.list() });
        if (request.method === "POST") {
          if (!(await allow(env, ip, true))) {
            throw new HttpError(429, "Too many new projects. Please try again shortly.");
          }
          if ((await owners.count()) >= limits.maxProjectsPerOwner) {
            throw new HttpError(
              429,
              `You can own ${limits.maxProjectsPerOwner} shared projects. Stop sharing one to share another.`,
            );
          }
          if (!(await env.USAGE.get(env.USAGE.idFromName("global")).allows(0))) {
            throw new HttpError(
              507,
              "LatexDo's shared storage is full right now. Try again later or share on your network.",
            );
          }
          const id = newProjectId();
          const createUrl = new URL(`https://room/internal/create?id=${id}`);
          const response = await env.PROJECTS.get(env.PROJECTS.idFromName(id)).fetch(
            new Request(createUrl, {
              method: "POST",
              headers: request.headers,
              body: request.body,
            }),
          );
          if (response.ok) {
            const project = (await response.clone().json()) as { name: string };
            await owners.add(id, project.name);
          }
          return response;
        }
        throw new HttpError(405, "Method not allowed.");
      }

      let projectId: string | null = null;
      if (parts[1] === "projects" && parts[2]) {
        projectId = isProjectId(parts[2]) ? parts[2] : null;
      } else if (parts[1] === "shares" && parts[2]) {
        projectId = projectIdFromShareToken(parts[2]);
        if (!projectId) throw new HttpError(404, "Share token not found.");
      } else if (parts[1] === "import") {
        throw new HttpError(
          501,
          "Hosted import conversion is not configured on this collaboration server.",
        );
      }
      if (!projectId) throw new HttpError(404, "Project not found.");
      return await env.PROJECTS.get(env.PROJECTS.idFromName(projectId)).fetch(request);
    } catch (error) {
      return errorResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;
