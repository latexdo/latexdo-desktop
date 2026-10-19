import { describe, expect, it } from "vitest";
import { parseTexLabels } from "./parseTexLabels";

describe("parseTexLabels (latexdo package)", () => {
  it("infers the kind from the label prefix outside any environment", () => {
    const content = [
      "\\label{fig:a}",
      "\\label{tab:b}",
      "\\label{eq:c}",
      "\\label{sec:d}",
      "\\label{subsec:e}",
      "\\label{thm:f}",
      "\\label{misc}",
    ].join("\n");
    expect(parseTexLabels(content, "main.tex").map((l) => l.kind)).toEqual([
      "figure",
      "table",
      "equation",
      "section",
      "subsection",
      "theorem",
      "unknown",
    ]);
  });

  it("prefers the surrounding environment over the label prefix", () => {
    const envs = ["figure", "table", "equation", "align", "theorem"];
    const expected = ["figure", "table", "equation", "equation", "theorem"];
    envs.forEach((env, i) => {
      const [label] = parseTexLabels(
        `\\begin{${env}}\n\\label{sec:x}\n\\end{${env}}`,
        "a.tex",
      );
      expect(label.kind).toBe(expected[i]);
      expect(label.line).toBe(2);
      expect(label.sourceFile).toBe("a.tex");
    });
  });

  it("finds captions before, then after the label, and section titles", () => {
    const before = parseTexLabels(
      "\\section*{Intro}\n\\caption[short]{ Above }\n\\label{fig:a}",
      "a.tex",
    )[0];
    expect(before.caption).toBe("Above");
    expect(before.title).toBe("Intro");

    const after = parseTexLabels("\\label{fig:a}\nx\n\\caption{ Below }", "a.tex")[0];
    expect(after.caption).toBe("Below");
    expect(after.title).toBeUndefined();

    const none = parseTexLabels("\\label{fig:a}\r\nplain", "a.tex")[0];
    expect(none.caption).toBeUndefined();
  });

  it("returns every label on a line", () => {
    const labels = parseTexLabels("\\label{a}\\label{b}", "a.tex");
    expect(labels.map((l) => l.key)).toEqual(["a", "b"]);
  });
});
