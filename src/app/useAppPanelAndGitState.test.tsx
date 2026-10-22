import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppPanelAndGitState } from "./useAppPanelAndGitState";
import { defaultSettings } from "../features/settings/settings";
import { defaultAiConfig } from "../features/ai/aiConfig";
import { defaultEnterpriseState } from "../features/enterprise/enterprise";
import type { AppCtx01 } from "./appContext";
import { hookContext } from "./__tests__/hookHarness";
function setup(extra = {}) {
  window.latexdo = { runtime: "browser" } as unknown as typeof window.latexdo;
  const { ctx, state } = hookContext(
    {
      activeDocument: null,
      activePath: "",
      activeResearchSpace: null,
      aiConfig: defaultAiConfig,
      citationProjectFiles: [],
      documents: [],
      engine: "pdflatex",
      enterpriseState: defaultEnterpriseState,
      hideProjectEntries: false,
      initialWorkspaceFlags: { panelVisible: false },
      installedExtensionSnippets: [],
      previewVisible: false,
      projectDisplayName: "Paper",
      projectEntries: [],
      projectId: "p",
      projectPath: "/p",
      rootFile: "main.tex",
      settings: defaultSettings,
      welcomeOpen: false,
      ...extra,
    },
    ["setActivePath", "setEngine", "setSettings", "setStatusMessage"],
    [],
  );
  return { ...renderHook(() => useAppPanelAndGitState(ctx as AppCtx01)), state };
}
afterEach(() => vi.restoreAllMocks());
describe("workspace settings command integration", () => {
  it("updates and resets compiler settings through the terminal command service", async () => {
    const h = setup();
    const command = h.result.current.latexDoCommandService;
    expect((await command.execute("latexdo settings get defaultEngine")).ok).toBe(true);
    await act(async () => {
      expect(
        (await command.execute("latexdo settings set defaultEngine lualatex")).ok,
      ).toBe(true);
    });
    expect(h.state.settings.defaultEngine).toBe("lualatex");
    expect(h.state.engine).toBe("lualatex");
    expect(h.result.current.engineRef.current).toBe("lualatex");
    await act(async () => {
      expect((await command.execute("latexdo settings reset defaultEngine")).ok).toBe(
        true,
      );
    });
    expect(h.state.engine).toBe(defaultSettings.defaultEngine);
    expect(h.state.settings.defaultEngine).toBe(defaultSettings.defaultEngine);
    expect((await command.execute("latexdo version")).ok).toBe(true);
  });
  it("chooses the paper folder for new files with safe empty-space fallbacks", () => {
    const h = setup({
      activeResearchSpace: {
        folders: [
          { name: "Notes", kind: "notes" },
          { name: "Paper", kind: "paper" },
        ],
      },
    });
    expect(h.result.current.defaultCreateRelativePath("file")).toBe(
      "Paper/chapter.tex",
    );
    expect(h.result.current.defaultCreateRelativePath("folder")).toBe("Paper/chapters");
  });
  it("uses project-relative defaults outside Research Spaces", () => {
    const h = setup();
    expect(h.result.current.defaultCreateRelativePath("file")).toBe("chapter.tex");
    expect(h.result.current.defaultCreateRelativePath("folder")).toBe("chapters");
  });
  it("exports a readable compliance report as Markdown", () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:report");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const h = setup();
    h.result.current.exportEnterpriseReport();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text/markdown" }),
    );
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:report");
    expect(h.state.statusMessage).toBe("Enterprise compliance report exported");
  });
});
