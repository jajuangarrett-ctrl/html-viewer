import {describe, it, expect, vi} from "vitest";
vi.mock("obsidian", () => {
  class TFile {path: string; basename: string; stat: {size:number;mtime:number}; text:string; constructor(path:string,text:string){this.path=path;this.basename=path.split('/').pop()!.replace(/\.[^.]+$/,'');this.text=text;this.stat={size:text.length,mtime:1};}}
  class Plugin {
    constructor(public app:any) {}
    async loadData(){return {excludedPathPatterns:"Hidden/",exactExcludedPaths:["Exact/a.html"]};}
    async saveData(_data:any){}
    registerEvent(_event:any){} registerView(_type:any,_factory:any){} registerExtensions(_ext:any,_type:any){} addRibbonIcon(_icon:any,_title:any,_fn:any){} addCommand(_command:any){} addSettingTab(_tab:any){}
  }
  class Empty {}
  return {Plugin,TFile,TFolder:Empty,SuggestModal:Empty,PluginSettingTab:Empty,Setting:Empty,ItemView:Empty,Menu:Empty,Modal:Empty,Notice:Empty,WorkspaceLeaf:Empty,setIcon:()=>{}};
});
import HtmlViewerPlugin from "../main.ts";
import {TFile} from "obsidian";
const f=(path:string,text:string)=>new (TFile as any)(path,text);
describe("actual plugin catalog wiring without an open viewer",()=>{
  it("uses settings, responds to vault events, keeps page history cached and clears on unload",async()=>{
    const handlers = new Map<string,Function>();
    let files:any[]=[f('shown.html','<html>'),f('Hidden/a.html','<html>'),f('Exact/a.html','<html>'),f('plain.txt','Notes')];
    const read=vi.fn(async(file:any)=>file.text);
    const app:any={vault:{getFiles:()=>files,cachedRead:read,getAbstractFileByPath:(path:string)=>files.find(x=>x.path===path),on:(event:string,fn:Function)=>{handlers.set(event,fn);return{};}},workspace:{on:()=>({}),onLayoutReady:(fn:Function)=>fn()}};
    const plugin=new HtmlViewerPlugin(app,{} as any);await plugin.onload();
    expect(await plugin.getHtmlCatalog()).toEqual([{path:'shown.html',title:'shown'}]);expect(await plugin.getHtmlFiles()).toEqual([files[0]]);expect(read).toHaveBeenCalledTimes(1);
    plugin.settings.selected='page-history-only';await plugin.saveSettings();await plugin.getHtmlCatalog();expect(read).toHaveBeenCalledTimes(1);
    plugin.settings.exactExcludedPaths.push('shown.html');await plugin.saveSettings();expect(await plugin.getHtmlCatalog()).toEqual([]);
    plugin.settings.exactExcludedPaths=[];await plugin.saveSettings();expect(await plugin.getHtmlCatalog()).toHaveLength(2);
    files[0].text='Plain lookalike';handlers.get('modify')!(files[0]);expect((await plugin.getHtmlCatalog()).map(x=>x.path)).toEqual(['Exact/a.html']);
    const created=f('new.htm','<p>Page</p>');files.push(created);handlers.get('create')!(created);expect(await plugin.getHtmlCatalog()).toHaveLength(2);
    created.path='renamed.htm';created.basename='renamed';handlers.get('rename')!(created,'new.htm');expect((await plugin.getHtmlCatalog()).some(x=>x.path==='renamed.htm')).toBe(true);
    files=files.filter(x=>x!==created);handlers.get('delete')!(created);expect(await plugin.getHtmlCatalog()).toHaveLength(1);
    plugin.onunload();expect(await plugin.getHtmlCatalog()).toEqual([]);
  });
});
