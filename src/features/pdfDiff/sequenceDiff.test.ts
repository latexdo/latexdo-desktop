import { describe, expect, it } from "vitest";
import { diffSequences, type DiffOp } from "./sequenceDiff";

/** Applies an edit script to `a` to check it really produces `b`. */
function apply(a: string[], b: string[], ops: DiffOp[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    if (op.kind === "equal") {
      expect(a.slice(op.aStart, op.aEnd)).toEqual(b.slice(op.bStart, op.bEnd));
      out.push(...a.slice(op.aStart, op.aEnd));
    } else if (op.kind === "insert") {
      out.push(...b.slice(op.bStart, op.bEnd));
    }
  }
  return out;
}

function changedCount(ops: DiffOp[]): number {
  return ops
    .filter((op) => op.kind !== "equal")
    .reduce((sum, op) => sum + (op.aEnd - op.aStart) + (op.bEnd - op.bStart), 0);
}

const words = (text: string) => text.split(" ").filter(Boolean);

describe("diffSequences", () => {
  it("returns one equal run for identical input", () => {
    const a = words("the quick brown fox");
    expect(diffSequences(a, a)).toEqual([
      { kind: "equal", aStart: 0, aEnd: 4, bStart: 0, bEnd: 4 },
    ]);
  });

  it("handles empty sides", () => {
    expect(diffSequences([], [])).toEqual([]);
    expect(diffSequences([], ["a"])).toEqual([
      { kind: "insert", aStart: 0, aEnd: 0, bStart: 0, bEnd: 1 },
    ]);
    expect(diffSequences(["a"], [])).toEqual([
      { kind: "delete", aStart: 0, aEnd: 1, bStart: 0, bEnd: 0 },
    ]);
  });

  it("finds a minimal word-level edit", () => {
    const a = words("we propose a fast method for parsing");
    const b = words("we propose a robust and fast method for parsing PDFs");
    const ops = diffSequences(a, b);
    expect(apply(a, b, ops)).toEqual(b);
    expect(changedCount(ops)).toBe(3);
    expect(ops.filter((op) => op.kind === "insert")).toEqual([
      { kind: "insert", aStart: 3, aEnd: 3, bStart: 3, bEnd: 5 },
      { kind: "insert", aStart: 7, aEnd: 7, bStart: 9, bEnd: 10 },
    ]);
  });

  it("reports a replacement as a delete next to an insert", () => {
    const a = words("results are good");
    const b = words("results are excellent");
    const ops = diffSequences(a, b);
    expect(apply(a, b, ops)).toEqual(b);
    expect(ops.map((op) => op.kind)).toEqual(["equal", "delete", "insert"]);
  });

  it("produces valid scripts for random edits", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 50; round += 1) {
      const a = Array.from({ length: Math.floor(random() * 60) }, () =>
        String.fromCharCode(97 + Math.floor(random() * 6)),
      );
      const b = a
        .filter(() => random() > 0.2)
        .flatMap((value) => (random() > 0.85 ? [value, "z"] : [value]));
      expect(apply(a, b, diffSequences(a, b))).toEqual(b);
    }
  });

  it("falls back to unique anchors when the budget is exhausted", () => {
    const a = Array.from({ length: 400 }, (_, index) => `w${index}`);
    const b = [...a];
    for (let index = 0; index < 400; index += 7) b[index] = `changed${index}`;
    // A tiny budget forces the anchored path; the script must stay valid.
    const ops = diffSequences(a, b, 50);
    expect(apply(a, b, ops)).toEqual(b);
    expect(changedCount(ops)).toBe(2 * Math.ceil(400 / 7));
  });

  it("replaces everything when nothing anchors and the budget is exhausted", () => {
    const a = ["x", "y", "x", "y"];
    const b = ["y", "x", "y", "x"];
    const ops = diffSequences(a, b, 1);
    expect(apply(a, b, ops)).toEqual(b);
  });
});
