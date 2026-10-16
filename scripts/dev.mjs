import net from "node:net";
import { spawn } from "node:child_process";
import { clearDevRuntimeCache, devUserDataPath } from "./clear-dev-runtime-cache.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const preferredPort = 5173;
const host = "127.0.0.1";

const childProcesses = new Set();
let shuttingDown = false;
let startedVite = false;

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function canReach(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findFreePort(startPort) {
  let port = startPort;

  for (;;) {
    if (await isPortFree(port)) {
      return port;
    }
    port += 1;
  }
}

async function resolveViteTarget() {
  const preferredUrl = `http://${host}:${preferredPort}`;

  if (await canReach(preferredUrl)) {
    return {
      port: preferredPort,
      url: preferredUrl,
      reuseExistingServer: true,
    };
  }

  if (await isPortFree(preferredPort)) {
    return {
      port: preferredPort,
      url: preferredUrl,
      reuseExistingServer: false,
    };
  }

  const port = await findFreePort(preferredPort + 1);
  return {
    port,
    url: `http://${host}:${port}`,
    reuseExistingServer: false,
  };
}

function spawnManaged(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit",
  });
  childProcesses.add(child);

  child.on("exit", (code, signal) => {
    childProcesses.delete(child);
    if (shuttingDown) {
      return;
    }

    if (options.onExit) {
      options.onExit(code, signal);
      return;
    }

    shutdown(code ?? (signal ? 1 : 0));
  });

  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of childProcesses) {
    child.kill("SIGTERM");
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 100);
}

async function main() {
  await clearDevRuntimeCache();

  const viteTarget = await resolveViteTarget();
  const sharedEnv = {
    ...process.env,
    VITE_DEV_SERVER_URL: viteTarget.url,
    LATEXDO_DEV_USER_DATA: devUserDataPath,
  };

  console.log(
    viteTarget.reuseExistingServer
      ? `[dev] Reusing Vite dev server at ${viteTarget.url}`
      : `[dev] Starting Vite dev server at ${viteTarget.url}`,
  );

  if (!viteTarget.reuseExistingServer) {
    startedVite = true;
    spawnManaged(
      npmCommand,
      [
        "exec",
        "vite",
        "--",
        "--host",
        host,
        "--port",
        String(viteTarget.port),
        "--strictPort",
      ],
      {
        cwd: process.cwd(),
      },
    );
  }

  spawnManaged(
    npmCommand,
    ["exec", "tsc", "--", "-p", "tsconfig.electron.json", "--watch"],
    {
      cwd: process.cwd(),
    },
  );

  spawnManaged("node", ["scripts/dev-electron.mjs"], {
    cwd: process.cwd(),
    env: sharedEnv,
    onExit: (code) => {
      shutdown(code ?? 0);
    },
  });

  if (startedVite) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (await canReach(viteTarget.url)) {
        return;
      }
      await wait(250);
    }
  }
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(0));

void main();
