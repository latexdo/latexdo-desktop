import { describe, expect, it } from "vitest";
import { compareVersionStrings } from "../../downloadManifest";

/**
 * Builds a version chain that is strictly ascending BY CONSTRUCTION:
 * numeric cores ascend, and within one core the pre-release ladder
 * alpha < alpha.1 < beta < beta.2 < rc.1 < rc.2 < release follows semver.
 * Expectations therefore never depend on the function under test.
 */
const prereleaseLadder = [
  "-alpha",
  "-alpha.1",
  "-beta",
  "-beta.2",
  "-rc.1",
  "-rc.2",
  "",
];

const chain: string[] = [];
for (let major = 0; major <= 5; major += 1) {
  for (let minor = 0; minor <= 5; minor += 1) {
    for (let patch = 0; patch <= 2; patch += 1) {
      for (const suffix of prereleaseLadder) {
        chain.push(`${major}.${minor}.${patch}${suffix}`);
      }
    }
  }
}

const orderedPairs: Array<{ lower: string; higher: string }> = [];
for (let index = 0; index + 1 < chain.length; index += 1) {
  orderedPairs.push({ lower: chain[index], higher: chain[index + 1] });
}
for (let index = 0; index + 13 < chain.length; index += 13) {
  orderedPairs.push({ lower: chain[index], higher: chain[index + 13] });
}
for (let index = 0; index + 101 < chain.length; index += 101) {
  orderedPairs.push({ lower: chain[index], higher: chain[index + 101] });
}

describe("generated version ordering (constructive chain)", () => {
  it.each(orderedPairs)("$lower < $higher", ({ lower, higher }) => {
    expect(compareVersionStrings(lower, higher)).toBeLessThan(0);
    expect(compareVersionStrings(higher, lower)).toBeGreaterThan(0);
  });
});

const selfEqualSamples = chain.filter((_, index) => index % 7 === 0);

describe("generated version self-equality", () => {
  it.each(selfEqualSamples.map((version) => ({ version })))(
    "$version equals itself",
    ({ version }) => {
      expect(compareVersionStrings(version, version)).toBe(0);
    },
  );
});

const equivalentForms: Array<{ left: string; right: string }> = [];
for (let major = 0; major <= 7; major += 1) {
  for (let minor = 0; minor <= 7; minor += 1) {
    const base = `${major}.${minor}.0`;
    equivalentForms.push({ left: base, right: `v${base}` });
    equivalentForms.push({ left: base, right: `V${base}` });
    equivalentForms.push({ left: base, right: `  ${base}  ` });
    equivalentForms.push({ left: `${major}.${minor}`, right: base });
  }
}

describe("generated version normalization equivalence", () => {
  it.each(equivalentForms)("$left == $right", ({ left, right }) => {
    expect(compareVersionStrings(left, right)).toBe(0);
    expect(compareVersionStrings(right, left)).toBe(0);
  });
});
