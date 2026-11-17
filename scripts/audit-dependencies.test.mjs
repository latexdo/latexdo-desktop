// @vitest-environment node
import { describe, expect, it } from "vitest";
import { evaluateAudit } from "./audit-dependencies.mjs";

const exception = {
  advisory: "GHSA-fc5q-39xc-vjpf",
  package: "picomatch",
  reason: "dev-only",
  expires: "2026-12-17",
};

function advisory(name, severity, ghsa) {
  return {
    name,
    title: `${name} issue`,
    severity,
    url: `https://github.com/advisories/${ghsa}`,
  };
}

function report(entries) {
  return { vulnerabilities: entries };
}

const picomatchReport = report({
  picomatch: {
    name: "picomatch",
    via: [advisory("picomatch", "high", "GHSA-fc5q-39xc-vjpf")],
  },
  vitest: { name: "vitest", via: ["picomatch"] },
});
const clean = report({});

describe("evaluateAudit", () => {
  it("allows a listed dev-only advisory before it expires", () => {
    const result = evaluateAudit({
      full: picomatchReport,
      production: clean,
      exceptions: [exception],
      today: "2026-11-17",
    });
    expect(result.failures).toEqual([]);
    expect(result.allowed).toHaveLength(1);
  });

  it("blocks the advisory once its exception expires", () => {
    const result = evaluateAudit({
      full: picomatchReport,
      production: clean,
      exceptions: [exception],
      today: "2026-12-18",
    });
    expect(result.failures).toEqual([expect.stringContaining("expired on 2026-12-17")]);
  });

  it("blocks a listed advisory when the package ships inside the app", () => {
    const result = evaluateAudit({
      full: picomatchReport,
      production: picomatchReport,
      exceptions: [exception],
      today: "2026-11-17",
    });
    expect(result.failures).toEqual([expect.stringContaining("ships inside the app")]);
  });

  it("blocks any other high or critical advisory", () => {
    const result = evaluateAudit({
      full: report({
        tar: { name: "tar", via: [advisory("tar", "critical", "GHSA-aaaa-bbbb-cccc")] },
      }),
      production: clean,
      exceptions: [],
      today: "2026-11-17",
    });
    expect(result.failures).toEqual([
      expect.stringContaining("tar: tar issue (critical)"),
    ]);
  });

  it("ignores moderate and low advisories, like --audit-level=high", () => {
    const result = evaluateAudit({
      full: report({
        a: { name: "a", via: [advisory("a", "moderate", "GHSA-aaaa-bbbb-cccc")] },
      }),
      production: clean,
      exceptions: [],
      today: "2026-11-17",
    });
    expect(result.failures).toEqual([]);
  });

  it("asks for an exception to be removed once npm stops reporting it", () => {
    const result = evaluateAudit({
      full: clean,
      production: clean,
      exceptions: [exception],
      today: "2026-11-17",
    });
    expect(result.failures).toEqual([expect.stringContaining("remove its exception")]);
  });

  it("fails when npm audit could not produce a report", () => {
    expect(() =>
      evaluateAudit({
        full: { error: { summary: "network down" } },
        production: clean,
      }),
    ).toThrow("network down");
  });
});
