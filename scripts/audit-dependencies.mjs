// Fails CI on high or critical npm advisories, like `npm audit --audit-level=high`,
// except for advisories listed below. Each exception names one advisory, says why it
// cannot be fixed yet, and expires, so CI fails again once the date passes.
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

export const auditExceptions = [
  {
    id: "GHSA-fc5q-39xc-vjpf",
    packageName: "picomatch",
    until: "2026-12-17",
    reason:
      "Every picomatch release (<=4.0.7, the latest) is affected and no fix is published. " +
      "It is only used by build tools (vite, vitest, eslint, electron-builder) on our own " +
      "glob patterns; `npm audit --omit=dev` is clean. Update picomatch once a fix ships.",
  },
];

const failingSeverities = new Set(["high", "critical"]);

function advisoryId(advisory) {
  return advisory.url?.match(/GHSA-[a-z0-9-]+/i)?.[0] ?? String(advisory.source);
}

/** Splits an `npm audit --json` report into failures, excused advisories and notes. */
export function evaluateAudit(report, exceptions, today) {
  if (report.error) {
    return {
      failures: [`npm audit failed: ${JSON.stringify(report.error)}`],
      excused: [],
      notes: [],
    };
  }
  const advisories = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      // Strings only point at another vulnerable package; its advisory is listed there.
      if (typeof via === "object" && failingSeverities.has(via.severity)) {
        advisories.set(advisoryId(via), via);
      }
    }
  }
  const failures = [];
  const excused = [];
  const notes = [];
  for (const [id, advisory] of advisories) {
    const exception = exceptions.find(
      (candidate) => candidate.id === id && candidate.packageName === advisory.name,
    );
    const label = `${advisory.severity} ${id} in ${advisory.name} (${advisory.range}): ${advisory.title}`;
    if (!exception) failures.push(label);
    else if (today > exception.until)
      failures.push(`${label} — exception expired on ${exception.until}`);
    else
      excused.push(`${label} — excused until ${exception.until}: ${exception.reason}`);
  }
  for (const exception of exceptions) {
    if (!advisories.has(exception.id)) {
      notes.push(
        `${exception.id} (${exception.packageName}) no longer appears; remove its exception.`,
      );
    }
  }
  return { failures, excused, notes };
}

async function runAudit() {
  // npm audit exits non-zero whenever it finds anything, so read the report regardless.
  const stdout = await new Promise((resolve, reject) => {
    execFile(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["audit", "--json"],
      { maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" },
      (error, output) => (output ? resolve(output) : reject(error)),
    );
  });
  return JSON.parse(stdout);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const today = new Date().toISOString().slice(0, 10);
  const { failures, excused, notes } = evaluateAudit(
    await runAudit(),
    auditExceptions,
    today,
  );
  for (const line of excused) console.warn(`Excused: ${line}`);
  for (const line of notes) console.warn(`Note: ${line}`);
  if (failures.length > 0) {
    for (const line of failures) console.error(`Failing: ${line}`);
    process.exit(1);
  }
  console.log("No unexcused high or critical advisories.");
}
