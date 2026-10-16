// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as encoding from "lib0/encoding";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";

type Identity = { session: string; client: string };
const owner = { session: "private-owner-session", client: "public-owner-id" };
const member = { session: "private-member-session", client: "public-member-id" };
let child: ChildProcess;
let directory: string;
let origin: string;
let logs = "";
const sockets = new Set<WebSocket>();

async function request(
  route: string,
  identity: Identity,
  method = "GET",
  body?: unknown,
) {
  return fetch(`${origin}${route}`, {
    method,
    headers: {
      "x-latexdo-session": identity.session,
      "x-latexdo-client": identity.client,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function project() {
  const created = await request("/api/projects", owner, "POST", {
    name: "Security regression",
  });
  expect(created.status).toBe(200);
  const { id } = (await created.json()) as { id: string };
  const shared = await request(`/api/projects/${id}/share`, owner, "POST");
  const { token } = (await shared.json()) as { token: string };
  expect((await request(`/api/shares/${token}/open`, member, "POST")).status).toBe(200);
  return { id, token };
}

async function connect(id: string, identity: Identity) {
  const url = new URL(`/api/projects/${id}/files/collaborate`, origin);
  url.protocol = "ws:";
  url.search = new URLSearchParams({
    session: identity.session,
    clientId: identity.client,
    path: "main.tex",
  }).toString();
  const socket = new WebSocket(url);
  sockets.add(socket);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket failed")), {
      once: true,
    });
  });
  return socket;
}

function closed(socket: WebSocket) {
  return new Promise<CloseEvent>((resolve) =>
    socket.addEventListener("close", resolve, { once: true }),
  );
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-collab-security-"));
  child = spawn(process.execPath, ["collaborations/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LATEXDO_COLLAB_HOST: "127.0.0.1",
      LATEXDO_COLLAB_PORT: "0",
      LATEXDO_COLLAB_DATA_DIR: directory,
      LATEXDO_COLLAB_TRUST_PROXY: "false",
      LATEXDO_COLLAB_ACCESS_LOG: "true",
      LATEXDO_COLLAB_MAX_FILE_BYTES: "128",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Server exited: ${code}; ${logs}`)));
    child.stderr?.on("data", (chunk) => {
      logs += String(chunk);
    });
    child.stdout?.on("data", (chunk) => {
      logs += String(chunk);
      for (const line of logs.split("\n")) {
        try {
          const record = JSON.parse(line);
          if (record.msg === "listening") {
            origin = `http://127.0.0.1:${record.port}`;
            resolve();
          }
        } catch {
          /* Wait for a complete log line. */
        }
      }
    });
  });
}, 15_000);

afterAll(async () => {
  for (const socket of sockets) socket.close();
  if (child && child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("collaboration security boundaries", () => {
  it("does not authenticate using a disclosed collaborator ID", async () => {
    const { id, token } = await project();
    const attacker = { session: "attacker-session", client: owner.client };
    expect((await request(`/api/projects/${id}/files`, attacker)).status).toBe(403);
    expect((await request(`/api/shares/${token}/permissions`, attacker)).status).toBe(
      403,
    );
    expect((await request(`/api/projects/${id}/files`, owner)).status).toBe(200);
    expect((await request(`/api/projects/${id}/files`, member)).status).toBe(200);
    const permissions = await (
      await request(`/api/shares/${token}/permissions`, member)
    ).text();
    expect(permissions).not.toContain("sessionHash");
    expect(permissions).not.toContain(owner.session);
  });

  it.each(["__proto__", "constructor", "toString"])(
    "handles the client ID %s without prototype privileges",
    async (client) => {
      const { id } = await project();
      expect(
        (await request(`/api/projects/${id}/files`, { session: "attacker", client }))
          .status,
      ).toBe(403);
    },
  );

  it("rejects unbound legacy permissions instead of letting callers claim them", async () => {
    const { id } = await project();
    const metaPath = path.join(directory, "projects", id, "project.json");
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    delete meta.permissions[member.client].sessionHash;
    await writeFile(metaPath, JSON.stringify(meta));
    expect((await request(`/api/projects/${id}/files`, member)).status).toBe(403);
    expect((await request(`/api/projects/${id}/files`, owner)).status).toBe(200);
  });

  it.each([sync.messageYjsSyncStep2, sync.messageYjsUpdate])(
    "rejects viewer writes through sync message %i",
    async (messageType) => {
      const { id, token } = await project();
      expect(
        (
          await request(
            `/api/projects/${id}/files/content?path=main.tex`,
            owner,
            "PUT",
            { content: "unchanged" },
          )
        ).status,
      ).toBe(204);
      expect(
        (
          await request(`/api/shares/${token}/permissions`, owner, "PUT", {
            clientId: member.client,
            role: "viewer",
          })
        ).status,
      ).toBe(200);
      const socket = await connect(id, member);
      const doc = new Y.Doc();
      doc.getText("content").insert(0, "unauthorized");
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      encoding.writeVarUint(encoder, messageType);
      encoding.writeVarUint8Array(encoder, Y.encodeStateAsUpdate(doc));
      const closeEvent = closed(socket);
      socket.send(encoding.toUint8Array(encoder));
      expect((await closeEvent).code).toBe(1008);
      expect(
        await (
          await request(`/api/projects/${id}/files/content?path=main.tex`, owner)
        ).json(),
      ).toEqual({ content: "unchanged" });
      doc.destroy();
    },
  );

  it("disconnects an editor immediately after a downgrade", async () => {
    const { id, token } = await project();
    const socket = await connect(id, member);
    const closeEvent = closed(socket);
    expect(
      (
        await request(`/api/shares/${token}/permissions`, owner, "PUT", {
          clientId: member.client,
          role: "viewer",
        })
      ).status,
    ).toBe(200);
    expect((await closeEvent).code).toBe(1008);
  });

  it("rejects oversized editor updates before they affect shared state", async () => {
    const { id } = await project();
    await request(`/api/projects/${id}/files/content?path=main.tex`, owner, "PUT", {
      content: "original",
    });
    const socket = await connect(id, member);
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "x".repeat(129));
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    sync.writeSyncStep2(encoder, doc);
    const closeEvent = closed(socket);
    socket.send(encoding.toUint8Array(encoder));
    expect((await closeEvent).code).toBe(1009);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      await (
        await request(`/api/projects/${id}/files/content?path=main.tex`, owner)
      ).json(),
    ).toEqual({ content: "original" });
    doc.destroy();
  });

  it("preserves independent permission changes made concurrently", async () => {
    const { token } = await project();
    const second = { client: "second-member", session: "second-secret" };
    await request(`/api/shares/${token}/open`, second, "POST");
    const responses = await Promise.all(
      [member, second].map((identity) =>
        request(`/api/shares/${token}/permissions`, owner, "PUT", {
          clientId: identity.client,
          role: "viewer",
        }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const { permissions } = (await (
      await request(`/api/shares/${token}/permissions`, owner)
    ).json()) as { permissions: { clientId: string; role: string }[] };
    expect(permissions.filter((p) => p.role === "viewer")).toHaveLength(2);
  });

  it("still accepts authorized editor updates", async () => {
    const { id } = await project();
    const socket = await connect(id, member);
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "valid edit");
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    sync.writeSyncStep2(encoder, doc);
    socket.send(encoding.toUint8Array(encoder));
    await expect
      .poll(async () => {
        const response = await request(
          `/api/projects/${id}/files/content?path=main.tex`,
          owner,
        );
        return response.status === 200
          ? ((await response.json()) as { content: string }).content
          : null;
      })
      .toBe("valid edit");
    socket.close();
    doc.destroy();
  });

  it("does not automatically re-enroll a removed member with their old token", async () => {
    const { id, token } = await project();
    expect(
      (
        await request(
          `/api/shares/${token}/collaborators/${member.client}`,
          owner,
          "DELETE",
        )
      ).status,
    ).toBe(204);
    expect((await request(`/api/shares/${token}/open`, member, "POST")).status).toBe(
      403,
    );
    expect((await request(`/api/projects/${id}/files`, member)).status).toBe(403);
  });

  it("redacts share credentials from access logs", async () => {
    const { token } = await project();
    await request(`/api/shares/${token}/permissions?session=secret-query`, owner);
    await request(`/api/%73hares/${token}/permissions`, owner);
    await request(`/api//shares/${token}/permissions`, owner);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(logs).toContain("/api/shares/[redacted]");
    expect(logs).not.toContain(token);
    expect(logs).not.toContain("secret-query");
  });

  it("bounds awareness identities per connection", async () => {
    const { id } = await project();
    const socket = await connect(id, member);
    const awareness = encoding.createEncoder();
    encoding.writeVarUint(awareness, 17);
    for (let id = 0; id < 17; id++) {
      encoding.writeVarUint(awareness, id);
      encoding.writeVarUint(awareness, 1);
      encoding.writeVarString(awareness, "{}");
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint8Array(encoder, encoding.toUint8Array(awareness));
    const closeEvent = closed(socket);
    socket.send(encoding.toUint8Array(encoder));
    expect((await closeEvent).code).toBe(1008);
  });
});
