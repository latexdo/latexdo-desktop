import { describe, expect, it } from "vitest";
import { compareVersions, parseSubmission, redact, ReportError } from "./report";

function submission(
  overrides: Record<string, unknown> = {},
  error: Record<string, unknown> = {},
) {
  return {
    reporter: "11111111-2222-4333-8444-555555555555",
    report: {
      schemaVersion: 1,
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      fingerprint: "0123456789abcdef",
      category: "error",
      title: "TypeError: x is undefined",
      kind: "renderer-error",
      severity: "error",
      processType: "renderer",
      firstSeenAt: "2026-11-10T10:00:00.000Z",
      lastSeenAt: "2026-11-10T10:05:00.000Z",
      occurrences: 2,
      error: {
        name: "TypeError",
        message: "x is undefined",
        stack: "TypeError: x\n    at f (latexdo://app/assets/index.js:1:1)",
        ...error,
      },
      context: { source: "window.error", lineno: 1 },
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
    },
  };
}

function rejection(input: unknown): ReportError {
  try {
    parseSubmission(input);
  } catch (error) {
    if (error instanceof ReportError) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("parseSubmission", () => {
  it("accepts a well-formed report", () => {
    const { report, reporter } = parseSubmission(submission({ note: "  compiling  " }));
    expect(reporter).toBe("11111111-2222-4333-8444-555555555555");
    expect(report).toMatchObject({
      occurrences: 2,
      note: "compiling",
      context: { lineno: 1 },
    });
  });

  it.each([
    ["a bad id", { id: "x" }],
    ["a bad fingerprint", { fingerprint: "ZZ" }],
    ["an unknown kind", { kind: "renderer-freeze" }],
    ["a huge title", { title: "x".repeat(201) }],
    ["nested context", { context: { a: { b: 1 } } }],
    [
      "too many context keys",
      {
        context: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i])),
      },
    ],
    ["zero occurrences", { occurrences: 0 }],
    ["a bad date", { firstSeenAt: "yesterday" }],
  ])("rejects %s", (_label, overrides) => {
    expect(rejection(submission(overrides)).status).toBe(400);
  });

  it("rejects a missing reporter", () => {
    expect(rejection({ ...submission(), reporter: "me" }).status).toBe(400);
  });

  it("refuses network and system noise", () => {
    const error = rejection(submission({}, { message: "Failed to fetch" }));
    expect(error).toMatchObject({ status: 422, code: "ignored" });
  });

  it("strips personal data the app missed", () => {
    const { report } = parseSubmission(
      submission(
        { note: "mail me at a@b.org" },
        { message: "open /Users/jane/x failed" },
      ),
    );
    expect(report.note).toBe("mail me at <email>");
    expect(report.error.message).toBe("open ~/x failed");
  });
});

describe("helpers", () => {
  it("redacts tokens", () => {
    expect(redact("Bearer abcdefghijklmnop sk-abcdefghijklmnopqr")).toBe(
      "Bearer <token> <api-key>",
    );
  });

  it("compares versions numerically", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("v1.2.0", "1.2.0-beta.1")).toBe(0);
    expect(compareVersions("1.2", "1.2.1")).toBe(-1);
  });
});
