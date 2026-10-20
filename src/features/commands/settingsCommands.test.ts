import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, type AppSettings } from "../settings/settings";
import { createLatexDoCommandService, formatCommandResultForTerminal } from "./commandExecutor";
import { normalizeSettingNumber, settingDefinitions, parseSettingValue } from "./settingsCommands";
let settings: AppSettings;
const update = vi.fn();
function service() { return createLatexDoCommandService({getSettings:()=>settings,updateSetting:(key,value)=>{update(key,value);settings={...settings,[key]:value};},resetSetting:key=>{settings={...settings,[key]:defaultSettings[key]};},getVersion:()=>"1"}); }
beforeEach(()=>{settings={...defaultSettings,projectTreeIgnoredNames:["node_modules"]};update.mockReset();});
describe("settings command validation",()=>{
 it.each(["get","set","reset"])("rejects missing, protected and unknown %s keys",async action=>{
  const s=service();for(const suffix of ["","legalAccepted on","doesNotExist on"])expect((await s.execute(`latexdo settings ${action} ${suffix}`)).ok).toBe(false);expect(update).not.toHaveBeenCalled();
 });
 it.each(["editor font-size NaN","editor font-size 999","project tree-depth 1.5","editor minimap maybe","compiler engine unknown","preview","settings set projectTreeIgnoredNames foo","settings set minimap nope","settings unknown"])("rejects %s without writing",async command=>{
  expect((await service().execute(`latexdo ${command}`)).ok).toBe(false);expect(update).not.toHaveBeenCalled();
 });
 it.each(["on","true","yes","1","enable","enabled","off","false","no","0","disable","disabled"])("parses boolean spelling %s",async value=>{
  expect((await service().execute(`latexdo settings set minimap ${value}`)).ok).toBe(true);expect(settings.minimap).toBe(["on","true","yes","1","enable","enabled"].includes(value));
 });
 it.each(["editor word-wrap on","editor raw-latex off","git inline-blame off","preview on","project tree-depth 5","project tree-limit 1000"])("applies %s",async command=>{expect((await service().execute(`latexdo ${command}`)).ok).toBe(true);expect(update).toHaveBeenCalledOnce();});
 it("lists and resets the complete allowlist without resetting legal acceptance",async()=>{
  settings.legalAccepted=true;settings.minimap=!defaultSettings.minimap;const s=service();expect((await s.execute("latexdo settings list")).details).toHaveLength(settingDefinitions.length);expect((await s.execute("latexdo settings")).ok).toBe(true);expect((await s.execute("latexdo settings reset-all --yes")).ok).toBe(true);expect(settings.minimap).toBe(defaultSettings.minimap);expect(settings.legalAccepted).toBe(true);expect((await s.execute("latexdo settings reset-all --force")).ok).toBe(true);
 });
 it("manages ignored names and rejects paths or missing names",async()=>{
  const s=service();expect((await s.execute("latexdo project ignored list")).details).toEqual(["  node_modules"]);expect((await s.execute("latexdo project ignored add output")).ok).toBe(true);expect(settings.projectTreeIgnoredNames).toContain("output");expect((await s.execute("latexdo project ignored remove output")).ok).toBe(true);expect(settings.projectTreeIgnoredNames).not.toContain("output");for(const command of ["add","remove","add ../unsafe","unknown"])expect((await s.execute(`latexdo project ignored ${command}`)).ok).toBe(false);
 });
 it("normalizes bounded numeric preferences and retains other values",()=>{
  expect(normalizeSettingNumber("projectTreeMaxDepth",-100)).toBeGreaterThan(0);expect(normalizeSettingNumber("projectTreeMaxEntries",1e9)).toBeLessThan(1e9);expect(normalizeSettingNumber("minimap",false)).toBe(false);
  expect(parseSettingValue(settingDefinitions.find(d=>d.key==="projectTreeIgnoredNames")!,"x")).toMatchObject({ok:false});
 });
 it("handles external input, syntax errors, typo suggestions and completions",async()=>{
  const s=service();expect((await s.execute("ls")).message).toBe("Not a LatexDo command.");expect((await s.execute('latexdo theme "')).ok).toBe(false);expect((await s.execute("latexdo")).ok).toBe(true);expect((await s.execute("latexdo settngs")).details?.join(" ")).toContain("settings");expect((await s.execute("latexdo zzzzzzz")).details).toEqual(["Run latexdo help to list available commands."]);expect(s.complete("latexdo set")).toContain("settings");expect(s.complete("ls")).toEqual([]);expect(s.complete('latexdo "')).toEqual([]);expect(s.complete("latexdo settings get")).toEqual([]);expect(s.help("settings").ok).toBe(true);expect(formatCommandResultForTerminal({ok:true,message:"Done",details:["one","two"]})).toBe("Done\r\none\r\ntwo");
 });
});
