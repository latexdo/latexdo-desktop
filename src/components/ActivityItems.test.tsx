import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ActivityItems } from "./ActivityItems";
afterEach(() => localStorage.clear());
const items = (
  <ActivityItems>
    <button title="Explorer">Explorer</button>
    <button title="Search">Search</button>
  </ActivityItems>
);
it("reorders with the keyboard and restores the order after remount (#258)", () => {
  render(items);
  fireEvent.keyDown(screen.getByText("Search"), { altKey: true, key: "ArrowUp" });
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
    "Search",
    "Explorer",
  ]);
  cleanup();
  render(items);
  expect(screen.getAllByRole("button")[0]).toHaveTextContent("Search");
});
it("moves a dragged activity before its drop target", () => {
  render(items);
  const dataTransfer = { setData() {}, effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(screen.getByText("Search").parentElement!, { dataTransfer });
  fireEvent.drop(screen.getByText("Explorer").parentElement!, { dataTransfer });
  expect(screen.getAllByRole("button")[0]).toHaveTextContent("Search");
});

it("can drag an activity down onto its immediate neighbor", () => {
  render(items);
  const dataTransfer = { setData() {}, effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(screen.getByText("Explorer").parentElement!, { dataTransfer });
  fireEvent.drop(screen.getByText("Search").parentElement!, { dataTransfer });
  expect(screen.getAllByRole("button")[0]).toHaveTextContent("Search");
});
