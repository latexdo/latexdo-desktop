import { afterEach, expect, it, vi } from "vitest";
import { ensureMetadataIgnore } from "./metadataIgnore";
afterEach(() => vi.unstubAllGlobals());
it("creates a local metadata ignore file without changing the project .gitignore (#250)", async () => {
  const writeFile = vi.fn();
  vi.stubGlobal("latexdo", { fileExists: vi.fn().mockResolvedValue(false), writeFile });
  await ensureMetadataIgnore("project");
  expect(writeFile).toHaveBeenCalledWith(
    "project",
    ".latexdo/.gitignore",
    expect.stringContaining("\n*\n"),
  );
});
it("preserves existing user ignore rules", async () => {
  const writeFile = vi.fn();
  vi.stubGlobal("latexdo", { fileExists: vi.fn().mockResolvedValue(true), writeFile });
  await ensureMetadataIgnore("project");
  expect(writeFile).not.toHaveBeenCalled();
});
