// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractDocument, extractPage } from "./extract.js";
import { importPdfIntoProject } from "./index.js";
const pdfjs = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => pdfjs);
type Op = [number, ...unknown[]];
function chars(text: string) {
  return [...text].map((unicode) => ({
    originalCharCode: unicode.charCodeAt(0),
    unicode,
    width: 500,
    isSpace: unicode === " ",
  }));
}
function proxy(operations: Op[], dimensions = [612, 792]) {
  return {
    view: [0, 0, ...dimensions],
    rotate: 0,
    getViewport: () => ({
      width: dimensions[0],
      height: dimensions[1],
      transform: [1, 0, 0, -1, 0, dimensions[1]],
    }),
    getOperatorList: vi.fn(async () => ({
      fnArray: operations.map((op) => op[0]),
      argsArray: operations.map((op) => op.slice(1)),
    })),
    commonObjs: {
      has: (key: string) => key === "F1",
      get: () => ({ name: "CMR10", fontMatrix: [0.001] }),
    },
    objs: {
      has: (key: string) => key === "F2",
      get: () => ({ name: "CMBX10", fontMatrix: [0.001] }),
    },
    cleanup: vi.fn(),
  };
}
async function extract(operations: Op[], budget = 10000) {
  const p = proxy(operations);
  const warnings: string[] = [];
  const fonts = new Map();
  const page = await extractPage(p, 0, fonts, warnings, { remaining: budget });
  expect(p.cleanup).toHaveBeenCalledOnce();
  return { page, warnings, fonts };
}
function document(
  pages: ReturnType<typeof proxy>[],
  metadata: Record<string, unknown> = {},
) {
  const doc = {
    numPages: pages.length,
    getPage: vi.fn(async (n: number) => pages[n - 1]),
    getMetadata: vi.fn(async () => ({ info: metadata })),
    destroy: vi.fn(async () => {}),
  };
  pdfjs.getDocument.mockReturnValue({ promise: Promise.resolve(doc) });
  return doc;
}
const textOps = (text: string, x = 72, y = 700, size = 10): Op[] => [
  [31],
  [37, "F1", size],
  [42, 1, 0, 0, 1, x, y],
  [44, chars(text)],
  [32],
];
afterEach(() => {
  vi.clearAllMocks();
});
describe("PDF text state and geometry extraction", () => {
  it("positions glyphs in page coordinates and honors kerning, spacing, scale and rise", async () => {
    const { page, fonts } = await extract([
      [31],
      [37, "F1", 10],
      [42, 1, 0, 0, 1, 50, 700],
      [33, 1],
      [34, 2],
      [35, 200],
      [39, 3],
      [45, [...chars("A "), 100, ...chars("B")]],
      [32],
    ]);
    expect(page.glyphs.map((g) => [g.text, g.x, g.y, g.width])).toEqual([
      ["A", 50, 89, 12],
      [" ", 62, 89, 16],
      ["B", 76, 89, 12],
    ]);
    expect(page.glyphs[0]).toMatchObject({ size: 10, rise: 3, pageIndex: 0 });
    expect(fonts.get("F1").rawName).toBe("CMR10");
  });
  it("tracks line leading, text moves and quote operators", async () => {
    const { page } = await extract([
      [31],
      [37, "F1", 10],
      [42, 1, 0, 0, 1, 50, 700],
      [36, 12],
      [44, chars("A")],
      [43],
      [44, chars("B")],
      [46, chars("C")],
      [47, 2, 1, chars("D")],
      [40, 5, -10],
      [44, chars("E")],
      [41, 5, -15],
      [44, chars("F")],
      [43],
      [44, chars("G")],
    ]);
    expect(page.glyphs.map((g) => [g.text, g.x, g.y])).toEqual([
      ["A", 50, 92],
      ["B", 50, 104],
      ["C", 50, 116],
      ["D", 50, 128],
      ["E", 55, 138],
      ["F", 60, 153],
      ["G", 60, 168],
    ]);
  });
  it("restores graphics state across saves and form XObjects", async () => {
    const { page } = await extract([
      [11],
      [75],
      [10],
      [12, 2, 0, 0, 2, 10, 20],
      ...textOps("A", 10, 20),
      [11],
      [74, [1, 0, 0, 1, 5, 10]],
      ...textOps("B", 10, 20),
      [75],
      ...textOps("C", 10, 20),
    ]);
    expect(page.glyphs.map((g) => [g.text, g.x, g.y, g.size])).toEqual([
      ["A", 30, 732, 20],
      ["B", 15, 762, 10],
      ["C", 10, 772, 10],
    ]);
  });
  it("caps retained glyphs and warns about rotated and invisible OCR text", async () => {
    expect(
      (await extract(textOps("abcdef"), 2)).page.glyphs.map((g) => g.text).join(""),
    ).toBe("ab");
    const rotated = await extract([
      [31],
      [37, "F1", 10],
      [42, 0, 1, -1, 0, 50, 700],
      [44, chars("rotated")],
    ]);
    expect(rotated.page.glyphs).toEqual([]);
    expect(rotated.warnings[0]).toContain("rotated text");
    const invisible = await extract([[38, 3], ...textOps("OCR")]);
    expect(invisible.page.glyphs).toHaveLength(3);
    expect(invisible.warnings[0]).toContain("invisible OCR");
  });
  it("handles local fonts, missing fonts, malformed text operands and cached fonts", async () => {
    const { page, fonts } = await extract([
      [44, chars("ignored")],
      [37, "F2", 10],
      [44, [null, "invalid", ...chars("B")]],
      [37, "missing", 10],
      [44, chars("M")],
      [37, "F2", 10],
      [44, chars("C")],
      [44, null],
      [37, "F1", 0.1],
      [44, chars("tiny")],
    ]);
    expect(page.glyphs.map((g) => g.text).join("")).toBe("BMC");
    expect(fonts.get("F2").bold).toBe(true);
    expect(fonts.has("missing")).toBe(true);
  });
  it("extracts thin rules, deduplicates rectangles, and separates vector artwork", async () => {
    const { page } = await extract([
      [2, 0.5],
      [91, [19], [10, 700, 100, 1]],
      [22],
      [91, [19], [10, 700, 100, 1]],
      [23],
      [91, [19], [10, 600, 100, 50]],
      [20],
      [91, [19], [200, 500, 50, 50]],
      [22],
    ]);
    expect(page.rules).toHaveLength(5);
    expect(page.rules.filter((r) => r.vertical)).toHaveLength(2);
    expect(page.rules[0]).toMatchObject({
      x1: 10,
      x2: 110,
      y1: 91,
      y2: 92,
      horizontal: true,
    });
    expect(page.graphics).toEqual([
      { pageIndex: 0, x: 200, y: 242, width: 50, height: 50, kind: "vector" },
    ]);
  });
  it("keeps disjoint polylines separate and drops clipping paths", async () => {
    const { page } = await extract([
      [91, [13, 14, 13, 14], [10, 700, 100, 700, 200, 600, 200, 650]],
      [21],
      [91, [19], [0, 0, 100, 100]],
      [29],
      [20],
      [91, [13, 14, 18], [10, 500, 100, 500]],
      [20],
    ]);
    expect(page.rules).toHaveLength(3);
    expect(page.rules.some((r) => r.x1 === 100 && r.x2 === 200)).toBe(false);
    expect(page.graphics).toEqual([]);
  });
  it.each([15, 16, 17])("records curved artwork for curve operator %i", async (op) => {
    const coords =
      op === 15 ? [10, 700, 20, 690, 30, 680, 100, 600] : [10, 700, 20, 690, 100, 600];
    const { page } = await extract([[91, [13, op], coords], [22]]);
    expect(page.rules).toEqual([]);
    expect(page.graphics[0]).toMatchObject({
      kind: "vector",
      x: 10,
      y: 92,
      width: 90,
      height: 100,
    });
  });
  it.each([62, 83, 84, 85, 86, 87, 88, 89, 90])(
    "recognizes image bounds for paint operator %i",
    async (op) => {
      const { page } = await extract([
        [10],
        [12, 100, 0, 0, 50, 20, 600],
        [op],
        [11],
        [op],
      ]);
      expect(page.graphics).toEqual([
        { pageIndex: 0, x: 20, y: 142, width: 100, height: 50, kind: "image" },
      ]);
      expect(page.scanned).toBe(true);
    },
  );
});
describe("document extraction and PDF import orchestration", () => {
  it("limits pages, shares the glyph budget, and safely configures the parser", async () => {
    const doc = document([proxy(textOps("abcdef")), proxy(textOps("ghi")), proxy([])], {
      Title: " Title ",
      Author: " Ada ",
      Producer: "TeX",
      Creator: "LatexDo",
    });
    const result = await extractDocument(new Uint8Array([1, 2]), {
      maxPages: 2,
      maxGlyphs: 7,
    });
    expect(result).toMatchObject({
      title: "Title",
      author: "Ada",
      producer: "TeX LatexDo",
    });
    expect(result.pages.map((p) => p.glyphs.length)).toEqual([6, 1]);
    expect(result.warnings[0]).toContain("first 2 of 3");
    expect(doc.destroy).toHaveBeenCalledOnce();
    expect(pdfjs.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        isEvalSupported: false,
        disableFontFace: true,
        useWorkerFetch: false,
      }),
    );
  });
  it("recovers from optional metadata and unreadable page operators", async () => {
    const bad = proxy([]);
    bad.getOperatorList.mockRejectedValueOnce(new Error("bad stream"));
    const doc = document([bad, proxy(textOps("ok"))]);
    doc.getMetadata.mockRejectedValueOnce(new Error("no metadata"));
    const result = await extractDocument(new Uint8Array());
    expect(result.pages).toHaveLength(1);
    expect(result.title).toBe("");
    expect(result.warnings[0]).toContain("bad stream");
    expect(doc.destroy).toHaveBeenCalledOnce();
  });
  it.each([
    [612, 792, "letterpaper"],
    [595, 842, "a4paper"],
    [500, 700, "paperwidth"],
  ])(
    "imports a %i x %i page into source while preserving existing files",
    async (width, height, paper) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "latexdo-pdf-"));
      try {
        const source = path.join(root, "Résumé paper.PDF");
        await writeFile(source, "%PDF-fixture");
        const project = path.join(root, "project");
        await mkdir(project);
        await writeFile(path.join(project, "resume-paper.tex"), "keep existing");
        document([
          proxy(
            [
              ...textOps("A scientific paper about useful ideas", 72, 620, 14),
              ...textOps(
                "This paragraph contains more than twenty searchable letters.",
                72,
                580,
              ),
              ...textOps(
                "This second line continues the discussion with useful results.",
                72,
                568,
              ),
            ],
            [width as number, height as number],
          ),
        ]);
        const result = await importPdfIntoProject(project, source);
        expect(result).toMatchObject({
          relativePath: "resume-paper-2.tex",
          converter: "built-in",
          pageCount: 1,
          bibRelativePath: null,
          mediaFiles: [],
        });
        const tex = await readFile(path.join(project, result.relativePath), "utf8");
        expect(tex).toContain("\\documentclass");
        expect(tex).toContain(paper as string);
        expect(tex).toContain("searchable letters");
        expect(await readFile(path.join(project, "resume-paper.tex"), "utf8")).toBe(
          "keep existing",
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it("rejects scans, directories, oversized inputs and the wrong extension", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "latexdo-pdf-reject-"));
    try {
      await expect(importPdfIntoProject(root, root)).rejects.toThrow(
        "Select a PDF file",
      );
      const source = path.join(root, "scan.pdf");
      await writeFile(source, "%PDF");
      document([proxy([[12, 100, 0, 0, 100, 0, 0], [85]])]);
      await expect(importPdfIntoProject(root, source)).rejects.toThrow("OCR");
      await truncate(source, 201 * 1024 * 1024);
      await expect(importPdfIntoProject(root, source)).rejects.toThrow("200 MB");
      const wrong = path.join(root, "file.txt");
      await writeFile(wrong, "%PDF");
      await expect(importPdfIntoProject(root, wrong)).rejects.toThrow(".pdf file");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
