// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decodeTextBuffer } from "./textFile.js";

const bib = "@article{lewis2020,\n  title = {Retrieval},\n}\n";

describe("decodeTextBuffer", () => {
  it("reads UTF-8, with or without a byte-order mark", () => {
    expect(decodeTextBuffer(Buffer.from(bib, "utf8"))).toBe(bib);
    expect(
      decodeTextBuffer(
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(bib)]),
      ),
    ).toBe(bib);
  });

  it("reads UTF-16 files written by Windows tools instead of calling them binary", () => {
    const le = Buffer.from(bib, "utf16le");
    expect(decodeTextBuffer(Buffer.concat([Buffer.from([0xff, 0xfe]), le]))).toBe(bib);
    expect(decodeTextBuffer(le)).toBe(bib);
    const be = Buffer.from(le).swap16();
    expect(decodeTextBuffer(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe(bib);
    expect(decodeTextBuffer(be)).toBe(bib);
  });

  it("still refuses real binary data", () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 7, 0, 0, 3,
    ]);
    expect(() => decodeTextBuffer(png)).toThrow("File appears to be binary.");
  });
});
