import * as monaco from "monaco-editor";
import { vi } from "vitest";
import { setMonaco } from "../appShared";
export function editorHarness(content = "First line\nSecond line\nThird line") {
 setMonaco(monaco);
 const model=monaco.editor.createModel(content,"latex",monaco.Uri.file(`/p/test-${Math.random()}.tex`));
 const document={path:model.uri.fsPath,relativePath:"main.tex",name:"main.tex",kind:"text" as const,content,savedContent:content};
 let selection=new monaco.Selection(1,1,1,4);
 const editor={
  getModel:()=>model,getSelection:()=>selection,getSelections:()=>[selection],getPosition:()=>selection.getPosition(),
  setPosition:vi.fn((p:monaco.IPosition)=>{selection=new monaco.Selection(p.lineNumber,p.column,p.lineNumber,p.column);}),
  setSelection:vi.fn((r:monaco.IRange)=>{selection=new monaco.Selection(r.startLineNumber,r.startColumn,r.endLineNumber,r.endColumn);}),
  setSelections:vi.fn(),getScrollTop:()=>0,getScrollLeft:()=>0,setScrollTop:vi.fn(),setScrollLeft:vi.fn(),
  executeEdits:vi.fn((_id:string,edits:monaco.editor.IIdentifiedSingleEditOperation[])=>model.applyEdits(edits)),
  deltaDecorations:vi.fn((old:string[],next:monaco.editor.IModelDeltaDecoration[])=>model.deltaDecorations(old,next)),
  pushUndoStop:vi.fn(),focus:vi.fn(),revealLineInCenter:vi.fn(),revealRangeInCenter:vi.fn(),revealRangeInCenterIfOutsideViewport:vi.fn(),revealPositionInCenterIfOutsideViewport:vi.fn(),trigger:vi.fn(),
 };
 return {model,document,editor};
}
