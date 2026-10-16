// Tools (TikZ drawing, extension tools) open as workspace tabs next to the
// documents, so none of them blocks the editor, the PDF or the AI chat.

export const toolTabIds = {
  tikzCanvas: "workspace:tikz-canvas",
  tikzConverter: "workspace:tikz-converter",
  tableGenerator: "workspace:table-generator",
  notationManager: "workspace:notation-manager",
  citationManager: "workspace:citation-manager",
  extensionDetails: "workspace:extension-details",
} as const;

export type ToolTabKey = keyof typeof toolTabIds;
export type ToolTabId = (typeof toolTabIds)[ToolTabKey];

const keysById = new Map<string, ToolTabKey>(
  Object.entries(toolTabIds).map(([key, id]) => [id, key as ToolTabKey]),
);

export function isToolTab(id: string): id is ToolTabId {
  return keysById.has(id);
}

export function toolTabKey(id: string): ToolTabKey | null {
  return keysById.get(id) ?? null;
}

export const toolTabLabels: Record<ToolTabKey, string> = {
  tikzCanvas: "TikZ Drawing",
  tikzConverter: "Figure → TikZ",
  tableGenerator: "Table Generator",
  notationManager: "Notation Manager",
  citationManager: "Citation Manager",
  extensionDetails: "Extension",
};
