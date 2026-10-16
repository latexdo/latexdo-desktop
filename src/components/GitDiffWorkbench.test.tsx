import { render, screen } from "@testing-library/react";
import type { DiffEditorProps } from "@monaco-editor/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitBlameLine, GitDiffSession } from "../types";
import {
  GitDiffWorkbench,
  createGitModelUri,
  gitDiffTabLabel,
} from "./GitDiffWorkbench";

const diffMock = vi.hoisted(() => ({
  props: null as DiffEditorProps | null,
}));

vi.mock("./MonacoEditor", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    MonacoDiffEditor: (props: DiffEditorProps) => {
      diffMock.props = props;
      return React.createElement("div", { "data-testid": "mock-diff-editor" });
    },
  };
});

const session: GitDiffSession = {
  id: "main.tex:index-to-worktree:1",
  relativePath: "chapters/main.tex",
  originalRef: { kind: "index" },
  modifiedRef: { kind: "working-tree" },
  originalContent: "one\ntwo\nthree\n",
  modifiedContent: "one\nchanged\nthree\n",
  originalLabel: "Index",
  modifiedLabel: "Working Tree",
  originalAuthor: "Omar",
  originalDate: "2026-07-09T09:00:00.000Z",
  status: "modified",
  language: "latex",
};

describe("GitDiffWorkbench", () => {
  beforeEach(() => {
    diffMock.props = null;
  });

  it("uses stable revision models and forces a side-by-side Monaco diff", async () => {
    render(<GitDiffWorkbench session={session} theme="latexdo-dark" fontSize={13} />);

    expect(await screen.findByTestId("mock-diff-editor")).toBeVisible();
    expect(screen.getByText(gitDiffTabLabel(session))).toBeVisible();
    expect(diffMock.props?.original).toBe(session.originalContent);
    expect(diffMock.props?.modified).toBe(session.modifiedContent);
    expect(diffMock.props?.originalModelPath).toContain("chapters/main.tex");
    expect(diffMock.props?.originalModelPath).toContain("index%3A");
    expect(diffMock.props?.modifiedModelPath).toContain("working-tree%3A");
    expect(diffMock.props?.options).toMatchObject({
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
      splitViewDefaultRatio: 0.5,
      renderOverviewRuler: true,
    });
    expect(createGitModelUri("a file.tex", "commit:abc123")).toBe(
      "git://latexdo/a%20file.tex?revision=commit%3Aabc123",
    );
  });

  it("shows a binary fallback without mounting Monaco", () => {
    render(
      <GitDiffWorkbench
        session={{ ...session, binary: true, message: "Binary files differ" }}
        theme="latexdo-dark"
        fontSize={13}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Binary files differ");
    expect(screen.queryByTestId("mock-diff-editor")).not.toBeInTheDocument();
    expect(diffMock.props).toBeNull();
  });

  it("adds blame only to unchanged modified-side lines", async () => {
    const blameLines: GitBlameLine[] = [
      {
        line: 1,
        hash: "aaaaaaaa",
        shortHash: "aaaaaaa",
        author: "Ada",
        authorTime: "2026-07-01T09:00:00.000Z",
        summary: "First line",
      },
      {
        line: 2,
        hash: "bbbbbbbb",
        shortHash: "bbbbbbb",
        author: "Grace",
        authorTime: "2026-07-02T09:00:00.000Z",
        summary: "Changed line",
      },
      {
        line: 3,
        hash: "cccccccc",
        shortHash: "ccccccc",
        author: "Linus",
        authorTime: "2026-07-03T09:00:00.000Z",
        summary: "Context line",
      },
    ];
    type TestDecoration = {
      range: { startLineNumber: number };
      options: { after: { inlineClassName: string } };
    };
    const createDecorationsCollection = vi.fn((_decorations: TestDecoration[]) => ({
      clear: vi.fn(),
      set: vi.fn(),
    }));
    const fakeEditor = {
      getModifiedEditor: () => ({
        getModel: () => ({ getLineCount: () => 3 }),
        createDecorationsCollection,
      }),
      getLineChanges: () => [
        {
          originalStartLineNumber: 2,
          originalEndLineNumber: 2,
          modifiedStartLineNumber: 2,
          modifiedEndLineNumber: 2,
        },
      ],
      onDidUpdateDiff: vi.fn(() => ({ dispose: vi.fn() })),
    };

    render(
      <GitDiffWorkbench
        session={session}
        theme="latexdo-dark"
        fontSize={13}
        blameLines={blameLines}
      />,
    );
    await screen.findByTestId("mock-diff-editor");
    const mount = diffMock.props?.onMount as unknown as (
      editor: unknown,
      monacoInstance: unknown,
    ) => void;
    mount(fakeEditor, {});

    const decorations = createDecorationsCollection.mock.calls[0]?.[0] ?? [];
    expect(decorations).toHaveLength(2);
    expect(decorations.map((decoration) => decoration.range.startLineNumber)).toEqual([
      1, 3,
    ]);
    expect(decorations[0].options.after.inlineClassName).toBe("git-blame-inline");
  });
});
