// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parseBibliography,
  parseReference,
  renderBibFile,
  splitEntries,
} from "./bibliography.js";
import { glyph } from "./__tests__/fixtures.js";
import type { TextLine } from "./layout.js";
import { lineText } from "./layout.js";
import type { Glyph } from "./model.js";

/**
 * A line of text; segments wrapped in `|…|` are set in an italic text font.
 */
function textLine(
  source: string,
  left = 50,
  options: { pageIndex?: number; size?: number; mathItalic?: boolean } = {},
): TextLine {
  const glyphs: Glyph[] = [];
  let italic = false;
  let x = left;
  for (const character of source) {
    if (character === "|") {
      italic = !italic;
      continue;
    }
    const base = glyph(character, x, 100, { pageIndex: options.pageIndex ?? 0 });
    glyphs.push(
      italic
        ? {
            ...base,
            font: {
              ...base.font,
              italic: true,
              mathRole: options.mathItalic ? ("variable" as never) : "text",
            },
          }
        : base,
    );
    x += 5;
  }
  return {
    pageIndex: options.pageIndex ?? 0,
    glyphs,
    baseline: 100,
    size: options.size ?? 10,
    left,
    right: x,
    top: 90,
    bottom: 102,
    column: 0,
    spanning: false,
  };
}

const texts = (groups: TextLine[][]) => groups.map((group) => group.map(lineText));

describe("splitEntries", () => {
  it("returns nothing for blank input", () => {
    expect(splitEntries([textLine("   ")])).toEqual([]);
  });

  it("splits by bracketed and numbered markers, dropping text before the first", () => {
    const groups = splitEntries([
      textLine("stray heading"),
      textLine("[1] A. Author. Title."),
      textLine("continued here."),
      textLine("2. B. Author. Other."),
    ]);
    expect(texts(groups)).toEqual([
      ["[1] A. Author. Title.", "continued here."],
      ["2. B. Author. Other."],
    ]);
  });

  it("splits hanging-indent entries at the margin", () => {
    const groups = splitEntries([
      textLine("Smith, J. A long title", 50),
      textLine("that continues.", 60),
      textLine("Jones, K. Another title", 50),
      textLine("going on.", 60),
    ]);
    expect(groups.map((g) => g.length)).toEqual([2, 2]);
  });

  it("splits indented entries whose continuations sit at the margin", () => {
    const groups = splitEntries([
      textLine("Smith, J. Entry one", 60),
      textLine("continuation one", 50),
      textLine("continuation two", 50),
      textLine("continuation three", 50),
      textLine("Jones, K. Entry two", 60),
      textLine("continuation four", 50),
      textLine("continuation five", 50),
      textLine("Next page entry", 50, { pageIndex: 1 }),
    ]);
    expect(groups.map((g) => g.length)).toEqual([4, 3, 1]);
  });

  it("uses a default size when line sizes are unknown", () => {
    const groups = splitEntries([
      textLine("first", 50, { size: 0 }),
      textLine("second", 50, { size: 0 }),
    ]);
    expect(groups).toHaveLength(1);
  });
});

describe("parseReference", () => {
  it("parses a numbered journal article with an italic venue", () => {
    const used = new Set<string>();
    const ref = parseReference(
      [
        textLine("[3] Smith, J. A., Jones, K. B., and Brown, C. (2019). Deep LaTeX"),
        textLine("recovery for PDFs. |Journal of Typesetting|, 12(3): 45-67."),
        textLine("doi:10.1234/jt.2019.45."),
      ],
      used,
    );
    expect(ref.marker).toBe("3");
    expect(ref.entryType).toBe("article");
    expect(ref.authorSurnames).toEqual(["Smith", "Jones", "Brown"]);
    expect(ref.fields).toMatchObject({
      volume: "12",
      number: "3",
      pages: "45--67",
      year: "2019",
      doi: "10.1234/jt.2019.45",
      journal: "Journal of Typesetting",
    });
    expect(ref.fields.title).toBe("Deep {LaTeX} recovery for {PDFs}");
    expect(ref.parsed).toBe(true);
    expect(ref.key).toBe("smith2019");
    // The same key again gets a suffix.
    const again = parseReference(
      [textLine("Smith, J. (2019). Another. |Venue|.")],
      used,
    );
    expect(again.key).toBe("smith2019a");
  });

  it("joins hyphenated line breaks", () => {
    const ref = parseReference(
      [textLine("A. Turing. Computable num-"), textLine("bers. |Proc. LMS|, 1936.")],
      new Set(),
    );
    expect(ref.raw).toContain("Computable numbers.");
  });

  it("detects proceedings and takes the venue from the italic run or the text", () => {
    const italic = parseReference(
      [textLine("Lee, A. 2020. Fast parsing. In |Proc. of the Workshop on Parsing|. pp. 1-9.")],
      new Set(),
    );
    expect(italic.entryType).toBe("inproceedings");
    expect(italic.fields.booktitle).toBe("Proc. of the Workshop on Parsing");
    expect(italic.fields.pages).toBe("1--9");

    const plain = parseReference(
      [textLine("Lee, A. 2021. Faster parsing. In Proceedings of ACL, pages 3-4.")],
      new Set(),
    );
    expect(plain.fields.booktitle).toBe("Proceedings of ACL");

    const bare = parseReference([textLine("Lee, A. 2022. Symposium talk.")], new Set());
    expect(bare.entryType).toBe("inproceedings");
    expect(bare.fields.booktitle).toBeUndefined();
  });

  it("recognises theses, reports, preprints and books", () => {
    const parse = (text: string) => parseReference([textLine(text)], new Set());
    expect(parse("Kim, H. 2018. Typesetting. PhD thesis, MIT.").entryType).toBe("phdthesis");
    expect(parse("Kim, H. 2018. Typesetting. Master's thesis, MIT.").entryType).toBe(
      "mastersthesis",
    );
    expect(parse("Kim, H. 2018. Typesetting. Technical report TR-12.").entryType).toBe(
      "techreport",
    );
    const preprint = parse("Kim, H. 2018. Typesetting. arXiv:1801.01234v2.");
    expect(preprint.entryType).toBe("misc");
    expect(preprint.fields).toMatchObject({ eprint: "1801.01234", archivePrefix: "arXiv" });
    const book = parse("Knuth, D. 1984. The TeXbook. 2nd edition. Addison-Wesley Publishing.");
    expect(book.entryType).toBe("book");
    expect(book.fields.edition).toBe("2");
    expect(parse("Knuth, D. 1984. Something else entirely.").entryType).toBe("misc");
  });

  it("puts the italic run in the right field for each type", () => {
    const book = parseReference(
      [textLine("Knuth, D. 1984. The book. |Addison Wesley| press.")],
      new Set(),
    );
    expect(book.entryType).toBe("article");
    expect(book.fields.journal).toBe("Addison Wesley");

    const misc = parseReference(
      [textLine("Knuth, D. 1984. A preprint. |arXiv preprint|.")],
      new Set(),
    );
    expect(misc.entryType).toBe("misc");
    expect(misc.fields.publisher).toBe("arXiv preprint");

    const journalPages = parseReference(
      [textLine("Ng, A. 2001. Learning. |Machine Learning|, pp. 5-9.")],
      new Set(),
    );
    expect(journalPages.entryType).toBe("article");
  });

  it("reads volume and number cues and an URL", () => {
    const ref = parseReference(
      [textLine("Ng, A. Learning things. Some Journal, vol. 4, no. 2. https://example.org/x.")],
      new Set(),
    );
    expect(ref.fields).toMatchObject({ volume: "4", number: "2", url: "https://example.org/x" });
    expect(ref.entryType).toBe("article");
  });

  it("ignores math-italic glyphs and keeps the longest italic run", () => {
    const ref = parseReference(
      [
        textLine("Ng, A. 2001. |x| title |Short| and |A Much Longer Venue Name| end"),
        textLine("|tail|", 50, { mathItalic: true }),
      ],
      new Set(),
    );
    expect(ref.fields.journal).toBe("A Much Longer Venue Name");
  });

  it("keeps an italic run across lines", () => {
    const ref = parseReference(
      [textLine("Ng, A. 2001. Title here. |Journal of|"), textLine("|Things|, 3.")],
      new Set(),
    );
    expect(ref.fields.journal).toBe("Journal of Things");
  });

  it("handles name-first authors with initials and et al.", () => {
    const ref = parseReference(
      [textLine("J. R. R. Tolkien & C. S. Lewis et al. Inklings at work. Oxford press, 1950.")],
      new Set(),
    );
    expect(ref.fields.author).toBe("J. R. R. Tolkien and C. S. Lewis and others");
    expect(ref.authorSurnames).toEqual(["Tolkien", "Lewis", "others"]);
  });

  it.each(["Smith et al.", "Smith, et al.", "Smith ET AL", "Smith, J., et al."])(
    "preserves BibTeX's others author when importing %s",
    (authors) => {
      const ref = parseReference(
        [textLine(`${authors} (2020). A useful paper. |Journal of Science|.`)],
        new Set(),
      );
      const expected = authors.startsWith("Smith, J.")
        ? "Smith, J and others"
        : "Smith and others";
      expect(ref.fields.author).toBe(expected);
      expect(ref.authorSurnames).toEqual(["Smith", "others"]);
      expect(ref.parsed).toBe(true);
      expect(renderBibFile([ref])).toContain(`author = {${expected}}`);
    },
  );

  it("falls back to initials as surnames and escapes special characters", () => {
    const ref = parseReference(
      [textLine("A. B. 2010. 100% of $cost & more_stuff #1 {x}~^\\")],
      new Set(),
    );
    expect(ref.authorSurnames).toEqual(["B"]);
    expect(ref.fields.title).toContain("100\\% of \\$cost \\& more\\_stuff \\#1 \\{x\\}");
    expect(ref.fields.title).toContain("\\textasciitilde{}\\textasciicircum{}\\textbackslash{}");
  });

  it("keeps only the raw text when authors cannot be found", () => {
    const ref = parseReference([textLine("[7] just some words without structure")], new Set());
    expect(ref.parsed).toBe(false);
    expect(ref.fields.note).toBe("just some words without structure");
    expect(ref.key).toBe("ref-7");
    const unnumbered = parseReference([textLine("only words here")], new Set(["ref"]));
    expect(unnumbered.key).toBe("refa");
  });

  it("uses a numbered key when nothing else is known", () => {
    const ref = parseReference([textLine("1. ???")], new Set());
    expect(ref.key).toBe("ref-1");
    const blank = parseReference([textLine("!!!")], new Set(["a", "b"]));
    expect(blank.key).toBe("ref");
  });

  it("ends on an italic venue and accepts it without a title", () => {
    const ref = parseReference([textLine("Ng, A. 2001. |Venue Name|")], new Set());
    expect(ref.fields.journal).toBe("Venue Name");
    expect(ref.fields.title).toBeUndefined();
    expect(ref.parsed).toBe(true);
  });

  it("numbers the key when the surname has no letters", () => {
    const ref = parseReference([textLine("[4] '' and '. Words. More words.")], new Set());
    expect(ref.authorSurnames.length).toBeGreaterThan(0);
    expect(ref.key).toBe("ref4");
    const unnumbered = parseReference([textLine("'' and '. Words. More.")], new Set(["x"]));
    expect(unnumbered.key).toBe("ref2");
  });

  it("truncates very long titles", () => {
    const ref = parseReference(
      [textLine(`Ng, A. 2001. ${"word ".repeat(80)}end`)],
      new Set(),
    );
    expect(ref.fields.title.length).toBeLessThanOrEqual(300);
  });

  it("drops a surname that cleans to nothing", () => {
    const ref = parseReference([textLine("12, 34. 2001. A title. |Venue|.")], new Set());
    expect(ref.authorSurnames).toEqual([]);
  });

  it("runs out of key suffixes gracefully", () => {
    const used = new Set(["smith2000", ...[..."abcdefghijklmnopqrstuvwxyz"].map((c) => `smith2000${c}`)]);
    const ref = parseReference([textLine("Smith, J. (2000). Title. |V|.")], used);
    expect(ref.key).toBe("smith2000");
  });
});

describe("parseBibliography and renderBibFile", () => {
  it("parses a list, drops tiny entries, and renders BibTeX", () => {
    const refs = parseBibliography([
      textLine("[1] Smith, J. (2019). A title. |A Journal|, 1(2): 3-4."),
      textLine("[2] tiny"),
      textLine("[3] unparseable words go here"),
    ]);
    expect(refs.map((r) => r.marker)).toEqual(["1", "3"]);
    const bib = renderBibFile(refs);
    expect(bib).toMatch(/^% Generated by LatexDo from a PDF import\./);
    expect(bib).toContain("@article{smith2019,\n  author = {Smith, J}");
    expect(bib).toContain(
      "% Only the raw text of this entry could be recovered; check the fields.\n@misc{ref-3,",
    );
    expect(bib).toContain("  note = {unparseable words go here}");
  });
});
