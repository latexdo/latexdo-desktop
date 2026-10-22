import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppPaperReview } from "./useAppPaperReview";
import type { AppCtx18 } from "./appContext";
import { defaultAiConfig } from "../features/ai/aiConfig";
const configured = vi.hoisted(() => vi.fn(() => true));
vi.mock("../components/AiSidebar", () => ({ isAiConfigured: configured }));
function setup(overrides: Record<string, unknown> = {}) {
  const sendPrompt = vi.fn(() => true);
  const ctx = {
    projectId: "p",
    projectName: "Research",
    rootFile: "main.tex",
    engine: "pdflatex",
    hideProjectEntries: false,
    aiConfig: {
      ...defaultAiConfig,
      profile: { ...defaultAiConfig.profile },
      access: { ...defaultAiConfig.access, projectFiles: true },
    },
    aiIsDesktop: true,
    compileResult: null,
    activeTextDocument: null,
    activeResearchSpace: null,
    proofreadingSettings: {},
    spellCheckerSettings: { enabled: false, languages: ["en"] },
    rebuttalItems: [],
    reviewChats: [],
    requireLegalAcceptance: vi.fn(() => false),
    setStatusMessage: vi.fn(),
    openAiSettings: vi.fn(),
    openAiSidebarApi: vi.fn().mockResolvedValue({ sendPrompt }),
    ...overrides,
  };
  return {
    ...renderHook(() => useAppPaperReview(ctx as unknown as AppCtx18)),
    ctx,
    sendPrompt,
  };
}
beforeEach(() => configured.mockReturnValue(true));
afterEach(cleanup);
describe("paper review", () => {
  it("reads the latest project context and excludes blank reviewer comments", () => {
    const h = setup();
    expect(h.result.current.paperReviewContext()).toMatchObject({
      lastBuild: null,
      activeFilePath: null,
      hasResearcherProfile: false,
      spellCheckLanguages: [],
    });
    Object.assign(h.ctx, {
      compileResult: {
        ok: false,
        diagnostics: [
          { severity: "error", file: "main.tex", line: 2, message: "bad" },
          { severity: "warning" },
        ],
      },
      activeTextDocument: { relativePath: "chapter.tex" },
      activeResearchSpace: { folders: [{ name: "Paper", kind: "latex" }] },
      spellCheckerSettings: { enabled: true, languages: ["en"] },
      rebuttalItems: [
        { reviewerComment: "  " },
        { reviewer: "R1", reviewerComment: "Explain", authorComment: "Done" },
      ],
      reviewChats: [
        {
          filePath: "chapter.tex",
          selection: { text: "quote" },
          comments: [{ text: "Check" }],
        },
      ],
    });
    h.ctx.aiConfig.profile.includeInContext = true;
    h.ctx.aiConfig.profile.displayName = "Ada";
    h.rerender();
    expect(h.result.current.paperReviewContext("methods")).toMatchObject({
      activeFilePath: "chapter.tex",
      focus: "methods",
      hasResearcherProfile: true,
      spellCheckLanguages: ["en"],
      lastBuild: { ok: false, errors: ["main.tex:2 bad"], warningCount: 1 },
      previousReviews: [{ reviewer: "R1", comment: "Explain", response: "Done" }],
      annotations: [{ filePath: "chapter.tex", excerpt: "quote", comments: ["Check"] }],
    });
  });
  it.each([{ projectId: "" }, { rootFile: "" }, { hideProjectEntries: true }])(
    "requires a readable project",
    async (override) => {
      const h = setup(override);
      await h.result.current.reviewPaperWithAi();
      expect(h.ctx.setStatusMessage).toHaveBeenCalledWith(
        "Open a LaTeX project to review its paper.",
      );
      expect(h.sendPrompt).not.toHaveBeenCalled();
    },
  );
  it("respects legal acceptance, access permissions and AI configuration", async () => {
    const h = setup();
    h.ctx.requireLegalAcceptance.mockReturnValue(true);
    await h.result.current.reviewPaperWithAi();
    expect(h.ctx.setStatusMessage).not.toHaveBeenCalled();
    h.ctx.requireLegalAcceptance.mockReturnValue(false);
    h.ctx.aiConfig.access.projectFiles = false;
    h.ctx.aiConfig.access.currentEditor = false;
    await h.result.current.reviewPaperWithAi();
    expect(h.ctx.openAiSettings).toHaveBeenCalled();
    expect(h.ctx.setStatusMessage).toHaveBeenCalledWith(
      expect.stringContaining("Project files"),
    );
    h.ctx.aiConfig.access.currentEditor = true;
    configured.mockReturnValue(false);
    await h.result.current.reviewPaperWithAi();
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "Choose an AI provider to review the paper.",
    );
  });
  it("sends the review prompt and distinguishes busy from unavailable chat", async () => {
    const h = setup();
    await h.result.current.reviewPaperWithAi("methods");
    expect(h.sendPrompt).toHaveBeenCalledWith(
      expect.stringContaining("methods"),
      expect.any(String),
    );
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "Reviewing the paper with AI…",
    );
    h.sendPrompt.mockReturnValue(false);
    await h.result.current.reviewPaperWithAi();
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("still answering"),
    );
    h.ctx.openAiSidebarApi.mockResolvedValue(null);
    await h.result.current.reviewPaperWithAi();
    expect(h.ctx.setStatusMessage).toHaveBeenLastCalledWith(
      "The AI chat could not open.",
    );
  });
});
