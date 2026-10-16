import { describe, expect, it } from "vitest";
import {
  mergeBibliographies,
  retargetBibliographyCommands,
} from "./mergeBibliographies";

const a = `% my old library
@string{nips = {NeurIPS}}
@article{lewis2020,
  title = {Retrieval-Augmented Generation {RAG}},
  journal = nips,
  year = {2020}
}
@inproceedings{vaswani2017,
  title = {Attention Is All You Need},
  year = {2017}
}`;

const b = `@article{lewis2020,
  title = {Retrieval-Augmented Generation {RAG}},
  journal = nips,
  year = {2020}
}
@article{vaswani2017,
  title = {Attention is all you need (preprint)},
  year = {2017}
}
@misc(he2016,
  title = {Deep Residual Learning}
)`;

describe("mergeBibliographies", () => {
  const merged = mergeBibliographies(
    [
      { path: "refs/a.bib", content: a },
      { path: "b.bib", content: b },
    ],
    new Date("2026-10-14T00:00:00Z"),
  );

  it("keeps every entry once, with @string definitions first", () => {
    expect(merged.entryCount).toBe(3);
    expect(merged.content.indexOf("@string{nips")).toBeLessThan(
      merged.content.indexOf("@article{lewis2020"),
    );
    expect(merged.content.match(/@article\{lewis2020/g)).toHaveLength(1);
    expect(merged.content).toContain("@misc(he2016");
    expect(merged.duplicates).toEqual(["lewis2020"]);
  });

  it("keeps the first of two different entries with one key and says so", () => {
    expect(merged.conflicts).toEqual([
      { key: "vaswani2017", keptFrom: "refs/a.bib", droppedFrom: ["b.bib"] },
    ]);
    expect(merged.content).toContain("Attention Is All You Need");
    expect(merged.content).not.toContain("(preprint)");
    expect(merged.content).toContain("% vaswani2017: kept the entry from refs/a.bib");
  });

  it("records where the entries came from", () => {
    expect(merged.content.startsWith("% Merged by LatexDo on 2026-10-14 from:")).toBe(
      true,
    );
  });
});

describe("retargetBibliographyCommands", () => {
  it("points \\bibliography at the merged file and keeps other bibliographies", () => {
    expect(
      retargetBibliographyCommands(
        "\\bibliography{refs/a,b.bib,external}",
        ["refs/a.bib", "b.bib"],
        "references.bib",
      ),
    ).toBe("\\bibliography{references,external}");
  });

  it("replaces several \\addbibresource lines with one", () => {
    const tex =
      "\\addbibresource{refs/a.bib}\n\\addbibresource[label=x]{b.bib}\n\\begin{document}";
    expect(
      retargetBibliographyCommands(tex, ["refs/a.bib", "b.bib"], "references.bib"),
    ).toBe("\\addbibresource{references.bib}\n\\begin{document}");
  });

  it("leaves files that do not use the merged bibliographies alone", () => {
    expect(
      retargetBibliographyCommands(
        "\\bibliography{other}",
        ["a.bib"],
        "references.bib",
      ),
    ).toBeNull();
  });
});
