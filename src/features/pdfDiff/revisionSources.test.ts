import { describe, expect, it, vi } from "vitest";
import type { GitDiffSession } from "../../types";
import {
  RevisionCompileError,
  choiceLabel,
  compiledPdfForRevision,
  compiledPdfSidesForSession,
  isPdfPath,
  resolveChoices,
  trackedPdfSides,
} from "./revisionSources";

const pdf = (value: number) => new Uint8Array([value]);

function api(
  overrides: Partial<
    Record<"compileGitRevisionPdf" | "readGitRevisionPdf", unknown>
  > = {},
) {
  return {
    compileGitRevisionPdf: vi.fn(
      async (_request: unknown, ref: { kind: string; hash?: string }) => ({
        ok: true,
        pdf: pdf(ref.kind === "index" ? 9 : 1),
        output: "",
        cached: false,
        skipped: [],
      }),
    ),
    readGitRevisionPdf: vi.fn(async () => pdf(5)),
    ...overrides,
  } as never;
}

const context = {
  projectId: "p1",
  rootFile: "main.tex",
  engine: "pdflatex" as const,
  currentPdf: pdf(7),
};

const session: GitDiffSession = {
  id: "s",
  relativePath: "out/paper.pdf",
  oldPath: "paper.pdf",
  originalRef: { kind: "commit", hash: "a".repeat(40) },
  modifiedRef: { kind: "working-tree" },
  originalContent: "",
  modifiedContent: "",
  originalLabel: "aaaaaaa",
  modifiedLabel: "Working Tree",
  originalShortHash: "aaaaaaa",
  originalAuthor: "Ada",
  modifiedAuthor: "Ada",
  status: "renamed",
  language: "plaintext",
  binary: true,
};

describe("revision sources", () => {
  it("recognises PDF paths", () => {
    expect(isPdfPath("a/b.PDF")).toBe(true);
    expect(isPdfPath("main.tex")).toBe(false);
  });

  it("labels each kind of choice", () => {
    expect(choiceLabel({ kind: "current" })).toBe("Current PDF");
    expect(choiceLabel({ kind: "file", name: "x.pdf", data: pdf(1) })).toBe("x.pdf");
    expect(
      choiceLabel({
        kind: "revision",
        ref: { kind: "index" },
        label: "Staged changes",
      }),
    ).toBe("Staged changes");
  });

  it("uses the current PDF for the working tree and compiles revisions", async () => {
    const client = api();
    await expect(
      compiledPdfForRevision(client, context, { kind: "working-tree" }, "Now"),
    ).resolves.toMatchObject({ label: "Now", data: context.currentPdf });
    await expect(
      compiledPdfForRevision(client, context, { kind: "empty" }, "Empty"),
    ).resolves.toMatchObject({ data: null, emptyMessage: "This version has no PDF." });
    const compiled = await compiledPdfForRevision(
      client,
      context,
      { kind: "commit", hash: "b".repeat(40) },
      "bbbbbbb",
      "Ada",
    );
    expect([...compiled.data!]).toEqual([1]);
    expect(compiled.detail).toBe("Ada");
    expect(
      (client as { compileGitRevisionPdf: ReturnType<typeof vi.fn> })
        .compileGitRevisionPdf,
    ).toHaveBeenCalledWith(
      { projectId: "p1", rootFile: "main.tex", engine: "pdflatex" },
      { kind: "commit", hash: "b".repeat(40) },
    );
  });

  it("asks for a compile when there is no current PDF", async () => {
    await expect(
      compiledPdfForRevision(
        api(),
        { ...context, currentPdf: null },
        { kind: "working-tree" },
        "Now",
      ),
    ).rejects.toThrow("Compile the project first");
  });

  it("reports a revision that fails to compile with its log", async () => {
    const client = api({
      compileGitRevisionPdf: vi.fn(async () => ({
        ok: false,
        output: "! LaTeX Error",
        cached: false,
        skipped: [],
      })),
    });
    const error = await compiledPdfForRevision(
      client,
      context,
      { kind: "index" },
      "Index",
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RevisionCompileError);
    expect((error as RevisionCompileError).message).toBe(
      "Index: the revision did not compile.",
    );
    expect((error as RevisionCompileError).output).toBe("! LaTeX Error");
  });

  it("resolves the picker's choices in order", async () => {
    const sides = await resolveChoices(
      api(),
      context,
      { kind: "revision", ref: { kind: "index" }, label: "Staged changes" },
      { kind: "file", name: "draft.pdf", data: pdf(3) },
    );
    expect(sides.original).toMatchObject({
      label: "Staged changes",
      detail: "Compiled from staged files",
    });
    expect([...sides.original.data!]).toEqual([9]);
    expect(sides.modified).toMatchObject({ label: "draft.pdf", detail: "PDF file" });

    const current = await resolveChoices(
      api(),
      context,
      {
        kind: "revision",
        ref: { kind: "commit", hash: "c".repeat(40) },
        label: "ccccccc",
      },
      { kind: "current" },
    );
    expect(current.original.detail).toBe("Compiled from Git");
    expect(current.modified.label).toBe("Current PDF");
  });

  it("reads both versions of a tracked PDF, following renames", async () => {
    const readGitRevisionPdf = vi.fn(async (_id: string, path: string) =>
      path === "paper.pdf" ? pdf(1) : null,
    );
    const sides = await trackedPdfSides(api({ readGitRevisionPdf }), "p1", session);
    expect(readGitRevisionPdf).toHaveBeenCalledWith(
      "p1",
      "paper.pdf",
      session.originalRef,
    );
    expect(readGitRevisionPdf).toHaveBeenCalledWith(
      "p1",
      "out/paper.pdf",
      session.modifiedRef,
    );
    expect(sides.original).toMatchObject({ label: "aaaaaaa", detail: "aaaaaaa · Ada" });
    expect(sides.modified).toMatchObject({
      data: null,
      emptyMessage: "The PDF does not exist in this version.",
    });

    const added = await trackedPdfSides(api(), "p1", {
      ...session,
      oldPath: undefined,
      originalRef: { kind: "empty" },
    });
    expect(added.original.data).toBeNull();
  });

  it("compiles both sides of a source diff", async () => {
    const sides = await compiledPdfSidesForSession(api(), context, {
      ...session,
      relativePath: "main.tex",
      originalRef: { kind: "index" },
      modifiedRef: { kind: "working-tree" },
      originalLabel: "Index",
      originalShortHash: undefined,
      originalAuthor: undefined,
    });
    expect([...sides.original.data!]).toEqual([9]);
    expect(sides.original.detail).toBeUndefined();
    expect(sides.modified.data).toBe(context.currentPdf);
    expect(sides.modified.detail).toBe("Ada");
  });
});
