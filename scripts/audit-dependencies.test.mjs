import { describe, expect, it } from "vitest";
import { evaluateAudit } from "./audit-dependencies.mjs";

const advisory = (name, id, severity = "high") => ({
  name,
  severity,
  title: `${name} problem`,
  range: "*",
  url: `https://github.com/advisories/${id}`,
});
const report = (...advisories) => ({
  vulnerabilities: Object.fromEntries(
    advisories.map((entry) => [entry.name, { name: entry.name, via: [entry] }]),
  ),
});
const exception = {
  id: "GHSA-aaaa-bbbb-cccc",
  packageName: "picomatch",
  until: "2026-12-17",
  reason: "No fix released.",
};

describe("dependency audit exceptions", () => {
  it("excuses only the listed advisory and still fails on any other high one", () => {
    const result = evaluateAudit(
      {
        vulnerabilities: {
          ...report(advisory("picomatch", "GHSA-aaaa-bbbb-cccc")).vulnerabilities,
          vite: { name: "vite", via: ["picomatch"] },
          other: {
            name: "other",
            via: [advisory("other", "GHSA-zzzz-zzzz-zzzz", "critical")],
          },
        },
      },
      [exception],
      "2026-11-17",
    );
    expect(result.excused).toHaveLength(1);
    expect(result.failures).toEqual([expect.stringContaining("GHSA-zzzz-zzzz-zzzz")]);
  });

  it("fails again once the exception expires", () => {
    const result = evaluateAudit(
      report(advisory("picomatch", "GHSA-aaaa-bbbb-cccc")),
      [exception],
      "2026-12-18",
    );
    expect(result.failures).toEqual([expect.stringContaining("expired on 2026-12-17")]);
  });

  it("does not let an exception cover the same advisory in another package", () => {
    const result = evaluateAudit(
      report(advisory("not-picomatch", "GHSA-aaaa-bbbb-cccc")),
      [exception],
      "2026-11-17",
    );
    expect(result.failures).toHaveLength(1);
  });

  it("ignores moderate advisories, as --audit-level=high does", () => {
    const result = evaluateAudit(
      report(advisory("minor", "GHSA-mmmm-mmmm-mmmm", "moderate")),
      [],
      "2026-11-17",
    );
    expect(result.failures).toEqual([]);
  });

  it("asks for the exception to be removed once the advisory is gone", () => {
    const result = evaluateAudit({ vulnerabilities: {} }, [exception], "2026-11-17");
    expect(result.notes).toEqual([expect.stringContaining("remove its exception")]);
  });

  it("fails when npm audit itself could not run", () => {
    const result = evaluateAudit({ error: { code: "ENOTFOUND" } }, [], "2026-11-17");
    expect(result.failures).toEqual([expect.stringContaining("ENOTFOUND")]);
  });
});
