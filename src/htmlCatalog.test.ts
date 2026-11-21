import { describe, it, expect, vi } from "vitest";
import { classifyHtmlContent, HTML_CLASSIFICATION_PREFIX } from "./htmlClassification";
import { HtmlCatalog } from "./htmlCatalog";
import { isPage, isReadablePage, MAX_FILE_BYTES } from "./core";
import { isPathExcluded } from "./fileFilters";

describe("shared HTML content classification", () => {
  it("accepts documents, uppercase, leading metadata and real fragments", () => {
    for (const text of ['<!DOCTYPE html><title>Page</title>', '<HTML lang="en"><body>Page</body></HTML>', '\uFEFF <!-- generated -->\n<html>', '<?xml version="1.0"?>\n<html xmlns="http://www.w3.org/1999/xhtml">', '<main><h1>Page</h1></main>', '<p>Paragraph</p>', '<div class="app">App</div>']) expect(classifyHtmlContent(text), text).toBe(true);
  });
  it("rejects plain, empty, fenced, escaped and tag examples in prose", () => {
    for (const text of ['', 'Ordinary note', 'An example <html> tag', '```html\n<html></html>\n```', '&lt;html&gt;Example', '<!-- <html> -->', '<!-- incomplete', '<script>doSomething()</script>', '<style>p {color:red}</style>', '<div>not a complete fragment', '<htmlish>example</htmlish>', '<!doctype html ', '<!doctype html']) expect(classifyHtmlContent(text), text).toBe(false);
    expect(classifyHtmlContent(' '.repeat(HTML_CLASSIFICATION_PREFIX) + '<html>')).toBe(false);
  });
  it("keeps TXT direct-open compatibility separate from HTML listings", () => {
    expect(isPage('note.txt')).toBe(false);
    expect(isReadablePage('note.txt')).toBe(true);
    expect(isPage('Page.HTML')).toBe(true);
  });
});
const file = (path: string, text: string, size = text.length) => ({path, basename: path.split('/').pop()!.replace(/\.[^.]+$/, ''), stat: {size, mtime: 1}, text});
describe("metadata-only HTML catalog", () => {
  it("includes only real supported HTML, applies all exclusions, bounds reads and survives unreadable files", async () => {
    const files = [file('Visible/a.HTML','<!doctype html>'), file('Visible/fragment.htm','<p>Page</p>'), file('Visible/impostor.html','Plain text'), file('Visible/html.txt','<html>'), file('Visible/note.txt','Notes'), file('Hidden/a.html','<html>'), file('Exact/a.html','<html>'), file('.secret/a.html','<html>'), file('node_modules/a.html','<html>'), file('Large/a.html','<html>',MAX_FILE_BYTES+1), file('Missing/a.html','<html>')];
    const read = vi.fn(async (f: typeof files[number]) => {if (f.path.startsWith('Missing/')) throw Error('not downloaded'); return f.text;});
    const catalog = new HtmlCatalog(() => files, read, path => path !== 'Exact/a.html' && !isPathExcluded(path,['Hidden/','node_modules/']));
    expect(await catalog.get()).toEqual([{path:'Visible/a.HTML',title:'a'}, {path:'Visible/fragment.htm',title:'fragment'}]);
    expect(read.mock.calls.map(c => c[0].path).sort()).toEqual(['Missing/a.html','Visible/a.HTML','Visible/fragment.htm','Visible/impostor.html']);
    const rows = await catalog.get(); expect(Object.isFrozen(rows)).toBe(true);expect(Object.isFrozen(rows[0])).toBe(true);
    expect(Object.keys(rows[0]).sort()).toEqual(['path','title']); catalog.dispose();
  });
  it("caches reads, invalidates same-stat edits, exclusion changes and rename/delete without an open view", async () => {
    let files = [file('a.html','<html>')]; let hidden = false;
    const read = vi.fn(async (f: typeof files[number]) => f.text);
    const catalog = new HtmlCatalog(() => files,read,() => !hidden);
    expect(await catalog.get()).toHaveLength(1);await catalog.get();expect(read).toHaveBeenCalledTimes(1);
    files[0].text = 'Not HTML';catalog.invalidate('a.html');expect(await catalog.get()).toEqual([]);
    files[0].text='<html>';catalog.invalidate('a.html');expect(await catalog.get()).toHaveLength(1);
    hidden=true;catalog.invalidate();expect(await catalog.get()).toEqual([]);
    hidden=false;files=[file('renamed.html','<body>')];catalog.invalidate();expect((await catalog.get())[0].path).toBe('renamed.html');
    files=[];catalog.invalidate();expect(await catalog.get()).toEqual([]);catalog.dispose();
  });
  it("does not return stale entries when content changes during an asynchronous read", async () => {
    const f=file('a.html','<html>');let release!: (text:string)=>void;let calls=0;
    const catalog=new HtmlCatalog(()=>[f],()=>++calls===1?new Promise<string>(r=>release=r):Promise.resolve('plain'),()=>true);
    const pending=catalog.get();catalog.invalidate('a.html');release('<html>');expect(await pending).toEqual([]);catalog.dispose();
  });
  it("retries transient read failures on a later query without a vault event", async () => {
    const f=file('a.html','<html>');let unavailable=true;
    const catalog=new HtmlCatalog(()=>[f],async()=>{if(unavailable)throw Error('temporary');return f.text;},()=>true);
    expect(await catalog.get()).toEqual([]);unavailable=false;expect(await catalog.get()).toHaveLength(1);catalog.dispose();
  });
  it("coalesces signals, isolates listener errors, supports unsubscribe and disabled provider", async () => {
    vi.useFakeTimers();const catalog=new HtmlCatalog(()=>[],async()=>'',()=>true);
    const fn=vi.fn();const off=catalog.subscribe(fn);catalog.subscribe(()=>{throw Error('consumer');});const other=vi.fn();catalog.subscribe(other);
    catalog.invalidate();catalog.invalidate();await vi.advanceTimersByTimeAsync(100);expect(fn).toHaveBeenCalledTimes(1);expect(other).toHaveBeenCalledTimes(1);
    off();catalog.dispose();expect(fn).toHaveBeenCalledTimes(1);expect(other).toHaveBeenCalledTimes(2);expect(await catalog.get()).toEqual([]);vi.useRealTimers();
  });
});
