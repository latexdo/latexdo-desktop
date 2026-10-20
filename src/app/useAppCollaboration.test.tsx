/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as monaco from "monaco-editor";
import { useAppCollaboration } from "./useAppCollaboration";
import { setMonaco } from "./appShared";
import type { AppCtx08 } from "./appContext";
import { defaultSettings, bookmarkKey } from "../features/settings/settings";
import { hookContext, deferred } from "./__tests__/hookHarness";
const bindings=vi.hoisted(()=>({created:[] as any[]}));
vi.mock("../collaboration/MonacoCollaborationBinding",()=>({MonacoCollaborationBinding:class {destroy=vi.fn();key:string;constructor(public options:any){this.key=`${options.projectId}:${options.relativePath}:${options.shareToken}:${options.clientName}:${options.apiBaseUrl}`;bindings.created.push(this);}}}));
const api:Record<string,any>={};const listeners:Record<string,any>={};
const shared={enabled:true,users:[],projectId:"p",token:"token",requireApproval:false};
const project={id:"shared",name:"Shared",rootPath:"/shared"};
function setup(overrides={}) {
 const model=monaco.editor.createModel("First line\nSecond line","latex",monaco.Uri.file(`/p/collab-${Math.random()}.tex`));
 const document={path:model.uri.fsPath,relativePath:"main.tex",name:"main.tex",kind:"text",content:model.getValue(),savedContent:model.getValue()};
 const editor={getModel:()=>model,getPosition:()=>new monaco.Position(1,3),getSelections:()=>[new monaco.Selection(1,1,1,2)],getScrollTop:()=>10,getScrollLeft:()=>20,setScrollTop:vi.fn(),setScrollLeft:vi.fn(),setSelections:vi.fn(),setPosition:vi.fn(),executeEdits:vi.fn((_id:string,edits:any[])=>model.applyEdits(edits)),deltaDecorations:vi.fn((_old:any,next:any[])=>next.map((_,i)=>`d${i}`)),focus:vi.fn()};
 const {ctx,state}=hookContext({activeDocument:document,activeTextDocument:document,activePath:document.path,activePathRef:{current:document.path},documentsRef:{current:[document]},documents:[document],editorRef:{current:editor},projectId:"p",projectIdRef:{current:"p"},projectPathRef:{current:"/p"},projectName:"Paper",collaborationAvailable:true,collaboration:{apiBaseUrl:"http://local",color:"red",emoji:"A"},collaborationDisplayName:"Ada",collaborationState:{enabled:false,users:[]},
 collaborationBindingRef:{current:null},collaborationBindingRequestIdRef:{current:0},editorBlameFetchSeqRef:{current:0},editorBlameLines:[],editorBlameStateRef:{current:{}},editorMutationOriginRef:{current:{run:(_origin:string,fn:()=>void)=>fn()}},
 realtimeBlockedDocumentsRef:{current:{}},realtimeReadyDocumentsRef:{current:new Set()},realtimeBlockedDocuments:{},realtimeReadyDocuments:new Set(),joinAttemptRef:{current:0},joinCollaborationBusy:false,joinTokenDraft:" token ",latexEditorView:"code",settings:defaultSettings,resolvedAppearance:"light",bookmarkStore:{},fileBlameEnabled:false,
 ...Object.fromEntries(["bookmarkDecorationsRef","fileBlameDecorationsRef","inlineBlameDecorationsRef","sourceSyncDecorationsRef","editorActionDisposablesRef"].map(k=>[k,{current:[]}])) ,
 ...Object.fromEntries(["citationSuggestTimerRef","editorMouseDisposableRef","editorScrollSyncDisposableRef","editorScrollSyncTimerRef","pdfScrollSyncTimerRef","sourceSyncClearTimerRef","nextEditAdapterRef"].map(k=>[k,{current:null}])),...overrides,
 },["setBookmarkStore","setCollaborationBusy","setCollaborationCopied","setCollaborationPermissions","setCollaborationState","setCurrentUserRole","setDocuments","setEditorBlameLines","setIsProjectAdmin","setJoinCollaborationBusy","setJoinCollaborationError","setShareStartError","setJoinTokenDraft","setJoinWaitingMessage","setRealtimeBlockedDocuments","setRealtimeReadyDocuments","setShareDialogOpen","setStatusMessage","settings"],["loadProject","requireLegalAcceptance","saveDocument"]);
 return {...renderHook(()=>useAppCollaboration(ctx as AppCtx08)),ctx,state,model,editor,document};
}
beforeEach(()=>{
 vi.useFakeTimers();setMonaco(monaco);bindings.created.length=0;
 for(const name of ["getGitBlame","readFile","openProject","openRequestedProject","importOverleafProject","getCollaborationState","getCollaborationPermissions","createCollaborationLink","joinCollaboration","rotateCollaborationLink","stopCollaboration","saveSharedProjectToFolder","deleteSharedProject","setCollaborationApproval","resolveCollaborationRequest"])api[name]=vi.fn().mockResolvedValue(null);
 api.getGitBlame.mockResolvedValue([]);api.readFile.mockResolvedValue("authoritative");api.getCollaborationState.mockResolvedValue(shared);api.createCollaborationLink.mockResolvedValue(shared);api.rotateCollaborationLink.mockResolvedValue(shared);api.joinCollaboration.mockResolvedValue({project,collaboration:shared});api.stopCollaboration.mockResolvedValue({enabled:false,users:[]});api.getCollaborationPermissions.mockResolvedValue({permissions:[{clientId:"a",role:"admin"}],isAdmin:true,currentUserRole:"admin",pending:[]});api.saveSharedProjectToFolder.mockResolvedValue({saved:true,project,written:2,folder:"/home"});
 for(const name of ["onGitChanged","onOpenRequested"])api[name]=vi.fn((cb:any)=>{listeners[name]=cb;return vi.fn();});api.hostsProjectsLocally=false;window.latexdo=api as typeof window.latexdo;
 Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:vi.fn().mockResolvedValue(undefined)}});
});
afterEach(()=>{cleanup();for(const model of monaco.editor.getModels())model.dispose();vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();});
describe("collaboration sharing workflow",()=>{
 it("saves dirty buffers before sharing and copies the token temporarily",async()=>{
  const h=setup();h.document.content="dirty";await h.result.current.createCollaborationLink();expect(h.ctx.saveDocument).toHaveBeenCalledWith(h.document);expect(api.createCollaborationLink).toHaveBeenCalledWith("p");expect(navigator.clipboard.writeText).toHaveBeenCalledWith("token");expect(h.state.collaborationCopied).toBe(true);expect(h.state.currentUserRole).toBe("admin");await act(()=>vi.advanceTimersByTimeAsync(1800));expect(h.state.collaborationCopied).toBe(false);expect(h.state.collaborationBusy).toBe(false);
 });
 it.each([true,false])("opens a newly shared project (hosted %s)",async hosted=>{
  const h=setup();api.createCollaborationLink.mockResolvedValue({...shared,projectId:"shared",hosted,inviteCode:"invite",projectName:"Shared"});await h.result.current.createCollaborationLink("internet" as any);expect(h.ctx.loadProject).toHaveBeenCalledWith(expect.objectContaining({id:"shared"}),true,false);expect(api.createCollaborationLink).toHaveBeenCalledWith("p",{mode:"internet",projectName:"Paper"});if(hosted){expect(api.joinCollaboration).not.toHaveBeenCalled();expect(h.state.statusMessage).toContain("Sharing started");}else expect(api.joinCollaboration).toHaveBeenCalledWith("token");
 });
 it("reports sharing failures and rejects missing projects",async()=>{
  const h=setup();api.createCollaborationLink.mockRejectedValue(new Error("offline"));await h.result.current.createCollaborationLink();expect(h.state.shareStartError).toBe("offline");expect(h.state.collaborationBusy).toBe(false);h.ctx.projectIdRef.current="";await h.result.current.createCollaborationLink();expect(h.state.statusMessage).toContain("open a project");
 });
 it("opens the local sharing dialog without starting a server",async()=>{
  api.hostsProjectsLocally=true;const h=setup();await act(async()=>h.result.current.openShareDialog());expect(h.state.shareDialogOpen).toBe(true);expect(api.createCollaborationLink).not.toHaveBeenCalled();expect(api.getCollaborationState).toHaveBeenCalledWith("p");
 });
 it("rotates invites and handles errors",async()=>{
  const h=setup();api.rotateCollaborationLink.mockResolvedValue({...shared,inviteCode:"fresh"});await h.result.current.regenerateCollaborationLink();expect(navigator.clipboard.writeText).toHaveBeenCalledWith("fresh");expect(h.state.statusMessage).toContain("old link no longer works");api.rotateCollaborationLink.mockRejectedValue("bad");await h.result.current.regenerateCollaborationLink();expect(h.state.statusMessage).toBe("Could not regenerate collaboration link");
 });
 it("polls a pending join until approved",async()=>{
  const h=setup();api.joinCollaboration.mockResolvedValueOnce({pending:true,message:"Waiting for owner"});const joining=h.result.current.joinCollaborationFromDialog();await act(async()=>{});expect(h.state.joinWaitingMessage).toBe("Waiting for owner");await act(()=>vi.advanceTimersByTimeAsync(3000));await joining;expect(api.joinCollaboration).toHaveBeenCalledTimes(2);expect(h.ctx.loadProject).toHaveBeenCalledWith(project,true,false);expect(h.state.joinTokenDraft).toBe("");expect(h.state.joinCollaborationBusy).toBe(false);expect(h.state.shareDialogOpen).toBe(false);
 });
 it("cancels a pending join without opening the returned project",async()=>{
  const h=setup();api.joinCollaboration.mockResolvedValue({pending:true,message:"Waiting"});const joining=h.result.current.joinCollaborationFromDialog();await act(async()=>{});h.result.current.cancelJoinCollaboration();await act(()=>vi.advanceTimersByTimeAsync(3000));await joining;expect(h.ctx.loadProject).not.toHaveBeenCalled();expect(api.joinCollaboration).toHaveBeenCalledOnce();expect(h.state.joinCollaborationBusy).toBe(false);
 });
 it("ignores a cancelled in-flight join and reports genuine failures",async()=>{
  const h=setup();const pending=deferred<any>();api.joinCollaboration.mockReturnValueOnce(pending.promise);const joining=h.result.current.joinCollaborationFromDialog();h.result.current.cancelJoinCollaboration();pending.resolve({project,collaboration:shared});await joining;expect(h.ctx.loadProject).not.toHaveBeenCalled();api.joinCollaboration.mockRejectedValue(new Error("denied"));await h.result.current.joinCollaborationFromDialog();expect(h.state.joinCollaborationError).toBe("denied");
 });
 it("stops hosted sharing only after saving edits and returning the copy home",async()=>{
  const h=setup({collaborationState:{...shared,hosted:true}});await h.result.current.stopCollaboration();expect(api.saveSharedProjectToFolder).toHaveBeenCalledWith("p",{ask:false});expect(api.deleteSharedProject).toHaveBeenCalledWith("p");expect(h.ctx.loadProject).toHaveBeenCalledWith(project,true,false);expect(h.state.statusMessage).toContain("2 changed file(s)");expect(h.state.collaborationPermissions).toEqual([]);
 });
 it("keeps the shared copy when saving home is cancelled",async()=>{
  const h=setup({collaborationState:{...shared,hosted:true}});api.saveSharedProjectToFolder.mockResolvedValue({saved:false});await h.result.current.stopCollaboration();expect(api.deleteSharedProject).not.toHaveBeenCalled();expect(h.state.statusMessage).toContain("shared copy stays open");
 });
 it("saves a shared project and returns to its original folder",async()=>{
  const h=setup();await h.result.current.saveSharedProjectToFolder();expect(h.state.statusMessage).toContain("/home");await h.result.current.returnToOwnFolder();expect(api.deleteSharedProject).toHaveBeenCalledWith("p");expect(h.state.statusMessage).toContain("Back in your folder");api.saveSharedProjectToFolder.mockResolvedValue({saved:false});await h.result.current.returnToOwnFolder();expect(h.state.shareStartError).toContain("Could not find your folder");
 });
 it.each(["stopCollaboration","saveSharedProjectToFolder","returnToOwnFolder"])("releases busy state after %s fails",async method=>{
  const h=setup();api.stopCollaboration.mockRejectedValue(new Error("offline"));api.saveSharedProjectToFolder.mockRejectedValue(new Error("offline"));await (h.result.current as any)[method]();expect(h.state.statusMessage).toBe("offline");expect(h.state.collaborationBusy).toBe(false);
 });
 it("changes approval, resolves requests and falls back to viewer on permission failure",async()=>{
  const h=setup();api.setCollaborationApproval.mockResolvedValue(shared);await h.result.current.changeCollaborationApproval(true);expect(h.state.statusMessage).toContain("approval");await h.result.current.changeCollaborationApproval(false);expect(h.state.statusMessage).toContain("Anyone");api.resolveCollaborationRequest.mockResolvedValue(shared);await h.result.current.resolveCollaborationRequest("guest",true);expect(api.resolveCollaborationRequest).toHaveBeenCalledWith("p","guest",true);api.getCollaborationPermissions.mockRejectedValue(new Error("offline"));await h.result.current.loadCollaborationPermissions("p");expect(h.state.currentUserRole).toBe("viewer");expect(h.state.isProjectAdmin).toBe(false);
 });
 it("announces each pending guest once and stops polling on unmount",async()=>{
  api.getCollaborationPermissions.mockResolvedValue({isAdmin:true,pending:[{clientId:"guest",name:"Grace"}],requireApproval:true});const h=setup({collaborationState:{...shared,requireApproval:true}});await act(async()=>{});expect(h.state.statusMessage).toContain("Grace wants to join");h.ctx.setStatusMessage.mockClear();await act(()=>vi.advanceTimersByTimeAsync(10000));expect(h.ctx.setStatusMessage).not.toHaveBeenCalled();h.unmount();api.getCollaborationPermissions.mockClear();await act(()=>vi.advanceTimersByTimeAsync(10000));expect(api.getCollaborationPermissions).not.toHaveBeenCalled();
 });
});
describe("editor collaboration binding",()=>{
 it("connects, applies presence and marks synchronized documents ready",async()=>{
  const h=setup({collaborationState:shared});await act(async()=>{});expect(bindings.created).toHaveLength(1);const binding=bindings.created[0];expect(binding.options).toMatchObject({projectId:"p",relativePath:"main.tex",shareToken:"token"});h.result.current.connectCollaborationBinding();expect(bindings.created).toHaveLength(1);await act(async()=>binding.options.onStatusChange("connected"));expect(h.result.current.liveConnection).toBe("connected");binding.options.onSynced();expect(h.state.realtimeReadyDocuments.has("main.tex")).toBe(true);binding.options.onPresenceChange([{name:"Grace"}]);expect(h.state.collaborationState.users).toEqual([{name:"Grace"}]);binding.options.onProjectChanged(4);expect(h.state.collaborationState.revision).toBe(4);h.unmount();expect(binding.destroy).toHaveBeenCalledOnce();
 });
 it("loads an authoritative read-only copy when access is denied",async()=>{
  const h=setup({collaborationState:shared});await act(async()=>{});const binding=bindings.created[0];await act(async()=>binding.options.onConnectionError("Read only",403));expect(h.state.realtimeBlockedDocuments["main.tex"]).toBe("Read only");expect(h.state.documents[0]).toMatchObject({content:"authoritative",savedContent:"authoritative"});expect(h.state.statusMessage).toContain("Read-only authoritative copy");expect(binding.destroy).toHaveBeenCalled();
 });
 it("does not replace buffers in a different project with a late authoritative copy",async()=>{
  const h=setup({collaborationState:shared});await act(async()=>{});const pending=deferred<string>();api.readFile.mockReturnValue(pending.promise);bindings.created[0].options.onConnectionError("denied",403);h.ctx.projectIdRef.current="other";pending.resolve("stale");await act(async()=>{});expect(h.state.documents[0].content).toBe(h.document.content);
 });
 it("remaps bookmarks and updates document buffers on editor changes",()=>{
  const h=setup();const key=bookmarkKey("/p","main.tex");h.state.bookmarkStore={[key]:[2]};h.result.current.handleEditorChange(h.document.path,"Inserted\nFirst line\nSecond line");expect(h.state.bookmarkStore[key]).toEqual([3]);expect(h.ctx.documentsRef.current[0].content).toContain("Inserted");h.ctx.setDocuments.mockClear();h.result.current.handleEditorChange(h.document.path,h.ctx.documentsRef.current[0].content);expect(h.ctx.setDocuments).not.toHaveBeenCalled();
 });
 it("synchronizes changed buffers while preserving selection and scroll",()=>{
  const h=setup();h.ctx.activeDocument={...h.document,content:"Changed"};h.rerender();expect(h.model.getValue()).toBe("Changed");expect(h.editor.setScrollTop).toHaveBeenCalledWith(10);expect(h.editor.setScrollLeft).toHaveBeenCalledWith(20);expect(h.editor.setSelections).toHaveBeenCalled();
 });
 it("inserts block code with line breaks and rejects a mismatched editor",()=>{
  const h=setup();expect(h.result.current.insertLatexBlockAtEditorPosition("\\input{chapter}")).toBe(true);expect(h.model.getValue()).toContain("Fi\n\\input{chapter}\n");h.ctx.activePathRef.current="other";expect(h.result.current.insertLatexBlockAtEditorPosition("bad")).toBe(false);
 });
 it("renders inline and file blame and suppresses file annotations for unsaved text",()=>{
  const h=setup();const blame={line:1,hash:"a".repeat(40),shortHash:"aaaaaaa",author:"Ada",authorTime:"2026-01-01",summary:"Fix"};h.ctx.editorBlameStateRef.current={byLine:new Map([[1,blame]]),dirty:false,inlineEnabled:true,fileBlameEnabled:false};h.result.current.applyEditorBlameDecorations();expect(h.editor.deltaDecorations.mock.calls.at(-2)?.[1][0].options.after.content).toContain("Ada");h.ctx.editorBlameStateRef.current.fileBlameEnabled=true;h.result.current.applyEditorBlameDecorations();expect(h.editor.deltaDecorations.mock.calls.at(-1)?.[1]).toHaveLength(1);h.ctx.editorBlameStateRef.current.dirty=true;h.result.current.applyEditorBlameDecorations();expect(h.editor.deltaDecorations.mock.calls.at(-1)?.[1]).toEqual([]);
 });
 it("opens local and Overleaf projects, respecting legal acceptance",async()=>{
  const h=setup();api.openProject.mockResolvedValue(project);await h.result.current.openProject();expect(h.ctx.loadProject).toHaveBeenCalledWith(project,true,false);api.importOverleafProject.mockResolvedValue(project);await h.result.current.importOverleafProject("git-url");expect(h.state.statusMessage).toBe("Overleaf project fetched locally");h.ctx.requireLegalAcceptance.mockReturnValue(true);await h.result.current.openProject();expect(api.openProject).toHaveBeenCalledOnce();
 });
});
