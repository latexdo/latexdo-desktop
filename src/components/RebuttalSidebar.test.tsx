import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RebuttalSidebar } from "./RebuttalSidebar";
import type { RebuttalItem } from "../types";

const item: RebuttalItem = {
  id: "item-1",
  reviewer: "Reviewer 2",
  originalText: "Original manuscript sentence.",
  reviewerComment: "Reviewer asks for more detail.",
  authorComment: "We added the requested explanation.",
  modificationMade: "Revised manuscript sentence.",
  revisedText: "Revised manuscript sentence.",
  insertedInTex: false,
};

function renderSidebar(
  props: Partial<React.ComponentProps<typeof RebuttalSidebar>> = {},
) {
  return render(
    <RebuttalSidebar
      items={[item]}
      onAddItem={vi.fn()}
      onAddRebuttalToSource={vi.fn()}
      onUpdateItem={vi.fn()}
      onDeleteItem={vi.fn()}
      {...props}
    />,
  );
}

describe("RebuttalSidebar", () => {
  it("adds comments, and says where the letter is saved", () => {
    const onAddItem = vi.fn();
    const onAddRebuttalToSource = vi.fn();
    const onGenerateLetter = vi.fn();
    renderSidebar({
      items: [],
      onAddItem,
      onAddRebuttalToSource,
      onGenerateLetter,
    });

    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
    fireEvent.click(screen.getByRole("button", { name: /add comment on selection/i }));
    expect(onAddItem).toHaveBeenCalledTimes(1);
    expect(onAddRebuttalToSource).toHaveBeenCalledTimes(1);

    const letter = screen.getByRole("region", { name: "Response letter" });
    expect(letter).toHaveTextContent(
      "Will be saved as rebuttal-letter.tex in your project folder",
    );
    // Nothing to write yet.
    expect(screen.getByRole("button", { name: /create letter/i })).toBeDisabled();
    expect(screen.getByText(/No reviewer comments yet/i)).toBeVisible();
  });

  it("creates, updates and opens the letter", () => {
    const onGenerateLetter = vi.fn();
    const onOpenLetter = vi.fn();
    const { rerender } = renderSidebar({ onGenerateLetter, onOpenLetter });

    fireEvent.click(screen.getByRole("button", { name: /create letter/i }));
    expect(onGenerateLetter).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();

    rerender(
      <RebuttalSidebar
        items={[item]}
        onAddItem={vi.fn()}
        onAddRebuttalToSource={vi.fn()}
        onUpdateItem={vi.fn()}
        onDeleteItem={vi.fn()}
        onGenerateLetter={onGenerateLetter}
        letterExists
        letterPath="rebuttal-letter-2.tex"
        onOpenLetter={onOpenLetter}
      />,
    );
    expect(screen.getByRole("region", { name: "Response letter" })).toHaveTextContent(
      "Saved as rebuttal-letter-2.tex in your project folder",
    );
    fireEvent.click(screen.getByRole("button", { name: /update letter/i }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onGenerateLetter).toHaveBeenCalledTimes(2);
    expect(onOpenLetter).toHaveBeenCalledTimes(1);
  });

  it("numbers comments by reviewer, like the letter", () => {
    renderSidebar({
      items: [
        { ...item, id: "a", reviewer: "Reviewer 1" },
        { ...item, id: "b", reviewer: "Reviewer 2" },
        { ...item, id: "c", reviewer: "Reviewer 1" },
      ],
    });
    expect(screen.getByText("Reviewer 1 · Comment 1.1")).toBeVisible();
    expect(screen.getByText("Reviewer 1 · Comment 1.2")).toBeVisible();
    expect(screen.getByText("Reviewer 2 · Comment 2.1")).toBeVisible();
  });

  it("updates and deletes every field of a comment", () => {
    const onUpdateItem = vi.fn();
    const onDeleteItem = vi.fn();
    renderSidebar({ onUpdateItem, onDeleteItem });

    fireEvent.change(screen.getByLabelText("Reviewer"), {
      target: { value: "Editor" },
    });
    fireEvent.change(screen.getByLabelText("Reviewer's comment"), {
      target: { value: "Updated review." },
    });
    fireEvent.change(screen.getByLabelText("Your response"), {
      target: { value: "Updated answer." },
    });
    fireEvent.change(screen.getByLabelText(/Original text/), {
      target: { value: "Updated source text." },
    });
    fireEvent.change(screen.getByLabelText(/Revised text/), {
      target: { value: "Updated revision." },
    });

    expect(onUpdateItem).toHaveBeenCalledWith("item-1", { reviewer: "Editor" });
    expect(onUpdateItem).toHaveBeenCalledWith("item-1", {
      reviewerComment: "Updated review.",
    });
    expect(onUpdateItem).toHaveBeenCalledWith("item-1", {
      authorComment: "Updated answer.",
    });
    expect(onUpdateItem).toHaveBeenCalledWith("item-1", {
      originalText: "Updated source text.",
    });
    expect(onUpdateItem).toHaveBeenCalledWith("item-1", {
      revisedText: "Updated revision.",
      modificationMade: "Updated revision.",
    });
    // Whether an item is in the TeX source is a fact, not a switch.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("Notes only")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /delete rebuttal item/i }));
    expect(onDeleteItem).toHaveBeenCalledWith("item-1");
  });

  it("offers to mark a notes-only comment at the editor selection", () => {
    const onInsertItemIntoTex = vi.fn();
    const { rerender } = renderSidebar({ onInsertItemIntoTex });

    fireEvent.click(screen.getByRole("button", { name: /mark selected text in tex/i }));
    expect(onInsertItemIntoTex).toHaveBeenCalledWith("item-1");

    rerender(
      <RebuttalSidebar
        items={[{ ...item, insertedInTex: true }]}
        onAddItem={vi.fn()}
        onAddRebuttalToSource={vi.fn()}
        onUpdateItem={vi.fn()}
        onDeleteItem={vi.fn()}
        onInsertItemIntoTex={onInsertItemIntoTex}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /mark selected text in tex/i }),
    ).toBeNull();
    expect(screen.getByText("Marked in TeX")).toBeVisible();
  });
});

describe("RebuttalSidebar fallbacks", () => {
  it("falls back to the default reviewer, empty original text and the legacy modification", () => {
    renderSidebar({
      items: [
        {
          ...item,
          reviewer: undefined,
          originalText: undefined,
          revisedText: undefined,
          modificationMade: "Legacy change.",
        },
      ],
    });
    const reviewer = screen.getByLabelText("Reviewer") as HTMLInputElement;
    expect(reviewer.value).toBe(reviewer.placeholder);
    expect(reviewer.value).not.toBe("");
    expect((screen.getByLabelText(/Original text/) as HTMLTextAreaElement).value).toBe(
      "",
    );
    expect((screen.getByLabelText(/Revised text/) as HTMLTextAreaElement).value).toBe(
      "Legacy change.",
    );
  });
});
