import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useFolderDrop } from "./useFolderDrop";
import type { AppCtx } from "./appContext";

const api = {
  runtime: "desktop",
  getDroppedFilePaths: vi.fn(() => ["/external/Paper"]),
  openDroppedFolders: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  api.openDroppedFolders.mockResolvedValue(null);
  Object.assign(window, { latexdo: api });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
function setup() {
  const ctx = {
    requireLegalAcceptance: vi.fn(() => false),
    projectIdRef: { current: "local" },
    documentsRef: {
      current: [
        {
          path: "/p/main.tex",
          relativePath: "main.tex",
          name: "main.tex",
          content: "unsaved",
          savedContent: "old",
        },
      ],
    },
    saveDocument: vi.fn().mockResolvedValue(undefined),
    loadProject: vi.fn().mockResolvedValue(undefined),
    setSidebarVisible: vi.fn(),
    setActiveSidebar: vi.fn(),
    setWelcomeOpen: vi.fn(),
    setStatusMessage: vi.fn(),
  };
  const childDrop = vi.fn();
  function Harness() {
    const drop = useFolderDrop(ctx as unknown as AppCtx);
    return (
      <div onDropCapture={drop.onDropCapture}>
        <div data-testid="target" onDrop={childDrop} />
        {drop.dialog}
      </div>
    );
  }
  render(<Harness />);
  const drop = (directory = true) =>
    fireEvent.drop(screen.getByTestId("target"), {
      dataTransfer: {
        items: [
          {
            webkitGetAsEntry: () => ({ isDirectory: directory }),
            getAsFile: () => new File([], "Paper"),
          },
        ],
      },
    });
  return { ctx, drop, childDrop };
}
describe("folder drops", () => {
  it("intercepts directories while leaving regular file imports alone", () => {
    const { drop, childDrop } = setup();
    drop(false);
    expect(childDrop).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    drop();
    expect(childDrop).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.openDroppedFolders).not.toHaveBeenCalled();
  });
  it("opens a new window without replacing or saving the current workspace", async () => {
    const { ctx, drop } = setup();
    drop();
    fireEvent.click(screen.getByRole("button", { name: "Open in New Window" }));
    await waitFor(() =>
      expect(api.openDroppedFolders).toHaveBeenCalledWith(
        ["/external/Paper"],
        "local",
        "window",
      ),
    );
    expect(ctx.saveDocument).not.toHaveBeenCalled();
    expect(ctx.loadProject).not.toHaveBeenCalled();
  });
  it("saves dirty documents before adding folders and reveals the file tree", async () => {
    const project = { id: "space", name: "Study", rootPath: "/study.latexdo-space" };
    api.openDroppedFolders.mockResolvedValue(project);
    const { ctx, drop } = setup();
    drop();
    fireEvent.click(screen.getByRole("button", { name: "Add to Research Space" }));
    await waitFor(() => expect(ctx.setSidebarVisible).toHaveBeenCalledWith(true));
    expect(ctx.saveDocument).toHaveBeenCalledWith(ctx.documentsRef.current[0]);
    expect(ctx.saveDocument.mock.invocationCallOrder[0]).toBeLessThan(
      api.openDroppedFolders.mock.invocationCallOrder[0],
    );
    expect(ctx.loadProject).toHaveBeenCalledWith(project, true, false);
    expect(ctx.setActiveSidebar).toHaveBeenCalledWith("explorer");
  });
  it("keeps the workspace and shows an error if saving fails", async () => {
    const { ctx, drop } = setup();
    ctx.saveDocument.mockRejectedValue(new Error("Disk full"));
    drop();
    fireEvent.click(screen.getByRole("button", { name: "Add to Research Space" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Disk full");
    expect(api.openDroppedFolders).not.toHaveBeenCalled();
    expect(ctx.loadProject).not.toHaveBeenCalled();
  });
});
