import { expect, it } from "vitest";
import { renderReleaseNotes } from "./render-release-notes.mjs";

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
