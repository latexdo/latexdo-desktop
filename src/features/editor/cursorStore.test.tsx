import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setCursorPosition, useCursorPosition } from "./cursorStore";

function Probe() {
  const { line, column } = useCursorPosition();
  return (
    <span>
      Ln {line}, Col {column}
    </span>
  );
}

describe("cursorStore", () => {
  it("re-renders subscribers when the cursor moves", () => {
    render(<Probe />);
    act(() => setCursorPosition(12, 7));
    expect(screen.getByText("Ln 12, Col 7")).toBeVisible();
  });
});
