import { useMemo, type ReactNode } from "react";
import { collaborationApiBaseUrl } from "./collaborationApi";
import { CollaborationContext } from "./CollaborationContext";
import { collaborationIdentity } from "./collaborationStorage";

export function CollaborationProvider({ children }: { children: ReactNode }) {
  const value = useMemo(
    () => ({
      ...collaborationIdentity(),
      apiBaseUrl: collaborationApiBaseUrl(),
    }),
    [],
  );

  return (
    <CollaborationContext.Provider value={value}>
      {children}
    </CollaborationContext.Provider>
  );
}
