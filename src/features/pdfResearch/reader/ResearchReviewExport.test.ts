import { afterEach, describe, expect, it, vi } from "vitest";
import type { PdfAnnotation } from "../domain/PdfAnnotation";
import type { ResearchDocument } from "../domain/ResearchDocument";
import {
  buildPdfReviewText,
  downloadTextFile,
  pdfReviewFileName,
} from "./ResearchReviewExport";

function doc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: "pdf:local:1",
    name: "paper.pdf",
    source: { type: "project-file", fileId: "1", relativePath: "refs/paper.pdf" },
    metadata: {},
    processing: { status: "indexed" },
    permissions: { canAnnotate: true, canExport: true },
    ...overrides,
  };
}

function annotation(overrides: Partial<PdfAnnotation>): PdfAnnotation {
  return {
    id: "a",
    documentId: "pdf:local:1",
    userId: "u",
    type: "highlight",
    pageNumber: 1,
    anchor: { quote: { exact: "quoted" } } as PdfAnnotation["anchor"],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

afterEach(() => vi.useRealTimers());

describe("pdfReviewFileName", () => {
  it("prefers the title and sanitises it", () => {
    expect(pdfReviewFileName(doc({ metadata: { title: "Deep: Nets!" } }))).toBe(
      "Deep-Nets-review.txt",
    );
    expect(pdfReviewFileName(doc())).toBe("paper-review.txt");
    expect(pdfReviewFileName(doc({ name: "???.pdf" }))).toBe("paper-review.txt");
  });
});

describe("buildPdfReviewText", () => {
  const at = new Date("2026-01-02T03:04:05.000Z");

  it("says when nothing was annotated and falls back to the name", () => {
    const text = buildPdfReviewText(
      doc({ source: { type: "uploaded", fileId: "1" } }),
      [],
      at,
    );
    expect(text).toContain("Paper: paper.pdf");
    expect(text).toContain("File: paper.pdf");
    expect(text).toContain("Generated: 2026-01-02T03:04:05.000Z");
    expect(text).toContain("No annotations were saved for this paper.");
  });

  it("orders items by page then time and includes trimmed notes", () => {
    const text = buildPdfReviewText(
      doc({ metadata: { title: "T" } }),
      [
        annotation({ id: "1", pageNumber: 2, createdAt: 5, type: "note", comment: "  late  " }),
        annotation({ id: "2", pageNumber: 2, createdAt: 1, comment: "   " }),
        annotation({
          id: "3",
          pageNumber: 1,
          anchor: { quote: { exact: "first" } } as PdfAnnotation["anchor"],
        }),
      ],
      at,
    );
    expect(text).toContain("Paper: T");
    expect(text).toContain("File: refs/paper.pdf");
    expect(text).toContain("Notes: 1");
    expect(text).toContain("Highlights: 2");
    const first = text.indexOf("1. Highlight - p.1");
    const second = text.indexOf("2. Highlight - p.2");
    const third = text.indexOf("3. Note - p.2");
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    expect(text).toContain('"first"');
    expect(text.match(/Your note:/g)).toHaveLength(1);
    expect(text.endsWith("Your note:\nlate")).toBe(true);
  });

  it("uses the current time by default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at);
    expect(buildPdfReviewText(doc(), [])).toContain(at.toISOString());
  });
});

describe("downloadTextFile", () => {
  it("clicks a temporary link and revokes the object URL", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    const clicks: HTMLAnchorElement[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push(this);
      });
    try {
      downloadTextFile("r.txt", "hello");
      expect(create).toHaveBeenCalledWith(expect.any(Blob));
      expect(clicks).toHaveLength(1);
      expect(clicks[0].download).toBe("r.txt");
      expect(clicks[0].rel).toBe("noopener");
      expect(clicks[0].isConnected).toBe(false);
      expect(revoke).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(revoke).toHaveBeenCalledWith("blob:x");
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    }
  });
});
