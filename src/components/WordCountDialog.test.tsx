import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WordCountDialog } from "./WordCountDialog";
import { countLatexWords } from "../latex/wordCount";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    }),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("highlights the selected section, explains totals and navigates to its source", () => {
  const source = String.raw`\begin{abstract}Two words\end{abstract}
\section{Methods}Some text.
\subsection{Data}More text.`;
  const onClose = vi.fn(),
    onNavigate = vi.fn();
  render(
    <WordCountDialog
      open
      fileName="main.tex"
      counts={countLatexWords(source)}
      projectFiles={[
        { path: "main.tex", words: 8 },
        { path: "chapter.tex", words: 12 },
      ]}
      projectLoading={false}
      offset={source.indexOf("\\subsection")}
      abstractLimit={1}
      onClose={onClose}
      onNavigate={onNavigate}
    />,
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByText("1 word target · 1 over")).toBeInTheDocument();
  expect(screen.getByText(/Project TeX source: 20 words/)).toBeInTheDocument();
  expect(screen.getByText("How counting works")).toBeInTheDocument();
  const row = screen.getByRole("button", { name: /subsection · line 3 Data 3 words/ });
  expect(row).toHaveAttribute("data-current", "true");
  fireEvent.click(row);
  expect(onClose).toHaveBeenCalledOnce();
  expect(onNavigate).toHaveBeenCalledWith(3, 1);
});

it("updates abstract and total counts when the source changes", () => {
  const props = {
    open: true,
    fileName: "main.tex",
    projectFiles: [],
    projectLoading: false,
    offset: null,
    abstractLimit: 250,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
  };
  const { rerender } = render(
    <WordCountDialog {...props} counts={countLatexWords("plain text")} />,
  );
  expect(screen.getByText("No abstract in this file")).toBeInTheDocument();
  rerender(
    <WordCountDialog
      {...props}
      counts={countLatexWords(String.raw`\abstract{One two three}`)}
    />,
  );
  expect(screen.queryByText("No abstract in this file")).not.toBeInTheDocument();
  expect(screen.getAllByText("3")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Close word count" }));
  expect(props.onClose).toHaveBeenCalledOnce();
});
