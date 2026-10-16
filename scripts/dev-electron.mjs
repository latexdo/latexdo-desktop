import { access } from "node:fs/promises";
import { watch } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const projectRoot = path.resolve(import.meta.dirname, "..");
const mainOutputPath = path.join(projectRoot, "dist-electron", "main.js");
const viteUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
const devUserDataPath =
  process.env.LATEXDO_DEV_USER_DATA ?? path.join(projectRoot, ".latexdo-dev-profile");

let electronProcess = null;
let restartTimer = null;
let stopping = false;
let watcherSettling = true;

async function waitForFile(filePath) {
  for (;;) {
    try {
      await access(filePath);
      return;
    } catch {
      await delay(250);
    }
  }
}

async function waitForServer(url) {
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until Vite is ready.
    }
    await delay(250);
  }
}

function startElectron() {
  electronProcess = spawn(electronBinary, ["."], {
    cwd: projectRoot,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: viteUrl,
      LATEXDO_DEV_CLEAR_RUNTIME_CACHE: "1",
      LATEXDO_DEV_USER_DATA: devUserDataPath,
    },
    stdio: "inherit",
  });

  electronProcess.on("exit", () => {
    electronProcess = null;
  });
}

function stopElectron() {
  if (!electronProcess) {
    return Promise.resolve();
  }

  const runningProcess = electronProcess;
  electronProcess = null;
  runningProcess.removeAllListeners("exit");
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    const fallback = setTimeout(settle, 1500);
    fallback.unref?.();
    runningProcess.once("exit", settle);
    runningProcess.once("error", settle);
    runningProcess.kill();
  });
}

async function restartElectron() {
  await stopElectron();
  if (!stopping) {
    startElectron();
  }
}

function scheduleRestart() {
  if (stopping || watcherSettling) {
    return;
  }

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    void restartElectron();
  }, 350);
}

async function main() {
  await Promise.all([waitForFile(mainOutputPath), waitForServer(viteUrl)]);
  startElectron();

  watch(path.join(projectRoot, "dist-electron"), { recursive: true }, () => {
    scheduleRestart();
  });
  setTimeout(() => {
    watcherSettling = false;
  }, 1000);
}

function shutdown(signal) {
  stopping = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  void stopElectron().finally(() => {
    process.exit(signal === "SIGINT" ? 130 : 0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

void main();
