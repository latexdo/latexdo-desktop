import { beforeEach, describe, expect, it } from "vitest";
import {
  classifyMessage,
  clearNotifications,
  getNotifications,
  markAllNotificationsRead,
  notify,
} from "./notifications";

beforeEach(() => clearNotifications());

describe("classifyMessage", () => {
  it.each([
    ["Update check failed: Website unavailable", "error"],
    ["Could not open the project.", "error"],
    ["LatexDo couldn't access the microphone.", "error"],
    ["Compiled with no errors", "info"],
    ["Ollama is offline", "warning"],
    ["Saved main.tex", "info"],
  ] as const)("%s → %s", (message, severity) => {
    expect(classifyMessage(message)).toBe(severity);
  });
});

describe("notify", () => {
  it("records newest first and ignores blank messages", () => {
    notify("First", { now: 1 });
    notify("   ", { now: 2 });
    notify("Second", { now: 10_000 });
    expect(getNotifications().map((entry) => entry.message)).toEqual([
      "Second",
      "First",
    ]);
  });

  it("collapses an immediately repeated message", () => {
    notify("Compile failed", { now: 1_000 });
    notify("Compile failed", { now: 1_500 });
    notify("Compile failed", { now: 5_000 });
    expect(getNotifications()).toHaveLength(2);
  });

  it("marks everything read and clears", () => {
    notify("Compile failed", { now: 1 });
    markAllNotificationsRead();
    expect(getNotifications()[0].read).toBe(true);
    clearNotifications();
    expect(getNotifications()).toEqual([]);
  });
});
