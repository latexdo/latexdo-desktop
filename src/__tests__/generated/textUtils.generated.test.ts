import { describe, expect, it } from "vitest";
import { generateTabularCode } from "../../tableGenerator";
import { escapeHtml } from "../../features/editor/html";
import { fileNameForDisplay, pathForDisplay } from "../../pathDisplay";

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

// ---- Tabular generation: structure is fixed by construction ----

const tableCases: Array<{ name: string; rows: number; cols: number }> = [];
for (let rows = 1; rows <= 10; rows += 1) {
  for (let cols = 1; cols <= 10; cols += 1) {
    tableCases.push({ name: `${rows}x${cols}`, rows, cols });
  }
}

describe("generated tabular structure", () => {
  it.each(tableCases)("$name grid", ({ rows, cols }) => {
    const cells = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => `c${row}-${col}`),
    );
    const code = generateTabularCode({ rows, cols, cells, alignment: "" });

    expect(code.startsWith("\\begin{tabular}{|")).toBe(true);
    expect(code.endsWith("\\end{tabular}")).toBe(true);
    // Each data row contains cols-1 separators; nothing else emits &.
    expect(code.split("&").length - 1).toBe(rows * (cols - 1));
    // One \\ per row.
    expect(code.split("\\\\").length - 1).toBe(rows);
    // hline above every row plus the closing one.
    expect(code.split("\\hline").length - 1).toBe(rows + 1);
    // Every cell value appears.
    for (const row of cells) {
      for (const cell of row) {
        expect(code).toContain(cell);
      }
    }
  });

  it.each(tableCases.filter(({ cols }) => cols <= 6))(
    "$name honors a custom alignment",
    ({ rows, cols }) => {
      const alignment = Array.from({ length: cols }, () => "r").join("|");
      const code = generateTabularCode({ rows, cols, cells: [], alignment });
      expect(code).toContain(`\\begin{tabular}{|${alignment}|}`);
    },
  );
});

// ---- HTML escaping: expected output from an independent character map ----

const htmlAlphabet = ["a", "b", "<", ">", "&", '"', "'", " ", "z"];
const htmlEntityMap: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const htmlCases: Array<{ name: string; input: string; expected: string }> = [];
for (let seed = 1; seed <= 300; seed += 1) {
  const random = mulberry32(seed * 22801763489);
  const length = Math.floor(random() * 24);
  let input = "";
  let expected = "";
  for (let index = 0; index < length; index += 1) {
    const character = htmlAlphabet[Math.floor(random() * htmlAlphabet.length)];
    input += character;
    expected += htmlEntityMap[character] ?? character;
  }
  htmlCases.push({ name: `seed ${seed}: ${JSON.stringify(input)}`, input, expected });
}

describe("generated HTML escaping", () => {
  it.each(htmlCases)("$name", ({ input, expected }) => {
    const escaped = escapeHtml(input);
    expect(escaped).toBe(expected);
    expect(escaped).not.toMatch(/[<>]/);
  });
});

// ---- Path display decoding: inputs built by URI-encoding known names ----

const displayNames = [
  "My Thesis",
  "chapter one",
  "notes & ideas",
  "résumé",
  "100% done",
  "plain",
];

const pathCases: Array<{ name: string; encodedPath: string; expected: string }> = [];
for (let seed = 1; seed <= 300; seed += 1) {
  const random = mulberry32(seed * 32452843);
  const depth = 1 + Math.floor(random() * 3);
  const segments: string[] = [];
  for (let index = 0; index < depth; index += 1) {
    segments.push(displayNames[Math.floor(random() * displayNames.length)]);
  }
  const encodedPath = segments.map((s) => encodeURIComponent(s)).join("/");
  const expected = segments.join("/");
  pathCases.push({ name: `seed ${seed}: ${encodedPath}`, encodedPath, expected });
}

describe("generated path display decoding", () => {
  it.each(pathCases)("$name", ({ encodedPath, expected }) => {
    expect(pathForDisplay(encodedPath)).toBe(expected);
    expect(fileNameForDisplay(encodedPath)).toBe(expected.split("/").pop());
  });
});
