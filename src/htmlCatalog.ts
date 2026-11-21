import { classifyHtmlContent } from "./htmlClassification";
import { isPage, MAX_FILE_BYTES, safePath } from "./core";

export type HtmlCatalogEntry = Readonly<{ path: string; title: string }>;
export type CatalogFile = { path: string; basename: string; stat: { size: number; mtime: number } };
/** Metadata-only public catalog. Raw document contents never leave this service. */
export class HtmlCatalog<F extends CatalogFile> {
  private revision = 0;
  private failedRevision = -1;
  private disposed = false;
  private cache = new Map<string, { stamp: string; html: boolean }>();
  private pending?: { revision: number; value: Promise<readonly HtmlCatalogEntry[]> };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private files: () => F[], private read: (file: F) => Promise<string>, private allowed: (path: string) => boolean) {}
  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  invalidate(path?: string) {
    if (this.disposed) return;
    this.revision++;
    if (path) this.cache.delete(path); else this.cache.clear();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.notify(), 80);
  }
  private notify() {
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* A consumer cannot break other listeners. */ }
    }
  }
  dispose() {
    this.disposed = true;
    this.revision++;
    this.cache.clear();
    clearTimeout(this.timer);
    this.notify();
    this.listeners.clear();
  }
  get(): Promise<readonly HtmlCatalogEntry[]> {
    if (this.disposed) return Promise.resolve(Object.freeze([]));
    if (this.pending?.revision === this.revision) return this.pending.value;
    const revision = this.revision;
    const value = this.build(revision);
    this.pending = { revision, value };
    return value;
  }
  /** A partial local/provider read is usable for browsing but must not replace a synced manifest. */
  async getForPublishing(): Promise<readonly HtmlCatalogEntry[]> {
    const rows = await this.get();
    if (this.disposed || this.failedRevision === this.revision) throw new Error("HTML catalog is temporarily incomplete");
    return rows;
  }
  private async build(revision: number): Promise<readonly HtmlCatalogEntry[]> {
    const files = this.files().filter(f => safePath(f.path) && isPage(f.path) && this.allowed(f.path) && f.stat.size <= MAX_FILE_BYTES);
    const paths = new Set(files.map(f => f.path));
    for (const path of this.cache.keys()) if (!paths.has(path)) this.cache.delete(path);
    const rows: HtmlCatalogEntry[] = [];
    let next = 0;
    let readFailed = false;
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
      while (next < files.length && !this.disposed && revision === this.revision) {
        const file = files[next++];
        const stamp = `${file.stat.mtime}:${file.stat.size}`;
        let html = this.cache.get(file.path)?.stamp === stamp ? this.cache.get(file.path)!.html : undefined;
        if (html === undefined) {
          try { html = classifyHtmlContent(await this.read(file)); }
          catch { readFailed = true; continue; } // Missing, unreadable or not locally downloaded: omit, never assume HTML.
          if (this.disposed || revision !== this.revision) break;
          this.cache.set(file.path, { stamp, html });
        }
        if (html) rows.push(Object.freeze({ path: file.path, title: file.basename }));
      }
    }));
    if (this.disposed) return Object.freeze([]);
    if (revision !== this.revision) return this.get();
    this.failedRevision = readFailed ? revision : -1;
    // A transient provider/read error must be retried by the next manual query.
    if (readFailed && this.pending?.revision === revision) this.pending = undefined;
    return Object.freeze(rows.sort((a, b) => a.path.localeCompare(b.path)));
  }
}
