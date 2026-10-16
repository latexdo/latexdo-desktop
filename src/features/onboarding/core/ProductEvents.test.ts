import { describe, expect, it, vi } from "vitest";
import { emitProductEvent, subscribeProductEvents } from "./ProductEvents";

describe("ProductEvents", () => {
  it("broadcasts product events to active subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeProductEvents(listener);

    emitProductEvent({ type: "compile:succeeded" });

    expect(listener).toHaveBeenCalledWith({ type: "compile:succeeded" });
    unsubscribe();
    emitProductEvent({ type: "compile:failed" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
