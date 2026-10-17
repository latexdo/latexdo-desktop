// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contextAt,
  contextScore,
  findSourceWord,
  normalizeWord,
  sourceContextAt,
  textWords,
  wordSimilarity,
} from "./wordMatch";
import { backwardSyncTex, forwardSyncTex } from "../../../electron/synctex.js";

// Real pdflatex and synctex on a three-file project, compiled in the system
// temp folder like a shared project (on macOS that folder is a symlink, which
// TeX records under its real path). Skipped where TeX is not installed.
const pdflatex = ["/Library/TeX/texbin/pdflatex", "/usr/bin/pdflatex"].find(existsSync);

const main = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
The cat sat on the mat while the dog watched the bird on the fence
near the old barn. How vexingly quick daft zebras jump over the
lazy dog in the evening.

\input{chapters/intro}

Final words of the main file mention the elephant and the giraffe.
\end{document}
`;
const intro = String.raw`\section{Chapter}
This sentence lives in another file and mentions the pineapple.
Second line with \textbf{boldword} and an efficient fiddle, then the end.
`;

interface PdfWord {
  word: string;
  norm: string;
  page: number;
  /** Centre, in PDF points from the top-left corner. */
  x: number;
  y: number;
}

let root: string;

/** Every word of the PDF with its position, read by pdf.js like the preview. */
async function pdfWords(pdfPath: string): Promise<PdfWord[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(await readFile(pdfPath)),
    useSystemFonts: true,
  }).promise;
  const words: PdfWord[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const height = page.getViewport({ scale: 1 }).height;
    const content = await page.getTextContent();
    let hyphenPending = false;
    for (const item of content.items) {
      if (!("str" in item) || !item.str) continue;
      const [, , , , left, baseline] = item.transform as number[];
      const found = textWords(item.str);
      found.forEach((part, index) => {
        const x = left! + (item.width * (part.start + part.end)) / 2 / item.str.length;
        const previous = words[words.length - 1];
        if (hyphenPending && index === 0 && previous) {
          previous.word += part.word;
          previous.norm = normalizeWord(previous.word);
        } else {
          words.push({
            word: part.word,
            norm: normalizeWord(part.word),
            page: pageNumber,
            x,
            y: height - baseline! - 3,
          });
        }
        hyphenPending = false;
      });
      const last = found[found.length - 1];
      if (last && /^[-­‐]\s*$/.test(item.str.slice(last.end))) hyphenPending = true;
      else if (item.str.trim()) hyphenPending = false;
    }
  }
  return words;
}

describe.runIf(pdflatex)("SyncTeX lands on the exact word", () => {
  let words: PdfWord[];
  const sources: Record<string, string> = {
    "main.tex": main,
    "chapters/intro.tex": intro,
  };

  beforeAll(async () => {
    // os.tmpdir() is /var/folders/… on macOS; TeX records /private/var/folders/….
    root = await mkdtemp(path.join(os.tmpdir(), "latexdo-synctex-"));
    await mkdir(path.join(root, "chapters"));
    await writeFile(path.join(root, "main.tex"), main);
    await writeFile(path.join(root, "chapters/intro.tex"), intro);
    execFileSync(pdflatex!, ["-synctex=1", "-interaction=nonstopmode", "main.tex"], {
      cwd: root,
      stdio: "ignore",
    });
    words = await pdfWords(path.join(root, "main.pdf"));
  }, 60_000);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** PDF → source: double-click the nth occurrence of a word. */
  async function clickInPdf(word: string, occurrence: number) {
    const indexes = words
      .map((item, index) => (item.norm === word ? index : -1))
      .filter((index) => index >= 0);
    const index = indexes[occurrence]!;
    const target = words[index]!;
    const location = await backwardSyncTex(
      root,
      path.join(root, "main.pdf"),
      target.page,
      target.x,
      target.y,
    );
    expect(location).not.toBeNull();
    const context = contextAt(words, index);
    const match = findSourceWord(sources[location!.file]!, location!.line, context);
    expect(match).not.toBeNull();
    const line = sources[location!.file]!.split("\n")[match!.line - 1]!;
    return {
      file: location!.file,
      line: match!.line,
      column: match!.column,
      text: line.slice(match!.column - 1, match!.column - 1 + match!.length),
    };
  }

  /** Source → PDF: double-click a word in the editor. */
  async function clickInSource(file: string, line: number, column: number) {
    const context = sourceContextAt(sources[file]!, line, column)!;
    const location = await forwardSyncTex(
      root,
      path.join(root, "main.pdf"),
      path.join(root, file),
      line,
      column,
    );
    expect(location).not.toBeNull();
    const boxes = location!.boxes!;
    let best = -1;
    let bestScore = -Infinity;
    words.forEach((item, index) => {
      if (item.page !== location!.page) return;
      const similarity = wordSimilarity(item.norm, normalizeWord(context.word));
      if (!similarity) return;
      const distance = Math.min(
        ...boxes.map((box) => {
          const dx = Math.max(box.h - item.x, 0, item.x - (box.h + box.width));
          const dy = Math.max(box.v - box.height - item.y, 0, item.y - box.v);
          return Math.hypot(dx, dy);
        }),
      );
      const height = Math.max(8, ...boxes.map((box) => box.height));
      const score =
        similarity * 3 +
        contextScore(words, index, context) * 4 -
        (distance / height) * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    });
    return { index: best, context };
  }

  it("finds the clicked word in the source, even a repeated one", async () => {
    // "the" appears many times: each click lands on its own occurrence.
    const sourceThes = [...main.matchAll(/\bthe\b/gi)].length;
    expect(sourceThes).toBeGreaterThan(5);
    const seen = new Set<string>();
    const pdfThes = words.filter((item) => item.norm === "the").length;
    for (let occurrence = 0; occurrence < pdfThes; occurrence++) {
      const hit = await clickInPdf("the", occurrence);
      expect(hit.text.toLowerCase()).toBe("the");
      seen.add(`${hit.file}:${hit.line}:${hit.column}`);
    }
    // Every PDF "the" maps to a different source "the".
    expect(seen.size).toBe(pdfThes);
  });

  it("follows a click into another file", async () => {
    expect(await clickInPdf("pineapple", 0)).toMatchObject({
      file: "chapters/intro.tex",
      line: 2,
      text: "pineapple",
    });
    expect(await clickInPdf("boldword", 0)).toMatchObject({
      file: "chapters/intro.tex",
      line: 3,
      text: "boldword",
    });
  });

  it("handles ligatures and words hyphenated across PDF lines", async () => {
    expect(await clickInPdf("efficient", 0)).toMatchObject({ text: "efficient" });
    expect(await clickInPdf("fiddle", 0)).toMatchObject({ text: "fiddle" });
    const vex = words.find((item) => item.norm.startsWith("vex"));
    expect(vex).toBeDefined();
    expect(await clickInPdf(vex!.norm, 0)).toMatchObject({ text: "vexingly" });
  });

  it("finds the source word in the PDF, also from another file and wrapped lines", async () => {
    const cases: Array<[string, number, string, number]> = [
      ["main.tex", 4, "the", 1], // "The cat sat on the mat while the dog…": second "the"
      ["main.tex", 4, "the", 2], // third "the"
      ["main.tex", 5, "zebras", 0],
      ["main.tex", 10, "giraffe", 0],
      ["chapters/intro.tex", 3, "boldword", 0],
      ["chapters/intro.tex", 2, "pineapple", 0],
    ];
    for (const [file, line, word, nth] of cases) {
      const text = sources[file]!.split("\n")[line - 1]!;
      const columns = [...text.matchAll(new RegExp(`\\b${word}\\b`, "gi"))].map(
        (match) => match.index + 2,
      );
      const { index, context } = await clickInSource(file, line, columns[nth]!);
      expect(context.word.toLowerCase()).toBe(word);
      expect(index).toBeGreaterThanOrEqual(0);
      // The PDF word chosen has the same neighbours as the source word.
      const chosen = contextAt(words, index);
      expect(chosen.word.toLowerCase()).toBe(word);
      expect(chosen.before.slice(-2)).toEqual(context.before.slice(-2));
    }
  });
});
