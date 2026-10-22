#!/usr/bin/env node
/*
 * Runs the sharing flow end to end against the real always-on server code:
 * starts the Cloudflare worker locally (wrangler dev), then
 *
 * 1. a desktop owner shares, a browser guest opens the web link and edits
 *    live with them, and with approval on the owner is told the moment
 *    someone is waiting (web/guest/src/guest.integration.test.ts);
 * 2. the server's own checks: storage, roles, approval push and limits
 *    (collaborations/cloudflare/test/e2e.test.mjs).
 *
 * The guest test runs first: the server's checks end by tripping its limit
 * on new projects, which would refuse the guest test's project.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { createInterface } from "node:readline";
import { stripVTControlCharacters } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cloudflare = path.join(root, "collaborations", "cloudflare");
const port = process.env.LATEXDO_E2E_PORT ?? "8790";
const origin = `http://localhost:${port}`;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)),
    );
  });
}

async function waitForServer(server) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("The local server stopped early.");
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The local server did not answer at ${origin} within two minutes.`);
}

await run(npm, ["run", "build:guest"], { cwd: root });
const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "latexdo-collab-e2e-"));
const server = spawn(
  npx,
  ["wrangler", "dev", "--local", "--port", port, "--persist-to", stateDirectory],
  {
    cwd: cloudflare,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  },
);
// HTTP assertions can pass while workerd reports an unhandled exception.
// Inspect complete lines so chunk boundaries cannot conceal runtime failures.
let runtimeFailed = false;
for (const [stream, output] of [
  [server.stdout, process.stdout],
  [server.stderr, process.stderr],
]) {
  const lines = createInterface({ input: stream });
  lines.on("line", (line) => {
    output.write(`${line}\n`);
    if (
      /\buncaught\b|\bunhandled\s+(?:exception|rejection)\b/i.test(
        stripVTControlCharacters(line),
      )
    )
      runtimeFailed = true;
  });
}
const serverClosed = new Promise((resolve) => server.on("close", resolve));
const stop = () => {
  if (server.exitCode !== null) return;
  try {
    // wrangler starts its own children; end the whole group.
    if (process.platform === "win32") server.kill();
    else process.kill(-server.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
};
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));

try {
  await waitForServer(server);
  await run(npx, ["vitest", "run", "web/guest/src/guest.integration.test.ts"], {
    cwd: root,
    env: { ...process.env, LATEXDO_E2E_CLOUD: "1", LATEXDO_COLLAB_URL: origin },
  });
  await run(npm, ["test"], {
    cwd: cloudflare,
    env: { ...process.env, COLLAB_URL: origin },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  stop();
  await serverClosed;
  await rm(stateDirectory, { recursive: true, force: true });
  if (runtimeFailed) {
    console.error(
      "Collaboration E2E failed: the Workers runtime reported an uncaught error.",
    );
    process.exitCode = 1;
  }
}
