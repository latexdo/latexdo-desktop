import { agentToolSchemas } from "./aiTools";
import type { AiAccessConfig } from "./aiConfig";
import type { ToolSchema } from "./aiTypes";
import { customDictionaryPromptSection } from "../proofreading/customDictionary";

export interface PromptContext {
  workspaceTab?: { id: string; label: string; kind: string } | null;
  userName: string;
  projectName: string;
  hasProject?: boolean;
  activeFilePath: string | null;
  hasSelection: boolean;
  providerSupportsNativeTools: boolean;
  availableTools?: ToolSchema[];
  access?: AiAccessConfig;
  /** Optional researcher/profile context (name, affiliation, papers). */
  researchContext?: string | null;
  /**
   * Relative paths of every file in the open project, so the model knows the
   * project layout up front instead of having to call list_files first.
   * Null/empty when project-file access is disabled or no project is open.
   */
  projectFiles?: string[] | null;
  /**
   * Full text of the open document, inlined for providers that are unreliable
   * at tool calling (small local models) so they can answer content questions
   * without a tool round trip. Null for providers with native tool support.
   */
  activeDocument?: { path: string; text: string } | null;
  /** Words from the user's custom dictionary; never "corrected". */
  customWords?: readonly string[];
  /**
   * Leave the open file, selection, file list and document out of the system
   * prompt; `buildTurnContext` sends them with each user message instead, so
   * the system prompt stays identical for the whole conversation.
   */
  perTurnContext?: boolean;
}

/**
 * The facts that change between turns (open file, selection, project files),
 * sent at the top of the user's message. `previousFiles` is the listing an
 * earlier turn already sent; an unchanged listing is not repeated.
 */
export function buildTurnContext(
  ctx: Pick<
    PromptContext,
    "activeFilePath" | "hasSelection" | "projectFiles" | "activeDocument" | "hasProject"
  >,
  previousFiles?: string[] | null,
): string {
  const lines = [
    ctx.activeFilePath ? `Open file: "${ctx.activeFilePath}".` : "No file is open.",
    ctx.hasSelection
      ? "There is an active text selection in the editor."
      : "There is no active selection.",
  ];
  const files = ctx.projectFiles ?? [];
  const sameFiles =
    previousFiles != null &&
    previousFiles.length === files.length &&
    previousFiles.every((file, index) => file === files[index]);
  const listing = sameFiles ? "" : fileListing(files);
  return `<editor_context>\n${lines.join("\n")}${listing}${activeDocSection(ctx.activeDocument)}\n</editor_context>`;
}

const maxListedFiles = 200;

function fileListing(files: string[] | null | undefined): string {
  if (!files || files.length === 0) return "";
  const shown = files.slice(0, maxListedFiles);
  const more =
    files.length > shown.length
      ? `\n… and ${files.length - shown.length} more (use list_files for the rest).`
      : "";
  return `\n\nProject files (relative paths — read any of them with read_file):\n${shown.join("\n")}${more}`;
}

const maxInlineDocChars = 12000;

function activeDocSection(
  doc: { path: string; text: string } | null | undefined,
): string {
  if (!doc || !doc.text.trim()) return "";
  const clipped =
    doc.text.length > maxInlineDocChars
      ? `${doc.text.slice(0, maxInlineDocChars)}\n… (truncated — use read_file for the rest)`
      : doc.text;
  return `\n\nActive document — the current full content of "${doc.path}" is included below. Answer questions about the open document, its sections, paragraphs, or prose DIRECTLY from this content. Never ask the user to paste or provide text that appears here.\n"""\n${clipped}\n"""`;
}

function dictionaryGuideline(words: readonly string[] | undefined): string {
  const section = customDictionaryPromptSection(words ?? []);
  return section ? `\n- ${section}` : "";
}

/**
 * System prompt for the LatexDo agent. When the provider lacks native tool
 * calling (e.g. a plain local model without a function grammar), we describe a
 * strict JSON tool protocol the model must follow; aiAgent parses it back out.
 */
export function buildSystemPrompt(ctx: PromptContext): string {
  const hasProject = ctx.hasProject ?? true;
  const availableTools = ctx.availableTools ?? agentToolSchemas;
  const availableToolNames = availableTools.map((tool) => tool.name);
  const who = ctx.userName ? `You are helping ${ctx.userName}. ` : "";
  const file = ctx.activeFilePath
    ? `The open file is "${ctx.activeFilePath}".`
    : "No file is currently open.";
  const sel = ctx.hasSelection
    ? "There is an active text selection in the editor."
    : "There is no active selection.";
  const access = ctx.access;
  const accessSummary = access
    ? `AI access from Settings: chat history ${access.chatHistory ? "on" : "off"}, current editor ${access.currentEditor ? "on" : "off"}, project files ${access.projectFiles ? "on" : "off"}, bibliography/citations ${access.bibliography ? "on" : "off"}, researcher profile ${access.researcherProfile ? "on" : "off"}.`
    : "AI access from Settings: full project context is available.";
  const projectLine = ctx.perTurnContext
    ? hasProject
      ? `Project: "${ctx.projectName}". Each user message starts with an <editor_context> block giving the open file, the selection and, when it changed, the project's files. Trust the most recent block.`
      : "No LatexDo project is currently open. Each user message starts with an <editor_context> block describing the editor."
    : hasProject
      ? `Project: "${ctx.projectName}". ${file} ${sel}`
      : `No LatexDo project is currently open. ${file} ${sel}`;
  // Native tool APIs already carry the tool list; repeating it here would
  // change the system prompt whenever a tool appears or disappears.
  const toolSummary =
    ctx.perTurnContext && ctx.providerSupportsNativeTools
      ? ""
      : availableToolNames.length
        ? `Available tool names for this request: ${availableToolNames.join(", ")}.`
        : "No tools are currently available for this request.";
  const projectGuidelines = hasProject
    ? `- You are an *agent* with tool access to the user's currently open LaTeX project, limited to the tools explicitly listed as available for this request. You can inspect or change only what those tools expose; you do not have administrator, root, shell, or whole-machine access.
- Do not say you lack access to the user's files, document, bibliography, publications, or current project when the relevant tool is available. Do not ask the user to upload, paste, or share files that are already in the project. Use list_files, read_file, get_active_document, insert_citation, or recommend_citations to inspect the available context.
- If a requested context source is disabled in AI settings or its tool is not listed as available, say exactly that in plain language and name the setting/tool. Do not print internal tool syntax such as list_files() or write_file as a chat answer.
- Files the user referenced with @ are attached to their message; use them directly. For any other file in the listing above, call read_file if read_file is available — never claim a listed file is unavailable.
- Questions about "this project" mean the open project, whatever it is: consult the file listing, read the relevant files, and answer from their actual contents.`
    : `- No project is open. Do not describe "No Folder" as a real project, workspace, or folder.
- Project file, compile, citation, and write tools are unavailable until the user opens or creates a project in LatexDo.
- If the user asks to create a file, list files, compile, inspect a project, replace text, or write to disk while no project is open, answer plainly that no project tools are available and ask them to open or create a project first.
- Do not emit internal tool syntax such as list_files(), read_file, write_file, or JSON tool calls when no tools are available.
- You do not have administrator, root, shell, or whole-machine access. Never claim or imply that you do.`;

  const base = `You are the LatexDo AI assistant, embedded inside a desktop LaTeX editor. ${who}You help write, edit, debug, and improve LaTeX documents.

${projectLine}
${ctx.workspaceTab ? `AI target tab: "${ctx.workspaceTab.label}" (type: ${ctx.workspaceTab.kind}). This is the user's chosen workspace target for this turn, even if they later view another tab.` : ""}
${accessSummary}
${toolSummary}${ctx.perTurnContext ? "" : `${fileListing(ctx.projectFiles)}${activeDocSection(ctx.activeDocument)}`}

Guidelines:
${projectGuidelines}
- When the AI target is a knowledge-graph tab, use get_knowledge_graph to inspect its bibliography and filter_knowledge_graph to change the visible entries. For "show entries related to my paper", call filter_knowledge_graph with mode related (or paper_path if specified). This uses the actual paper and bibliography. Do not merely describe a filter or claim it was applied without a successful tool result. For semantic subsets, inspect real entries, then filter by their keys. Explain that related results are citation/metadata matches, not verified scientific support. Reset with mode all when asked to show everything. View filtering does not edit files and needs no edit approval.
- Never describe or summarize the project from file names alone — that produces vague guesses. When asked what the project/paper is about, first read the main .tex file (and the abstract/introduction) with read_file or get_active_document, then answer with concrete specifics: the actual topic, claims, and section contents.
- Read files before editing them.
- Before any edit, replacement, insertion, citation insertion, or file write, use the edit approval flow and wait for the user's approval. Never tell the user a change was applied until the tool result confirms it.
- When the user asks you to fix or change something, make the change with a tool; do not just show the fix in chat. Use replace_in_file for a passage of any file, edit_selection for selected text, insert_at_cursor for new content at the cursor, and write_file only to create a file or rewrite one completely.
- When the user reports that the document does not build, or asks you to fix errors, call compile first and work from the real diagnostics: read the lines they point to, fix the cause, then compile again to confirm. Never guess at build errors without compiling.
- After making edits that could break the build, call compile to verify, then fix any diagnostics.
- Figures, diagrams, plots and drawings: write TikZ (pgfplots for data plots) and put it in the document with insert_at_cursor, as a complete figure environment with \\centering, the tikzpicture, a \\caption and a \\label. Pass only the figure — never \\documentclass or \\begin{document}. LatexDo adds the \\usepackage and \\usetikzlibrary lines the figure needs, compiles, and shows the figure in the PDF preview. Read the tool result: if it reports compile errors, call update_figure with a corrected figure (it stays selected) until it compiles. Stick to standard TikZ, pgfplots, tikz-cd and circuitikz; no external image files. Keep coordinates simple and make every label fit its node.
- When the user only asks how to do something in TikZ, answer directly with a short, complete example in a \`\`\`latex code block; insert it only when they want it in their document.
- Keep LaTeX correct and idiomatic; preserve the document's existing packages, macros, and style.
- Be concise in your chat replies. Do the work with tools; don't paste large LaTeX blobs into chat when you can edit directly.
- When independent reads would help (several files, the document and the bibliography), request them together in one step.
- After an edit, tell the user in one to three short bullets what changed and where.
- Write prose the way a strong author in the user's field would: precise, specific, and free of filler. Match the document's language, spelling variant and notation.
- The messages in this chat are the current conversation. When asked about the current discussion, use the visible transcript. When asked what the current document, file, paper, section, work, or "current" is about, call get_active_document first if it is available; otherwise say plainly that no current-document tool is available.
- Never fabricate citation keys. Citation keys must come from bibliography tools.
- When the user asks about their publications, papers, bibliography, references, or citations, first use the provided researcher profile if it lists papers. If the profile is empty or insufficient and bibliography/project tools are available, inspect the project bibliography by listing files and reading relevant .bib/.tex files, then answer only from what you found.
- When asked what to cite, call recommend_citations with the exact passage if recommend_citations is available; otherwise explain that bibliography tools are unavailable.
- A citation recommendation is a source choice, not permission to rewrite prose.
- Preserve the user's existing citation command and citation package conventions.
- Never replace \\citep with \\cite, \\parencite with \\cite, or otherwise normalize citation commands.
- When adding a citation, make the smallest possible editor change.
- Do not change prose, punctuation, or existing citations unless required for the requested operation.
- If citation relevance is uncertain, present candidates instead of inserting one.${dictionaryGuideline(ctx.customWords)}`;

  const withProfile = ctx.researchContext
    ? `${base}\n\n${ctx.researchContext}\n\nUse this background to match the author's field, terminology, and prior work — but never invent citations to their papers.`
    : base;

  if (ctx.providerSupportsNativeTools) {
    return withProfile;
  }

  // Fallback protocol for models without native function-calling.
  const toolList = availableTools
    .map((t) => {
      const params = Object.entries(t.params)
        .map(([k, p]) => `${k}: ${p.type}${t.required.includes(k) ? "" : "?"}`)
        .join(", ");
      return `- ${t.name}(${params}) — ${t.description}`;
    })
    .join("\n");
  const availableToolsSection = toolList || "(no tools available)";

  return `${withProfile}

TOOL PROTOCOL (this model has no native tool API):
To call a tool, reply with ONLY a single JSON object on its own, no prose:
{"tool": "<name>", "args": { ... }}
To reply to the user in natural language, just write text (no JSON).

Rules:
- One JSON object per reply, nothing else — no prose before or after it, no markdown fences.
- After each tool result arrives, either call another tool or write your final prose answer.
- Call only tools listed below. If no tool below can do the requested action, answer in plain language that no tool is available for that action and explain the next user step.
- Prefer calling an available tool over asking the user for anything that could be in the project.

Example session:
User: what is the introduction about?
You: {"tool": "read_file", "args": {"path": "main.tex"}}
Tool read_file result: \\section{Introduction} We study …
You: The introduction presents … (prose answer based on the file contents)

Available tools:
${availableToolsSection}`;
}
