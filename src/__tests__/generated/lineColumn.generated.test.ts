import { describe, expect, it } from "vitest";
import { lineColumnAtOffset } from "../../features/project/projectUtils";

/** Deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ProbeCase {
  name: string;
  content: string;
  offset: number;
  line: number;
  column: number;
}

/**
 * Documents are assembled line by line, so the expected line/column of every
 * probed offset is known by construction.
 */
const cases: ProbeCase[] = [];
const alphabet = "abcdefghijklmnopqrstuvwxyz {}\\$_^%";

for (let seed = 1; seed <= 100; seed += 1) {
  const random = mulberry32(seed * 7919);
  const lineCount = 1 + Math.floor(random() * 30);
  const lines: string[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    const length = Math.floor(random() * 40);
    let line = "";
    for (let cursor = 0; cursor < length; cursor += 1) {
      line += alphabet[Math.floor(random() * alphabet.length)];
    }
    lines.push(line);
  }
  const content = lines.join("\n");

  for (let probe = 0; probe < 8; probe += 1) {
    const targetLine = 1 + Math.floor(random() * lineCount);
    const targetColumn = 1 + Math.floor(random() * (lines[targetLine - 1].length + 1));
    let offset = 0;
    for (let index = 0; index < targetLine - 1; index += 1) {
      offset += lines[index].length + 1;
    }
    offset += targetColumn - 1;
    cases.push({
      name: `seed ${seed} probe ${probe} -> ${targetLine}:${targetColumn}`,
      content,
      offset,
      line: targetLine,
      column: targetColumn,
    });
  }
}

describe("generated lineColumnAtOffset probes", () => {
  it.each(cases)("$name", ({ content, offset, line, column }) => {
    expect(lineColumnAtOffset(content, offset)).toEqual({ line, column });
  });

  it("clamps offsets beyond the content", () => {
    const content = "ab\ncd";
    expect(lineColumnAtOffset(content, 999)).toEqual({ line: 2, column: 3 });
    expect(lineColumnAtOffset(content, -5)).toEqual({ line: 1, column: 1 });
  });
});
