import { safePath } from "./core";
import type { HtmlCatalogEntry } from "./htmlCatalog";

export const IOS_CATALOG_FILE = "Artifacts/HTML Viewer/ios-catalog.json";
export const IOS_CATALOG_MAX_BYTES = 1024 * 1024;
export const IOS_CATALOG_MAX_ENTRIES = 2_000;
export const IOS_CATALOG_MAX_PATH_BYTES = 1_024;
export const IOS_CATALOG_MAX_SEGMENT_BYTES = 255;
export const IOS_CATALOG_MAX_TITLE_POINTS = 300;
const encoder = new TextEncoder();
const sensitiveName = /(^|[\/\s._-])(?:passwords?|api[\s._-]*keys?|secrets?|credentials?|tokens?|private[\s._-]*keys?)(?=$|[\/\s._-])/i;
const internalSegments = new Set(["node_modules", "__pycache__"]);

export function isIOSCatalogPage(path: string): boolean {
  if (!safePath(path) || !/^.+\.html?$/i.test(path) || /^[a-z][a-z\d+.-]*:/i.test(path)
    || /[\p{Cc}\p{Cf}]/u.test(path) || encoder.encode(path).length > IOS_CATALOG_MAX_PATH_BYTES
    || path.split("/").some(segment => !segment.trim() || segment.trimStart().startsWith(".")
      || encoder.encode(segment).length > IOS_CATALOG_MAX_SEGMENT_BYTES
      || internalSegments.has(segment.trim().toLowerCase()))) return false;
  let inspection = path;
  try { inspection = decodeURIComponent(path); } catch { /* Literal percent signs are valid file-name bytes. */ }
  return !sensitiveName.test(path) && !sensitiveName.test(inspection);
}

export function iosPageURL(path: string): string | null {
  if (!isIOSCatalogPage(path)) return null;
  try {
    const value = encodeURIComponent(path).replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase());
    return "fjg-html-viewer://open?path=" + value;
  } catch {
    return null; // Unpaired surrogates are not valid file names for this transfer.
  }
}

export class IOSCatalogLimitError extends Error {}

export function serializeIOSCatalog(catalog: readonly HtmlCatalogEntry[]): { text: string; count: number } {
  const paths = new Set<string>();
  for (const row of catalog) {
    if (!isIOSCatalogPage(row.path) || !iosPageURL(row.path)) continue;
    paths.add(row.path);
    if (paths.size > IOS_CATALOG_MAX_ENTRIES) throw new IOSCatalogLimitError();
  }
  const entries = Array.from(paths).sort().map(path => ({
    path,
    // Derive titles from file names only. Do not read content or carry custom fields.
    title: Array.from(path.split("/").pop()!.replace(/\.html?$/i, "").trim()).slice(0, IOS_CATALOG_MAX_TITLE_POINTS).join("") || "Untitled HTML",
  }));
  const text = JSON.stringify({ schemaVersion: 1, entries }, null, 2) + "\n";
  if (encoder.encode(text).length > IOS_CATALOG_MAX_BYTES) throw new IOSCatalogLimitError();
  return { text, count: entries.length };
}

export type IOSCatalogExportResult =
  | { status: "written" | "unchanged"; entries: number }
  | { status: "disabled" | "collision" | "too-large" | "superseded" | "error"; message: string };

export type IOSCatalogExisting = { state: "missing" | "collision" } | { state: "file"; text: string };
export interface IOSCatalogOutput {
  read(): Promise<IOSCatalogExisting>;
  create(text: string, current: () => boolean): Promise<boolean>;
  replace(previous: string, text: string, current: () => boolean): Promise<boolean>;
  knownDigest(): string | undefined;
  rememberDigest(digest: string): void;
}

const inactive = (): IOSCatalogExportResult => ({ status: "disabled", message: "Turn on iOS catalog publishing on this desktop first." });
const superseded = (): IOSCatalogExportResult => ({ status: "superseded", message: "The HTML catalog changed while publishing. Any queued update will regenerate it." });
const collision = (): IOSCatalogExportResult => ({ status: "collision", message: "The iOS catalog path is occupied by an unrecognized or changed file. Nothing was overwritten." });

async function digest(text: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** An explicitly enabled desktop has one queued refresh and one atomic writer. */
export class IOSCatalogExporter {
  private enabled = false;
  private disposed = false;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private dirtySince?: number;
  private running?: Promise<IOSCatalogExportResult>;

  constructor(
    private catalog: () => Promise<readonly HtmlCatalogEntry[]>,
    private output: IOSCatalogOutput,
    private automaticResult: (result: IOSCatalogExportResult) => void = () => {},
    private delay = 400,
    private maximumDelay = 1_600,
  ) {}

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    this.generation++;
    if (enabled) this.requestRefresh();
    else this.stopTimer();
  }

  requestRefresh(): void {
    if (!this.enabled || this.disposed) return;
    this.generation++;
    this.dirtySince ??= Date.now();
    this.schedule();
  }

  private schedule(): void {
    if (!this.enabled || this.disposed || this.running || this.dirtySince === undefined) return;
    clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.delay, this.maximumDelay - (Date.now() - this.dirtySince)));
    this.timer = setTimeout(() => {
      void this.regenerate().then(this.automaticResult).catch(() => {});
    }, wait);
  }

  private stopTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.dirtySince = undefined;
  }

  regenerate(): Promise<IOSCatalogExportResult> {
    if (!this.enabled || this.disposed) return Promise.resolve(inactive());
    if (this.running) return this.running;
    this.stopTimer();
    const generation = this.generation;
    const current = () => !this.disposed && this.enabled && generation === this.generation;
    const pending = this.publish(current).finally(() => {
      this.running = undefined;
      this.schedule();
    });
    this.running = pending;
    return pending;
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    this.generation++;
    this.stopTimer();
  }

  private async publish(current: () => boolean): Promise<IOSCatalogExportResult> {
    try {
      const { text, count } = serializeIOSCatalog(await this.catalog());
      if (!current()) return superseded();
      const existing = await this.output.read();
      if (!current()) return superseded();
      if (existing.state === "collision") return collision();
      const nextDigest = await digest(text);
      if (!current()) return superseded();
      if (existing.state === "file") {
        if (existing.text === text) {
          this.output.rememberDigest(nextDigest);
          return { status: "unchanged", entries: count };
        }
        if (!this.output.knownDigest() || await digest(existing.text) !== this.output.knownDigest()) return collision();
        if (!current()) return superseded();
        if (!await this.output.replace(existing.text, text, current)) return current() ? collision() : superseded();
      } else if (!await this.output.create(text, current)) {
        return current() ? collision() : superseded();
      }
      this.output.rememberDigest(nextDigest);
      return { status: "written", entries: count };
    } catch (error) {
      if (!current()) return superseded();
      if (error instanceof IOSCatalogLimitError) {
        return { status: "too-large", message: "The iOS catalog exceeds 2,000 pages or 1 MiB. Narrow it with Excluded paths. The previous export was left alone." };
      }
      return { status: "error", message: "Could not publish the iOS catalog. Check the vault folder access and try Regenerate again." };
    }
  }
}
