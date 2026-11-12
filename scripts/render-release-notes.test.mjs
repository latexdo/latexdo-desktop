import { expect, it } from "vitest";
import { buildChangeNotes, renderReleaseNotes } from "./render-release-notes.mjs";

it("publishes the reviewed features, fixes and migration notes as readable Markdown", () => {
  const markdown = renderReleaseNotes({
    title: "LatexDo 1.0",
    summary: "A clearer editor.",
    highlights: [{ title: "Reading themes", description: "Choose a PDF theme." }],
    fixes: ["Completion stays disabled when turned off."],
    breakingChanges: ["Restart after updating."],
    security: [{ title: "Verified updates", description: "Signed downloads." }],
  });
  expect(markdown).toContain("# LatexDo 1.0\n\nA clearer editor.");
  expect(markdown).toContain("- **Reading themes** — Choose a PDF theme.");
  expect(markdown).toContain("## Fixes\n\n- Completion stays disabled");
  expect(markdown).toContain("## Breaking changes\n\n- Restart after updating.");
  expect(markdown).toContain("## Security\n\n- **Verified updates**");
  expect(
    renderReleaseNotes({ title: "Release", highlights: [], fixes: [] }),
  ).not.toContain("##");
});

it("lists what a build brought, reading pull-request merges as their commits", () => {
  const notes = buildChangeNotes([
    {
      commit: "a".repeat(40),
      subject: "Merge pull request #7 from latexdo/x",
      merged: [
        "feat(discussion): react to messages (#7)",
        "docs: tidy",
        "fix: keep toolbar close",
      ],
    },
    { commit: "b".repeat(40), subject: "perf: faster tree" },
    { commit: "c".repeat(40), subject: "feat: react to messages" },
  ]);
  expect(notes).toEqual([
    { kind: "New", text: "React to messages" },
    { kind: "Fixed", text: "Keep toolbar close" },
    { kind: "Improved", text: "Faster tree" },
  ]);
  const markdown = renderReleaseNotes(
    { title: "LatexDo 1.0", summary: "S.", highlights: [] },
    notes,
  );
  expect(markdown).toContain("## In this build\n\n- **New** — React to messages");
  expect(
    buildChangeNotes([{ commit: "d".repeat(40), subject: "Merge branch 'x'" }]),
  ).toEqual([]);
});
