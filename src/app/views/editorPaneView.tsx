import { supportLatexDoUrl } from "../../features/settings/settings";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  BookOpenText,
  CircleCheck,
  CircleAlert,
  FileText,
  Code2,
  Command,
  Download,
  FilePlus2,
  FileUp,
  FileImage,
  FolderPlus,
  FolderOpen,
  LoaderCircle,
  Lock,
  Plus,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import React, { Suspense } from "react";
import { DEFAULT_SPLIT_PERCENT } from "../../features/layout/paneLayout";
import { productConfig } from "../../productConfig";
import TikzCanvas from "../../TikzCanvas";
import TableCanvas from "../../TableCanvas";
import { FigureToTikzConverter } from "../../components/FigureToTikzConverter";
import { GitDiffWorkbench } from "../../components/GitDiffWorkbench";
import { CitationManager } from "../../components/CitationManager";
import { VisualLatexEditor } from "../../components/VisualLatexEditor";
import { ResearchPdfReader } from "../../features/pdfResearch/reader/ResearchPdfReader";
import { NotationManager } from "../../components/NotationManager";
import { ExtensionDetailPanel } from "../../components/ExtensionsSidebar";
import { pathForDisplay } from "../../pathDisplay";
import { verifyCitationCached } from "../../features/citations/citationVerification";
import { fileName, languageFor } from "../../features/project/projectUtils";
import { proseLanguages } from "../../features/editor/wordCompletion/registerWordCompletion";
import {
  AppIcon,
  MonacoEditor,
  PdfPreview,
  assetPreviewTypeLabel,
  formatAssetSize,
} from "../appShared";
import type { AppCtx } from "../appContext";
import { toolTabIds, type ToolTabKey } from "../../features/workspace/toolTabs";
import {
  renderKnowledgeGraphTab,
  renderSourceToolbar,
} from "./sourceControlAndToolbarView";

export function renderWelcomePage(ctx: AppCtx) {
  const {
    openExternalLink,
    availableWelcomeTemplates,
    createProject,
    createProjectFromTemplate,
    createResearchSpace,
    docxImporting,
    hasVisibleProject,
    importDocx,
    importMarkdown,
    importPdf,
    markdownImporting,
    openCreateDialog,
    openProject,
    paperReviewImporting,
    pdfImporting,
    renderTemplateIcon,
    reviewPaper,
    templateCreating,
  } = ctx;
  return (
    <div className="welcome-page">
      <div className="welcome-hero">
        <AppIcon className="welcome-brand" />
        <div>
          <p className="welcome-kicker">{productConfig.welcomeKicker}</p>
          <h1>{productConfig.welcomeTitle}</h1>
          <p>{productConfig.welcomeSubtitle}</p>
        </div>
      </div>

      {productConfig.commandCenterItems.length > 0 ? (
        <section
          className="welcome-command-center"
          aria-labelledby="welcome-command-title"
        >
          <h2 id="welcome-command-title">{productConfig.commandCenterTitle}</h2>
          <div className="welcome-command-grid">
            {productConfig.commandCenterItems.map((item) => (
              <div className="welcome-command-item" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="welcome-grid">
        <section className="welcome-section">
          <h2>Start</h2>
          <button
            className="welcome-action primary"
            onClick={() => void reviewPaper()}
            disabled={paperReviewImporting}
          >
            <BookOpenText size={18} />
            <span>
              <strong>Review Paper</strong>
              <small>Read, annotate, highlight, and ask AI about a PDF</small>
            </span>
          </button>
          <button
            className="welcome-action primary"
            onClick={() => void createProject()}
          >
            <Plus size={18} />
            <span>
              <strong>{productConfig.newProjectTitle}</strong>
              <small>{productConfig.newProjectDescription}</small>
            </span>
          </button>
          <button className="welcome-action" onClick={openProject}>
            <FolderOpen size={18} />
            <span>
              <strong>Open Folder or Research Space</strong>
              <small>
                Open any folder with your LaTeX files, or a .latexdo-space file
              </small>
            </span>
          </button>
          <button className="welcome-action" onClick={() => void createResearchSpace()}>
            <FolderPlus size={18} />
            <span>
              <strong>New Research Space</strong>
              <small>Save multiple papers, shared .bib files, figures, and data</small>
            </span>
          </button>
          {hasVisibleProject ? (
            <button className="welcome-action" onClick={() => openCreateDialog("file")}>
              <FilePlus2 size={18} />
              <span>
                <strong>New File</strong>
                <small>Add a .tex, .bib, or text file to this project</small>
              </span>
            </button>
          ) : null}
          <button
            className="welcome-action"
            onClick={() => void importDocx()}
            disabled={docxImporting}
          >
            <FileUp size={18} />
            <span>
              <strong>Import DOCX</strong>
              <small>Convert a Word document into LaTeX and extracted media</small>
            </span>
          </button>
          <button
            className="welcome-action"
            onClick={() => void importMarkdown()}
            disabled={markdownImporting}
          >
            <Code2 size={18} />
            <span>
              <strong>Import Markdown</strong>
              <small>Convert a Markdown file into LaTeX</small>
            </span>
          </button>
          <button
            className="welcome-action"
            onClick={() => void importPdf()}
            disabled={pdfImporting}
          >
            <FileImage size={18} />
            <span>
              <strong>Convert PDF to LaTeX</strong>
              <small>Rebuild editable LaTeX from a searchable PDF</small>
            </span>
          </button>
          <p className="welcome-support">
            ♥ LatexDo is free and open source, built by a nonprofit.{" "}
            <button type="button" onClick={() => openExternalLink(supportLatexDoUrl)}>
              Support it
            </button>
          </p>
        </section>
        <section className="welcome-section welcome-template-section">
          <h2>{productConfig.templateGalleryTitle}</h2>
          <div className="welcome-template-grid">
            {availableWelcomeTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                className="welcome-template-card"
                onClick={() => void createProjectFromTemplate(template)}
                disabled={templateCreating !== null}
              >
                <span className="welcome-template-icon">
                  {renderTemplateIcon(template)}
                </span>
                <span className="welcome-template-copy">
                  <strong>{template.name}</strong>
                  <small>{template.summary}</small>
                  <em>
                    {templateCreating === template.id ? "Creating..." : template.files}
                  </em>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="welcome-tip">
        <Command size={14} />
        <span>
          {productConfig.compileTip} <kbd>⌘</kbd> <kbd>Enter</kbd>
        </span>
      </div>
    </div>
  );
}

export function renderAssetPreviewPane(ctx: AppCtx) {
  const { agentContext, aiConfig, aiIsDesktop, openAiSettings, pdfRotation, pdfScale } =
    ctx;
  const activeDocument = ctx.activeDocument!;
  const activeResearchDocument = ctx.activeResearchDocument!;
  return (
    <div
      className={`asset-preview-pane ${
        activeDocument.assetMimeType === "application/pdf"
          ? "asset-preview-pdf-pane"
          : ""
      }`}
      aria-label={`${pathForDisplay(activeDocument.relativePath)} preview`}
    >
      {activeDocument.assetMimeType === "application/pdf" &&
      activeDocument.assetBytes &&
      activeResearchDocument ? (
        <Suspense
          fallback={
            <div className="preview-empty" aria-label="Loading PDF">
              <LoaderCircle className="spin" size={18} />
            </div>
          }
        >
          <ResearchPdfReader
            document={activeResearchDocument}
            data={activeDocument.assetBytes}
            scale={pdfScale}
            rotation={pdfRotation}
            config={aiConfig}
            agentContext={agentContext}
            isDesktop={aiIsDesktop}
            onOpenSettings={openAiSettings}
          />
        </Suspense>
      ) : activeDocument.assetMimeType === "application/pdf" ? (
        <div className="asset-preview-fallback">PDF preview unavailable.</div>
      ) : (
        <img
          className="asset-preview-image"
          src={activeDocument.assetDataUrl}
          alt={`${pathForDisplay(activeDocument.relativePath)} preview`}
          draggable={false}
        />
      )}
    </div>
  );
}

export function renderEditorDropZone(ctx: AppCtx) {
  const {
    activeCollaborationReadOnlyMessage,
    activeDocumentIsLatex,
    configureMonaco,
    editorTheme,
    handleEditorChange,
    handleEditorFileDrop,
    handleEditorMount,
    latexEditorView,
    settings,
  } = ctx;
  const activeDocument = ctx.activeDocument!;
  return (
    <div
      className="editor-drop-zone"
      onDragOver={(event) => {
        const types = Array.from(event.dataTransfer.types);
        if (types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        } else if (types.includes("text/plain")) {
          // Lets a file dragged from the project tree be dropped here.
          event.preventDefault();
        }
      }}
      onDropCapture={(event) => void handleEditorFileDrop(event)}
    >
      {activeCollaborationReadOnlyMessage ? (
        <div className="editor-readonly-banner" role="status">
          <Lock size={13} />
          <span>{activeCollaborationReadOnlyMessage}</span>
        </div>
      ) : null}
      {activeDocumentIsLatex && latexEditorView === "visual" ? (
        <VisualLatexEditor
          key={`${activeDocument.path}:visual`}
          content={activeDocument.content}
          readOnly={Boolean(activeCollaborationReadOnlyMessage)}
          onChange={(value) => handleEditorChange(activeDocument.path, value)}
        />
      ) : (
        <Suspense
          fallback={
            <div className="editor-loading" role="status">
              Loading editor...
            </div>
          }
        >
          <MonacoEditor
            key={activeDocument.path}
            path={activeDocument.path}
            defaultValue={activeDocument.content}
            defaultLanguage={languageFor(activeDocument.name)}
            language={languageFor(activeDocument.name)}
            theme={editorTheme}
            beforeMount={configureMonaco}
            onMount={handleEditorMount}
            onChange={(value) => handleEditorChange(activeDocument.path, value)}
            options={{
              readOnly: Boolean(activeCollaborationReadOnlyMessage),
              readOnlyMessage: {
                value:
                  activeCollaborationReadOnlyMessage || "This document is read-only.",
              },
              fontFamily:
                "'SFMono-Regular', 'Cascadia Code', 'Fira Code', Menlo, monospace",
              fontSize: settings.editorFontSize,
              lineHeight: 22,
              minimap: { enabled: settings.minimap, scale: 0.75 },
              padding: { top: 16, bottom: 24 },
              renderWhitespace: "selection",
              smoothScrolling: true,
              cursorSmoothCaretAnimation: "on",
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true, indentation: true },
              wordWrap: settings.wordWrap ? "on" : "off",
              glyphMargin: true,
              folding: true,
              foldingStrategy: "auto",
              showFoldingControls: "mouseover",
              links: true,
              multiCursorModifier: "alt",
              multiCursorPaste: "spread",
              columnSelection: false,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              fixedOverflowWidgets: false,
              // Light DOM, so the app stylesheet can add icons to the context menu.
              useShadowDOM: false,
              acceptSuggestionOnCommitCharacter: false,
              acceptSuggestionOnEnter: "on",
              tabCompletion: "on",
              quickSuggestions: {
                other: true,
                comments: false,
                strings: true,
              },
              snippetSuggestions: "top",
              // Prose files use the ranked word completion instead.
              wordBasedSuggestions: proseLanguages.has(languageFor(activeDocument.name))
                ? "off"
                : "currentDocument",
              // Copilot-style ghost text, with its hover toolbar.
              inlineSuggest: { enabled: true, showToolbar: "onHover" },
              suggest: {
                showSnippets: true,
                showStatusBar: true,
                showInlineDetails: true,
                preview: true,
              },
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

export function renderSourcePane(ctx: AppCtx) {
  const {
    activeDocumentIsAssetPreview,
    closeGitDiffSession,
    configureMonaco,
    editorTheme,
    gitBlameLines,
    knowledgeGraphActive,
    toolTabActive,
    openGitFile,
    openProject,
    settings,
    showBlankWorkspace,
    showEmptyEditor,
    showWelcome,
    showWelcomePage,
  } = ctx;
  const activeDocument = ctx.activeDocument!;
  const gitDiffSession = ctx.gitDiffSession!;
  return (
    <section
      className={`source-pane ${showWelcome ? "welcome-only" : ""} ${showEmptyEditor ? "empty-only" : ""} ${gitDiffSession ? "git-diff-active" : ""} ${toolTabActive ? "tool-tab-active" : ""}`}
      data-tour-id="editor"
    >
      {activeDocument &&
      !showWelcome &&
      !gitDiffSession &&
      activeDocumentIsAssetPreview &&
      // PDFs open in Reader Mode, whose own strip shows the title and tools.
      activeDocument.assetMimeType !== "application/pdf" ? (
        <div className="source-toolbar asset-source-toolbar">
          <div className="asset-toolbar-file">
            <span className="pane-label">
              {assetPreviewTypeLabel(activeDocument.assetMimeType)}
            </span>
            <FileImage size={14} />
            <span>{pathForDisplay(activeDocument.relativePath)}</span>
            {formatAssetSize(activeDocument.assetSizeBytes) ? (
              <small>{formatAssetSize(activeDocument.assetSizeBytes)}</small>
            ) : null}
          </div>
        </div>
      ) : null}
      {activeDocument &&
      !showWelcome &&
      !gitDiffSession &&
      !activeDocumentIsAssetPreview
        ? renderSourceToolbar(ctx)
        : null}
      {renderToolTabs(ctx)}
      {toolTabActive ? null : knowledgeGraphActive ? (
        renderKnowledgeGraphTab(ctx)
      ) : showWelcome ? (
        renderWelcomePage(ctx)
      ) : activeDocumentIsAssetPreview && activeDocument?.assetDataUrl ? (
        renderAssetPreviewPane(ctx)
      ) : activeDocument ? (
        renderEditorDropZone(ctx)
      ) : gitDiffSession ? (
        <GitDiffWorkbench
          session={gitDiffSession}
          theme={editorTheme}
          fontSize={settings.editorFontSize}
          blameLines={gitBlameLines}
          beforeMount={configureMonaco}
          onOpenFile={(relativePath) => void openGitFile(relativePath)}
          onClose={() => closeGitDiffSession()}
        />
      ) : (
        <div className="empty-editor">
          <AppIcon className="empty-logo" />
          <h2>{showBlankWorkspace ? "No project is open" : "No editor is open"}</h2>
          <button onClick={showBlankWorkspace ? openProject : showWelcomePage}>
            {showBlankWorkspace ? "Open Folder" : "Show Welcome"}
          </button>
        </div>
      )}
    </section>
  );
}

export function renderSplitHandle(ctx: AppCtx) {
  const {
    compileResult,
    compiling,
    downloadPdf,
    handleBackwardSync,
    handleEditorCursorToPdf,
    handlePdfPointToSource,
    lastPdfLocation,
    nudgeSplit,
    pdfRotation,
    pdfScale,
    pdfSurfaceRef,
    pdfTarget,
    rootFile,
    schedulePdfScrollSync,
    setLastPdfLocation,
    setPdfRotation,
    setPdfScale,
    setPdfTarget,
    setSplitPercent,
    startResize,
  } = ctx;
  const pdfData = ctx.pdfData!;
  const pdfStatus = compiling
    ? "Building PDF"
    : compileResult?.ok === false
      ? "Build failed — showing the previous PDF"
      : compileResult?.ok
        ? "PDF ready"
        : "PDF preview";
  const PdfStatusIcon = compiling
    ? LoaderCircle
    : compileResult?.ok === false
      ? CircleAlert
      : compileResult?.ok
        ? CircleCheck
        : FileText;
  return (
    <>
      <div
        className="split-handle"
        onPointerDown={startResize}
        onDoubleClick={() => setSplitPercent(DEFAULT_SPLIT_PERCENT)}
        onKeyDown={nudgeSplit}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize editor and PDF preview"
        title="Drag to resize · double-click to reset"
        tabIndex={0}
      />
      <section className="preview-pane" data-tour-id="pdf-preview">
        <div className="preview-header">
          <div>
            <span
              className="pdf-build-status"
              role="img"
              aria-label={pdfStatus}
              title={pdfStatus}
            >
              <PdfStatusIcon
                size={15}
                className={compiling ? "spin" : undefined}
                aria-hidden="true"
              />
            </span>
            <span>{fileName(rootFile).replace(/\.tex$/, ".pdf")}</span>
          </div>
          <div className="preview-actions">
            <button
              onClick={() => void handlePdfPointToSource()}
              disabled={!pdfData || !(pdfTarget ?? lastPdfLocation)}
              title="Show PDF point in source"
              aria-label="Show PDF point in source"
              data-tour-id="pdf-source-nav"
            >
              <ArrowLeftToLine size={15} />
            </button>
            <button
              onClick={() => void handleEditorCursorToPdf()}
              title="Show editor cursor in PDF"
              aria-label="Show editor cursor in PDF"
            >
              <ArrowRightToLine size={15} />
            </button>
            <div className="preview-action-divider" aria-hidden="true" />
            <button
              onClick={() => setPdfScale((scale) => Math.max(60, scale - 10))}
              title="Zoom out"
            >
              <ZoomOut size={15} />
            </button>
            <span>{pdfScale}%</span>
            <button
              onClick={() => setPdfScale((scale) => Math.min(180, scale + 10))}
              title="Zoom in"
            >
              <ZoomIn size={15} />
            </button>
            <button
              onClick={() => setPdfRotation((rotation) => (rotation + 90) % 360)}
              title={`Rotate PDF (${pdfRotation} deg)`}
              aria-label="Rotate PDF"
            >
              <RotateCw size={15} />
            </button>
            <button onClick={() => void downloadPdf()} title="Download PDF">
              <Download size={14} />
            </button>
          </div>
        </div>
        <div
          ref={pdfSurfaceRef}
          className="pdf-surface"
          onScroll={schedulePdfScrollSync}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              setPdfScale((s) =>
                Math.max(60, Math.min(180, s + (e.deltaY > 0 ? -10 : 10))),
              );
            }
          }}
        >
          {pdfData ? (
            <Suspense
              fallback={
                <div className="preview-empty" aria-label="Loading PDF">
                  <LoaderCircle className="spin" size={18} />
                </div>
              }
            >
              <PdfPreview
                data={pdfData}
                scale={pdfScale}
                rotation={pdfRotation}
                target={pdfTarget}
                onNavigate={(location) => {
                  setPdfTarget(null);
                  setLastPdfLocation(location);
                  void handleBackwardSync(location);
                }}
              />
            </Suspense>
          ) : (
            <div className="preview-empty">
              <div className="paper-skeleton">
                <div className="paper-title" />
                <div className="paper-subtitle" />
                <div className="paper-line wide" />
                <div className="paper-line" />
                <div className="paper-line medium" />
                <div className="paper-heading" />
                <div className="paper-line wide" />
                <div className="paper-line medium" />
              </div>
              <p>Compile to generate the PDF preview</p>
              <span>
                <Command size={12} /> Ctrl/⌘ + Enter
              </span>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

/**
 * Tools as workspace tabs (TikZ and the extension tools). They stay mounted
 * while open, so their state survives switching to a document and back; only
 * the active one is shown.
 */
export function renderToolTabs(ctx: AppCtx) {
  const {
    activePath,
    citationAnalysis,
    citationLibraryError,
    citationLibraryLoading,
    closeToolTab,
    documents,
    extensionCatalog,
    extensionDetailsId,
    handleAppendBibEntry,
    installExtension,
    installedExtensionIdSet,
    openExternalLink,
    uninstallExtension,
    handleInsertCitationCode,
    handleInsertNotationCode,
    insertFigure,
    insertTextFromTool,
    mergeBibliographyFiles,
    runInReturnDocument,
    toolReturnPath,
    toolTabOpen,
  } = ctx;
  const returnDocument = documents.find(
    (document) => document.path === toolReturnPath(),
  );
  const detailsExtension = extensionCatalog.extensions.find(
    (extension) => extension.id === extensionDetailsId,
  );
  const tab = (key: ToolTabKey, label: string, content: React.ReactNode) =>
    toolTabOpen[key] ? (
      <div
        key={key}
        className="tool-tab"
        hidden={activePath !== toolTabIds[key]}
        role="region"
        aria-label={label}
      >
        {content}
      </div>
    ) : null;
  return (
    <>
      {tab(
        "tikzCanvas",
        "TikZ drawing",
        <TikzCanvas
          active={activePath === toolTabIds.tikzCanvas}
          onInsertCode={insertFigure}
        />,
      )}
      {tab(
        "tikzConverter",
        "Figure to TikZ converter",
        <FigureToTikzConverter onInsertCode={insertFigure} />,
      )}
      {tab(
        "tableGenerator",
        "Table generator",
        <TableCanvas onInsertCode={insertTextFromTool} />,
      )}
      {tab(
        "notationManager",
        "Notation manager",
        <NotationManager
          content={
            returnDocument && "content" in returnDocument ? returnDocument.content : ""
          }
          onInsertCode={(code) =>
            runInReturnDocument(() => handleInsertNotationCode(code))
          }
        />,
      )}
      {tab(
        "citationManager",
        "Citation manager",
        <CitationManager
          analysis={citationAnalysis}
          loading={citationLibraryLoading}
          error={citationLibraryError}
          activeDocumentPath={returnDocument?.relativePath}
          onInsertCitation={(key, command) =>
            runInReturnDocument(() => handleInsertCitationCode(key, command))
          }
          onAppendBibEntry={handleAppendBibEntry}
          onMergeBibFiles={() => void mergeBibliographyFiles()}
          onRemoveUnused={() => void ctx.removeUnusedBibliographyEntries()}
          onClose={() => closeToolTab(toolTabIds.citationManager)}
          verifyEntry={verifyCitationCached}
        />,
      )}
      {detailsExtension
        ? tab(
            "extensionDetails",
            `${detailsExtension.name} extension`,
            <ExtensionDetailPanel
              extension={detailsExtension}
              installed={installedExtensionIdSet.has(detailsExtension.id)}
              onInstallExtension={installExtension}
              onUninstallExtension={uninstallExtension}
              onOpenExternal={openExternalLink}
            />,
          )
        : null}
    </>
  );
}
