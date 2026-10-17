import { describe, expect, it } from "vitest";
import { collaboratorLook, remoteCursorCss } from "./collaboratorLook";

describe("collaborator look", () => {
  it("gives the same person the same emoji and color everywhere", () => {
    expect(collaboratorLook("client-ada")).toEqual(collaboratorLook("client-ada"));
    const looks = new Set(
      Array.from({ length: 40 }, (_, i) => collaboratorLook(`client-${i}`).emoji),
    );
    expect(looks.size).toBeGreaterThan(8);
  });

  it("labels each remote cursor with its emoji and name, safely quoted", () => {
    const css = remoteCursorCss([
      { clientID: 42, name: 'Ada "the" Lovelace', emoji: "🦊", color: "#2f6fdb" },
      { clientID: 7, name: "", emoji: "🐼", color: "red; background:url(x)" },
    ]);
    expect(css).toContain(
      '.yRemoteSelectionHead-42::after { content: "🦊 Ada \\"the\\" Lovelace"; background: #2f6fdb; }',
    );
    expect(css).toContain(".yRemoteSelection-42 { background-color: #2f6fdb38; }");
    // Unsafe colors fall back to a palette color, and a missing name to "Guest".
    expect(css).toContain('content: "🐼 Guest"; background: #2f6fdb;');
    expect(css).not.toContain("url(x)");
  });
});
