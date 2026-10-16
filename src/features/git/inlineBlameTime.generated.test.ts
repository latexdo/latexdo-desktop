import { describe, expect, it } from "vitest";
import { blameHeatLevel, formatBlameRelativeTime, heatLevelCount } from "./inlineBlame";

const now = new Date("2026-07-15T12:00:00.000Z");
const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

function agoIso(elapsedMs: number): string {
  return new Date(now.getTime() - elapsedMs).toISOString();
}

/**
 * Exact multiples of each unit sit safely inside their rounding bucket, so
 * the expected phrase is fixed by construction.
 */
const relativeCases: Array<{ elapsed: number; expected: string }> = [];

for (let seconds = 0; seconds <= 44; seconds += 2) {
  relativeCases.push({ elapsed: seconds * 1000, expected: "just now" });
}
for (let seconds = 46; seconds <= 89; seconds += 1) {
  relativeCases.push({ elapsed: seconds * 1000, expected: "a minute ago" });
}
for (let minutes = 2; minutes <= 44; minutes += 1) {
  relativeCases.push({ elapsed: minutes * minute, expected: `${minutes} minutes ago` });
}
for (let minutes = 46; minutes <= 89; minutes += 1) {
  relativeCases.push({ elapsed: minutes * minute, expected: "an hour ago" });
}
for (let hours = 2; hours <= 21; hours += 1) {
  relativeCases.push({ elapsed: hours * hour, expected: `${hours} hours ago` });
}
relativeCases.push({ elapsed: 22 * hour, expected: "yesterday" });
relativeCases.push({ elapsed: 26 * hour, expected: "yesterday" });
for (let days = 2; days <= 6; days += 1) {
  relativeCases.push({ elapsed: days * day, expected: `${days} days ago` });
}
relativeCases.push({ elapsed: 7 * day, expected: "a week ago" });
for (let weeks = 2; weeks <= 4; weeks += 1) {
  relativeCases.push({ elapsed: weeks * 7 * day, expected: `${weeks} weeks ago` });
}
for (let months = 2; months <= 11; months += 1) {
  relativeCases.push({ elapsed: months * 30 * day, expected: `${months} months ago` });
}
for (let years = 2; years <= 30; years += 1) {
  relativeCases.push({ elapsed: years * 365 * day, expected: `${years} years ago` });
}

describe("generated relative time phrases", () => {
  it.each(relativeCases)(
    "elapsed $elapsed ms -> $expected",
    ({ elapsed, expected }) => {
      expect(formatBlameRelativeTime(agoIso(elapsed), now)).toBe(expected);
    },
  );
});

/**
 * Heat brackets by construction: [1d, 7d, 14d, 30d, 90d, 180d, 365d, 2y, 4y].
 * Sample many ages strictly inside each bracket.
 */
const heatBrackets = [
  { from: 0, to: day, level: 0 },
  { from: day, to: 7 * day, level: 1 },
  { from: 7 * day, to: 14 * day, level: 2 },
  { from: 14 * day, to: 30 * day, level: 3 },
  { from: 30 * day, to: 90 * day, level: 4 },
  { from: 90 * day, to: 180 * day, level: 5 },
  { from: 180 * day, to: 365 * day, level: 6 },
  { from: 365 * day, to: 2 * 365 * day, level: 7 },
  { from: 2 * 365 * day, to: 4 * 365 * day, level: 8 },
  { from: 4 * 365 * day, to: 40 * 365 * day, level: 9 },
];

const heatCases: Array<{ age: number; level: number }> = [];
for (const bracket of heatBrackets) {
  const width = bracket.to - bracket.from;
  for (let step = 1; step <= 30; step += 1) {
    const age = bracket.from + Math.floor((width * step) / 31);
    heatCases.push({ age, level: bracket.level });
  }
}

describe("generated heatmap levels", () => {
  it.each(heatCases)("age $age ms -> level $level", ({ age, level }) => {
    expect(blameHeatLevel(agoIso(age), now)).toBe(level);
  });

  it("caps at the oldest level", () => {
    expect(heatBrackets.at(-1)?.level).toBe(heatLevelCount - 1);
  });
});
