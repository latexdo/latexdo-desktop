// End-to-end checks against a running server (wrangler dev locally, or the
// deployed one): COLLAB_URL=https://collab.latexdo.org npm test
// The server only stores and relays ciphertext, so these tests send opaque
// bytes; the app's encryption is tested in electron/cloudE2ee.test.ts.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

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

/** A minimal live connection speaking the encrypted-relay protocol. */
async function connect(who, projectId, path, token) {
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
  const updates = [];
  const cursors = [];
  const frames = [];
  let log;
  const ready = new Promise((resolve) => {
    socket.addEventListener("message", (event) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data));
      const type = decoding.readVarUint(decoder);
      if (type === 11) {
        const seq = decoding.readVarUint(decoder);
        const count = decoding.readVarUint(decoder);
        const entries = [];
        for (let index = 0; index < count; index += 1) {
          entries.push(Buffer.from(decoding.readVarUint8Array(decoder)));
        }
        log = { seq, entries, role: decoding.readVarString(decoder) };
        resolve();
      } else if (type === 10) {
        decoding.readVarUint(decoder);
        updates.push(Buffer.from(decoding.readVarUint8Array(decoder)));
      } else if (type === 12) {
        cursors.push(Buffer.from(decoding.readVarUint8Array(decoder)));
      } else {
        frames.push({ type, data: decoding.readVarString(decoder) });
      }
    });
  });
  await ready;
  const sendTyped = (type, bytes) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, type);
    encoding.writeVarUint8Array(encoder, bytes);
    socket.send(encoding.toUint8Array(encoder));
  };
  return {
    socket,
    log,
    updates,
    cursors,
    frames,
    sendUpdate: (bytes) => sendTyped(10, bytes),
    sendCursor: (bytes) => sendTyped(12, bytes),
    close: () => socket.close(1000, "done"),
  };
}

async function until(check, label, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const sealed = (size = 48) => randomBytes(size);
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

test("an encrypted shared project works end to end", async () => {
  const owner = person("enc1:owner");
  const guest = person("enc1:guest");
  const stranger = person("enc1:stranger");

  const health = await fetch(new URL("/api/health", base)).then((r) => r.json());
  assert.equal(health.encryption, "end-to-end");

  const created = await call(owner, "POST", "/api/projects", {
    folderName: "enc1:name",
  });
  assert.equal(created.status, 200);
  const id = created.body.id;
  assert.equal(created.body.name, "enc1:name");

  // Plaintext file access is refused: everything is end-to-end encrypted.
  assert.equal(
    (await call(owner, "GET", `/api/projects/${id}/files/content?path=main.tex`)).body
      .code,
    "encrypted",
  );

  // The owner stores an encrypted text log and an encrypted figure.
  const first = sealed();
  assert.equal(
    (
      await call(owner, "POST", `/api/projects/${id}/files/log?path=main.tex`, {
        data: b64(first),
      })
    ).status,
    200,
  );
  const figure = sealed(200);
  assert.equal(
    (
      await call(owner, "PUT", `/api/projects/${id}/files/binary?path=fig/plot.png`, {
        base64: b64(figure),
      })
    ).status,
    204,
  );
  assert.deepEqual(
    Buffer.from(
      (await call(owner, "GET", `/api/projects/${id}/files/binary?path=fig/plot.png`))
        .body.base64,
      "base64",
    ),
    figure,
  );

  // Sharing; newcomers wait for approval by default.
  const token = (await call(owner, "POST", `/api/projects/${id}/share`, {})).body.token;
  assert.match(token, /^p[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/);
  assert.equal(
    (await call(guest, "POST", `/api/shares/${token}/open`, {}, token)).body.code,
    "approval-pending",
  );
  await call(
    owner,
    "POST",
    `/api/shares/${token}/pending/${guest.client}`,
    { action: "approve" },
    token,
  );
  const opened = await call(guest, "POST", `/api/shares/${token}/open`, {}, token);
  assert.equal(opened.status, 200);
  assert.equal(opened.body.collaboration.encrypted, true);
  assert.equal((await call(stranger, "GET", `/api/projects/${id}/files`)).status, 403);

  // Live: both get the stored log, then each other's updates and cursors.
  const a = await connect(owner, id, "main.tex");
  const b = await connect(guest, id, "main.tex", token);
  assert.deepEqual(a.log.entries, [first]);
  assert.equal(b.log.role, "editor");
  const fromA = sealed();
  const fromB = sealed();
  a.sendUpdate(fromA);
  b.sendUpdate(fromB);
  b.sendCursor(sealed(20));
  await until(
    () => a.updates.length === 1 && b.updates.length === 1,
    "relayed updates",
  );
  assert.deepEqual(a.updates[0], fromB);
  assert.deepEqual(b.updates[0], fromA);
  await until(() => a.cursors.length === 1, "relayed cursor");
  await until(
    () =>
      a.frames.some((frame) => frame.type === 4 && frame.data.includes("enc1:guest")),
    "presence",
  );

  // The log now holds all three updates, in order of arrival.
  const log = (
    await call(
      guest,
      "GET",
      `/api/projects/${id}/files/log?path=main.tex`,
      undefined,
      token,
    )
  ).body;
  assert.equal(log.entries.length, 3);
  assert.equal(log.entries[0], b64(first));

  // Compaction replaces the log with one snapshot.
  const snapshot = sealed(64);
  assert.equal(
    (
      await call(
        guest,
        "POST",
        `/api/projects/${id}/files/log?path=main.tex`,
        { data: b64(snapshot), replaceUpTo: log.seq },
        token,
      )
    ).status,
    200,
  );
  assert.deepEqual(
    (
      await call(
        guest,
        "GET",
        `/api/projects/${id}/files/log?path=main.tex`,
        undefined,
        token,
      )
    ).body.entries,
    [b64(snapshot)],
  );

  // A viewer may read but never write.
  await call(
    owner,
    "PUT",
    `/api/shares/${token}/permissions`,
    { clientId: guest.client, role: "viewer" },
    token,
  );
  await until(
    () => b.socket.readyState === WebSocket.CLOSED,
    "role change disconnects",
  );
  const viewer = await connect(guest, id, "main.tex", token);
  assert.equal(viewer.log.role, "viewer");
  viewer.sendUpdate(sealed());
  await until(
    () => viewer.socket.readyState === WebSocket.CLOSED,
    "viewer write rejected",
  );
  assert.equal(
    (
      await call(
        guest,
        "POST",
        `/api/projects/${id}/files/log?path=main.tex`,
        { data: b64(sealed()) },
        token,
      )
    ).status,
    403,
  );

  // Tree changes reach open editors; the bundle carries everything encrypted.
  await call(owner, "POST", `/api/projects/${id}/files/copy`, {
    fromRelativePath: "fig",
    toRelativePath: "old",
  });
  await until(() => a.frames.some((frame) => frame.type === 5), "tree change");
  await call(owner, "DELETE", `/api/projects/${id}/files?path=old`);
  const bundle = (await call(owner, "GET", `/api/projects/${id}/files/bundle`)).body;
  assert.deepEqual(
    bundle.files.map((file) => file.relativePath),
    ["fig/plot.png", "main.tex"],
  );
  assert.deepEqual(bundle.files[1].entries, [b64(snapshot)]);

  // Stopping sharing locks everyone else out.
  await call(owner, "DELETE", `/api/projects/${id}/share`);
  assert.equal(
    (await call(guest, "GET", `/api/projects/${id}/files`, undefined, token)).body.code,
    "sharing-stopped",
  );
  a.close();
});

test("refuses browsers, unsafe paths and floods", async () => {
  const owner = person("enc1:omar");
  const preflight = await fetch(new URL("/api/projects", base), { method: "OPTIONS" });
  assert.equal(preflight.status, 405);
  assert.equal(preflight.headers.get("access-control-allow-origin"), null);
  const id = (await call(owner, "POST", "/api/projects", { folderName: "enc1:x" })).body
    .id;
  for (const path of ["../x", "/etc/passwd", "a/../../b", ".git/config", "C:/x"]) {
    const response = await call(
      owner,
      "POST",
      `/api/projects/${id}/files/log?path=${encodeURIComponent(path)}`,
      { data: b64(sealed()) },
    );
    assert.equal(response.status, 400, path);
  }
  assert.equal((await call(owner, "GET", "/api/shares/not-a-token/open")).status, 404);
  // At most a handful of new projects per minute from one address.
  let refused = false;
  for (let index = 0; index < 8 && !refused; index += 1) {
    refused =
      (
        await call(person("enc1:spam"), "POST", "/api/projects", {
          folderName: "enc1:s",
        })
      ).status === 429;
  }
  assert.equal(refused, true);
});
