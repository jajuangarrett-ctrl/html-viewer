import { HtmlViewerView } from "../src/HtmlViewerView";
import { TFile, TFolder } from "./obsidian";
import { HtmlCatalog } from "../src/htmlCatalog";
import { makeBundle, pageURL } from "../src/core";
import { preparePage } from "../src/renderer";
const prototype = HTMLElement.prototype as any;
prototype.empty = function () {
  this.replaceChildren();
};
prototype.addClass = function (...s: string[]) {
  this.classList.add(...s);
};
prototype.hasClass = function (s: string) {
  return this.classList.contains(s);
};
prototype.toggleClass = function (s: string, b: boolean) {
  this.classList.toggle(s, b);
};
prototype.setText = function (s: string) {
  this.textContent = s;
};
prototype.setAttr = function (k: string, v: string) {
  this.setAttribute(k, v);
};
prototype.createEl = function (tag: string, opts: any = {}) {
  const el = document.createElement(tag);
  if (opts.cls) el.className = opts.cls;
  if (opts.text) el.textContent = opts.text;
  if (opts.type) el.setAttribute("type", opts.type);
  for (const [k, v] of Object.entries(opts.attr ?? {}))
    el.setAttribute(k, String(v));
  this.append(el);
  return el;
};
prototype.createDiv = function (opts: any = {}) {
  return this.createEl("div", opts);
};
const enc = (s: string) => new TextEncoder().encode(s).buffer;
const defaultFiles: Record<string, string> = {
  "Demo/index.html":
    '<!doctype html><html><head><title>Field Notes</title><meta name="fjg-navigation" content="page-sections"><link rel="stylesheet" href="style.css"></head><body><button data-fjg-section-toggle id="sections" onclick="document.getElementById(\'panel\').hidden=!document.getElementById(\'panel\').hidden">Show sections</button><nav id="panel" hidden>Overview · Notes · Details</nav><h1>Field Notes</h1><p>Local reading without wasted space.</p><input id="draft" placeholder="Your draft"><button id="counter" onclick="this.textContent=Number(this.textContent)+1">0</button><p id="json"></p><a id="next" href="pages/next.html?mode=read#chapter">Next page</a><a id="external" href="https://example.com/guide">Web guide</a><a id="video" href="https://youtu.be/M7lc1UVf-VE?t=20">Video</a><img src="dot.svg" alt="local graphic"><script src="app.js"></script><div style="height:1000px"></div><h2 id="end">End of document</h2></body></html>',
  "Demo/style.css":
    '@import "more.css"; body { margin:16px; font:18px system-ui;background:#f5f1e8;color:#172a2a } h1{color:rgb(0,100,100)} img{width:64px;height:64px} input,button{min-height:44px} a{display:block;padding:12px} @media(min-width:650px){body{margin:24px}}',
  "Demo/more.css": "p {line-height:1.5}",
  "Demo/dot.svg":
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="teal"/></svg>',
  "Demo/app.js":
    'fetch("data.json").then(r=>r.json()).then(x=>document.getElementById("json").textContent=x.greeting);',
  "Demo/data.json": '{"greeting":"Local JSON loaded"}',
  "Demo/pages/next.html":
    '<html><head><title>Chapter Two</title></head><body><h1 id="chapter">Chapter Two</h1><a href="../index.html">Return</a></body></html>',
  "Demo/HTML as text.txt": "<html><body><h1>HTML in text</h1></body></html>",
  "Demo/plain.txt": "This <is> ordinary text & not HTML.",
  "Private/secret.json": '{"private":"NEVER_BUNDLED"}',
};
let view: HtmlViewerView;
(window as any).setup = async (opts: any = {}) => {
  await view?.onClose();
  document.querySelector("#root")!.replaceChildren();
  const files = Object.entries(opts.files ?? defaultFiles).map(
    ([p, s]) => new TFile(p, enc(String(s))),
  );
  const vault = {
    getFiles: () => files,
    getAbstractFileByPath: (p: string) => files.find((f) => f.path === p),
    readBinary: async (f: TFile) => f.bytes,
    on: () => ({}),
  };
  const app = {
    vault,
    workspace: {
      requestSaveLayout() {},
      on() {
        return {};
      },
    },
  };
  const settings: any = {
    projects: [],
    selected: "",
    allowExternal: opts.external ?? false,
  };
  const path = opts.path ?? "Demo/index.html";
  const p = {
    id: "demo",
    name: "Field Notes",
    root: "Demo",
    entry: path,
    last: pageURL(path),
    trusted: opts.trusted ?? false,
  };
  settings.projects.push(p);
  const catalog = new HtmlCatalog(() => files, async f => new TextDecoder().decode(f.bytes), path => !(opts.excluded ?? []).includes(path));
  const plugin: any = {
    getHtmlCatalog: () => catalog.get(),
    getHtmlFiles: async () => (await catalog.get()).map(row => files.find(f => f.path === row.path)),
    subscribeHtmlCatalog: (fn: () => void) => catalog.subscribe(fn),
    app,
    settings,
    saveSettings: async () => {},
    openFileSuggestModal: () => {},
    openFolderSuggestModal: () => {},
  };
  view = new HtmlViewerView(
    { app, contentEl: document.querySelector("#root") } as any,
    plugin,
  );
  await view.onOpen();
  await view.loadFile(files.find((f) => f.path === path)! as any);
  (window as any).view = view;
  (window as any).settings = settings;
};
(window as any).render = (
  files: Record<string, string>,
  trusted = false,
  page = "index.html",
) =>
  preparePage(
    makeBundle(
      Object.entries(files).map(([path, s]) => ({ path, bytes: enc(s) })),
    ),
    page,
    trusted,
  );
