import { useMemo, useState } from "react";
import type { OpenDocument } from "../../types";

export function useDocuments() {
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [activePath, setActivePath] = useState("");
  const activeDocument = useMemo(
    () => documents.find((document) => document.path === activePath),
    [activePath, documents],
  );

  return {
    documents,
    setDocuments,
    activePath,
    setActivePath,
    activeDocument,
  };
}
