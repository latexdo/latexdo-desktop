import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  fallbackExtensionCatalog,
  validateExtensionCatalog,
  type LatexDoExtensionManifest,
} from "../extensions";
import {
  ExtensionIcon,
  ExtensionPreview,
  snippetPreviewText,
  templateLayout,
} from "./ExtensionPreview";

describe("extension previews", () => {
  it("gives every built-in extension a preview of what it does", () => {
    for (const extension of fallbackExtensionCatalog.extensions) {
      const { unmount } = render(<ExtensionPreview extension={extension} />);
      expect(screen.getByRole("figure", { name: /Preview:/ })).toBeInTheDocument();
      unmount();
    }
  });

  it("draws a template's own first page", () => {
    const layout = templateLayout(
      "\\documentclass[conference]{IEEEtran}\n\\title{Fast {Graph} Search}\n\\begin{abstract}x\\end{abstract}\n\\section{Introduction}\\section{Results}\\begin{table}\\end{table}\\bibliography{refs}",
    );
    expect(layout).toMatchObject({
      title: "Fast Graph Search",
      shape: "paper",
      twoColumn: true,
      sections: ["Introduction", "Results"],
      hasAbstract: true,
      hasTable: true,
      hasReferences: true,
    });
    expect(templateLayout("\\documentclass{beamer}").shape).toBe("slides");
    expect(templateLayout("\\documentclass[a0paper]{tikzposter}").shape).toBe("poster");
  });

  it("shows a snippet as it reads once inserted", () => {
    expect(snippetPreviewText("\\\\caption{${1:Caption.}\\}\n\\\\label{fig:$2}")).toBe(
      "\\caption{Caption.}\n\\label{fig:}",
    );
  });

  it("accepts screenshots only from latexdo.org", () => {
    const base = fallbackExtensionCatalog.extensions.find(
      (extension) => extension.id === "latexdo.plots",
    )!;
    const catalog = validateExtensionCatalog({
      ...fallbackExtensionCatalog,
      extensions: [
        {
          ...base,
          screenshots: [
            { url: "https://latexdo.org/store/shots/plots.gif", caption: "Line plot" },
            { url: "https://evil.example/x.png" },
            { url: "http://latexdo.org/insecure.png" },
          ],
        },
      ],
    });
    expect(catalog!.extensions[0]!.screenshots).toEqual([
      { url: "https://latexdo.org/store/shots/plots.gif", caption: "Line plot" },
    ]);
  });
});

function manifest(
  contributes: LatexDoExtensionManifest["contributes"],
  category = "writing",
): LatexDoExtensionManifest {
  return {
    schemaVersion: 1,
    id: "test.ext",
    kind: "extension",
    name: "Test",
    version: "1.0.0",
    description: "",
    author: "",
    category: category as LatexDoExtensionManifest["category"],
    tags: [],
    contributes,
  };
}

describe("extension preview variants", () => {
  it("shows the generic icon for unknown categories and honours the size", () => {
    const { container, rerender } = render(
      <ExtensionIcon extension={manifest({}, "mystery")} size={12} />,
    );
    expect(container.querySelector(".extension-icon-mystery svg")).toHaveAttribute(
      "width",
      "12",
    );
    rerender(<ExtensionIcon extension={manifest({}, "writing")} />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "20");
  });

  it("renders nothing for an extension with nothing to show", () => {
    const { container } = render(<ExtensionPreview extension={manifest({})} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists what a checking extension checks", () => {
    render(
      <ExtensionPreview
        extension={manifest({
          featureFlags: { checkPageCount: true, acronymManagerEnabled: true },
        })}
      />,
    );
    expect(
      screen.getByRole("figure", { name: "Preview: What it checks in your paper" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Check Page Count")).toBeInTheDocument();
    expect(screen.getByText("Acronym Manager")).toBeInTheDocument();
  });

  it("cycles through several snippets and stays put with one", () => {
    vi.useFakeTimers();
    try {
      const { container, unmount } = render(
        <ExtensionPreview
          extension={manifest({
            snippets: [
              { label: "fig", insertText: "\\begin{figure}\n\n\\end{figure}" },
              { label: "tab", insertText: "\\begin{table}" },
            ],
          })}
        />,
      );
      expect(container.querySelector(".xp-typed")).toHaveTextContent("fig");
      expect(container.querySelectorAll(".xp-dots span")).toHaveLength(2);
      act(() => {
        vi.advanceTimersByTime(4200);
      });
      expect(container.querySelector(".xp-typed")).toHaveTextContent("tab");
      act(() => {
        vi.advanceTimersByTime(4200);
      });
      expect(container.querySelector(".xp-typed")).toHaveTextContent("fig");
      unmount();

      const single = render(
        <ExtensionPreview
          extension={manifest({ snippets: [{ label: "eq", insertText: "x" }] })}
        />,
      );
      expect(single.container.querySelector(".xp-dots")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws posters in two columns with figures and recognises CVs", () => {
    const { container } = render(
      <ExtensionPreview
        extension={manifest({
          templates: [
            {
              id: "poster",
              name: "Poster",
              summary: "",
              files: "",
              mainTex:
                "\\documentclass{tikzposter}\\section{A}\\section{B}\\section{C}\\includegraphics{x}\\begin{tabular}",
            },
          ],
        })}
      />,
    );
    expect(container.querySelector(".xp-page-poster .xp-body.two")).not.toBeNull();
    expect(container.querySelectorAll(".xp-column")).toHaveLength(2);
    expect(container.querySelector(".xp-figure")).not.toBeNull();
    expect(container.querySelector(".xp-table")).not.toBeNull();
    expect(screen.getByText("The first page of “Poster”")).toBeInTheDocument();

    expect(templateLayout("\\documentclass{moderncv}").shape).toBe("cv");
    const plain = templateLayout("no class here \\twocolumn");
    expect(plain).toMatchObject({ shape: "paper", twoColumn: true, title: "Untitled" });
  });

  it("uses default sections for a single-column template without any", () => {
    const { container } = render(
      <ExtensionPreview
        extension={manifest({
          templates: [
            {
              id: "t",
              name: "Bare",
              summary: "",
              files: "",
              mainTex: "\\documentclass{article}",
            },
          ],
        })}
      />,
    );
    expect(container.querySelector(".xp-body.two")).toBeNull();
    expect(screen.getByText("Introduction")).toBeInTheDocument();
    expect(screen.getByText("Method")).toBeInTheDocument();
  });
});
