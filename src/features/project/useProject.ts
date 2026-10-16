import { useState } from "react";
import type { ProjectEntry } from "../../types";

export function useProject() {
  const [projectId, setProjectId] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [projectEntries, setProjectEntries] = useState<ProjectEntry[]>([]);
  const [hideProjectEntries, setHideProjectEntries] = useState(true);
  const [welcomeOpen, setWelcomeOpen] = useState(true);
  const [createDialog, setCreateDialog] = useState<"file" | "folder" | null>(null);
  const [createPath, setCreatePath] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [docxImporting, setDocxImporting] = useState(false);
  const [markdownImporting, setMarkdownImporting] = useState(false);
  const [pdfImporting, setPdfImporting] = useState(false);
  const [templateCreating, setTemplateCreating] = useState<string | null>(null);

  return {
    projectId,
    setProjectId,
    projectPath,
    setProjectPath,
    projectEntries,
    setProjectEntries,
    hideProjectEntries,
    setHideProjectEntries,
    welcomeOpen,
    setWelcomeOpen,
    createDialog,
    setCreateDialog,
    createPath,
    setCreatePath,
    createError,
    setCreateError,
    creating,
    setCreating,
    docxImporting,
    setDocxImporting,
    markdownImporting,
    setMarkdownImporting,
    pdfImporting,
    setPdfImporting,
    templateCreating,
    setTemplateCreating,
  };
}
