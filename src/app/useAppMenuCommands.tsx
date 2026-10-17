import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { requestFind } from "../components/FindPanel";
import { flattenEntries } from "../features/project/projectUtils";
import { toolTabIds, type ToolTabKey } from "../features/workspace/toolTabs";
import type { LayoutPreset } from "../features/ai/aiConfig";
import type { LatexToolbarCommand, PanelKind, SidebarView } from "./appShared";
import { isTextDocument } from "./appShared";
import type { AppCtx19 } from "./appContext";

const editorCommandPrefix = "editor:";

const sidebarCommands: Record<string, SidebarView> = {
  "view.explorer": "explorer",
  "view.sourceControl": "sourceControl",
  "view.extensions": "extensions",
  "view.ai": "ai",
};

const panelCommands: Record<string, PanelKind> = {
  "view.problems": "problems",
  "view.output": "output",
  "view.terminal": "terminal",
};

const layoutCommands: Record<string, LayoutPreset> = {
  "view.layout.focus": "focus",
  "view.layout.balanced": "balanced",
  "view.layout.power": "power",
};

const insertCommands: Record<string, LatexToolbarCommand> = {
  "insert.underline": "underline",
  "insert.math": "math",
  "insert.section": "section",
  "insert.subsection": "subsection",
  "insert.equation": "equation",
  "insert.itemize": "itemize",
  "insert.enumerate": "enumerate",
  "insert.cite": "cite",
  "insert.ref": "ref",
  "insert.href": "href",
  "insert.formatTable": "formatTable",
};

/**
 * Carries out the application menu (File, Edit, Selection, View, Go, Build,
 * Insert, Tools, Help). The main process owns the menu and its shortcuts and
 * sends each chosen item here by id.
 */
export function useAppMenuCommands(ctx: AppCtx19) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The listener is registered once; commands always see the latest state.
  const latest = useRef(ctx);
  latest.current = ctx;

  useEffect(() => {
    const runEditorAction = (actionId: string) => {
      const editor = latest.current.editorRef.current;
      if (!editor) {
        latest.current.setStatusMessage("Open a file in the editor first.");
        return;
      }
      editor.focus();
      void editor.getAction(actionId)?.run();
    };

    const goToFile = async () => {
      const { askQuickPick, projectEntries, hideProjectEntries, openDocument } =
        latest.current;
      const files = hideProjectEntries
        ? []
        : flattenEntries(projectEntries).filter((entry) => entry.type === "file");
      if (!files.length) {
        latest.current.setStatusMessage("Open a project to go to its files.");
        return;
      }
      const choice = await askQuickPick({
        title: "Go to File",
        placeholder: "Search files by name",
        items: files.map((entry) => ({
          id: entry.path,
          label: entry.name,
          description: entry.relativePath,
          icon: <FileText size={14} />,
        })),
      });
      const entry = files.find((file) => file.path === choice?.item?.id);
      if (entry) {
        await openDocument(entry);
      }
    };

    const stepTab = (offset: number) => {
      const tabs = latest.current.workspaceTabs;
      if (tabs.length < 2) return;
      const index = Math.max(
        0,
        tabs.findIndex((tab) => tab.active),
      );
      tabs[(index + offset + tabs.length) % tabs.length].onSelect();
    };

    const saveAll = async () => {
      const { documentsRef, saveDocument, setStatusMessage } = latest.current;
      const dirty = documentsRef.current.filter(
        (document) =>
          isTextDocument(document) && document.content !== document.savedContent,
      );
      for (const document of dirty) {
        await saveDocument(document);
      }
      setStatusMessage(
        dirty.length
          ? `Saved ${dirty.length} file${dirty.length === 1 ? "" : "s"}`
          : "All files are saved.",
      );
    };

    const changeResearchSpace = async (
      change: (
        projectId: string,
      ) => Promise<Awaited<ReturnType<typeof window.latexdo.saveResearchSpaceAs>>>,
      doneMessage: string,
    ) => {
      const { projectId, hideProjectEntries, loadProject, setStatusMessage } =
        latest.current;
      if (!projectId || hideProjectEntries) {
        setStatusMessage("Open a project first.");
        return;
      }
      const project = await change(projectId);
      if (project) {
        await loadProject(project, false, false);
        setStatusMessage(doneMessage);
      }
    };

    const run = async (command: string) => {
      const c = latest.current;
      if (c.requireLegalAcceptance()) return;

      if (command.startsWith(editorCommandPrefix)) {
        runEditorAction(command.slice(editorCommandPrefix.length));
        return;
      }
      if (command in sidebarCommands) {
        c.openSidebar(sidebarCommands[command]);
        return;
      }
      if (command in panelCommands) {
        c.openPanel(panelCommands[command]);
        return;
      }
      if (command in layoutCommands) {
        c.applyLayoutPreset(layoutCommands[command]);
        return;
      }
      if (command in insertCommands) {
        c.editorRef.current?.focus();
        c.applyLatexToolbarCommand(insertCommands[command]);
        return;
      }
      if (command.startsWith("view.tool.")) {
        const key = command.slice("view.tool.".length) as ToolTabKey;
        if (key in toolTabIds) c.openToolTab(toolTabIds[key]);
        return;
      }

      switch (command) {
        case "app.settings":
          c.setSettingsOpen(true);
          return;
        case "file.newProject":
          await c.createProject();
          return;
        case "file.newResearchSpace":
          await c.createResearchSpace();
          return;
        case "file.saveResearchSpaceAs":
          await changeResearchSpace(
            window.latexdo.saveResearchSpaceAs,
            "Research Space saved",
          );
          return;
        case "file.addFolderToResearchSpace":
          await changeResearchSpace(
            window.latexdo.addFolderToResearchSpace,
            "Folder added to the Research Space",
          );
          return;
        case "file.save":
          await c.saveActiveAndCompile();
          return;
        case "file.saveAll":
          await saveAll();
          return;
        case "file.reloadFromDisk":
          await c.reloadOpenDocumentsFromDisk({ includeUnsaved: true });
          return;
        case "file.share":
          c.openShareDialog();
          return;
        case "edit.find":
        case "edit.findInFiles": {
          const scope = command === "edit.findInFiles" ? "project" : "file";
          const editor = c.editorRef.current;
          if (editor?.hasTextFocus()) {
            // The editor's own action seeds the query from its selection.
            runEditorAction(
              scope === "project" ? "latexdo.findInFiles" : "latexdo.find",
            );
          } else {
            requestFind({ scope });
          }
          return;
        }
        case "view.commandPalette":
          runEditorAction("editor.action.quickCommand");
          return;
        case "view.toggleSidebar":
          c.toggleSidebar();
          return;
        case "view.togglePanel":
          c.togglePanel();
          return;
        case "view.togglePreview":
          await c.togglePreview();
          return;
        case "view.toggleWordWrap":
          c.setSettings((current) => ({ ...current, wordWrap: !current.wordWrap }));
          return;
        case "view.toggleMinimap":
          c.setSettings((current) => ({ ...current, minimap: !current.minimap }));
          return;
        case "go.file":
          await goToFile();
          return;
        case "go.nextTab":
          stepTab(1);
          return;
        case "go.previousTab":
          stepTab(-1);
          return;
        case "go.syncPdf":
          await c.handleEditorCursorToPdf();
          return;
        case "build.compile":
          await c.compile();
          return;
        case "build.stop":
          await c.cancelCompile();
          return;
        case "build.downloadPdf":
          await c.downloadPdf();
          return;
        case "tools.reviewPaper":
          await c.reviewPaperWithAi();
          return;
        case "tools.reviewPdf":
          c.reviewPaper();
          return;
        case "tools.proofread":
          await c.runProofreading();
          return;
        case "tools.aiSettings":
          c.openAiSettings();
          return;
        case "help.welcome":
          c.showWelcomePage();
          return;
        case "help.shortcuts":
          setShortcutsOpen(true);
          return;
      }
    };

    return window.latexdo.onMenuCommand((command) => {
      void run(command).catch((error: unknown) => {
        latest.current.setStatusMessage(
          error instanceof Error ? error.message : "That command did not complete.",
        );
      });
    });
  }, []);

  return { shortcutsOpen, setShortcutsOpen };
}
