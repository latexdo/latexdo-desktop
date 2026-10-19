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

const order = () => screen.getAllByRole("button").map((button) => button.textContent);

it("ignores unreadable or non-array saved orders and non-string ids", () => {
  localStorage.setItem("latexdo.activity-order.v1", "{not json");
  render(items);
  expect(order()).toEqual(["Explorer", "Search"]);
  cleanup();
  localStorage.setItem("latexdo.activity-order.v1", '{"a":1}');
  render(items);
  expect(order()).toEqual(["Explorer", "Search"]);
  cleanup();
  localStorage.setItem("latexdo.activity-order.v1", '[3,"Search"]');
  render(items);
  expect(order()).toEqual(["Search", "Explorer"]);
});

it("moves down with Alt+ArrowDown and ignores other keys and edges", () => {
  render(items);
  const explorer = screen.getByText("Explorer");
  fireEvent.keyDown(explorer, { key: "ArrowDown" });
  fireEvent.keyDown(explorer, { altKey: true, key: "Enter" });
  fireEvent.keyDown(explorer, { altKey: true, key: "ArrowUp" });
  expect(order()).toEqual(["Explorer", "Search"]);
  fireEvent.keyDown(explorer, { altKey: true, key: "ArrowDown" });
  expect(order()).toEqual(["Search", "Explorer"]);
});

it("keeps working when the order cannot be saved", () => {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = () => {
    throw new Error("quota");
  };
  try {
    render(items);
    fireEvent.keyDown(screen.getByText("Search"), { altKey: true, key: "ArrowUp" });
    expect(order()).toEqual(["Search", "Explorer"]);
  } finally {
    Storage.prototype.setItem = original;
  }
});

it("marks the dragged item, accepts drag-over only while dragging and resets on drag end", () => {
  render(items);
  const explorer = screen.getByText("Explorer").parentElement!;
  const search = screen.getByText("Search").parentElement!;
  const dataTransfer = { setData() {}, effectAllowed: "", dropEffect: "" };
  expect(fireEvent.dragOver(search, { dataTransfer })).toBe(true);
  fireEvent.dragStart(explorer, { dataTransfer });
  expect(explorer).toHaveClass("activity-dragging");
  expect(fireEvent.dragOver(search, { dataTransfer })).toBe(false);
  expect(dataTransfer.dropEffect).toBe("move");
  fireEvent.dragEnd(explorer);
  expect(explorer).not.toHaveClass("activity-dragging");
  fireEvent.drop(search, { dataTransfer });
  expect(order()).toEqual(["Explorer", "Search"]);
  fireEvent.dragStart(explorer, { dataTransfer });
  fireEvent.drop(explorer, { dataTransfer });
  expect(order()).toEqual(["Explorer", "Search"]);
});
