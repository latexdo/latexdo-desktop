/**
 * Sequence diff for PDF word lists: Myers' O(ND) algorithm with a work budget,
 * falling back to patience-style anchoring (words that occur once in both
 * sides) when the two versions differ too much for a direct diff.
 */

export type DiffOpKind = "equal" | "delete" | "insert";

export interface DiffOp {
  kind: DiffOpKind;
  /** Half-open range in the original sequence. */
  aStart: number;
  aEnd: number;
  /** Half-open range in the modified sequence. */
  bStart: number;
  bEnd: number;
}

/** Cells of Myers' edit graph a single direct diff may explore. */
const defaultBudget = 4_000_000;

function pushOp(ops: DiffOp[], op: DiffOp): void {
  if (op.aStart === op.aEnd && op.bStart === op.bEnd) return;
  const last = ops[ops.length - 1];
  if (
    last &&
    last.kind === op.kind &&
    last.aEnd === op.aStart &&
    last.bEnd === op.bStart
  ) {
    last.aEnd = op.aEnd;
    last.bEnd = op.bEnd;
    return;
  }
  ops.push({ ...op });
}

/**
 * Myers diff of a[aLo, aHi) against b[bLo, bHi). Returns null when the edit
 * distance would exceed what the budget allows.
 */
function myers(
  a: readonly string[],
  b: readonly string[],
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
  budget: number,
): DiffOp[] | null {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const max = n + m;
  if (max === 0) return [];
  // Time grows with D·(N+M) and the saved trace with D², so cap both.
  const maxD = Math.max(
    1,
    Math.min(max, Math.floor(budget / max), Math.floor(Math.sqrt(budget / 2))),
  );
  const offset = maxD + 1;
  const size = 2 * maxD + 3;
  const v = new Int32Array(size);
  const trace: Int32Array[] = [];
  let found = -1;

  for (let d = 0; d <= maxD; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found !== -1) {
      trace.push(v);
      break;
    }
  }
  if (found === -1) return null;

  // Walk the trace backwards to recover the edit script.
  const reversed: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const prev = trace[d];
    const k = x - y;
    const fromInsert =
      k === -d || (k !== d && prev[offset + k - 1] < prev[offset + k + 1]);
    const prevK = fromInsert ? k + 1 : k - 1;
    const prevX = prev[offset + prevK];
    const prevY = prevX - prevK;
    const startX = fromInsert ? prevX : prevX + 1;
    const startY = fromInsert ? prevY + 1 : prevY;
    if (x > startX) {
      reversed.push({
        kind: "equal",
        aStart: aLo + startX,
        aEnd: aLo + x,
        bStart: bLo + startY,
        bEnd: bLo + y,
      });
    }
    if (fromInsert) {
      reversed.push({
        kind: "insert",
        aStart: aLo + prevX,
        aEnd: aLo + prevX,
        bStart: bLo + prevY,
        bEnd: bLo + prevY + 1,
      });
    } else {
      reversed.push({
        kind: "delete",
        aStart: aLo + prevX,
        aEnd: aLo + prevX + 1,
        bStart: bLo + prevY,
        bEnd: bLo + prevY,
      });
    }
    x = prevX;
    y = prevY;
  }
  if (x > 0) {
    reversed.push({
      kind: "equal",
      aStart: aLo,
      aEnd: aLo + x,
      bStart: bLo,
      bEnd: bLo + y,
    });
  }

  const ops: DiffOp[] = [];
  for (let index = reversed.length - 1; index >= 0; index -= 1) {
    pushOp(ops, reversed[index]);
  }
  return ops;
}

/** Longest increasing subsequence of anchor positions in b (patience sort). */
function longestIncreasing(pairs: Array<[number, number]>): Array<[number, number]> {
  const tails: number[] = [];
  const previous = new Int32Array(pairs.length).fill(-1);
  for (let index = 0; index < pairs.length; index += 1) {
    const value = pairs[index][1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[index] = tails[lo - 1];
    tails[lo] = index;
  }
  const result: Array<[number, number]> = [];
  for (let index = tails.length ? tails[tails.length - 1] : -1; index !== -1; ) {
    result.push(pairs[index]);
    index = previous[index];
  }
  return result.reverse();
}

function uniqueAnchors(
  a: readonly string[],
  b: readonly string[],
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
): Array<[number, number]> {
  const counts = new Map<
    string,
    { a: number; b: number; aIndex: number; bIndex: number }
  >();
  for (let index = aLo; index < aHi; index += 1) {
    const entry = counts.get(a[index]) ?? { a: 0, b: 0, aIndex: -1, bIndex: -1 };
    entry.a += 1;
    entry.aIndex = index;
    counts.set(a[index], entry);
  }
  for (let index = bLo; index < bHi; index += 1) {
    const entry = counts.get(b[index]);
    if (!entry) continue;
    entry.b += 1;
    entry.bIndex = index;
  }
  const pairs: Array<[number, number]> = [];
  for (const entry of counts.values()) {
    if (entry.a === 1 && entry.b === 1) pairs.push([entry.aIndex, entry.bIndex]);
  }
  pairs.sort((left, right) => left[0] - right[0]);
  return longestIncreasing(pairs);
}

function diffRange(
  a: readonly string[],
  b: readonly string[],
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
  budget: number,
  ops: DiffOp[],
  depth: number,
): void {
  // Common prefix and suffix cost nothing and shrink the problem.
  let prefixEnd = 0;
  while (
    aLo + prefixEnd < aHi &&
    bLo + prefixEnd < bHi &&
    a[aLo + prefixEnd] === b[bLo + prefixEnd]
  ) {
    prefixEnd += 1;
  }
  pushOp(ops, {
    kind: "equal",
    aStart: aLo,
    aEnd: aLo + prefixEnd,
    bStart: bLo,
    bEnd: bLo + prefixEnd,
  });
  aLo += prefixEnd;
  bLo += prefixEnd;
  let suffix = 0;
  while (
    aHi - suffix > aLo &&
    bHi - suffix > bLo &&
    a[aHi - suffix - 1] === b[bHi - suffix - 1]
  ) {
    suffix += 1;
  }
  const aMid = aHi - suffix;
  const bMid = bHi - suffix;

  if (aLo === aMid || bLo === bMid) {
    pushOp(ops, { kind: "delete", aStart: aLo, aEnd: aMid, bStart: bLo, bEnd: bLo });
    pushOp(ops, { kind: "insert", aStart: aMid, aEnd: aMid, bStart: bLo, bEnd: bMid });
  } else {
    const direct = myers(a, b, aLo, aMid, bLo, bMid, budget);
    if (direct) {
      for (const op of direct) pushOp(ops, op);
    } else {
      const anchors = depth < 8 ? uniqueAnchors(a, b, aLo, aMid, bLo, bMid) : [];
      if (!anchors.length) {
        pushOp(ops, {
          kind: "delete",
          aStart: aLo,
          aEnd: aMid,
          bStart: bLo,
          bEnd: bLo,
        });
        pushOp(ops, {
          kind: "insert",
          aStart: aMid,
          aEnd: aMid,
          bStart: bLo,
          bEnd: bMid,
        });
      } else {
        let aCursor = aLo;
        let bCursor = bLo;
        for (const [aIndex, bIndex] of anchors) {
          diffRange(a, b, aCursor, aIndex, bCursor, bIndex, budget, ops, depth + 1);
          pushOp(ops, {
            kind: "equal",
            aStart: aIndex,
            aEnd: aIndex + 1,
            bStart: bIndex,
            bEnd: bIndex + 1,
          });
          aCursor = aIndex + 1;
          bCursor = bIndex + 1;
        }
        diffRange(a, b, aCursor, aMid, bCursor, bMid, budget, ops, depth + 1);
      }
    }
  }

  pushOp(ops, { kind: "equal", aStart: aMid, aEnd: aHi, bStart: bMid, bEnd: bHi });
}

/** The edit script turning `a` into `b`, as merged runs of equal/delete/insert. */
export function diffSequences(
  a: readonly string[],
  b: readonly string[],
  budget = defaultBudget,
): DiffOp[] {
  const ops: DiffOp[] = [];
  diffRange(a, b, 0, a.length, 0, b.length, budget, ops, 0);
  return ops;
}
