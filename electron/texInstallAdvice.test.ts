import { describe, expect, it } from "vitest";
import {
  asymptoteInstallAdvice,
  latexPackageInstallAdvice,
  latexToolchainInstallAdvice,
  synctexInstallAdvice,
  texPlatform,
} from "./texInstallAdvice.js";

const allAdvice = (platform: NodeJS.Platform) =>
  [
    latexToolchainInstallAdvice(platform),
    asymptoteInstallAdvice(platform),
    synctexInstallAdvice(platform),
    latexPackageInstallAdvice("siunitx", platform),
  ].join("\n");

describe("texInstallAdvice", () => {
  it("maps Node platforms to installer families", () => {
    expect(texPlatform("darwin")).toBe("macos");
    expect(texPlatform("win32")).toBe("windows");
    expect(texPlatform("linux")).toBe("linux");
  });

  it("only offers MacTeX on macOS", () => {
    const advice = allAdvice("darwin");
    expect(advice).toContain("MacTeX");
    expect(advice).not.toMatch(/MiKTeX/i);
    expect(latexPackageInstallAdvice("siunitx", "darwin")).toContain(
      "sudo tlmgr install siunitx",
    );
  });

  it("only offers MiKTeX on Windows", () => {
    const advice = allAdvice("win32");
    expect(advice).toContain("MiKTeX");
    expect(advice).not.toContain("MacTeX");
  });

  it("only offers TeX Live on Linux", () => {
    const advice = allAdvice("linux");
    expect(advice).toContain("TeX Live");
    expect(advice).not.toMatch(/MiKTeX|MacTeX/);
  });
});
