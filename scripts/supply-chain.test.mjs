// @vitest-environment node
import { it, expect, vi } from "vitest";
it("verifies the repository's release trust key, installer hash and publication controls", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await import("./verify-supply-chain.mjs");
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Verified single-workflow CI, CLI hash"),
    );
  } finally {
    log.mockRestore();
  }
});
