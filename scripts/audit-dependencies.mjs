// Fails on high or critical npm advisories, like `npm audit --audit-level=high`,
// except for the advisories listed below. An exception is accepted only while no
// patched release exists, only for packages that never ship inside the app, and
// only until it expires, so each one is reviewed again rather than forgotten.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const auditExceptions = [];

const blockingSeverities = new Set(["high", "critical"]);

function advisoryId(via) {
  return via.url?.match(/GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i)?.[0] ?? null;
}

/** The advisories themselves; npm also lists every package that depends on them. */
function blockingAdvisories(report) {
  const advisories = [];
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== "object" || !blockingSeverities.has(via.severity)) continue;
      advisories.push({
        id: advisoryId(via),
        package: via.name ?? vulnerability.name,
        severity: via.severity,
        title: via.title,
        url: via.url,
      });
    }
  }
  return advisories;
}

function assertReport(report, label) {
  if (!report || typeof report !== "object" || report.error) {
    const summary = report?.error?.summary ?? "no audit report";
    throw new Error(`npm audit (${label}) did not complete: ${summary}`);
  }
}

/**
 * @param {{ full: object, production: object, exceptions?: typeof auditExceptions, today?: string }} input
 * @returns {{ failures: string[], allowed: string[] }}
 */
export function evaluateAudit({
  full,
  production,
  exceptions = auditExceptions,
  today = new Date().toISOString().slice(0, 10),
}) {
  assertReport(full, "all dependencies");
  assertReport(production, "shipped dependencies");
  const failures = [];
  const allowed = [];
  const shippedPackages = new Set(Object.keys(production.vulnerabilities ?? {}));
  const reported = new Set();

  for (const advisory of blockingAdvisories(full)) {
    const label = `${advisory.package}: ${advisory.title} (${advisory.severity}) ${advisory.url}`;
    const exception = exceptions.find(
      (entry) => entry.advisory === advisory.id && entry.package === advisory.package,
    );
    if (exception) reported.add(exception);
    if (!exception) {
      failures.push(label);
    } else if (shippedPackages.has(advisory.package)) {
      failures.push(
        `${label} — now ships inside the app, so its exception no longer applies`,
      );
    } else if (today > exception.expires) {
      failures.push(
        `${label} — its exception expired on ${exception.expires}; review it again`,
      );
    } else {
      allowed.push(
        `${label} — allowed until ${exception.expires}: ${exception.reason}`,
      );
    }
  }

  // Shipped dependencies get no exceptions at all.
  for (const advisory of blockingAdvisories(production)) {
    const label = `${advisory.package}: ${advisory.title} (${advisory.severity}) ${advisory.url}`;
    if (!failures.some((failure) => failure.startsWith(label))) {
      failures.push(`${label} — ships inside the app`);
    }
  }

  for (const exception of exceptions) {
    if (!reported.has(exception)) {
      failures.push(
        `${exception.package} ${exception.advisory} is no longer reported; remove its exception from scripts/audit-dependencies.mjs`,
      );
    }
  }
  return { failures, allowed };
}

function runAudit(extraArgs) {
  const result = spawnSync("npm", ["audit", "--json", ...extraArgs], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit returned no JSON report:\n${result.stderr}`);
  }
}

function main() {
  const { failures, allowed } = evaluateAudit({
    full: runAudit([]),
    production: runAudit(["--omit=dev"]),
  });
  for (const line of allowed) console.log(`Allowed: ${line}`);
  if (failures.length > 0) {
    for (const line of failures) console.error(`Blocking: ${line}`);
    process.exit(1);
  }
  console.log("No blocking high or critical advisories.");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
