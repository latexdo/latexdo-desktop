import { expect, it } from "vitest";
import { removeUnusedBibliography } from "./removeUnusedBibliography";

it("removes only uncited entries while preserving comments, macros and nested fields (#247)", () => {
  const bib =
    '% Keep this note\n@string{venue = "Conference"}\n@article{used, title={A {nested} title}}\n@article{unused, title={Other}}\n';
  const result = removeUnusedBibliography([
    { path: "main.tex", content: "\\cite{used}" },
    { path: "refs.bib", content: bib },
  ]);
  expect(result[0].removed).toEqual(["unused"]);
  expect(result[0].content).toContain(
    '% Keep this note\n@string{venue = "Conference"}',
  );
  expect(result[0].content).toContain("@article{used, title={A {nested} title}}");
  expect(result[0].content).not.toContain("@article{unused");
});
it("keeps nocite entries and bibliography inheritance dependencies", () => {
  const result = removeUnusedBibliography([
    { path: "main.tex", content: "\\cite{child}\\nocite{extra}" },
    {
      path: "refs.bib",
      content:
        "@inproceedings{child, crossref={parent}}\n@book{parent,title={Book}}\n@misc{extra,title={Extra}}\n@misc{unused,title={Unused}}",
    },
  ]);
  expect(result[0].removed).toEqual(["unused"]);
});
it("does not prune a bibliography included with nocite star", () => {
  expect(
    removeUnusedBibliography([
      { path: "main.tex", content: "\\nocite{*}" },
      { path: "refs.bib", content: "@misc{keep,title={Keep}}" },
    ]),
  ).toEqual([]);
});

it("preserves additional multicite arguments and custom citation macros", () => {
  expect(
    removeUnusedBibliography([
      { path: "main.tex", content: "\\cites{first}{second} \\myreference{third}" },
      {
        path: "refs.bib",
        content:
          "@misc{first,title={One}}\n@misc{second,title={Two}}\n@misc{third,title={Three}}",
      },
    ]),
  ).toEqual([]);
});
