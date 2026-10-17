import { useCallback, useRef } from "react";
import { isAiConfigured } from "../components/AiSidebar";
import {
  buildPaperReviewPrompt,
  paperReviewDisplayText,
  type PaperReviewContext,
} from "../features/ai/paperReview";
import type { AppCtx18 } from "./appContext";

/**
 * "Review": the AI agent reviews the open paper as a peer reviewer would,
 * with everything LatexDo knows about the author's settings and project.
 */
export function useAppPaperReview(ctx: AppCtx18) {
  const latest = useRef(ctx);
  latest.current = ctx;

  /** What the review prompt is built from; read at click time. */
  const paperReviewContext = useCallback((focus?: string): PaperReviewContext => {
    const c = latest.current;
    const compileDiagnostics = c.compileResult?.diagnostics ?? [];
    const profile = c.aiConfig.profile;
    return {
      projectName: c.projectName,
      rootFile: c.rootFile,
      engine: c.engine,
      activeFilePath: c.activeTextDocument?.relativePath ?? null,
      researchSpaceFolders: c.activeResearchSpace?.folders.map((folder) => ({
        name: folder.name,
        kind: folder.kind,
      })),
      access: c.aiConfig.access,
      proofreading: c.proofreadingSettings,
      spellCheckLanguages: c.spellCheckerSettings?.enabled
        ? c.spellCheckerSettings.languages
        : [],
      lastBuild: c.compileResult
        ? {
            ok: c.compileResult.ok,
            errors: compileDiagnostics
              .filter((diagnostic) => diagnostic.severity === "error")
              .map(
                (diagnostic) =>
                  `${diagnostic.file}:${diagnostic.line} ${diagnostic.message}`,
              ),
            warningCount: compileDiagnostics.filter(
              (diagnostic) => diagnostic.severity === "warning",
            ).length,
          }
        : null,
      previousReviews: c.rebuttalItems
        .filter((item) => item.reviewerComment.trim())
        .map((item) => ({
          reviewer: item.reviewer,
          comment: item.reviewerComment,
          response: item.authorComment,
        })),
      annotations: c.reviewChats.map((chat) => ({
        filePath: chat.filePath,
        excerpt: chat.selection.text,
        comments: chat.comments.map((comment) => comment.text),
      })),
      hasResearcherProfile: Boolean(
        profile.includeInContext &&
        (profile.displayName || profile.affiliation || profile.papers.length),
      ),
      focus,
    };
  }, []);

  const reviewPaperWithAi = useCallback(
    async (focus?: string) => {
      const c = latest.current;
      if (c.requireLegalAcceptance()) return;
      if (!c.projectId || c.hideProjectEntries || !c.rootFile) {
        c.setStatusMessage("Open a LaTeX project to review its paper.");
        return;
      }
      const { access } = c.aiConfig;
      if (!access.projectFiles && !access.currentEditor) {
        c.setStatusMessage(
          'Turn on "Project files" or "Current editor" in AI settings so the AI can read the paper.',
        );
        c.openAiSettings();
        return;
      }
      if (!isAiConfigured(c.aiConfig, c.aiIsDesktop)) {
        c.setStatusMessage("Choose an AI provider to review the paper.");
        c.openAiSettings();
        return;
      }

      const reviewContext = paperReviewContext(focus);
      const api = await c.openAiSidebarApi();
      const sent = api?.sendPrompt(
        buildPaperReviewPrompt(reviewContext),
        paperReviewDisplayText(reviewContext),
      );
      if (!sent) {
        c.setStatusMessage(
          api
            ? "The AI is still answering. Stop it or wait, then review again."
            : "The AI chat could not open.",
        );
        return;
      }
      c.setStatusMessage("Reviewing the paper with AI…");
    },
    [paperReviewContext],
  );

  return { reviewPaperWithAi, paperReviewContext };
}
