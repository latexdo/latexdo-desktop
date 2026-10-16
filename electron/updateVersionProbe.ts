import { writeFileSync } from "node:fs";
import { versionsEquivalent } from "./versions.js";

// Runs before profile access, the single-instance lock, or any windows. Helpers
// require a receipt as well as exit 0: an older build may ignore these arguments.
export function runUpdateVersionProbe(
  argv: string[],
  packaged: boolean,
  runningVersion: string,
): number | null {
  const index = argv.indexOf("--latexdo-verify-update");
  if (index === -1) return null;
  const expected = argv[index + 1];
  const receipt = argv[index + 2];
  if (
    !packaged ||
    !expected ||
    !receipt ||
    !versionsEquivalent(runningVersion, expected)
  ) {
    return 1;
  }
  try {
    writeFileSync(receipt, expected, { flag: "wx", mode: 0o600 });
    return 0;
  } catch {
    return 1;
  }
}
