import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fallbackExtensionCatalog, validateExtensionCatalog } from "../extensions";
import {
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
