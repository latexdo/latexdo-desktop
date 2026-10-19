import { describe, expect, it } from "vitest";
import { InlineCompletionCache } from "./inlineCompletionCache";

describe("InlineCompletionCache", () => {
  it("returns the remaining suggestion while the user types it", () => {
    const cache = new InlineCompletionCache();
    cache.set("Hello ", "", "world!");
    expect(cache.get("Hello ", "")).toBe("world!");
    expect(cache.get("Hello wor", "")).toBe("ld!");
    expect(cache.get("Hello world!", "")).toBeNull();
    expect(cache.get("Hello x", "")).toBeNull();
    expect(cache.get("Hello ", "other suffix")).toBeNull();
  });

  it("restores deleted letters on backspace but not across lines or too far", () => {
    const cache = new InlineCompletionCache();
    cache.set("line one\nabc", "", "def");
    expect(cache.get("line one\nab", "")).toBe("cdef");
    expect(cache.get("line one", "")).toBeNull();
    const long = "x".repeat(50);
    cache.set(long, "", "y");
    expect(cache.get("x".repeat(9), "")).toBeNull();
    expect(cache.get("x".repeat(10), "")).toBe("x".repeat(40) + "y");
  });

  it("replaces duplicates, evicts the oldest, and clears", () => {
    const cache = new InlineCompletionCache(2);
    cache.set("a", "", "1");
    cache.set("a", "", "2");
    expect(cache.get("a", "")).toBe("2");
    cache.set("b", "", "3");
    cache.set("c", "", "4");
    expect(cache.get("a", "")).toBeNull();
    expect(cache.get("b", "")).toBe("3");
    cache.clear();
    expect(cache.get("c", "")).toBeNull();
  });
});
