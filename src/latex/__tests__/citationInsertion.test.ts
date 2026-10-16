import { describe, expect, it } from "vitest";
import { buildCitationInsertion, planCitationInsertion } from "../citationInsertion";

function applyPlan(text: string, offset: number, key: string): string {
  const plan = planCitationInsertion(text, offset, "citep", [key]);
  if (!plan) return text;
  return (
    text.slice(0, plan.rangeStartOffset) + plan.text + text.slice(plan.rangeEndOffset)
  );
}

describe("citationInsertion", () => {
  it("builds a basic citation insertion", () => {
    expect(buildCitationInsertion("parencite", ["vaswani2017"])).toBe(
      "\\parencite{vaswani2017}",
    );
  });

  it("inserts before terminal punctuation when the cursor is after it", () => {
    const text = "Transformers replace recurrent computation with self-attention.";

    expect(applyPlan(text, text.length, "vaswani2017")).toBe(
      "Transformers replace recurrent computation with self-attention \\citep{vaswani2017}.",
    );
  });

  it("merges with an adjacent compatible citation", () => {
    const text = "This method is efficient \\citep{smith2024}.";

    expect(applyPlan(text, text.length, "jones2025")).toBe(
      "This method is efficient \\citep{smith2024,jones2025}.",
    );
  });

  it("does not insert a key already present in the adjacent citation", () => {
    const text = "This method is efficient \\citep{smith2024}.";

    expect(applyPlan(text, text.length, "smith2024")).toBe(text);
  });

  it("does not merge optional-argument citations", () => {
    const text = "This is related \\citep[see][p.~4]{smith2024}.";

    expect(applyPlan(text, text.length, "jones2025")).toBe(
      "This is related \\citep[see][p.~4]{smith2024} \\citep{jones2025}.",
    );
  });
});
