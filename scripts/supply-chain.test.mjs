// @vitest-environment node
import { it, expect, vi } from "vitest";
it("verifies the repository's release publication controls", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await import("./verify-supply-chain.mjs");
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Verified single-workflow CI"),
    );
  } finally {
    log.mockRestore();
  }
});
