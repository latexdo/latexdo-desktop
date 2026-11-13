import { describe, expect, it } from "vitest";
import { deepLinkScheme, inviteFromArgv, inviteFromDeepLink } from "./deepLink.js";

describe("join links into the desktop app", () => {
  it("reads the invite from latexdo-app://join/<code>", () => {
    expect(deepLinkScheme).toBe("latexdo-app");
    expect(inviteFromDeepLink("latexdo-app://join/abc_DEF-123")).toBe(
      "latexdo-invite:abc_DEF-123",
    );
    // Other spellings systems and pages produce.
    expect(inviteFromDeepLink("latexdo-app:join/abc")).toBe("latexdo-invite:abc");
    expect(inviteFromDeepLink("latexdo-app://join#abc")).toBe("latexdo-invite:abc");
    expect(inviteFromDeepLink("latexdo-app://join?invite=abc")).toBe(
      "latexdo-invite:abc",
    );
    // A full desktop invite pasted after join/ works too.
    expect(inviteFromDeepLink("latexdo-app://join/latexdo-invite:abc")).toBe(
      "latexdo-invite:abc",
    );
    expect(inviteFromDeepLink(" latexdo-app://join/abc ")).toBe("latexdo-invite:abc");
  });

  it("refuses anything else", () => {
    for (const value of [
      "latexdo://join/abc",
      "https://collab.latexdo.org/join#abc",
      "latexdo-app://open/abc",
      "latexdo-app://join/",
      "latexdo-app://join/a b",
      "latexdo-app://join/abc%2F..%2F",
      "latexdo-app://join/abc/def",
      `latexdo-app://join/${"a".repeat(5000)}`,
      "not a url",
      42,
      null,
    ]) {
      expect(inviteFromDeepLink(value)).toBeNull();
    }
  });

  it("finds the link among command-line arguments", () => {
    expect(
      inviteFromArgv(["/Applications/LatexDo", "--flag", "latexdo-app://join/xyz"]),
    ).toBe("latexdo-invite:xyz");
    expect(inviteFromArgv(["LatexDo.exe", "C:\\paper.latexdo-space"])).toBeNull();
    expect(inviteFromArgv(["LatexDo.exe", "latexdo-app://evil/xyz"])).toBeNull();
  });
});
