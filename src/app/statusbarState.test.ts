import { describe, expect, it } from "vitest";
import type { CompileResult } from "../types";
import { statusbarStateFor } from "./statusbarState";

const compiled = (ok: boolean, severity?: "error" | "warning"): CompileResult => ({
  ok,
  durationMs: 1,
  output: "",
  diagnostics: severity
    ? [{ severity, message: "x", file: "main.tex", line: 1 } as never]
    : [],
});

describe("statusbarStateFor", () => {
  const base = {
    compileResult: null,
    sharing: false,
    liveConnection: "idle" as const,
    online: true,
  };

  it("stays neutral for a local project that compiles", () => {
    expect(
      statusbarStateFor({ ...base, compileResult: compiled(true, "warning") }),
    ).toBe("idle");
  });

  it("shows compile errors first, even offline", () => {
    expect(statusbarStateFor({ ...base, compileResult: compiled(false) })).toBe(
      "compile-error",
    );
    expect(
      statusbarStateFor({
        ...base,
        online: false,
        compileResult: compiled(true, "error"),
      }),
    ).toBe("compile-error");
  });

  it("follows the live sharing connection", () => {
    expect(
      statusbarStateFor({ ...base, sharing: true, liveConnection: "connected" }),
    ).toBe("online");
    expect(statusbarStateFor({ ...base, sharing: true, liveConnection: "error" })).toBe(
      "offline",
    );
    expect(
      statusbarStateFor({ ...base, sharing: true, liveConnection: "connecting" }),
    ).toBe("idle");
  });

  it("shows offline when the computer has no network", () => {
    expect(statusbarStateFor({ ...base, online: false })).toBe("offline");
  });
});
