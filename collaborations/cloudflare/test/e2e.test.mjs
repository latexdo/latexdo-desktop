// End-to-end checks against a running server (wrangler dev locally, or the
// deployed one): COLLAB_URL=https://collab.latexdo.org npm test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

const base = process.env.COLLAB_URL ?? "http://localhost:8790";

function person(name) {
  return { session: `session-${randomUUID()}`, client: `client-${randomUUID()}`, name };
}

async function call(who, method, path, body, token) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      "content-type": "application/json",
      "x-latexdo-session": who.session,
      "x-latexdo-client": who.client,
      "x-latexdo-client-name": who.name,
      ...(token ? { "x-latexdo-share-token": token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** A minimal live editor speaking the y-websocket protocol. */
async function editor(who, projectId, path, token) {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  const url = new URL(`/api/projects/${projectId}/files/collaborate`, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = new URLSearchParams({
    path,
    session: who.session,
    clientId: who.client,
    name: who.name,
    ...(token ? { share: token } : {}),
  }).toString();
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  const frames = [];
  let synced;
  const ready = new Promise((resolve) => (synced = resolve));
  socket.addEventListener("message", (event) => {
    const data = new Uint8Array(event.data);
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    if (type !== 0) {
      frames.push({ type, data: type >= 4 ? decoding.readVarString(decoder) : null });
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    const inner = syncProtocol.readSyncMessage(decoder, encoder, doc, "remote");
    if (encoding.length(encoder) > 1) socket.send(encoding.toUint8Array(encoder));
    if (
      inner === syncProtocol.messageYjsSyncStep2 ||
      inner === syncProtocol.messageYjsSyncStep1
    )
      synced();
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  syncProtocol.writeSyncStep1(encoder, doc);
  socket.send(encoding.toUint8Array(encoder));
  doc.on("update", (update, origin) => {
    if (origin === "remote") return;
    const out = encoding.createEncoder();
    encoding.writeVarUint(out, 0);
    syncProtocol.writeUpdate(out, update);
    socket.send(encoding.toUint8Array(out));
  });
  await ready;
  return { doc, text, socket, frames, close: () => socket.close(1000, "done") };
}

async function until(check, label, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test("a shared project works end to end", async () => {
  const owner = person("Omar");
  const guest = person("Ada");
  const stranger = person("Eve");

  const health = await fetch(new URL("/api/health", base)).then((r) => r.json());
  assert.equal(health.ok, true);

  // The owner creates a project and uploads text and a figure.
  const created = await call(owner, "POST", "/api/projects", { folderName: "Thesis" });
  assert.equal(created.status, 200);
  const id = created.body.id;
  assert.match(id, /^project_[0-9a-f]{32}$/);
  assert.equal(
    (
      await call(owner, "PUT", `/api/projects/${id}/files/content?path=main.tex`, {
        content: "Hello",
      })
    ).status,
    204,
  );
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]);
  assert.equal(
    (
      await call(
        owner,
        "PUT",
        `/api/projects/${id}/files/binary?path=figures/plot.png`,
        { base64: png.toString("base64") },
      )
    ).status,
    204,
  );
  const listed = (await call(owner, "GET", "/api/projects")).body.projects;
  assert.ok(
    listed.some((project) => project.id === id),
    "owner index lists the project",
  );

  // Nobody gets in without the invite.
  assert.equal((await call(stranger, "GET", `/api/projects/${id}/files`)).status, 403);

  // Sharing gives a token that carries the project id.
  const share = await call(owner, "POST", `/api/projects/${id}/share`, {});
  const token = share.body.token;
  assert.equal(share.body.enabled, true);
  assert.match(token, /^p[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/);

  // The guest joins and sees the same files, figure included.
  const opened = await call(guest, "POST", `/api/shares/${token}/open`, {}, token);
  assert.equal(opened.status, 200);
  assert.equal(opened.body.project.id, id);
  const tree = (await call(guest, "GET", `/api/projects/${id}/files`, undefined, token))
    .body;
  assert.deepEqual(
    tree.map((entry) => entry.name),
    ["figures", "main.tex"],
  );
  assert.equal(tree[0].children[0].binary, true);
  const figure = await call(
    guest,
    "GET",
    `/api/projects/${id}/files/binary?path=figures/plot.png`,
    undefined,
    token,
  );
  assert.deepEqual(Buffer.from(figure.body.base64, "base64"), png);

  // Two people type in the same file at once and both see the result.
  const a = await editor(owner, id, "main.tex");
  const b = await editor(guest, id, "main.tex", token);
  await until(
    () => a.text.toString() === "Hello" && b.text.toString() === "Hello",
    "initial sync",
  );
  a.text.insert(5, ", world");
  b.text.insert(0, ">> ");
  await until(
    () =>
      a.text.toString() === b.text.toString() &&
      a.text.toString() === ">> Hello, world",
    "merged edits",
  );
  // The server's copy is the merged text too.
  await until(
    async () =>
      (
        await call(
          guest,
          "GET",
          `/api/projects/${id}/files/content?path=main.tex`,
          undefined,
          token,
        )
      ).body.content === ">> Hello, world",
    "server copy",
  );

  // Adding a file tells every open editor to refresh its tree.
  await call(
    guest,
    "POST",
    `/api/projects/${id}/files`,
    { relativePath: "sections/intro.tex", type: "file" },
    token,
  );
  await until(() => a.frames.some((frame) => frame.type === 5), "tree change frame");
  // Presence shows both people.
  await until(
    () => a.frames.some((frame) => frame.type === 4 && frame.data.includes("Ada")),
    "presence frame",
  );

  // Copy, move and delete.
  assert.equal(
    (
      await call(
        guest,
        "POST",
        `/api/projects/${id}/files/copy`,
        { fromRelativePath: "main.tex", toRelativePath: "backup/main.tex" },
        token,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        guest,
        "POST",
        `/api/projects/${id}/files/move`,
        { fromRelativePath: "backup", toRelativePath: "old" },
        token,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        guest,
        "GET",
        `/api/projects/${id}/files/content?path=old/main.tex`,
        undefined,
        token,
      )
    ).body.content,
    ">> Hello, world",
  );
  assert.equal(
    (
      await call(
        guest,
        "DELETE",
        `/api/projects/${id}/files?path=old`,
        undefined,
        token,
      )
    ).status,
    204,
  );
  assert.equal(
    (
      await call(
        guest,
        "GET",
        `/api/projects/${id}/files/exists?path=old/main.tex`,
        undefined,
        token,
      )
    ).body.exists,
    false,
  );

  // One request returns the whole project, figure included, for compiling.
  const bundle = (
    await call(guest, "GET", `/api/projects/${id}/files/bundle`, undefined, token)
  ).body;
  assert.deepEqual(
    bundle.files.map((file) => file.relativePath),
    ["figures/plot.png", "main.tex", "sections/intro.tex"],
  );
  assert.equal(bundle.files[0].base64, png.toString("base64"));

  // Approval: newcomers wait, the owner lets them in as viewers.
  await call(
    owner,
    "PUT",
    `/api/shares/${token}/approval`,
    { requireApproval: true },
    token,
  );
  const knocking = await call(stranger, "POST", `/api/shares/${token}/open`, {}, token);
  assert.equal(knocking.body.code, "approval-pending");
  const permissions = (
    await call(owner, "GET", `/api/shares/${token}/permissions`, undefined, token)
  ).body;
  assert.equal(permissions.pending[0].name, "Eve");
  await call(
    owner,
    "POST",
    `/api/shares/${token}/pending/${stranger.client}`,
    { action: "approve", role: "viewer" },
    token,
  );
  assert.equal(
    (await call(stranger, "POST", `/api/shares/${token}/open`, {}, token)).body
      .collaboration.currentUserRole,
    "viewer",
  );
  assert.equal(
    (
      await call(
        stranger,
        "PUT",
        `/api/projects/${id}/files/content?path=main.tex`,
        { content: "x" },
        token,
      )
    ).status,
    403,
  );

  // Removing someone cuts them off and retires the invite.
  const removed = await call(
    owner,
    "DELETE",
    `/api/shares/${token}/collaborators/${guest.client}`,
    undefined,
    token,
  );
  assert.equal(removed.status, 204);
  await until(
    () => b.socket.readyState === WebSocket.CLOSED,
    "removed editor disconnected",
  );
  assert.equal(
    (await call(guest, "GET", `/api/projects/${id}/files`, undefined, token)).body.code,
    "access-removed",
  );
  const newToken = (await call(owner, "GET", `/api/projects/${id}/share`)).body.token;
  assert.notEqual(newToken, token);

  // Stopping sharing closes everyone else's access; the owner keeps the project.
  await call(owner, "DELETE", `/api/projects/${id}/share`);
  assert.equal(
    (await call(stranger, "GET", `/api/projects/${id}/files`, undefined, newToken)).body
      .code,
    "sharing-stopped",
  );
  assert.equal(
    (await call(owner, "GET", `/api/projects/${id}/files/content?path=main.tex`)).body
      .content,
    ">> Hello, world",
  );
  a.close();
});

test("rejects unsafe paths and oversized files", async () => {
  const owner = person("Omar");
  const id = (await call(owner, "POST", "/api/projects", { folderName: "Limits" })).body
    .id;
  for (const path of ["../x", "/etc/passwd", "a/../../b", ".git/config", "C:/x"]) {
    const response = await call(
      owner,
      "PUT",
      `/api/projects/${id}/files/content?path=${encodeURIComponent(path)}`,
      { content: "x" },
    );
    assert.equal(response.status, 400, path);
  }
  assert.equal((await call(owner, "GET", "/api/shares/not-a-token/open")).status, 404);
  assert.equal(
    (await call(owner, "GET", "/api/projects/project_nope/files")).status,
    404,
  );
});
