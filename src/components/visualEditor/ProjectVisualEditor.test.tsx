import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectEntry } from "../../types";
import { ProjectVisualEditor } from "./ProjectVisualEditor";

const captured = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("../VisualLatexEditor", () => ({
  VisualLatexEditor: (props: Record<string, unknown>) => {
    captured.props = props;
    return <div data-testid="editor" />;
  },
}));

const latexdo = {
  readAsset: vi.fn(),
  getDroppedFilePaths: vi.fn(),
  createFolder: vi.fn(),
};

const entries: ProjectEntry[] = [
  { name: "main.tex", path: "/p/main.tex", relativePath: "main.tex", type: "file" },
  {
    name: "plot.png",
    path: "/p/figures/plot.png",
    relativePath: "figures/plot.png",
    type: "file",
  },
];

function setup(projectId: string | null = "p1") {
  const importExternalFilePaths = vi.fn(async () => [
    { relativePath: "figures/a.png", type: "file" as const },
    { relativePath: "figures/notes.txt", type: "file" as const },
  ]);
  render(
    <ProjectVisualEditor
      projectId={projectId}
      documentPath="chapters/intro.tex"
      content="x"
      readOnly={false}
      projectEntries={entries}
      onChange={vi.fn()}
      importExternalFilePaths={importExternalFilePaths as never}
    />,
  );
  return {
    props: captured.props as Record<string, (...args: never[]) => unknown>,
    importExternalFilePaths,
  };
}

beforeEach(() => {
  (window as unknown as { latexdo: unknown }).latexdo = latexdo;
  latexdo.readAsset.mockReset();
  latexdo.getDroppedFilePaths.mockReset();
  latexdo.createFolder.mockReset().mockResolvedValue(undefined);
});

describe("ProjectVisualEditor", () => {
  it("loads figures from the project, trying each place, and caches them", async () => {
    const { props } = setup();
    expect(screen.getByTestId("editor")).toBeInTheDocument();
    latexdo.readAsset.mockImplementation(async (_id: string, path: string) => {
      if (path === "figures/plot.png") return new Uint8Array([1, 2]);
      throw new Error("missing");
    });
    const load = props.loadImage as (path: string) => Promise<unknown>;
    expect(await load("figures/plot")).toEqual({
      kind: "image",
      url: "data:image/png;base64,AQI=",
    });
    const calls = latexdo.readAsset.mock.calls.length;
    await load("figures/plot");
    expect(latexdo.readAsset.mock.calls.length).toBe(calls);
    latexdo.readAsset.mockResolvedValueOnce(new Uint8Array([3]));
    expect(await load("figures/doc.pdf")).toEqual({
      kind: "pdf",
      data: new Uint8Array([3]),
    });
    latexdo.readAsset.mockRejectedValue(new Error("missing"));
    expect(await load("figures/none")).toBeNull();
  });

  it("imports dropped images into figures/", async () => {
    const { props, importExternalFilePaths } = setup();
    const importImages = props.importImages as (files: File[]) => Promise<string[]>;
    latexdo.getDroppedFilePaths.mockReturnValueOnce([]);
    expect(await importImages([])).toEqual([]);
    latexdo.getDroppedFilePaths.mockReturnValueOnce(["/tmp/a.png"]);
    latexdo.createFolder.mockRejectedValueOnce(new Error("exists"));
    expect(await importImages([new File(["x"], "a.png")])).toEqual(["figures/a.png"]);
    expect(importExternalFilePaths).toHaveBeenCalledWith(["/tmp/a.png"], "figures");
  });

  it("turns project files dragged from the tree into LaTeX", () => {
    const { props } = setup();
    const latexFor = props.latexForProjectFile as (path: string) => string | null;
    expect(latexFor("/p/figures/plot.png")).toContain("\\includegraphics");
    expect(latexFor("/p/missing.tex")).toBeNull();
    expect((props.figureSource as (path: string) => string)("figures/x.png")).toContain(
      "figures/x.png",
    );
  });

  it("works without a project", async () => {
    const { props } = setup(null);
    expect(props.loadImage).toBeUndefined();
    expect(props.importImages).toBeUndefined();
  });
});
