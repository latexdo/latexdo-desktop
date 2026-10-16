import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./aiSystemPrompt";

const baseContext = {
  userName: "Omar",
  projectName: "Paper",
  activeFilePath: "content/conclusion.tex",
  hasSelection: false,
  providerSupportsNativeTools: true,
  researchContext: null,
};

describe("buildSystemPrompt", () => {
  it("tells the agent to use project tools instead of claiming missing access", () => {
    const prompt = buildSystemPrompt(baseContext);

    expect(prompt).toContain("tool access to the user's currently open LaTeX project");
    expect(prompt).toContain("Do not say you lack access");
    expect(prompt).toContain("Do not ask the user to upload, paste, or share files");
    expect(prompt).toContain("list_files");
    expect(prompt).toContain("read_file");
  });

  it("routes publication questions to profile papers or project bibliographies", () => {
    const prompt = buildSystemPrompt(baseContext);

    expect(prompt).toContain("When the user asks about their publications");
    expect(prompt).toContain("provided researcher profile");
    expect(prompt).toContain("inspect the project bibliography");
  });

  it("describes access settings and current-topic behavior", () => {
    const prompt = buildSystemPrompt({
      ...baseContext,
      access: {
        chatHistory: true,
        currentEditor: true,
        projectFiles: false,
        bibliography: true,
        researcherProfile: false,
      },
    });

    expect(prompt).toContain("project files off");
    expect(prompt).toContain("researcher profile off");
    expect(prompt).toContain("When asked about the current discussion");
    expect(prompt).toContain("call get_active_document first");
  });

  it("names disabled settings instead of pretending capability is missing", () => {
    const prompt = buildSystemPrompt(baseContext);

    expect(prompt).toContain("disabled in AI settings");
    expect(prompt).toContain("tool is not listed as available");
  });

  it("lists project files so the model knows the layout up front", () => {
    const prompt = buildSystemPrompt({
      ...baseContext,
      projectFiles: ["main.tex", "sections/intro.tex", "refs.bib"],
    });

    expect(prompt).toContain("Project files (relative paths");
    expect(prompt).toContain("sections/intro.tex");
    expect(prompt).toContain("Files the user referenced with @");
  });

  it("caps the file listing and points to list_files for the rest", () => {
    const many = Array.from({ length: 250 }, (_, i) => `chapter${i}.tex`);
    const prompt = buildSystemPrompt({ ...baseContext, projectFiles: many });

    expect(prompt).toContain("chapter199.tex");
    expect(prompt).not.toContain("chapter200.tex\n");
    expect(prompt).toContain("and 50 more (use list_files for the rest)");
  });

  it("omits the listing when project access is off or empty", () => {
    expect(buildSystemPrompt({ ...baseContext, projectFiles: null })).not.toContain(
      "Project files (relative paths",
    );
    expect(buildSystemPrompt({ ...baseContext, projectFiles: [] })).not.toContain(
      "Project files (relative paths",
    );
  });

  it("inlines the active document content when provided", () => {
    const prompt = buildSystemPrompt({
      ...baseContext,
      providerSupportsNativeTools: false,
      activeDocument: {
        path: "main.tex",
        text: "\\section{Related Work}\nResearch on code completion has grown.",
      },
    });

    expect(prompt).toContain('the current full content of "main.tex"');
    expect(prompt).toContain("Research on code completion has grown.");
    expect(prompt).toContain("Never ask the user to paste or provide text");
  });

  it("truncates huge inlined documents and omits empty ones", () => {
    const long = buildSystemPrompt({
      ...baseContext,
      activeDocument: { path: "main.tex", text: "x".repeat(20000) },
    });
    expect(long).toContain("truncated — use read_file for the rest");

    const empty = buildSystemPrompt({
      ...baseContext,
      activeDocument: { path: "main.tex", text: "   " },
    });
    expect(empty).not.toContain("Active document");
  });

  it("includes the JSON tool protocol for local plain-chat providers", () => {
    const prompt = buildSystemPrompt({
      ...baseContext,
      providerSupportsNativeTools: false,
    });

    expect(prompt).toContain("TOOL PROTOCOL");
    expect(prompt).toContain('{"tool": "<name>", "args": { ... }}');
  });

  it("treats no-project state as unavailable tools instead of a writable project", () => {
    const prompt = buildSystemPrompt({
      ...baseContext,
      projectName: "No Folder",
      hasProject: false,
      activeFilePath: null,
      availableTools: [],
      projectFiles: null,
      providerSupportsNativeTools: false,
    });

    expect(prompt).toContain("No LatexDo project is currently open");
    expect(prompt).toContain('No project is open. Do not describe "No Folder"');
    expect(prompt).toContain("No tools are currently available");
    expect(prompt).toContain("open or create a project");
    expect(prompt).toContain("(no tools available)");
    expect(prompt).not.toContain('Project: "No Folder"');
  });
});
