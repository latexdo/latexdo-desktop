import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CitationEntry } from "../latex/latexIndex";
import { CitationSearchPopup } from "./CitationSearchPopup";

const entries: CitationEntry[] = [
  {
    key: "lovelace1843",
    type: "article",
    title: "Notes on the Analytical Engine",
    author: "Ada Lovelace",
    year: "1843",
    sourceFile: "references.bib",
  },
  {
    key: "turing1950",
    type: "article",
    title: "Computing Machinery and Intelligence",
    author: "Alan Turing",
    year: "1950",
    journal: "Mind",
    sourceFile: "references.bib",
  },
];

function renderPopup(
  overrides: Partial<Parameters<typeof CitationSearchPopup>[0]> = {},
) {
  const props = {
    anchor: { left: 100, top: 200, bottom: 218 },
    entries,
    citedKeys: new Set(["turing1950"]),
    focusRequest: 0,
    shortcutLabel: "Ctrl+Alt+C",
    onFocusHandled: vi.fn(),
    onPick: vi.fn(),
    onDismiss: vi.fn(),
    onLeave: vi.fn(),
    ...overrides,
  };
  render(<CitationSearchPopup {...props} />);
  return props;
}

describe("CitationSearchPopup", () => {
  it("starts as a compact search bar showing the bibliography size", () => {
    renderPopup();
    expect(
      screen.getByPlaceholderText("Search 2 references by title, author, year…"),
    ).toBeVisible();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("filters by title, author or year and inserts the chosen key", () => {
    const props = renderPopup();
    const input = screen.getByRole("combobox", { name: "Search bibliography" });
    fireEvent.focus(input);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByText("cited")).toBeVisible();

    fireEvent.change(input, { target: { value: "machinery 1950" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("turing1950");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onPick).toHaveBeenCalledWith(entries[1]);
  });

  it("moves through results with the arrow keys and closes on Escape", () => {
    const props = renderPopup();
    const input = screen.getByRole("combobox", { name: "Search bibliography" });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(props.onDismiss).toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("takes focus when the editor shortcut requests it", () => {
    const props = renderPopup({ focusRequest: 1 });
    expect(screen.getByRole("combobox", { name: "Search bibliography" })).toHaveFocus();
    expect(props.onFocusHandled).toHaveBeenCalled();
  });

  it("explains an empty result", () => {
    renderPopup();
    const input = screen.getByRole("combobox", { name: "Search bibliography" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "zzzzqqqq" } });
    expect(screen.getByText(/No references match/)).toBeVisible();
  });

  it("opens on the recent references of this paper and the text already typed", () => {
    renderPopup({
      readContext: () => ({ recentKeys: ["lovelace1843"], sentence: "", query: "" }),
    });
    const input = screen.getByRole("combobox", { name: "Search bibliography" });
    fireEvent.focus(input);
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("lovelace1843");
    expect(options[0]).toHaveTextContent("📌 recent");
  });

  it("starts the search from the key fragment typed in \\cite{}", () => {
    renderPopup({
      readContext: () => ({ recentKeys: [], sentence: "", query: "tur" }),
    });
    const input = screen.getByRole("combobox", { name: "Search bibliography" });
    fireEvent.focus(input);
    expect(input).toHaveValue("tur");
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("warns when a reference may not fit the sentence being written", () => {
    renderPopup({
      readContext: () => ({
        recentKeys: [],
        sentence:
          "Transformer attention scales quadratically with sequence length in language modelling benchmarks",
        query: "",
      }),
    });
    fireEvent.focus(screen.getByRole("combobox", { name: "Search bibliography" }));
    expect(screen.getByRole("status")).toHaveTextContent("⚠️ May not fit here");
  });

  it("moves between lists with Tab and adds an online paper to the bibliography", async () => {
    vi.useFakeTimers();
    try {
      const paper = {
        provider: "Crossref" as const,
        title: "Attention Is All You Need",
        authors: ["Ashish Vaswani"],
        year: 2017,
        doi: "10.5555/attention",
      };
      const onSearchOnline = vi.fn().mockResolvedValue([paper]);
      const onAddOnline = vi.fn();
      renderPopup({ onSearchOnline, onAddOnline });
      const input = screen.getByRole("combobox", { name: "Search bibliography" });
      fireEvent.focus(input);
      expect(screen.getByRole("tab", { name: "📚 Library" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      fireEvent.keyDown(input, { key: "Tab" });
      expect(screen.getByRole("tab", { name: "📌 Recent" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
      fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
      expect(screen.getByRole("tab", { name: "🌐 Online" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      fireEvent.change(input, { target: { value: "attention" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(onSearchOnline).toHaveBeenCalledWith("attention", expect.any(AbortSignal));
      expect(screen.getByRole("option")).toHaveTextContent("🌐 Crossref");
      expect(screen.getByRole("option")).toHaveTextContent("＋ new entry");
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
      });
      expect(onAddOnline).toHaveBeenCalledWith(paper);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cites the library copy when an online paper is already in the bibliography", async () => {
    vi.useFakeTimers();
    try {
      const props = renderPopup({
        onSearchOnline: vi.fn().mockResolvedValue([
          {
            provider: "OpenAlex",
            title: "Computing Machinery and Intelligence",
            authors: ["Alan Turing"],
            year: 1950,
          },
        ]),
        onAddOnline: vi.fn(),
      });
      const input = screen.getByRole("combobox", { name: "Search bibliography" });
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "4", ctrlKey: true });
      fireEvent.change(input, { target: { value: "turing" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(screen.getByRole("option")).toHaveTextContent("in library");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(props.onPick).toHaveBeenCalledWith(entries[1]);
      expect(props.onAddOnline).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
