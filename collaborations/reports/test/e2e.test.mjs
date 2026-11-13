// End-to-end checks against a running report server (wrangler dev locally,
// or the deployed one): REPORTS_URL=http://localhost:8791 ADMIN_TOKEN=… npm test
// Without ADMIN_TOKEN the admin checks only confirm the API is closed.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";

const base = process.env.REPORTS_URL ?? "http://localhost:8791";
const adminToken = process.env.ADMIN_TOKEN;

async function call(method, path, body, headers = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function report(fingerprint, overrides = {}) {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    fingerprint,
    category: "crash",
    title: "TypeError: x is undefined",
    kind: "uncaught-exception",
    severity: "fatal",
    processType: "main",
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    occurrences: 1,
    error: {
      name: "TypeError",
      message: "x is undefined",
      stack: "TypeError: x\n    at f (<app>/dist-electron/main.js:1:1)",
    },
    context: {},
    environment: {
      appVersion: "1.0.0",
      platform: "darwin",
      arch: "arm64",
      osVersion: "25.0.0",
      electron: "38.0.0",
      chrome: "140.0.0",
      node: "22.0.0",
    },
    ...overrides,
  };
}

test("health", async () => {
  const { status, body } = await call("GET", "/api/health");
  assert.equal(status, 200);
  assert.equal(body.product, "LatexDo crash reports");
});

test("groups reports of one problem and counts distinct reporters", async () => {
  const fingerprint = randomBytes(8).toString("hex");
  const alice = randomUUID();
  const bob = randomUUID();
  const first = report(fingerprint);

  const one = await call("POST", "/api/reports", { report: first, reporter: alice });
  assert.equal(one.status, 201);
  assert.deepEqual(
    {
      known: one.body.known,
      occurrences: one.body.occurrences,
      reporters: one.body.reporters,
    },
    { known: false, occurrences: 1, reporters: 1 },
  );

  const retry = await call("POST", "/api/reports", { report: first, reporter: alice });
  assert.equal(retry.body.occurrences, 1, "a retried report counts once");

  const two = await call("POST", "/api/reports", {
    report: report(fingerprint),
    reporter: bob,
  });
  assert.deepEqual(
    {
      known: two.body.known,
      occurrences: two.body.occurrences,
      reporters: two.body.reporters,
    },
    { known: true, occurrences: 2, reporters: 2 },
  );
});

test("refuses malformed reports and noise", async () => {
  const bad = await call("POST", "/api/reports", {
    report: { schemaVersion: 1 },
    reporter: randomUUID(),
  });
  assert.equal(bad.status, 400);
  const noise = await call("POST", "/api/reports", {
    report: report(randomBytes(8).toString("hex"), {
      error: { name: "TypeError", message: "Failed to fetch" },
    }),
    reporter: randomUUID(),
  });
  assert.equal(noise.status, 422);
  const wrongMethod = await call("GET", "/api/reports");
  assert.equal(wrongMethod.status, 405);
});

test("the admin API is closed without the token", async () => {
  const { status } = await call("GET", "/api/issues");
  assert.ok(status === 401 || status === 404);
});

test(
  "admins list, inspect and mark problems fixed",
  { skip: !adminToken },
  async () => {
    const auth = { authorization: `Bearer ${adminToken}` };
    const fingerprint = randomBytes(8).toString("hex");
    await call("POST", "/api/reports", {
      report: report(fingerprint),
      reporter: randomUUID(),
    });

    const list = await call(
      "GET",
      "/api/issues?status=open&limit=200",
      undefined,
      auth,
    );
    assert.ok(list.body.issues.some((issue) => issue.fingerprint === fingerprint));

    const detail = await call("GET", `/api/issues/${fingerprint}`, undefined, auth);
    assert.equal(detail.body.samples.length, 1);

    const fixed = await call(
      "PATCH",
      `/api/issues/${fingerprint}`,
      { status: "fixed", fixedIn: "1.1.0" },
      auth,
    );
    assert.equal(fixed.body.issue.status, "fixed");

    const old = await call("POST", "/api/reports", {
      report: report(fingerprint),
      reporter: randomUUID(),
    });
    assert.deepEqual(
      { status: old.body.status, fixedIn: old.body.fixedIn },
      { status: "fixed", fixedIn: "1.1.0" },
    );

    const regressed = await call("POST", "/api/reports", {
      report: report(fingerprint, {
        environment: { ...report(fingerprint).environment, appVersion: "1.1.0" },
      }),
      reporter: randomUUID(),
    });
    assert.equal(regressed.body.status, "regressed");
  },
);

test(
  "counts every report per day, version and platform for the dashboard",
  { skip: !adminToken },
  async () => {
    const auth = { authorization: `Bearer ${adminToken}` };
    const before = await call("GET", "/api/stats?days=7", undefined, auth);
    assert.equal(before.status, 200);
    assert.equal(before.body.daily.length, 7);
    const fingerprint = randomBytes(8).toString("hex");
    // Earlier tests may have used up this minute's rate limit: count what landed.
    let accepted = 0;
    for (let index = 0; index < 3; index += 1) {
      const sent = await call("POST", "/api/reports", {
        report: report(fingerprint, {
          environment: { ...report(fingerprint).environment, appVersion: "9.9.9" },
        }),
        reporter: randomUUID(),
      });
      if (sent.status === 201) accepted += 1;
      else assert.equal(sent.status, 429);
    }
    assert.ok(accepted > 0, "every report was rate limited");
    const after = await call("GET", "/api/stats?days=7", undefined, auth);
    const today = (body) => body.daily.at(-1).reports;
    assert.equal(today(after.body) - today(before.body), accepted);
    const version = (body) =>
      body.byVersion.find((row) => row.key === "9.9.9")?.reports ?? 0;
    assert.equal(version(after.body) - version(before.body), accepted);
    assert.ok(after.body.top.some((row) => row.fingerprint === fingerprint));
    assert.ok(after.body.issuesByStatus.open >= 1);
  },
);
