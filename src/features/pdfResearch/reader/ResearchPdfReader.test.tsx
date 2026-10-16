import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAiConfig } from "../../ai/aiConfig";
import type { AgentContext } from "../../ai/aiTools";
import type { PdfPreviewOverlay } from "../../../PdfPreview";
import type { ResearchDocument } from "../domain/ResearchDocument";
import { pdfAnnotationStorageKey } from "../annotations/AnnotationStore";
import { ResearchPdfReader } from "./ResearchPdfReader";

const previewMock = vi.hoisted(() => ({
  overlays: [] as PdfPreviewOverlay[],
  lastData: new Uint8Array(),
}));

vi.mock("../../../PdfPreview", () => ({
  default: (props: { data: Uint8Array; overlays: PdfPreviewOverlay[] }) => {
    previewMock.lastData = props.data;
    previewMock.overlays = props.overlays;
    return (
      <div className="pdf-document">
        <div className="pdf-page" data-page-number="1">
          <canvas />
          <div className="textLayer">
            <span data-testid="pdf-text-layer">Attention is all you need.</span>
          </div>
          {props.overlays.map((overlay) => (
            <div
              key={overlay.id}
              data-testid="pdf-overlay"
              className={overlay.className ?? ""}
              title={overlay.title}
            />
          ))}
        </div>
      </div>
    );
  },
}));

const ctx: AgentContext = {
  projectName: () => "Paper",
  activeFilePath: () => "main.tex",
  listFiles: vi.fn().mockResolvedValue(["main.tex"]),
  readFile: vi.fn().mockResolvedValue("\\section{Intro}"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  documentText: () => "\\section{Intro}",
  selection: () => ({ text: "Intro", hasSelection: true }),
  applyEdit: vi.fn().mockResolvedValue(undefined),
  compile: vi.fn().mockResolvedValue({ ok: true, log: "", diagnostics: [] }),
  runChecks: vi.fn().mockResolvedValue("ok"),
  insertCitation: vi.fn().mockResolvedValue(
    JSON.stringify({
      recommendation: { key: "smith2026", citation: "\\citep{smith2026}" },
    }),
  ),
  recommendCitations: vi
    .fn()
    .mockResolvedValue(
      JSON.stringify({ recommendations: [{ key: "smith2026", score: 0.5 }] }),
    ),
  requestApproval: vi.fn().mockResolvedValue(true),
};

function makeDocument(): ResearchDocument {
  return {
    id: "pdf:project-1:/research/paper.pdf",
    projectId: "project-1",
    name: "paper.pdf",
    source: {
      type: "project-file",
      fileId: "/research/paper.pdf",
      relativePath: "papers/paper.pdf",
    },
    metadata: { title: "Attention Paper" },
    processing: { status: "rendering" },
    permissions: { canAnnotate: true, canExport: true },
  };
}

function renderReader() {
  const onOpenSettings = vi.fn();
  render(
    <ResearchPdfReader
      document={makeDocument()}
      data={new Uint8Array([37, 80, 68, 70])}
      scale={120}
      config={{ ...defaultAiConfig, provider: "off" }}
      agentContext={ctx}
      isDesktop
      onOpenSettings={onOpenSettings}
    />,
  );
  return { onOpenSettings };
}

function selectPdfText(selectedText: string = "Attention is all you need.") {
  const pageElement = document.querySelector(".pdf-page") as HTMLElement;
  Object.defineProperty(pageElement, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 612,
      bottom: 792,
      width: 612,
      height: 792,
    }),
  });

  const span = screen.getByTestId("pdf-text-layer");
  const node = span.firstChild as Text;
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, node.textContent?.length ?? 0);
  Object.defineProperty(range, "getClientRects", {
    configurable: true,
    value: () => [
      { left: 120, right: 320, top: 64, bottom: 80, width: 200, height: 16 },
    ],
  });

  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    getRangeAt: () => range,
    toString: () => selectedText,
    removeAllRanges: () => {},
  } as unknown as Selection;
  vi.spyOn(window, "getSelection").mockReturnValue(selection);

  fireEvent.mouseUp(span);
  return selection;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.localStorage.clear();
  previewMock.overlays = [];
  previewMock.lastData = new Uint8Array();
});

describe("ResearchPdfReader", () => {
  it("shows a selection toolbar after selecting text in the PDF", async () => {
    renderReader();
    expect(
      screen.getByPlaceholderText(/Select source text first/i),
    ).toBeInTheDocument();

    selectPdfText();

    const toolbar = await screen.findByRole("toolbar", {
      name: /PDF selection actions/i,
    });
    expect(toolbar).toBeVisible();
    expect(within(toolbar).getByRole("button", { name: /^Ask$/ })).toBeVisible();
    expect(within(toolbar).getByRole("button", { name: /^Explain$/ })).toBeVisible();
    expect(within(toolbar).getByRole("button", { name: /^Highlight$/ })).toBeVisible();
    expect(within(toolbar).getByRole("button", { name: /^Note$/ })).toBeVisible();
    expect(within(toolbar).getByRole("button", { name: /^Copy$/ })).toBeVisible();
  });

  it("highlights the selected passage into a persistent annotation", async () => {
    renderReader();
    selectPdfText();
    const toolbar = await screen.findByRole("toolbar", {
      name: /PDF selection actions/i,
    });
    fireEvent.click(within(toolbar).getByRole("button", { name: /^Highlight$/ }));

    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(
      previewMock.overlays.some((overlay) =>
        overlay.className?.includes("pdf-annotation-highlight"),
      ),
    ).toBe(true);
    expect(screen.getByText(/Highlight · p\.1/i)).toBeVisible();
    const stored = window.localStorage.getItem(pdfAnnotationStorageKey);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? "{}").annotations).toBeDefined();
  });

  it("creates a note with a comment from the selected passage", async () => {
    renderReader();
    selectPdfText();
    const toolbar = await screen.findByRole("toolbar", {
      name: /PDF selection actions/i,
    });
    fireEvent.click(within(toolbar).getByRole("button", { name: /^Note$/ }));

    expect(screen.getByText(/Note on p\.1/i)).toBeVisible();
    fireEvent.change(screen.getByPlaceholderText(/Write your interpretation/i), {
      target: { value: "This passage is the central claim." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save note$/ }));

    expect(
      screen.getAllByText("This passage is the central claim.").length,
    ).toBeGreaterThan(0);
    expect(
      previewMock.overlays.some((overlay) =>
        overlay.className?.includes("pdf-annotation-note"),
      ),
    ).toBe(true);
  });

  it("generates a local TXT review from saved annotations without AI", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:latexdo-review");
    const revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });

    renderReader();
    expect(screen.getByRole("button", { name: /Generate Review/i })).toBeDisabled();

    selectPdfText();
    const toolbar = await screen.findByRole("toolbar", {
      name: /PDF selection actions/i,
    });
    fireEvent.click(within(toolbar).getByRole("button", { name: /^Note$/ }));
    fireEvent.change(screen.getByPlaceholderText(/Write your interpretation/i), {
      target: { value: "This is my reviewer note." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save note$/ }));

    fireEvent.click(screen.getByRole("button", { name: /Generate Review/i }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    const reviewText = await blob.text();
    expect(reviewText).toContain("This is my reviewer note.");
    expect(reviewText).toContain("AI used: No");
    expect(reviewText).toContain("Attention is all you need.");
    expect(screen.getByText(/Generated Attention-Paper-review\.txt/i)).toBeVisible();
  });

  it("attaches the selected passage to the research assistant as context", async () => {
    renderReader();
    selectPdfText();
    const toolbar = await screen.findByRole("toolbar", {
      name: /PDF selection actions/i,
    });
    fireEvent.click(within(toolbar).getByRole("button", { name: /^Ask$/ }));

    const chip = await waitFor(() => {
      const element = document.querySelector(".research-context-chip");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(chip.querySelector("q")?.textContent).toContain(
      "Attention is all you need.",
    );
    expect(chip.querySelector("span")?.textContent).toContain("paper.pdf · p.1");
  });
});
