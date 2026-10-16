import { describe, expect, it } from "vitest";
import { figurePreviewCandidatePaths } from "../../figurePreview";

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

const safeSegments = ["figures", "img", "assets", "chapter1", "deep-dir", "a_b"];
const safeNames = ["plot", "diagram-2", "result_v3", "IMG001"];
const extensions = ["png", "jpg", "jpeg", "svg", "pdf"];
const texLocations = ["main.tex", "sections/intro.tex", "deep/nested/ch.tex"];

interface SafeCase {
  name: string;
  rawPath: string;
  texRelativePath: string;
  baseName: string;
}

const safeCases: SafeCase[] = [];
for (let seed = 1; seed <= 400; seed += 1) {
  const random = mulberry32(seed * 104729);
  const depth = Math.floor(random() * 3);
  const segments: string[] = [];
  for (let index = 0; index < depth; index += 1) {
    segments.push(safeSegments[Math.floor(random() * safeSegments.length)]);
  }
  const base = safeNames[Math.floor(random() * safeNames.length)];
  const withExtension = random() > 0.3;
  const extension = extensions[Math.floor(random() * extensions.length)];
  const fileName = withExtension ? `${base}.${extension}` : base;
  let rawPath = [...segments, fileName].join("/");
  const variant = Math.floor(random() * 4);
  if (variant === 1) rawPath = `./${rawPath}`;
  if (variant === 2) rawPath = rawPath.replaceAll("/", "\\");
  if (variant === 3) rawPath = `"${rawPath}"`;
  const texRelativePath = texLocations[Math.floor(random() * texLocations.length)];
  safeCases.push({
    name: `seed ${seed}: ${rawPath} from ${texRelativePath}`,
    rawPath,
    texRelativePath,
    baseName: base,
  });
}

describe("generated safe figure paths", () => {
  it.each(safeCases)("$name", ({ rawPath, texRelativePath, baseName }) => {
    const candidates = figurePreviewCandidatePaths(rawPath, texRelativePath);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate).not.toMatch(/^\//);
      expect(candidate.split("/")).not.toContain("..");
      expect(candidate.split("/")).not.toContain(".");
      expect(candidate).toContain(baseName);
      expect(candidate).not.toContain("\\");
    }
  });
});

const unsafePrefixes = [
  (p: string) => `/${p}`,
  (p: string) => `C:/${p}`,
  (p: string) => `c:\\${p}`,
  (p: string) => `http://evil.example/${p}`,
  (p: string) => `https://evil.example/${p}`,
  (p: string) => `file:///${p}`,
  (p: string) => `../${p}`,
  (p: string) => `a/../../${p}`,
  (p: string) => `..\\${p}`,
  () => "",
];

interface UnsafeCase {
  name: string;
  rawPath: string;
  texRelativePath: string;
}

const unsafeCases: UnsafeCase[] = [];
for (let seed = 1; seed <= 40; seed += 1) {
  const random = mulberry32(seed * 15485863);
  const base = `${safeNames[Math.floor(random() * safeNames.length)]}.png`;
  for (const wrap of unsafePrefixes) {
    const rawPath = wrap(base);
    const texRelativePath = texLocations[Math.floor(random() * texLocations.length)];
    unsafeCases.push({
      name: `seed ${seed}: ${JSON.stringify(rawPath)}`,
      rawPath,
      texRelativePath,
    });
  }
}

describe("generated unsafe figure paths are rejected", () => {
  it.each(unsafeCases)("$name", ({ rawPath, texRelativePath }) => {
    expect(figurePreviewCandidatePaths(rawPath, texRelativePath)).toEqual([]);
  });
});
