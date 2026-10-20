/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as monaco from "monaco-editor";
import { useAppAiActions } from "./useAppAiActions";
import { setMonaco } from "./appShared";
import type { AppCtx10 } from "./appContext";
import { defaultAiConfig } from "../features/ai/aiConfig";
import { knowledgeGraphTabId } from "../features/graph/graphWorkspace";
import { hookContext, deferred } from "./__tests__/hookHarness";
const mocks=vi.hoisted(()=>({reformulate:vi.fn(),abort:vi.fn(),figure:vi.fn(),preview:vi.fn(),dispose:vi.fn(),append:vi.fn()}));
vi.mock("./useAppTikzFigures",()=>({useAppTikzFigures:()=>({insertFigureInEditor:mocks.figure,showFigureInPreview:mocks.preview})}));
vi.mock("../features/ai/aiClient",()=>({abortGeneration:mocks.abort}));
vi.mock("../features/ai/selectionAi",async importOriginal=>({...await importOriginal<any>(),performReformulation:mocks.reformulate}));
vi.mock("../features/ai/reformulationProgress",()=>({showReformulationProgress:()=>({dispose:mocks.dispose,append:mocks.append})}));
const api:Record<string,any>={};
function setup(overrides={}) {
 const model=monaco.editor.createModel("A complete sentence for revision.","latex",monaco.Uri.file(`/p/main-${Math.random()}.tex`));
 const document={path:model.uri.fsPath,relativePath:"main.tex",name:"main.tex",kind:"text",content:model.getValue(),savedContent:model.getValue()};
 const selection=new monaco.Selection(1,1,1,model.getLineMaxColumn(1));
 const editor={getModel:()=>model,getSelection:vi.fn(()=>selection),getPosition:()=>new monaco.Position(1,1),executeEdits:vi.fn((_id:string,edits:any[])=>model.applyEdits(edits)),focus:vi.fn(),pushUndoStop:vi.fn(),revealRangeInCenterIfOutsideViewport:vi.fn()};
 const {ctx,state}=hookContext({
  activationWorkspaceSnapshotRef:{current:null},activeAiSidebarApiRef:{current:{proposeEdit:vi.fn().mockResolvedValue(true),appendSelectionContext:vi.fn()}},activePathRef:{current:document.path},activeTextDocument:document,documents:[document],documentsRef:{current:[document]},editorRef:{current:editor},
  aiConfig:{...defaultAiConfig,selection:{mode:"custom",custom:{kind:"ollama",baseUrl:"http://localhost:11434",model:"qwen"}},provider:"ollama",ollamaModel:"qwen",access:{...defaultAiConfig.access,currentEditor:true,bibliography:true,projectFiles:true}},aiIsDesktop:true,hasVisibleProject:true,projectId:"p",projectIdRef:{current:"p"},projectName:"Paper",rootFile:"main.tex",
  citationAnalysis:{entries:[{key:"smith",type:"article",title:"Neural networks",author:"Smith",year:"2026",journal:"Journal",sourceFile:"refs.bib"}],usages:[]},citationProjectFilesRef:{current:[{path:"refs.bib",content:"@article{smith, title={Neural networks}, author={Smith}, year={2026}}"},{path:"main.tex",content:"\\cite{smith}"}]},
  graphFilterRef:{current:null},graphOpenRef:{current:true},graphSourceRef:{current:null},graphViewStateRef:{current:{}},knowledgeGraph:{nodes:[{key:"smith"}],edges:[]},knowledgeGraphOpen:true,pendingGraphCitationRef:{current:null},
  reformulationCancelledRef:{current:false},reformulationInFlightRef:{current:false},reformulationRequestIdRef:{current:null},activeSidebar:"files",sidebarVisible:false,previewVisible:false,panelVisible:true,activePanel:"output",latexEditorView:"visual",settings:{minimap:true},...overrides,
 },["setActivePanel","setActivePath","setActiveSidebar","setGraphFilter","setGraphViewState","setLatexEditorView","setPanelVisible","setPreviewVisible","setProofreadingError","setProofreadingSettings","setSettings","setSidebarVisible","setSpellCheckerError","setSpellCheckerLoading","setSpellCheckerSettings","setSpellCheckerWordDraft","setStatusMessage"],["compile"]);
 ctx.compile.mockResolvedValue({ok:true,output:"built",diagnostics:[{severity:"warning",file:"main.tex",line:2,message:"warning"}]});
 const hook=renderHook(()=>useAppAiActions(ctx as AppCtx10));return {...hook,ctx,state,model,editor,document,dispose:()=>{hook.unmount();model.dispose();}};
}
beforeEach(()=>{
 vi.useFakeTimers();setMonaco(monaco);
 for(const mock of Object.values(mocks))mock.mockReset();mocks.reformulate.mockResolvedValue({step:{type:"text",content:"A clearer complete sentence."}});mocks.figure.mockResolvedValue({ok:true,message:"Figure inserted"});mocks.preview.mockResolvedValue(undefined);
 for(const name of ["getSpellCheckerSettings","updateSpellCheckerSettings","getProofreadingSettings","updateProofreadingSettings","listProject","readFile","writeFile"])api[name]=vi.fn().mockResolvedValue({enabled:true});api.listProject.mockResolvedValue([{type:"directory",children:[{type:"file",relativePath:"main.tex"}]},{type:"directory"},{type:"file",relativePath:"refs.bib"}]);api.readFile.mockResolvedValue("disk");window.latexdo=api as typeof window.latexdo;
});
afterEach(()=>{cleanup();for(const model of monaco.editor.getModels())model.dispose();vi.clearAllTimers();vi.useRealTimers();});
describe("AI settings and agent context",()=>{
 it.each([["loadSpellCheckerSettings","getSpellCheckerSettings","spellCheckerSettings","spellCheckerError"],["saveSpellCheckerSettings","updateSpellCheckerSettings","spellCheckerSettings","spellCheckerError"],["loadProofreadingSettings","getProofreadingSettings","proofreadingSettings","proofreadingError"],["saveProofreadingSettings","updateProofreadingSettings","proofreadingSettings","proofreadingError"]])("loads and handles failures in %s",async(method,ipc,key,errorKey)=>{
  const h=setup();await (h.result.current as any)[method]({enabled:true},"Saved",{clearWordDraft:true});expect(h.state[key]).toEqual({enabled:true});api[ipc].mockRejectedValue(new Error("Error invoking remote method 'settings': denied"));await (h.result.current as any)[method]({});expect(h.state[errorKey]).toBe("denied");api[ipc].mockRejectedValue("bad");await (h.result.current as any)[method]({});expect(h.state[errorKey]).toMatch(/Could not/);
 });
 it("exposes files, current selection, compiler diagnostics and citation recommendations",async()=>{
  const h=setup();const c=h.result.current.agentContext;expect(c.hasProject!()).toBe(true);expect(c.projectName()).toBe("Paper");expect(c.activeFilePath()).toBe("main.tex");expect(await c.listFiles()).toEqual(["main.tex","refs.bib"]);expect(await c.readFile("main.tex")).toBe("disk");await c.writeFile("a.tex","text");expect(api.writeFile).toHaveBeenCalledWith("p","a.tex","text");expect(c.documentText()).toBe(h.model.getValue());expect(c.selection().hasSelection).toBe(true);expect(await c.compile()).toEqual({ok:true,log:"built",diagnostics:["warning main.tex:2 — warning"]});expect(await c.showFigure!()).toEqual({ok:false,log:"",diagnostics:[]});expect(await c.runChecks("citations")).toContain("no compile-level issues");expect(JSON.parse(await c.insertCitation("smith")).recommendation.key).toBe("smith");expect(JSON.parse(await c.insertCitation("absent-key-xyz")).recommendation).toBeNull();expect(JSON.parse(await c.recommendCitations("Neural networks")).recommendations[0].key).toBe("smith");expect(await c.requestApproval({} as any)).toBe(true);
 });
 it("rejects file operations without a visible project",async()=>{
  const h=setup({hasVisibleProject:false,projectId:null,activeTextDocument:null,editorRef:{current:null}});const c=h.result.current.agentContext;expect(c.hasProject!()).toBe(false);expect(c.projectName()).toBe("");expect(c.activeFilePath()).toBeNull();expect(c.documentText()).toBe("");expect(c.selection().hasSelection).toBe(false);expect(await c.listFiles()).toEqual([]);await expect(c.readFile("x")).rejects.toThrow("No project");await expect(c.writeFile("x","y")).rejects.toThrow("No project");
 });
 it("applies selection, cursor, file and TikZ edits through their proper paths",async()=>{
  const h=setup();const apply=h.result.current.agentContext.applyEdit;await apply({kind:"replace-selection",path:"main.tex",newText:"Replacement"} as any);expect(h.model.getValue()).toBe("Replacement");await apply({kind:"insert-at-cursor",path:"main.tex",newText:"Prefix "} as any);expect(h.model.getValue()).toBe("Prefix Replacement");await apply({kind:"replace-file",path:"main.tex",newText:"Whole file"} as any);expect(h.model.getValue()).toBe("Whole file");await apply({kind:"replace-file",path:"other.tex",newText:"Other"} as any);expect(api.writeFile).toHaveBeenCalledWith("p","other.tex","Other");
  const tikz="\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}";await apply({kind:"insert-at-cursor",newText:tikz} as any);expect(mocks.figure).toHaveBeenCalledWith(h.editor,tikz,"cursor");mocks.figure.mockResolvedValue({ok:false,message:"Invalid figure"});await expect(apply({kind:"replace-selection",newText:tikz} as any)).rejects.toThrow("Invalid figure");
 });
 it("provides tab-specific buffers and rejects stale edits",async()=>{
  const h=setup();let c=h.result.current.contextForWorkspaceTab(h.document.path);expect(c.workspaceTab?.()).toMatchObject({kind:"document",label:"main.tex"});expect(c.activeFilePath()).toBe("main.tex");expect(c.documentText()).toBe(h.model.getValue());expect(c.selection().hasSelection).toBe(true);expect(await c.readFile("./main.tex")).toBe(h.document.content);
  await expect(c.applyEdit({kind:"replace-selection",path:"main.tex",oldText:"stale",newText:"bad"} as any)).rejects.toThrow("selection changed");await c.applyEdit({kind:"replace-selection",path:"main.tex",oldText:h.model.getValue(),newText:"Good"} as any);expect(h.model.getValue()).toBe("Good");h.ctx.activePathRef.current="elsewhere";expect(c.documentText()).toBe(h.document.content);expect(c.selection().hasSelection).toBe(false);await expect(c.applyEdit({kind:"insert-at-cursor",path:"main.tex",newText:"bad"} as any)).rejects.toThrow("no longer active");h.ctx.projectIdRef.current="other";await expect(c.readFile("main.tex")).rejects.toThrow("project changed");
  for(const tab of ["workspace:welcome","workspace:tikz-canvas","workspace:table-generator","workspace:diff","missing"]){c=h.result.current.contextForWorkspaceTab(tab);expect(c.workspaceTab?.()?.kind).toBe("other");expect(c.documentText()).toBe("");expect(c.activeFilePath()).toBeNull();}
 });
});
describe("selection reformulation",()=>{
 it("requires user approval before editing and disposes progress",async()=>{
  const h=setup();mocks.reformulate.mockImplementation(async(_config,_snapshot,onToken)=>{onToken("draft");return {step:{type:"text",content:"A clearer complete sentence."}};});await h.result.current.reformulateSelectionWithAi();expect(h.model.getValue()).toBe("A clearer complete sentence.");expect(h.ctx.activeAiSidebarApiRef.current.proposeEdit).toHaveBeenCalledOnce();expect(mocks.append).toHaveBeenCalledWith("draft");expect(mocks.dispose).toHaveBeenCalled();expect(h.ctx.reformulationInFlightRef.current).toBe(false);expect(h.ctx.reformulationRequestIdRef.current).toBeNull();expect(h.state.statusMessage).toBe("Reformulation applied.");
 });
 it.each([[{type:"text",content:"partial",truncated:true},"cut off"],[{type:"error",content:"offline"},"offline"],[{type:"text",content:""},"empty result"]])("does not apply unsafe results %j",async(step,message)=>{
  const h=setup();mocks.reformulate.mockResolvedValue({step});await h.result.current.reformulateSelectionWithAi();expect(h.editor.executeEdits).not.toHaveBeenCalled();expect(h.state.statusMessage).toContain(message);expect(h.ctx.reformulationInFlightRef.current).toBe(false);
 });
 it("preserves user edits made while generation is pending",async()=>{
  const h=setup();const pending=deferred<any>();mocks.reformulate.mockReturnValue(pending.promise);const request=h.result.current.reformulateSelectionWithAi();h.model.setValue("A new sentence written by the author.");pending.resolve({step:{type:"text",content:"Old rewrite"}});await request;expect(h.model.getValue()).toBe("A new sentence written by the author.");expect(h.state.statusMessage).toContain("selected text changed");
 });
 it("cancels pending generation without applying the eventual result",async()=>{
  const h=setup();const pending=deferred<any>();mocks.reformulate.mockReturnValue(pending.promise);const request=h.result.current.reformulateSelectionWithAi();h.result.current.cancelReformulation();expect(mocks.abort).toHaveBeenCalledWith(expect.any(String));pending.resolve({step:{type:"text",content:"Rewrite"}});await request;expect(h.editor.executeEdits).not.toHaveBeenCalled();expect(h.state.statusMessage).toBe("Reformulation cancelled.");
 });
 it("handles declined proposals and transport errors",async()=>{
  const h=setup();h.ctx.activeAiSidebarApiRef.current.proposeEdit.mockResolvedValue(false);await h.result.current.reformulateSelectionWithAi();expect(h.state.statusMessage).toContain("declined");expect(h.editor.executeEdits).not.toHaveBeenCalled();mocks.reformulate.mockRejectedValue(new Error("offline"));await h.result.current.reformulateSelectionWithAi();expect(h.state.statusMessage).toContain("offline");expect(h.ctx.reformulationInFlightRef.current).toBe(false);
 });
 it("rejects empty selections, unconfigured AI and duplicate requests",async()=>{
  const h=setup();h.model.setValue("");await h.result.current.reformulateSelectionWithAi();expect(h.state.statusMessage).toBe("Select text to reformulate.");h.result.current.askAiAboutSelection();expect(h.state.statusMessage).toBe("Select text to ask AI about.");h.model.setValue("A complete sentence for revision.");h.ctx.reformulationInFlightRef.current=true;await h.result.current.reformulateSelectionWithAi();expect(h.state.statusMessage).toContain("already in progress");h.ctx.aiConfig={...defaultAiConfig,provider:"off",selection:{mode:"off"}};h.rerender();await h.result.current.reformulateSelectionWithAi();expect(h.state.statusMessage).toContain("not configured");expect(mocks.reformulate).not.toHaveBeenCalled();
 });
 it("attaches selected text to the mounted chat on the next frame",async()=>{
  const h=setup();h.result.current.askAiAboutSelection();await act(()=>vi.advanceTimersByTimeAsync(20));expect(h.ctx.activeAiSidebarApiRef.current.appendSelectionContext).toHaveBeenCalledWith(expect.objectContaining({type:"editor-selection",filePath:"main.tex",text:h.document.content}));expect(h.state.activeSidebar).toBe("ai");
 });
 it("times out when the AI sidebar never mounts",async()=>{
  const h=setup({activeAiSidebarApiRef:{current:null}});const pending=h.result.current.reformulateSelectionWithAi();await act(()=>vi.advanceTimersByTimeAsync(2500));await pending;expect(h.state.statusMessage).toContain("Could not open the AI chat");expect(h.ctx.reformulationInFlightRef.current).toBe(false);
 });
});
describe("graph and workspace actions",()=>{
 it("filters the graph by query, citations, keys and all entries",async()=>{
  const h=setup();const c=h.result.current.contextForWorkspaceTab(knowledgeGraphTabId);expect(JSON.parse(await c.getKnowledgeGraph!(0)).totalEntries).toBe(1);
  for(const request of [{mode:"query",query:"neural"},{mode:"cited"},{mode:"keys",keys:"smith, smith"},{mode:"all"}]){const result=JSON.parse(await c.filterKnowledgeGraph!(request as any));expect(result.applied).toBe(true);expect(result.count).toBe(request.mode === "cited" ? 0 : 1);}
  await expect(c.filterKnowledgeGraph!({mode:"keys",keys:"unknown"} as any)).rejects.toThrow("Unknown bibliography keys");h.ctx.graphOpenRef.current=false;await expect(c.getKnowledgeGraph!(0)).rejects.toThrow("Choose the Knowledge Graph");
 });
 it("enforces graph permissions",async()=>{
  const h=setup();h.ctx.aiConfig.access.projectFiles=false;const c=h.result.current.contextForWorkspaceTab(knowledgeGraphTabId);await expect(c.filterKnowledgeGraph!({mode:"related"} as any)).rejects.toThrow("Project files access");h.ctx.aiConfig.access.currentEditor=false;await expect(c.getKnowledgeGraph!(0)).rejects.toThrow("access is disabled");
 });
 it("returns to a source tab with a pending citation and protects stale source",()=>{
  const h=setup();h.result.current.insertCitationKey("smith");expect(h.state.statusMessage).toContain("Open a .tex tab");h.ctx.graphSourceRef.current={path:h.document.path,content:h.document.content,offset:0,selection:""};h.result.current.insertCitationKey("smith");expect(h.ctx.pendingGraphCitationRef.current).toMatchObject({path:h.document.path,key:"smith"});expect(h.state.activePath).toBe(h.document.path);
  h.result.current.recommendCitationsForSelection();expect(h.state.statusMessage).toContain("Select a sentence");h.ctx.graphSourceRef.current.selection="Neural networks";h.result.current.recommendCitationsForSelection();expect(h.state.graphFilter.keys).toContain("smith");
 });
 it("applies layout and restores the workspace after the tutorial",()=>{
  const h=setup();h.result.current.applyLayoutPreset("focus");expect(h.state.settings.minimap).toBe(false);h.result.current.prepareActivationTutorial();expect(h.state.latexEditorView).toBe("code");expect(h.ctx.activationWorkspaceSnapshotRef.current).toMatchObject({activeSidebar:"files",panelVisible:true});h.result.current.restoreActivationWorkspace();expect(h.state.activeSidebar).toBe("files");expect(h.state.latexEditorView).toBe("visual");expect(h.ctx.activationWorkspaceSnapshotRef.current).toBeNull();h.result.current.restoreActivationWorkspace();
 });
});
