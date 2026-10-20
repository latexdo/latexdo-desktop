/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as monaco from "monaco-editor";
import { useAppEditorDecorations } from "./useAppEditorDecorations";
import type { AppCtx05 } from "./appContext";
import { defaultSettings } from "../features/settings/settings";
import { hookContext } from "./__tests__/hookHarness";
import { editorHarness } from "./__tests__/editorHarness";
const api={readFile:vi.fn(),writeFile:vi.fn(),proofreadDocument:vi.fn(),openExternalUrl:vi.fn()};
function setup(overrides={}){
 const e=editorHarness();const entry={...e.document,type:"file"};
 const {ctx,state}=hookContext({activeDocument:e.document,activeTextDocument:e.document,activePath:e.document.path,activePathRef:{current:e.document.path},documentsRef:{current:[e.document]},documents:[e.document],editorRef:{current:e.editor},projectIdRef:{current:"p"},projectEntriesRef:{current:[entry]},activeBookmarkKey:"main",activeBookmarkLines:[],bookmarkDecorationsRef:{current:[]},bookmarkStore:{},closedTabPathsRef:{current:[]},reopenClosedTabArmedRef:{current:false},pendingSourceRef:{current:null},settings:defaultSettings,proofreadingSettings:{enabled:false},diagnostics:[],reviewChats:[],createDialog:null,settingsOpen:false,gitContextMenu:null,activeSidebar:"files",sidebarVisible:true,...overrides},["setActivePath","setBookmarkStore","setCitationManagerOpen","setCreateDialog","setCreateError","setCreatePath","setDocuments","setEditorCursorLine","setGitContextMenu","setNotationManagerOpen","setProofreadingError","setProofreadingLoading","setProofreadingResult","setSettingsOpen","setSidebarVisible","setStatusMessage","setTableCanvasOpen","setWelcomeOpen","settings","settingsOpen"],["closeActiveTab","compile","defaultCreateRelativePath","openDocument","revealPendingSource","saveActiveAndCompile"]);
 ctx.defaultCreateRelativePath.mockReturnValue("new.tex");return {...renderHook(()=>useAppEditorDecorations(ctx as AppCtx05)),ctx,state,...e,entry};
}
const diagnostic={file:"main.tex",line:1,column:1,endLine:1,endColumn:6,severity:"warning",message:"Typo",source:"proofread",replacements:["Fixed"]};
beforeEach(()=>{vi.useFakeTimers();for(const fn of Object.values(api))fn.mockReset().mockResolvedValue(undefined);api.readFile.mockResolvedValue("First line");api.proofreadDocument.mockResolvedValue({output:"No issues",diagnostics:[]});window.latexdo=api as unknown as typeof window.latexdo;});
afterEach(()=>{cleanup();for(const model of monaco.editor.getModels())model.dispose();vi.clearAllTimers();vi.useRealTimers();});
const key=(key:string,options:KeyboardEventInit={})=>{const event=new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true,...options});window.dispatchEvent(event);return event;};
describe("editor diagnostics and proofreading",()=>{
 it("applies proofreading suggestions to the target buffer",()=>{
  const h=setup();h.result.current.applyDiagnosticReplacement(diagnostic as any);expect(h.state.documents[0].content).toBe("Fixed line\nSecond line\nThird line");expect(h.state.statusMessage).toBe("Applied suggestion: Fixed");h.ctx.setDocuments.mockClear();h.result.current.applyDiagnosticReplacement({...diagnostic,source:"compiler"} as any);expect(h.ctx.setDocuments).not.toHaveBeenCalled();
 });
 it("applies a validated compiler fix, saves and recompiles",async()=>{
  const h=setup();const fix={title:"Fix typo",line:1,column:1,endLine:1,endColumn:6,expectedText:"First",replacement:"Fixed"};await h.result.current.applyLatexDiagnosticFix(diagnostic as any,fix as any);expect(api.writeFile).toHaveBeenCalledWith("p","main.tex","Fixed line\nSecond line\nThird line");expect(h.state.documents[0].savedContent).toContain("Fixed");expect(h.ctx.compile).toHaveBeenCalledOnce();await act(()=>vi.advanceTimersByTimeAsync(20));expect(h.ctx.revealPendingSource).toHaveBeenCalled();
 });
 it("rejects stale fixes and missing entries, and opens a closed file after a fix",async()=>{
  const h=setup();const fix={title:"Fix",line:1,column:1,endLine:1,endColumn:6,expectedText:"stale",replacement:"Fixed"};await h.result.current.applyLatexDiagnosticFix(diagnostic as any,fix as any);expect(api.writeFile).not.toHaveBeenCalled();expect(h.state.statusMessage).toContain("source changed");await h.result.current.applyLatexDiagnosticFix({...diagnostic,file:"missing.tex"} as any,fix as any);expect(h.state.statusMessage).toContain("Could not find");h.ctx.documentsRef.current=[];await h.result.current.applyLatexDiagnosticFix(diagnostic as any,{...fix,expectedText:"First"} as any);expect(h.ctx.openDocument).toHaveBeenCalledWith(h.entry);
 });
 it("debounces automatic proofreading and exposes result errors",async()=>{
  const h=setup({proofreadingSettings:{enabled:true}});await act(()=>vi.advanceTimersByTimeAsync(649));expect(api.proofreadDocument).not.toHaveBeenCalled();await act(()=>vi.advanceTimersByTimeAsync(1));expect(api.proofreadDocument).toHaveBeenCalled();expect(h.state.statusMessage).toBe("No issues");expect(h.state.proofreadingLoading).toBe(false);api.proofreadDocument.mockResolvedValue({error:"offline"});await h.result.current.runProofreading();expect(h.state.proofreadingError).toBe("offline");api.proofreadDocument.mockRejectedValue("bad");await h.result.current.runProofreading();expect(h.state.proofreadingError).toBe("Proofreading request failed");expect(h.state.proofreadingResult).toBeNull();
 });
 it("clamps diagnostics to valid positions and includes the reported compiler location",()=>{
  const h=setup({diagnostics:[{...diagnostic,line:-5,column:999,endLine:500,endColumn:999,reportedLine:2,reportedColumn:2,locationAccuracy:"exact",severity:"error"},{...diagnostic,file:"other.tex"}]});const markers=monaco.editor.getModelMarkers({resource:h.model.uri});expect(markers).toHaveLength(1);expect(markers[0]).toMatchObject({startLineNumber:1,endLineNumber:3,severity:monaco.MarkerSeverity.Error,source:"LatexDo analysis"});expect(markers[0].relatedInformation?.[0].startLineNumber).toBe(2);
 });
});
describe("editor keyboard routing",()=>{
 it("routes save, compile, create, sidebar and close shortcuts",()=>{
  const h=setup();key("s",{ctrlKey:true});expect(h.ctx.saveActiveAndCompile).toHaveBeenCalledOnce();key("Enter",{metaKey:true});expect(h.ctx.compile).toHaveBeenCalledOnce();key("n",{ctrlKey:true});expect(h.state.createPath).toBe("new.tex");key("b",{ctrlKey:true});expect(h.state.sidebarVisible).toBe(false);key("w",{ctrlKey:true});expect(h.ctx.closeActiveTab).toHaveBeenCalledOnce();key("w",{ctrlKey:true,shiftKey:true});expect(h.ctx.closeActiveTab).toHaveBeenCalledOnce();
 });
 it("closes overlays before the AI sidebar and respects intercepted Escape",()=>{
  const h=setup({createDialog:"file",settingsOpen:true,gitContextMenu:{x:1}});expect(key("Escape").defaultPrevented).toBe(true);expect(h.state.createDialog).toBeNull();expect(h.state.settingsOpen).toBe(false);h.ctx.createDialog=null;h.ctx.settingsOpen=false;h.ctx.gitContextMenu=null;h.ctx.activeSidebar="ai";h.rerender();key("Escape");expect(h.state.sidebarVisible).toBe(false);
 });
 it("blocks save and Escape while legal acceptance is required",()=>{
  const h=setup({legalAcceptanceRequired:true});expect(key("Escape").defaultPrevented).toBe(true);key("s",{ctrlKey:true});expect(h.ctx.saveActiveAndCompile).not.toHaveBeenCalled();
 });
 it("reopens recently closed tabs and disarms undo after pointer activity",()=>{
  const h=setup();const closed={...h.entry,path:"/p/closed.tex",relativePath:"closed.tex"};h.ctx.projectEntriesRef.current.push(closed);h.ctx.closedTabPathsRef.current=[closed.path,"missing",h.document.path];h.ctx.reopenClosedTabArmedRef.current=true;key("z",{ctrlKey:true});expect(h.ctx.openDocument).toHaveBeenCalledWith(closed);window.dispatchEvent(new Event("pointerdown"));expect(h.ctx.reopenClosedTabArmedRef.current).toBe(false);h.ctx.openDocument.mockClear();h.ctx.closedTabPathsRef.current=[closed.path];key("z",{ctrlKey:true});expect(h.ctx.openDocument).not.toHaveBeenCalled();key("t",{ctrlKey:true,shiftKey:true});expect(h.ctx.openDocument).toHaveBeenCalledWith(closed);
 });
});
describe("bookmarks, links and markup decorations",()=>{
 it("adds and removes bookmarks and wraps navigation in both directions",()=>{
  const h=setup({activeBookmarkLines:[1,3]});h.editor.setPosition({lineNumber:2,column:1});h.result.current.toggleBookmarkAtCurrentLine();expect(h.state.bookmarkStore.main).toEqual([1,2,3]);h.editor.setPosition({lineNumber:1,column:1});h.result.current.toggleBookmarkAtCurrentLine();expect(h.state.bookmarkStore.main).toEqual([3]);h.result.current.jumpToBookmark("previous");expect(h.editor.setPosition).toHaveBeenLastCalledWith({lineNumber:3,column:1});h.result.current.jumpToBookmark("next");expect(h.editor.setPosition).toHaveBeenLastCalledWith({lineNumber:1,column:1});
 });
 it("guards absent editors, empty bookmarks and clamps outline positions",async()=>{
  const h=setup();h.result.current.jumpToBookmark("next");expect(h.state.statusMessage).toBe("No bookmarks in this file.");h.result.current.revealOutlineLine(500,500);expect(h.editor.setPosition).toHaveBeenLastCalledWith({lineNumber:3,column:11});h.ctx.editorRef.current=null;h.result.current.toggleBookmarkAtCurrentLine();expect(h.state.statusMessage).toContain("Open a document");await h.result.current.openLinkAtCursor();expect(h.state.statusMessage).toContain("Place the cursor");
 });
 it("opens the link at the cursor and rejects plain text",async()=>{
  const h=setup();await h.result.current.openLinkAtCursor();expect(h.state.statusMessage).toBe("No LaTeX link at the cursor.");h.model.setValue("\\url{https://example.org}");h.editor.setPosition({lineNumber:1,column:10});await h.result.current.openLinkAtCursor();expect(api.openExternalUrl).toHaveBeenCalledWith("https://example.org");
 });
 it("hides nested commands and comments while decorating review threads",()=>{
  const h=setup({settings:{...defaultSettings,showRawLatex:false},reviewChats:[{filePath:"main.tex",selection:{startLine:1,startColumn:1,endLine:1,endColumn:3},comments:[{text:"Check this"}]}]});h.ctx.activeDocument={...h.document,content:"\\section[short[nested]]{Long\n{Title}}\n% comment\n\\emph{text}%tail"};h.rerender();const decs=h.model.getAllDecorations();expect(decs.some(d=>d.options.inlineClassName==="latex-command-hidden")).toBe(true);expect(decs.some(d=>d.options.inlineClassName==="review-comment-decoration")).toBe(true);expect(h.editor.deltaDecorations.mock.calls.at(-1)?.[1]).toHaveLength(4);
 });
});
