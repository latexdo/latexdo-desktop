import { describe, expect, it } from "vitest";
import { buildLines, computeDocumentStats, detectColumnSplits, layoutPages, lineText, mathGlyphShare, mergeMathLines, orderLines, removeRunningHeadFoot } from "./layout";
import { describeFont } from "./fonts";
import { glyphs, line, page, stats } from "./__tests__/fixtures";
const math=describeFont("m","CMMI10",0.001);
describe("PDF page geometry",()=>{
 it("provides fallback dimensions for empty documents and pages",()=>{
  expect(computeDocumentStats([],[])).toMatchObject({bodySize:10,leading:12,columnCount:1,pageWidth:612,pageHeight:792,columnWidth:400});expect(layoutPages([page([])]).layouts[0]).toMatchObject({bodyLeft:72,bodyRight:540});expect(buildLines(page([]),10)).toEqual([]);
 });
 it("attaches scripts to nearby lines but keeps distant footnotes separate",()=>{
  const p=page([...glyphs("Body",50,100),...glyphs("2",75,94,{size:6}),...glyphs("fn",50,700,{size:6}),...glyphs(" ",300,300,{size:5})]);const lines=buildLines(p,10);expect(lines).toHaveLength(2);expect(lines[0].glyphs.map(g=>g.text).join("")).toContain("2");expect(lineText(lines[1])).toBe("fn");
 });
 it("detects two text columns and reads the left one before the right",()=>{
  const lines=Array.from({length:10},(_,i)=>[line("Left column content",50,100+i*20),line("Right column content",330,107+i*20)]).flat();expect(detectColumnSplits(lines,612,10)).toHaveLength(1);const layout=layoutPages([page(lines.flatMap(l=>l.glyphs))]);expect(layout.layouts[0].columns).toHaveLength(2);const ordered=layout.layouts[0].lines;expect(ordered.slice(0,10).every(l=>l.column===0)).toBe(true);expect(ordered.slice(10).every(l=>l.column===1)).toBe(true);
 });
 it("does not infer a gutter from short lines or narrowly occupied pages",()=>{
  expect(detectColumnSplits([line("short",50,100)],612,10)).toEqual([]);expect(detectColumnSplits(Array.from({length:20},(_,i)=>line("narrow",50,100+i*12)),612,10)).toEqual([]);
 });
 it("reads spanning headings before each column band",()=>{
  const a={...line("Heading",50,50),spanning:true},b={...line("Left",50,100),column:0},c={...line("Right",330,90),column:1},d={...line("Next heading",50,200),spanning:true};expect(orderLines([d,c,b,a],2)).toEqual([a,b,c,d]);expect(orderLines([b,c],1)).toEqual([c,b]);
 });
 it("removes repeated running titles and page numbers while retaining body and unique headers",()=>{
  const pages=Array.from({length:3},(_,i)=>[line("Journal title",50,25),line(`Page ${i+1}`,50,760),line("Body text",50,200),...(i===0?[line("Unique heading",50,45)]:[])]);const result=removeRunningHeadFoot(pages,stats);expect(result.removed).toBe(6);expect(result.pageLines[0].map(lineText)).toEqual(["Body text","Unique heading"]);expect(removeRunningHeadFoot([pages[0]],stats).removed).toBe(0);
 });
 it("merges fraction rows separated by a drawn rule but keeps unrelated prose apart",()=>{
  const upper=line("x",100,100,{font:math}),lower=line("y",100,112,{font:math});const rule={x1:99,x2:110,y1:105,y2:105,thickness:1,pageIndex:0,horizontal:true,vertical:false};const result=mergeMathLines([upper,lower],[rule],10,12);expect(result).toHaveLength(1);expect(result[0].glyphs).toHaveLength(2);expect(mergeMathLines([line("prose",50,100),line("prose",50,112)],[],10,12)).toHaveLength(2);expect(mergeMathLines([upper,{...lower,left:300,right:310}],[],10,12)).toHaveLength(2);expect(mathGlyphShare(upper)).toBe(1);expect(mathGlyphShare({...upper,glyphs:[]})).toBe(0);
 });
 it("infers word gaps and preserves explicit spaces once",()=>{
  const l=line("a",50,100);l.glyphs.push(...glyphs("b",75,100),...glyphs("  c",85,100));expect(lineText(l)).toBe("a b c");
 });
});
