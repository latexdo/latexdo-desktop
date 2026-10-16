// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { deflateRawSync } from "node:zlib";
import { importDocxIntoProject } from "./docxImport.js";
import { importMarkdown } from "./markdownImport.js";

const processMock = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => processMock);
vi.mock("child_process", () => processMock);
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "latexdo-import-"));
  processMock.execFile.mockImplementation((...args: unknown[]) => {
    (args.at(-1) as (error: Error | null, stdout?: string, stderr?: string) => void)(
      new Error("pandoc unavailable"),
    );
  });
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  vi.clearAllMocks();
});

// Small standards-compliant ZIP fixture writer: tests exercise the real DOCX reader.
function zip(entries: Record<string, string | Buffer>, compressed = false): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const original = Buffer.from(value);
    const data = compressed ? deflateRawSync(original) : original;
    let crc = 0xffffffff;
    for (const byte of original) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(compressed ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(original.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(compressed ? 8 : 0, 10);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(original.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    central.push(record, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(Buffer.concat(central).length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}
const run = (text: string, properties = "") =>
  `<w:r><w:rPr>${properties}</w:rPr><w:t>${text}</w:t></w:r>`;
const paragraph = (text: string, properties = "") =>
  `<w:p><w:pPr>${properties}</w:pPr>${text}</w:p>`;
async function docx(
  body: string,
  extra: Record<string, string | Buffer> = {},
  compressed = false,
  name = "paper.docx",
) {
  const source = path.join(directory, name);
  await writeFile(
    source,
    zip(
      {
        "word/document.xml": `<w:document><w:body>${body}</w:body></w:document>`,
        ...extra,
      },
      compressed,
    ),
  );
  const result = await importDocxIntoProject(directory, source);
  return {
    result,
    latex: await readFile(path.join(directory, result.relativePath), "utf8"),
  };
}

describe("DOCX import through real files", () => {
  it.each([false, true])(
    "reads %s-compressed text, entities and formatting",
    async (compressed) => {
      const { result, latex } = await docx(
        paragraph(
          run(
            "A &amp; B &lt; C &gt; D &quot;quoted&quot; &#65; &#x42; _ % # $ { } \\ ~ ^",
            "<w:b/><w:i/><w:u/><w:strike/><w:highlight/>",
          ) +
            run("up", '<w:vertAlign w:val="superscript"/>') +
            run("down", '<w:vertAlign w:val="subscript"/>') +
            "<w:r><w:tab/><w:br/></w:r>",
        ),
        { "docProps/core.xml": "<dc:title>Paper &amp; Notes</dc:title>" },
        compressed,
      );
      expect(result.converter).toBe("built-in");
      expect(latex).toContain("\\title{Paper \\& Notes}");
      expect(latex).toContain("\\textbf{");
      expect(latex).toContain("\\emph{");
      expect(latex).toContain("\\underline{");
      expect(latex).toContain("\\textsuperscript{up}");
      expect(latex).toContain("\\textsubscript{down}");
      expect(latex).toContain("\\_");
      expect(latex).toContain("\\%");
      expect(latex).toContain("\\end{document}");
    },
  );
  it("preserves heading hierarchy, nested lists and table cells", async () => {
    const headings = [1, 2, 3, 4, 5, 6]
      .map((n) => paragraph(run(`Heading ${n}`), `<w:pStyle w:val="Heading${n}"/>`))
      .join("");
    const list = (text: string, id: number, level = 0) =>
      paragraph(
        run(text),
        `<w:numPr><w:numId w:val="${id}"/><w:ilvl w:val="${level}"/></w:numPr>`,
      );
    const table = `<w:tbl><w:tr><w:tc>${paragraph(run("Name"))}</w:tc><w:tc>${paragraph(run("Value"))}</w:tc></w:tr><w:tr><w:tc>${paragraph(run("Only one cell"))}</w:tc></w:tr></w:tbl>`;
    const { latex } = await docx(
      headings +
        list("One", 1) +
        list("Nested", 1, 1) +
        list("Two", 1) +
        list("Bullet", 2) +
        paragraph(run("After")) +
        table,
      {
        "word/numbering.xml":
          '<w:numbering><w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="20"/></w:num><w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="lowerRoman"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="20"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum></w:numbering>',
      },
    );
    for (const command of [
      "section",
      "subsection",
      "subsubsection",
      "paragraph",
      "subparagraph",
    ])
      expect(latex).toContain(`\\${command}{Heading`);
    expect(latex).toContain("\\begin{enumerate}");
    expect(latex).toContain("\\begin{itemize}");
    expect(latex).toContain("Name & Value");
    expect(latex).toContain("\\begin{tabular}{ll}");
    expect(latex.match(/\\begin{enumerate}/g)?.length).toBe(
      latex.match(/\\end{enumerate}/g)?.length,
    );
  });
  it("extracts media once, preserves links, and warns about lossy equations", async () => {
    const image = '<w:r><w:drawing><a:blip r:embed="image"/></w:drawing></w:r>';
    const { result, latex } = await docx(
      paragraph(image + image) +
        paragraph(`<w:hyperlink r:id="link">${run("Read more")}</w:hyperlink>`) +
        paragraph("<m:oMath><m:t>x</m:t><m:t>=1</m:t></m:oMath><m:oMath></m:oMath>"),
      {
        "word/_rels/document.xml.rels":
          '<Relationships><Relationship Id="image" Target="media/photo.png"/><Relationship Id="link" Target="https://example.org/a?q=1&amp;x=2" TargetMode="External"/></Relationships>',
        "word/media/photo.png": Buffer.from([137, 80, 78, 71]),
      },
    );
    expect(result.mediaFiles).toEqual(["assets/paper/photo.png"]);
    expect(await readFile(path.join(directory, result.mediaFiles[0]))).toEqual(
      Buffer.from([137, 80, 78, 71]),
    );
    expect(latex).toContain("\\usepackage{graphicx}");
    expect(latex).toContain("\\href{");
    expect(latex).toContain("$x =1$");
    expect(result.warnings.join(" ")).toContain("Skipped a Word equation");
  });
  it("does not overwrite an existing import and tolerates missing optional parts", async () => {
    await writeFile(path.join(directory, "paper.tex"), "keep");
    await mkdir(path.join(directory, "assets/paper"), { recursive: true });
    const { result, latex } = await docx(
      paragraph(run("Hello", '<w:b w:val="false"/><w:i w:val="0"/>')) +
        "<w:p></w:p><w:tbl></w:tbl><w:p>truncated",
    );
    expect(result.relativePath).toBe("paper-2.tex");
    expect(result.assetDirectory).toBe("assets/paper-2");
    expect(await readFile(path.join(directory, "paper.tex"), "utf8")).toBe("keep");
    expect(latex).toContain("\\title{Paper}");
    expect(latex).not.toContain("\\textbf{Hello}");
  });
  it("rejects malformed and unsupported archives with actionable errors", async () => {
    const source = path.join(directory, "bad.docx");
    for (const [data, message] of [
      [Buffer.from("not a zip"), /valid DOCX archive/],
      [zip({ empty: "x" }), /document body/],
    ] as const) {
      await writeFile(source, data);
      await expect(importDocxIntoProject(directory, source)).rejects.toThrow(message);
    }
    await expect(importDocxIntoProject(directory, directory)).rejects.toThrow(
      "Select a DOCX file",
    );
    const text = path.join(directory, "paper.txt");
    await writeFile(text, "text");
    await expect(importDocxIntoProject(directory, text)).rejects.toThrow(
      "Select a .docx file",
    );
    const invalidCompression = zip({ "word/document.xml": "<body/>" });
    invalidCompression.writeUInt16LE(
      99,
      invalidCompression.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10,
    );
    await writeFile(source, invalidCompression);
    await expect(importDocxIntoProject(directory, source)).rejects.toThrow(
      "unsupported compression",
    );
  });
  it("uses Pandoc when available and reports extracted media", async () => {
    processMock.execFile.mockImplementation(
      (
        _file: string,
        args: string[],
        _options: unknown,
        callback: (error: null, stdout: string, stderr: string) => void,
      ) => {
        void (async () => {
          const target = args[args.indexOf("--output") + 1];
          const assets = args.find((a) => a.startsWith("--extract-media="))!.slice(16);
          await mkdir(path.join(assets, "nested"), { recursive: true });
          await writeFile(path.join(assets, "nested/image.png"), "image");
          await writeFile(target, "\\documentclass{article}");
          callback(null, "", "");
        })();
      },
    );
    const { result } = await docx("");
    expect(result.converter).toBe("pandoc");
    expect(result.mediaFiles).toEqual(["assets/paper/nested/image.png"]);
  });
});

describe("Markdown import", () => {
  it("converts headings, mixed lists, formatting and fenced blocks when Pandoc is missing", async () => {
    const source = path.join(directory, "notes.md");
    await writeFile(
      source,
      [
        "# Title",
        "## Section",
        "### Subsection",
        "#### Paragraph",
        "##### Subparagraph",
        "###### Minor",
        "",
        "**bold** *italic* `code` ~~deleted~~",
        "second line",
        "",
        "- first",
        "- second",
        "1. one",
        "2. two",
        "regular",
        "---",
        "```js",
        "const x = 1;",
        "```",
        "A [link](https://example.org)",
        "![figure](image.png)",
        "```",
        "unterminated",
      ].join("\n"),
    );
    const result = await importMarkdown(directory, source);
    const latex = await readFile(path.join(directory, result.relativePath), "utf8");
    expect(result.converter).toBe("built-in");
    for (const command of [
      "section",
      "subsection",
      "subsubsection",
      "paragraph",
      "subparagraph",
      "textbf",
      "textit",
      "texttt",
      "sout",
      "href",
      "includegraphics",
    ])
      expect(latex).toContain(`\\${command}{`);
    expect(latex).toContain("\\begin{itemize}");
    expect(latex).toContain("\\begin{enumerate}");
    expect(latex.match(/\\begin{verbatim}/g)).toHaveLength(2);
    expect(latex.match(/\\end{verbatim}/g)).toHaveLength(2);
  });
  it("propagates file errors instead of reporting a successful import", async () => {
    await expect(
      importMarkdown(directory, path.join(directory, "missing.md")),
    ).rejects.toThrow(/ENOENT/);
  });
  it("prefers Pandoc and passes filenames as arguments rather than shell commands", async () => {
    processMock.execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        callback: (error: null, stdout: string, stderr: string) => void,
      ) => callback(null, "", ""),
    );
    const source = path.join(directory, "notes;echo.md");
    expect(await importMarkdown(directory, source)).toMatchObject({
      converter: "pandoc",
      warnings: [],
    });
    expect(processMock.execFile.mock.calls[0][1][0]).toBe(source);
  });
});
