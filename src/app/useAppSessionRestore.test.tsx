import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppSessionRestore } from "./useAppSessionRestore";
import type { AppCtx17 } from "./appContext";
import type { OpenDocument, ProjectEntry } from "../types";
import type { LatexDoExtensionManifest } from "../extensions";
import { toolTabIds } from "../features/workspace/toolTabs";
const key = "latexdo.session.tabs.v1";
const entry = (name: string): ProjectEntry => ({ name, path: `/p/${name}`, relativePath: name, type: "file" });
const doc = (name: string): OpenDocument => ({ ...entry(name), kind: "text", content: "new", savedContent: "old" });
function setup(overrides: Record<string, unknown> = {}) {
  const ctx = {
    activePath: "/p/a.tex", activePathRef: { current: "" },
    documents: [] as OpenDocument[], documentsRef: { current: [] as OpenDocument[] },
    extensionToolAvailability: { tikzConverter: true, notationManager: true, projectBibliography: true, tableGenerator: true },
    openDocument: vi.fn(), projectEntries: [entry("a.tex"), entry("b.tex")],
    projectId: "p", projectPath: "/p", saveDocument: vi.fn().mockResolvedValue(undefined),
    setActivePath: vi.fn(), setSettingsOpen: vi.fn(), setSettingsTab: vi.fn(), setStatusMessage: vi.fn(), openToolTab: vi.fn(),
    ...overrides,
  };
  return { ...renderHook(() => useAppSessionRestore(ctx as unknown as AppCtx17)), ctx };
}
const unload = () => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event; };
beforeEach(() => { localStorage.clear(); window.latexdo = { runtime: "desktop" } as typeof window.latexdo; vi.spyOn(window, "close").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("session restoration", () => {
  it("restores existing tabs once and reselects the saved active file", async () => {
    localStorage.setItem(key, JSON.stringify({ "/p": { open: ["a.tex", "b.tex", "missing.tex"], active: "b.tex" } }));
    const { ctx, rerender } = setup();
    ctx.documentsRef.current = [doc("a.tex")];
    ctx.openDocument.mockImplementation(async (file) => { ctx.documentsRef.current.push(doc(file.name)); });
    await act(async () => {});
    expect(ctx.openDocument).toHaveBeenCalledWith(entry("b.tex"), "p", { announce: false });
    expect(ctx.setActivePath).toHaveBeenLastCalledWith("/p/b.tex");
    const count = ctx.openDocument.mock.calls.length;
    rerender();
    expect(ctx.openDocument).toHaveBeenCalledTimes(count);
  });
  it("ignores vanished and unreadable tabs", async () => {
    localStorage.setItem(key, JSON.stringify({ "/p": { open: ["a.tex", "gone"], active: "gone" } }));
    const { ctx } = setup({ openDocument: vi.fn().mockRejectedValue(new Error("denied")) });
    await act(async () => {});
    expect(ctx.setActivePath).not.toHaveBeenCalled();
  });
  it.each(["not json", "null", "3"])("recovers from invalid stored state %s", (value) => {
    localStorage.setItem(key, value);
    const { ctx } = setup({ documents: [doc("a.tex")] });
    expect(ctx.openDocument).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(key)!)["/p"]).toMatchObject({ open: ["a.tex"], active: "a.tex" });
  });
  it("keeps the newest 30 projects and tolerates storage failures", () => {
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(Array.from({ length: 35 }, (_, i) => [`/old${i}`, { open: [], savedAt: i }]))));
    const { rerender, ctx } = setup();
    const saved = JSON.parse(localStorage.getItem(key)!);
    expect(Object.keys(saved)).toHaveLength(30);
    expect(saved["/old0"]).toBeUndefined();
    expect(saved["/p"]).toBeTruthy();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    ctx.documents = [doc("a.tex")];
    expect(() => rerender()).not.toThrow();
  });
  it.each([{ projectId: "" }, { projectPath: "" }, { projectEntries: [] }])("waits for a project and its files", (override) => {
    const { ctx } = setup(override);
    expect(ctx.openDocument).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
  });
});
describe("saving before close", () => {
  it("saves dirty text documents in sequence and closes only once", async () => {
    const { ctx } = setup();
    ctx.documentsRef.current = [doc("a.tex"), { ...doc("x.png"), kind: "asset" }, { ...doc("clean.tex"), content: "old" }, doc("b.tex")];
    expect(unload().defaultPrevented).toBe(true);
    unload();
    await act(async () => {});
    expect(ctx.saveDocument.mock.calls.map(([d]) => d.name)).toEqual(["a.tex", "b.tex"]);
    expect(window.close).toHaveBeenCalledTimes(1);
  });
  it.each([new Error("disk full"), "offline"])("stays open on save failure and allows retry", async (error) => {
    const { ctx } = setup(); ctx.documentsRef.current = [doc("a.tex")];
    ctx.saveDocument.mockRejectedValueOnce(error);
    unload(); await act(async () => {});
    expect(window.close).not.toHaveBeenCalled();
    expect(ctx.setStatusMessage).toHaveBeenCalledWith(expect.stringContaining(error instanceof Error ? "disk full" : "could not be saved"));
    unload(); await act(async () => {});
    expect(window.close).toHaveBeenCalledTimes(1);
  });
  it("prompts in the browser and removes the listener on unmount", () => {
    const { ctx, unmount } = setup();
    expect(unload().defaultPrevented).toBe(false);
    window.latexdo = { runtime: "browser" } as unknown as typeof window.latexdo;
    ctx.documentsRef.current = [doc("a.tex")];
    expect(unload().defaultPrevented).toBe(true);
    expect(ctx.saveDocument).not.toHaveBeenCalled();
    unmount();
    expect(unload().defaultPrevented).toBe(false);
  });
});
describe("installed extension launch", () => {
  it.each([
    ["tikzConverterEnabled", "tikzConverter", "tikz"],
    ["notationManagerEnabled", "notationManager", "notation"],
    ["projectBibliographyEnabled", "citationManager", "citation"],
    ["tableGeneratorEnabled", "tableGenerator", "editor"],
  ] as const)("opens %s or its settings when disabled", (flag, tool, tab) => {
    const extension = { contributes: { featureFlags: { [flag]: true } } } as LatexDoExtensionManifest;
    const { result, ctx, rerender } = setup();
    expect(result.current.openInstalledExtension(extension)).toBe(true);
    expect(ctx.openToolTab).toHaveBeenCalledWith(toolTabIds[tool]);
    ctx.extensionToolAvailability = { tikzConverter: false, notationManager: false, projectBibliography: false, tableGenerator: false };
    rerender();
    result.current.openInstalledExtension(extension);
    expect(ctx.setSettingsTab).toHaveBeenCalledWith(tab);
    expect(ctx.setSettingsOpen).toHaveBeenCalledWith(true);
  });
  it("opens settings-only extensions and ignores extensions without a launch target", () => {
    const { result, ctx } = setup();
    expect(result.current.openInstalledExtension({ contributes: {} } as LatexDoExtensionManifest)).toBe(false);
    result.current.openInstalledExtension({ contributes: { featureFlags: { errorDoctorEnabled: true } } } as LatexDoExtensionManifest);
    expect(ctx.setSettingsTab).toHaveBeenCalledWith("doctor");
  });
});
