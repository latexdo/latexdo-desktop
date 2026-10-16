import { describe, expect, it } from "vitest";
import { parseMathAtPosition } from "./mathPreview";

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

const mathBodies = ["x + y", "E = mc^2", "\\frac{a}{b}", "\\sum_{i=1}^n i", "\\alpha"];
const delimiters = [
  { open: "$", close: "$", display: false },
  { open: "$$", close: "$$", display: true },
  { open: "\\(", close: "\\)", display: false },
  { open: "\\[", close: "\\]", display: true },
  { open: "\\begin{equation}", close: "\\end{equation}", display: true },
  { open: "\\begin{align}", close: "\\end{align}", display: true },
];
const textChunks = ["Plain words here. ", "More prose text ", "Nothing special "];

interface Probe {
  name: string;
  text: string;
  line: number;
  column: number;
  expectedTex: string | null;
  expectedDisplay?: boolean;
}

function positionAt(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  const lastBreak = before.lastIndexOf("\n");
  return { line, column: offset - lastBreak };
}

/**
 * Documents are assembled from tracked text and math segments, so the
 * expected result of probing any offset is known by construction.
 */
const probes: Probe[] = [];

for (let seed = 1; seed <= 150; seed += 1) {
  const random = mulberry32(seed * 179426549);
  let text = "";
  const segments: Array<{ bodyOffset: number; body: string; display: boolean }> = [];
  const gaps: number[] = [];
  const segmentCount = 1 + Math.floor(random() * 3);

  for (let index = 0; index < segmentCount; index += 1) {
    const chunk = textChunks[Math.floor(random() * textChunks.length)];
    gaps.push(text.length + Math.floor(chunk.length / 2));
    text += chunk;

    const delimiter = delimiters[Math.floor(random() * delimiters.length)];
    const body = mathBodies[Math.floor(random() * mathBodies.length)];
    text += delimiter.open;
    segments.push({
      bodyOffset: text.length + Math.floor(body.length / 2),
      body,
      display: delimiter.display,
    });
    text += body + delimiter.close;
    if (random() > 0.5) {
      text += "\n";
    }
  }
  const tailChunk = textChunks[Math.floor(random() * textChunks.length)];
  gaps.push(text.length + Math.floor(tailChunk.length / 2));
  text += tailChunk;

  for (const segment of segments) {
    const { line, column } = positionAt(text, segment.bodyOffset);
    probes.push({
      name: `seed ${seed}: inside math at ${line}:${column}`,
      text,
      line,
      column,
      expectedTex: segment.body,
      expectedDisplay: segment.display,
    });
  }
  const gap = gaps[Math.floor(random() * gaps.length)];
  const { line, column } = positionAt(text, gap);
  probes.push({
    name: `seed ${seed}: outside math at ${line}:${column}`,
    text,
    line,
    column,
    expectedTex: null,
  });
}

describe("generated math position parsing", () => {
  it.each(probes)("$name", ({ text, line, column, expectedTex, expectedDisplay }) => {
    const found = parseMathAtPosition(text, line, column);
    if (expectedTex === null) {
      expect(found).toBeNull();
      return;
    }
    expect(found?.tex).toBe(expectedTex);
    expect(found?.display).toBe(expectedDisplay);
  });
});
