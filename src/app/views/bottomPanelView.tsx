import { CircleAlert, Command, LoaderCircle, TerminalSquare, X } from "lucide-react";
import { Suspense } from "react";
import { TerminalPanel, ToolchainSetupCard } from "../appShared";
import { ProblemsPanel } from "../../components/ProblemsPanel";
import type { AppCtx } from "../appContext";

export function renderPanelTabs(ctx: AppCtx) {
  const { activePanel, diagnostics, openPanel, setPanelVisible } = ctx;
  return (
    <div className="panel-tabs">
      <button
        className={activePanel === "problems" ? "active" : ""}
        onClick={() => openPanel("problems")}
        data-tour-id="problems"
      >
        <CircleAlert size={13} />
        PROBLEMS
        {diagnostics.length ? (
          <span className="count-badge">{diagnostics.length}</span>
        ) : null}
      </button>
      <button
        className={activePanel === "output" ? "active" : ""}
        onClick={() => openPanel("output")}
      >
        <Command size={13} />
        OUTPUT
      </button>
      <button
        className={activePanel === "terminal" ? "active" : ""}
        onClick={() => openPanel("terminal")}
      >
        <TerminalSquare size={13} />
        TERMINAL
      </button>
      <div />
      <button
        className="panel-close"
        onClick={() => setPanelVisible(false)}
        aria-label="Close bottom panel"
      >
        <X size={15} />
      </button>
    </div>
  );
}

export function renderPanelPane(ctx: AppCtx) {
  const {
    activePanel,
    applyDiagnosticReplacement,
    applyLatexDiagnosticFix,
    compile,
    diagnostics,
    openDiagnostic,
    openExternalLink,
    rootFile,
  } = ctx;
  const activeCompilerSetupIssue = ctx.activeCompilerSetupIssue!;
  return (
    <section
      id="problems-panel"
      aria-label="Problems"
      className={`panel-pane panel-pane-problems ${
        activePanel === "problems" ? "" : "hidden"
      }`}
    >
      {activeCompilerSetupIssue ? (
        <ToolchainSetupCard
          issue={activeCompilerSetupIssue}
          onOpenExternal={openExternalLink}
          onInstalled={() => void compile()}
        />
      ) : (
        <ProblemsPanel
          diagnostics={diagnostics}
          rootFile={rootFile}
          onOpen={(diagnostic) => void openDiagnostic(diagnostic)}
          onApplyFix={(diagnostic, fix) =>
            void applyLatexDiagnosticFix(diagnostic, fix)
          }
          onApplyReplacement={applyDiagnosticReplacement}
        />
      )}
    </section>
  );
}

export function renderPanelContent(ctx: AppCtx) {
  const {
    refreshAfterTerminalCommand,
    activePanel,
    compileResult,
    latexDoCommandService,
    projectId,
    projectPath,
    statusMessage,
    terminalStarted,
  } = ctx;
  return (
    <div className="panel-content">
      {renderPanelPane(ctx)}
      <section
        aria-label="Output"
        className={`panel-pane ${activePanel === "output" ? "" : "hidden"}`}
      >
        <p className="status-message" role="status">
          {statusMessage}
        </p>
        <pre className="build-output">
          {compileResult?.output || "Compile the project to see build output."}
        </pre>
      </section>
      {terminalStarted ? (
        <section
          className={`panel-pane panel-pane-terminal ${
            activePanel === "terminal" ? "" : "hidden"
          }`}
        >
          <Suspense
            fallback={
              <div className="panel-empty" aria-label="Loading terminal">
                <LoaderCircle className="spin" size={16} />
              </div>
            }
          >
            <TerminalPanel
              projectId={projectId}
              workspacePath={projectPath}
              active={activePanel === "terminal"}
              commandService={latexDoCommandService}
              onCommandSettled={() => void refreshAfterTerminalCommand()}
            />
          </Suspense>
        </section>
      ) : null}
    </div>
  );
}
