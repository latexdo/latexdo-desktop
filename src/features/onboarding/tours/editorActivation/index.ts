import type { TourDefinition } from "../../core/TourTypes";

// Keep this tour short: it presents the core loop only, never more than six steps.
export const editorActivationTour: TourDefinition = {
  id: "editor-activation",
  version: 2,
  title: "Take the one-minute tour",
  intro:
    "Five quick stops in your own project: the editor, the PDF, source and PDF sync, and AI.",
  steps: [
    {
      id: "editor",
      featureId: "editor",
      targetId: "editor",
      title: "Write your paper here",
      body: "This is your LaTeX source, with completion as you type and Cite and formatting tools in the toolbar above.",
      mode: "explain",
      success: "That is the editor.",
    },
    {
      id: "compile",
      featureId: "compile",
      targetId: "compile",
      fallbackTargetId: "editor",
      title: "Build the PDF",
      body: "Compile with the toolbar button or Ctrl/Cmd + Enter. The PDF appears next to your source.",
      mode: "user-action",
      expectedEvent: "compile:succeeded",
      success: "Your PDF is ready.",
    },
    {
      id: "pdf-navigation",
      featureId: "synctex",
      targetId: "pdf-preview",
      fallbackTargetId: "workspace",
      title: "Source and PDF stay in sync",
      body: "Jump from a line in your source to the same place in the PDF, and back.",
      mode: "user-action",
      expectedEvent: "synctex:navigated",
      success: "Source and PDF are linked.",
    },
    {
      id: "ask-ai",
      featureId: "ask-ai-selection",
      targetId: "ai-sidebar",
      fallbackTargetId: "editor",
      title: "Ask AI about your writing",
      body: "Select a sentence and use Ask AI about Selection. The assistant gets that exact passage with its file and lines.",
      mode: "user-action",
      expectedEvent: "ai:selection-attached",
      success: "AI now knows exactly what passage you mean.",
    },
    {
      id: "workspace",
      featureId: "workspace-map",
      targetId: "workspace",
      title: "That is the whole loop",
      body: "Write, compile, check the PDF, ask AI. Files, Problems and everything else are one click away when you need them.",
      mode: "explain",
      cta: "Start working",
      success: "You are ready to work.",
    },
  ],
};
