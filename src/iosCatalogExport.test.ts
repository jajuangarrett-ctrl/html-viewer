import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IOS_CATALOG_FILE, IOSCatalogExporter, IOSCatalogLimitError, IOS_CATALOG_MAX_ENTRIES,
  iosPageURL, isIOSCatalogPage, serializeIOSCatalog, type IOSCatalogExisting, type IOSCatalogOutput,
} from "./iosCatalogExport";
import type { HtmlCatalogEntry } from "./htmlCatalog";

const row = (path: string, title = path) => ({ path, title });
const first = [row("Artifacts/Guide.html")];
const second = [row("Artifacts/Next.htm")];

function outputFixture() {
  let state: string | null = null, known: string | undefined, blocked = false;
  const output: IOSCatalogOutput = {
    read: vi.fn(async (): Promise<IOSCatalogExisting> => blocked ? { state: "collision" } : state === null ? { state: "missing" } : { state: "file", text: state }),
    create: vi.fn(async (text, current) => {
      if (!current() || state !== null || blocked) return false;
      state = text;
      return true;
    }),
    replace: vi.fn(async (previous, text, current) => {
      if (!current() || state !== previous || blocked) return false;
      state = text;
      return true;
    }),
    knownDigest: () => known,
    rememberDigest: vi.fn((digest: string) => { known = digest; }),
  };
  return { output, get: () => state, put: (text: string) => { state = text; }, block: () => { blocked = true; } };
}

function deferred<T>() {
  let finish!: (value: T) => void;
  const promise = new Promise<T>(resolve => { finish = resolve; });
  return { finish, promise };
}

afterEach(() => { vi.useRealTimers(); });

describe("native iOS version 1 wire contract", () => {
  it("uses exact safe vault names, enforces exclusions, and writes only deterministic title/path metadata", () => {
    const candidates = [
      row("Artifacts/Café 𐐷 + 100% #?.HTML", "<script>Do not leak HTML source</script>"),
      row("Artifacts/Z.htm"), row("Artifacts/A_Home.html"), row("Artifacts/Z.htm", "duplicate"),
      row("root.html"), row("Root.html"), row("Documents/plain.txt"),
      row("Layouts/.internal/run.html"), row("Artifacts/Node_Modules/a.html"), row(".obsidian/a.html"),
      row("a/%73ecrets/page.html"), row("Team/Passwords.html"), row("Secrets/Guide.html"),
      row("http:example.html"), row("C:/guide.html"), row("/root.html"), row("a/../x.html"),
      row("Artifacts/\nonsense.html"), row("a/ /file.htm"), row("a/ .cache/file.htm"),
    ];
    expect(IOS_CATALOG_FILE).toBe("Artifacts/HTML Viewer/ios-catalog.json");
    const value = serializeIOSCatalog(candidates);
    expect(value).toEqual(serializeIOSCatalog([...candidates].reverse()));
    expect(value.text).not.toContain("Do not leak");
    expect(JSON.parse(value.text)).toEqual({ schemaVersion: 1, entries: [
      { path: "Artifacts/A_Home.html", title: "A_Home" },
      { path: "Artifacts/Café 𐐷 + 100% #?.HTML", title: "Café 𐐷 + 100% #?" },
      { path: "Artifacts/Z.htm", title: "Z" }, { path: "Root.html", title: "Root" },
      { path: "root.html", title: "root" },
    ] });
  });

  it("encodes one exact URL parameter, including punctuation and Unicode", () => {
    const path = "Projects/ A Café 𐐷 + 100% #? (ok)!'.html";
    const url = iosPageURL(path)!;
    expect(url).toBe("fjg-html-viewer://open?path=Projects%2F%20A%20Caf%C3%A9%20%F0%90%90%B7%20%2B%20100%25%20%23%3F%20%28ok%29%21%27.html");
    expect(decodeURIComponent(url.split("?path=")[1])).toBe(path);
    for (const bad of ["https://a.example/page.htm", "../x.html", "/a.html", ".secret.html",
      "node_modules/x.html", "a\\b.html", "a\u007Fb.html", "A\0B.htm"]) {
      expect(isIOSCatalogPage(bad)).toBe(false);
      expect(iosPageURL(bad)).toBeNull();
    }
  });

  it("fails closed on excessive document or byte counts and caps title without cutting surrogate pairs", () => {
    expect(() => serializeIOSCatalog(Array.from({ length: IOS_CATALOG_MAX_ENTRIES + 1 }, (_, n) => row(n + ".html")))).toThrow(IOSCatalogLimitError);
    expect(() => serializeIOSCatalog(Array.from({ length: IOS_CATALOG_MAX_ENTRIES }, (_, n) => row("bucket-" + n + "/" + "a".repeat(120) + "/" + "b".repeat(120) + "/" + "c".repeat(180) + ".html")))).toThrow(IOSCatalogLimitError);
    const title = "𐐷".repeat(60) + "abc".repeat(2);
    expect(isIOSCatalogPage(title + ".html")).toBe(true);
    expect(JSON.parse(serializeIOSCatalog([row(title + ".html")]).text).entries[0].title).toBe(title);
    expect(isIOSCatalogPage("é".repeat(126) + ".html")).toBe(false); // component > 255 UTF-8 bytes
    expect(isIOSCatalogPage("a".repeat(254).concat("/").repeat(4) + "Guide.html")).toBe(false); // whole path > 1,024 bytes
    for(const control of ["\u0085", "\u202E", "\u200D"]) expect(isIOSCatalogPage("A" + control + "B.html")).toBe(false);
  });
});

describe("single opt-in publisher", () => {
  it("never reads or writes by default; once enabled, creates, keeps identical bytes, and atomically updates an owned file", async () => {
    const f = outputFixture();
    let rows = first;
    const read = vi.fn(async () => rows);
    const exporter = new IOSCatalogExporter(read, f.output);
    expect(await exporter.regenerate()).toMatchObject({ status: "disabled" });
    exporter.requestRefresh();
    expect(read).not.toHaveBeenCalled();
    exporter.setEnabled(true);
    expect(await exporter.regenerate()).toEqual({ status: "written", entries: 1 });
    expect(await exporter.regenerate()).toEqual({ status: "unchanged", entries: 1 });
    expect(f.output.create).toHaveBeenCalledTimes(1);
    expect(f.output.replace).not.toHaveBeenCalled();
    rows = second;
    expect(await exporter.regenerate()).toEqual({ status: "written", entries: 1 });
    expect(f.output.replace).toHaveBeenCalledTimes(1);
    expect(f.get()).toEqual(serializeIOSCatalog(second).text);
    exporter.setEnabled(false);
    expect(await exporter.regenerate()).toMatchObject({ status: "disabled" });
    expect(f.get()).toEqual(serializeIOSCatalog(second).text);
  });

  it("preserves unrecognized bytes, a lookalike valid schema, and changed bytes even with previous ownership", async () => {
    const f = outputFixture();
    f.put(serializeIOSCatalog(second).text);
    let rows = first;
    const exporter = new IOSCatalogExporter(async () => rows, f.output);
    exporter.setEnabled(true);
    expect(await exporter.regenerate()).toMatchObject({ status: "collision" });
    expect(f.output.replace).not.toHaveBeenCalled();
    rows = second; // exact desired bytes can be recognized without a write
    expect(await exporter.regenerate()).toMatchObject({ status: "unchanged" });
    f.put("An unrelated document stored at this path");
    rows = first;
    expect(await exporter.regenerate()).toMatchObject({ status: "collision" });
    expect(f.get()).toBe("An unrelated document stored at this path");
    f.block();
    expect(await exporter.regenerate()).toMatchObject({ status: "collision" });
    expect(f.output.replace).not.toHaveBeenCalled();
  });

  it("returns a friendly failure and retains a valid earlier manifest if catalog reads or limits fail", async () => {
    const f = outputFixture();
    let behavior = "";
    const exporter = new IOSCatalogExporter(async () => {
      if (behavior === "read") throw new Error("Private device path or credentials must not leak");
      if (behavior === "size") return Array.from({ length: IOS_CATALOG_MAX_ENTRIES + 1 }, (_, n) => row(n + ".htm"));
      return first;
    }, f.output);
    exporter.setEnabled(true);
    expect(await exporter.regenerate()).toMatchObject({ status: "written" });
    behavior = "read";
    const failure = await exporter.regenerate();
    expect(failure).toMatchObject({ status: "error" });
    expect(JSON.stringify(failure)).not.toContain("Private device");
    behavior = "size";
    expect(await exporter.regenerate()).toMatchObject({ status: "too-large" });
    expect(f.get()).toEqual(serializeIOSCatalog(first).text);
    expect(f.output.replace).not.toHaveBeenCalled();
  });

  it("bounds sustained updates, cancels a queued reload, and never runs more than one writer", async () => {
    vi.useFakeTimers();
    const f = outputFixture();
    const slow = deferred<readonly HtmlCatalogEntry[]>();
    const read = vi.fn(async () => slow.promise);
    const exporter = new IOSCatalogExporter(read, f.output, () => {}, 40, 100);
    exporter.setEnabled(true);
    for (let n = 0; n < 3; n++) { await vi.advanceTimersByTimeAsync(28); exporter.requestRefresh(); }
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16);
    expect(read).toHaveBeenCalledTimes(1);
    const run = exporter.regenerate();
    expect(exporter.regenerate()).toBe(run);
    exporter.requestRefresh();
    exporter.dispose();
    slow.finish(first);
    expect(await run).toMatchObject({ status: "superseded" });
    await vi.advanceTimersByTimeAsync(300);
    expect(read).toHaveBeenCalledTimes(1);
    expect(f.output.create).not.toHaveBeenCalled();
  });

  it("supersedes a stale pending read and debounces a single follow-up generation", async () => {
    vi.useFakeTimers();
    const f = outputFixture();
    const slow = deferred<readonly HtmlCatalogEntry[]>();
    const result = deferred<string>();
    const read = vi.fn(() => Promise.resolve<readonly HtmlCatalogEntry[]>(second)).mockImplementationOnce(() => slow.promise);
    const exporter = new IOSCatalogExporter(read, f.output, outcome => result.finish(outcome.status), 30, 100);
    exporter.setEnabled(true);
    const underway = exporter.regenerate();
    exporter.requestRefresh(); exporter.requestRefresh();
    slow.finish(first);
    expect(await underway).toMatchObject({ status: "superseded" });
    expect(f.output.create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30);
    expect(await result.promise).toBe("written");
    expect(read).toHaveBeenCalledTimes(2);
    expect(f.get()).toBe(serializeIOSCatalog(second).text);
  });
});
