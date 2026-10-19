import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { CollaborationContext, useCollaborationContext } from "./CollaborationContext";
import type { CollaborationProviderState } from "./collaborationTypes";

describe("useCollaborationContext", () => {
  it("throws outside a provider", () => {
    expect(() => renderHook(() => useCollaborationContext())).toThrow(
      /must be used inside CollaborationProvider/,
    );
  });

  it("returns the provided state", () => {
    const state = { marker: true } as unknown as CollaborationProviderState;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CollaborationContext.Provider value={state}>{children}</CollaborationContext.Provider>
    );
    const { result } = renderHook(() => useCollaborationContext(), { wrapper });
    expect(result.current).toBe(state);
  });
});
