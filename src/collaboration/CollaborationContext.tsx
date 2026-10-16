import { createContext, useContext } from "react";
import type { CollaborationProviderState } from "./collaborationTypes";

export const CollaborationContext = createContext<CollaborationProviderState | null>(
  null,
);

export function useCollaborationContext(): CollaborationProviderState {
  const context = useContext(CollaborationContext);
  if (!context) {
    throw new Error(
      "useCollaborationContext must be used inside CollaborationProvider",
    );
  }
  return context;
}
