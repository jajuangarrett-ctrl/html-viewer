import {afterEach, describe, it, expect, vi} from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { IOS_CATALOG_FILE, serializeIOSCatalog } from "./iosCatalogExport";
vi.mock("obsidian", () => {
  class TFile {path: string; basename: string; stat: {size:number;mtime:number}; text:string; constructor(path:string,text:string){this.path=path;this.basename=path.split('/').pop()!.replace(/\.[^.]+$/,'');this.text=text;this.stat={size:text.length,mtime:1};}}
  class TFolder { constructor(public path: string) {} }
  class FileSystemAdapter { constructor(private root: string) {} getBasePath() { return this.root; } }
  class Plugin {
    commands=new Map<string, any>();
    constructor(public app:any) {}
    async loadData(){return {excludedPathPatterns:"Hidden/",exactExcludedPaths:["Exact/a.html"]};}
    async saveData(_data:any){}
    registerEvent(_event:any){} registerView(_type:any,_factory:any){} registerExtensions(_ext:any,_type:any){} addRibbonIcon(_icon:any,_title:any,_fn:any){} addCommand(command:any){this.commands.set(command.id,command);} addSettingTab(_tab:any){}
  }
  class Empty {}
  class Modal {
    static last?: Modal;
    titleEl={setText:vi.fn()};
    actions: { text: string; onclick?: () => void }[]=[];
    contentEl={
      createEl: vi.fn(),
      createDiv: () => ({ createEl: (_kind:string, options:{text:string}) => {
        const action = {text:options.text}; this.actions.push(action); return action;
      } }),
    };
    open(){Modal.last=this;} close(){Modal.last=undefined;}
  }
  class Notice { static notices:string[]=[]; constructor(text:string){Notice.notices.push(text);} }
  return {Platform:{isDesktopApp:false,isIosApp:false},Plugin,TFile,TFolder,FileSystemAdapter,SuggestModal:Empty,PluginSettingTab:Empty,Setting:Empty,ItemView:Empty,Menu:Empty,Modal,Notice,WorkspaceLeaf:Empty,setIcon:()=>{}};
});
import HtmlViewerPlugin from "../main.ts";
import {FileSystemAdapter, Modal, Notice, Platform, TFile, TFolder} from "obsidian";
afterEach(()=>{
  Platform.isDesktopApp=false;
  Platform.isIosApp=false;
  (Modal as any).last=undefined;
  (Notice as any).notices=[];
  vi.unstubAllGlobals();
});
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

async function desktopVaultFixture() {
  const temporary = await mkdtemp(join(tmpdir(), "html-viewer-ios-catalog-synthetic-"));
  const root = join(temporary, "vault");
  await mkdir(root);
  const handlers = new Map<string, Function>();
  const files = new Map<string, TFile | TFolder>();
  let local: unknown, layout: (() => void) | undefined;
  let failPath = "";
  const vault = {
    adapter: new (FileSystemAdapter as any)(root),
    getFiles: () => [...files.values()].filter((file): file is TFile => file instanceof TFile),
    cachedRead: vi.fn(async (file: any) => {
      if (file.path === failPath) throw new Error("synthetic temporary failure");
      return file.text;
    }),
    getAbstractFileByPath: (path:string) => files.get(path),
    read: vi.fn(async (file:TFile) => readFile(join(root, file.path), "utf8")),
    createFolder: vi.fn(async (path:string) => {
      await mkdir(join(root, path));
      const folder = new (TFolder as any)(path);
      files.set(path, folder);
      handlers.get("create")?.(folder);
      return folder;
    }),
    create: vi.fn(async (path:string,text:string) => {
      await writeFile(join(root,path),text,{flag:"wx"});
      const file = f(path,text);
      files.set(path,file);
      handlers.get("create")?.(file);
      return file;
    }),
    process: vi.fn(async (file:TFile, transform:(text:string)=>string) => {
      const path = join(root,file.path);
      const previous = await readFile(path,"utf8");
      const next = transform(previous);
      if (next !== previous) {
        await writeFile(path,next);
        file.stat.size = Buffer.byteLength(next);
        handlers.get("modify")?.(file);
      }
      return next;
    }),
    on:(event:string,fn:Function)=>{handlers.set(event,fn);return{};},
  };
  const app:any={
    vault,
    workspace:{on:()=>({}),onLayoutReady:(call:()=>void)=>{layout=call;}},
    loadLocalStorage:()=>local,
    saveLocalStorage:(_key:string,value:unknown)=>{local=value;},
  };
  return {
    root, app, vault, handlers,
    add: (path:string,text:string) => {
      const file=f(path,text);
      files.set(path,file);
      handlers.get("create")?.(file);
      return file;
    },
    mistake:(path:string)=>{failPath=path;},
    layout:()=>layout?.(), remove:()=>rm(temporary,{recursive:true,force:true}),
  };
}

describe("actual Obsidian publisher and handoff wiring", () => {
  it("only an explicit desktop opts in, exports after layout, retries a partial scan, persists across re-enable and never loops on JSON", async () => {
    Platform.isDesktopApp = true;
    const f = await desktopVaultFixture();
    let plugin = new HtmlViewerPlugin(f.app, {} as any);
    try {
      f.add("Artifacts/Café.html", "<html><p>secret content is not part of manifest</p></html>");
      const changed = f.add("Plain.htm", "not HTML");
      f.add("Hidden/not-in-catalog.html", "<html>");
      f.add("Artifacts/Secrets/private.html", "<html>");
      await plugin.onload();
      expect(plugin.isPublishingIOSCatalog()).toBe(false);
      expect(await plugin.regenerateIOSCatalog()).toMatchObject({ status:"disabled" });
      expect(f.vault.create).not.toHaveBeenCalled();
      expect(await plugin.enableIOSCatalogPublishing()).toMatchObject({ status:"superseded" });
      f.layout();
      await vi.waitFor(() => expect(f.vault.create).toHaveBeenCalledTimes(1), { timeout:2000 });
      const exportPath = join(f.root, IOS_CATALOG_FILE);
      expect(await readFile(exportPath,"utf8")).toBe(serializeIOSCatalog([{path:"Artifacts/Café.html", title:"Café"}]).text);
      expect(await plugin.regenerateIOSCatalog()).toEqual({ status:"unchanged", entries:1 });
      expect(f.vault.process).not.toHaveBeenCalled();

      changed.text = "<main>A real page</main>"; changed.stat.mtime++;
      f.mistake(changed.path);
      f.handlers.get("modify")!(changed);
      expect(await plugin.regenerateIOSCatalog()).toMatchObject({ status:"error" });
      expect(f.vault.process).not.toHaveBeenCalled();
      f.mistake("");
      expect(await plugin.regenerateIOSCatalog()).toEqual({ status:"written", entries:2 });
      expect(f.vault.process).toHaveBeenCalledTimes(1);

      plugin.onunload();
      plugin = new HtmlViewerPlugin(f.app, {} as any); await plugin.onload(); f.layout();
      expect(plugin.isPublishingIOSCatalog()).toBe(true);
      expect(await plugin.regenerateIOSCatalog()).toEqual({ status:"unchanged", entries:2 });
      plugin.disableIOSCatalogPublishing();
      expect(await plugin.regenerateIOSCatalog()).toMatchObject({ status:"disabled" });
      expect(f.vault.create).toHaveBeenCalledTimes(1);
      expect(f.vault.process).toHaveBeenCalledTimes(1);
    } finally { plugin.onunload(); await f.remove(); }
  });

  it("refuses a symlinked destination ancestor without reading or writing a neighbor", async () => {
    Platform.isDesktopApp = true;
    const f = await desktopVaultFixture();
    const plugin = new HtmlViewerPlugin(f.app,{} as any);
    try {
      f.add("Guide.html","<html>");
      const neighbor=join(dirname(f.root),"outside");
      await mkdir(neighbor);
      await symlink(neighbor,join(f.root,"Artifacts"));
      await plugin.onload(); f.layout();
      expect(await plugin.enableIOSCatalogPublishing()).toMatchObject({ status:"collision" });
      expect(f.vault.create).not.toHaveBeenCalled();
      expect(f.vault.read).not.toHaveBeenCalled();
    } finally { plugin.onunload(); await f.remove(); }
  });

  it("does not clobber a file changed between the preflight read and the atomic process callback", async () => {
    Platform.isDesktopApp = true;
    const f = await desktopVaultFixture();
    const plugin = new HtmlViewerPlugin(f.app,{} as any);
    try {
      f.add("First.html","<html>");
      await plugin.onload(); f.layout();
      expect(await plugin.enableIOSCatalogPublishing()).toEqual({ status:"written", entries:1 });
      const output = join(f.root, IOS_CATALOG_FILE);
      const process = f.vault.process.getMockImplementation()!;
      f.vault.process.mockImplementationOnce(async (file,transform) => {
        // External edit races just after the publish preflight, before process reads.
        await writeFile(output,"Do not overwrite this file.");
        return process(file,transform);
      });
      f.add("Next.htm","<main>Another page</main>");
      expect(await plugin.regenerateIOSCatalog()).toMatchObject({ status:"collision" });
      expect(await readFile(output,"utf8")).toBe("Do not overwrite this file.");
    } finally { plugin.onunload(); await f.remove(); }
  });

  it("mobile never exports; explicit iOS command checks real HTML and launches an encoded path only upon choosing Open app", async () => {
    Platform.isIosApp = true;
    const valid = f("Artifacts/Café & #?.html", "<html>"), fake = f("plain.html","plain text");
    let selected = valid;
    const files=[valid,fake];
    const app:any={
      vault:{getFiles:()=>files,cachedRead:async(file:any)=>file.text,getAbstractFileByPath:(path:string)=>files.find(file=>file.path===path),on:()=>({})},
      workspace:{on:()=>({}),onLayoutReady:(fn:Function)=>fn(),getActiveViewOfType:()=>({currentFile:selected}),getActiveFile:()=>null},
    };
    const open = vi.fn();
    vi.stubGlobal("window",{open});
    const plugin = new HtmlViewerPlugin(app,{} as any);
    await plugin.onload();
    try {
      const command = (plugin as any).commands.get("open-in-ios-html-viewer").checkCallback;
      expect((plugin as any).commands.has("regenerate-ios-catalog")).toBe(false);
      expect(await plugin.enableIOSCatalogPublishing()).toMatchObject({status:"disabled"});
      expect(command(true)).toBe(true);
      expect(open).not.toHaveBeenCalled();
      expect(command(false)).toBe(true);
      await vi.waitFor(()=>expect((Modal as any).last).toBeTruthy());
      expect(open).not.toHaveBeenCalled();
      (Modal as any).last.actions.find((button:any)=>button.text==="Open app").onclick();
      expect(open).toHaveBeenCalledWith("fjg-html-viewer://open?path=Artifacts%2FCaf%C3%A9%20%26%20%23%3F.html","_blank","noopener,noreferrer");
      command(false);
      await vi.waitFor(()=>expect((Modal as any).last).toBeTruthy());
      selected=fake;
      (Modal as any).last.actions.find((button:any)=>button.text==="Open app").onclick();
      expect(open).toHaveBeenCalledTimes(1);
      expect(command(false)).toBe(true);
      await vi.waitFor(()=>expect((Notice as any).notices).toContain("The selected file is no longer an eligible HTML page."));
      expect((Modal as any).last).toBeUndefined();
      expect(open).toHaveBeenCalledTimes(1);
    } finally { plugin.onunload(); }
  });
});
