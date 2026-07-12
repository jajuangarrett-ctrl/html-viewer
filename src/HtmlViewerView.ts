import { ItemView, Notice, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type HtmlViewerPlugin from "../main";
import { absolutePathToFileUrl, vaultFileToFileUrl } from "./pathUtils";

export const VIEW_TYPE_HTML = "html-viewer";

function getDirectory(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function normalizeVaultPath(path: string): string {
  const parts: string[] = [];

  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  return parts.join("/");
}

function isRelativeLocalUrl(url: string): boolean {
  const trimmed = url.trim();

  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("/")) {
    return false;
  }

  return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

function resolveRelativeVaultPath(baseDir: string, url: string): string | null {
  if (!isRelativeLocalUrl(url)) {
    return null;
  }

  const cleanUrl = url.split(/[?#]/, 1)[0];
  let decodedUrl = cleanUrl;

  try {
    decodedUrl = decodeURI(cleanUrl);
  } catch {
    decodedUrl = cleanUrl;
  }

  return normalizeVaultPath(baseDir ? `${baseDir}/${decodedUrl}` : decodedUrl);
}

function getHtmlAttribute(tag: string, attrName: string): string | null {
  const quoted = new RegExp(`\\b${attrName}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag);
  if (quoted) {
    return quoted[2];
  }

  const unquoted = new RegExp(`\\b${attrName}\\s*=\\s*([^\\s>]+)`, "i").exec(tag);
  return unquoted?.[1] ?? null;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function replaceAsync(
  input: string,
  regex: RegExp,
  replacer: (match: RegExpExecArray) => Promise<string>
): Promise<string> {
  const chunks: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    chunks.push(input.slice(lastIndex, match.index));
    chunks.push(await replacer(match));
    lastIndex = match.index + match[0].length;
  }

  chunks.push(input.slice(lastIndex));
  return chunks.join("");
}

export class HtmlViewerView extends ItemView {
  plugin: HtmlViewerPlugin;
  iframe: HTMLIFrameElement | null = null;
  pathLabel: HTMLElement | null = null;
  currentFile: TFile | null = null;
  currentUrl = "";
  currentBrowserUrl = "";
  currentPath = "";
  currentSrcdoc = "";
  companionLeaf: WorkspaceLeaf | null = null;
  private readonly messageHandler = (event: MessageEvent) => this.handleMessage(event);

  constructor(leaf: WorkspaceLeaf, plugin: HtmlViewerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_HTML;
  }

  getDisplayText(): string {
    const externalFilename = this.currentPath.split("/").pop();
    return this.currentFile?.name ?? (externalFilename || "HTML Viewer");
  }

  getIcon(): string {
    return "code-2";
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("html-viewer-container");

    const navBar = contentEl.createDiv({ cls: "html-viewer-navbar" });
    this.pathLabel = navBar.createDiv({
      cls: "html-viewer-path",
      text: "No HTML file loaded",
    });

    const reloadButton = navBar.createEl("button", {
      text: "↺",
      attr: { "aria-label": "Reload" },
    });
    reloadButton.addEventListener("click", () => this.reload());

    const browserButton = navBar.createEl("button", {
      text: "⎋",
      attr: { "aria-label": "Open in Browser" },
    });
    browserButton.addEventListener("click", () => {
      const browserUrl = this.currentBrowserUrl || this.currentUrl;
      if (browserUrl) {
        window.open(browserUrl, "_blank");
      }
    });

    this.iframe = contentEl.createEl("iframe", {
      cls: "html-viewer-iframe",
      attr: {
        sandbox: "allow-scripts allow-same-origin allow-forms allow-popups",
      },
    });

    window.addEventListener("message", this.messageHandler);

    if (this.currentUrl || this.currentSrcdoc) {
      this.updateFrame();
      this.updatePathLabel(this.getDisplayText(), this.currentPath);
    }
  }

  async onClose(): Promise<void> {
    window.removeEventListener("message", this.messageHandler);
    this.iframe = null;
    this.pathLabel = null;
  }

  async loadFile(file: TFile): Promise<void> {
    const adapter = this.app.vault.adapter as unknown as { getBasePath?: () => string };
    const basePath = adapter.getBasePath?.();

    if (!basePath) {
      throw new Error("HTML Viewer requires a desktop vault adapter with getBasePath().");
    }

    const fileUrl = vaultFileToFileUrl(basePath, file.path);

    this.currentUrl = this.app.vault.getResourcePath(file);
    this.currentBrowserUrl = fileUrl;
    this.currentFile = file;
    this.currentPath = file.path;
    this.currentSrcdoc = await this.buildSrcdoc(file);
    this.updateFrame();
    this.updatePathLabel(file.name, file.path);
  }

  loadAbsolutePath(absPath: string): void {
    const normalizedPath = absPath.replace(/\\/g, "/");
    this.currentUrl = absolutePathToFileUrl(absPath);
    this.currentBrowserUrl = this.currentUrl;
    this.currentFile = null;
    this.currentPath = normalizedPath;
    this.currentSrcdoc = "";
    this.updateFrame();
    this.updatePathLabel(normalizedPath.split("/").pop() ?? normalizedPath, normalizedPath);
  }

  getState(): Record<string, unknown> {
    const state = super.getState();

    if (this.currentFile) {
      return { ...state, file: this.currentFile.path };
    }

    if (this.currentPath) {
      return { ...state, absPath: this.currentPath };
    }

    return state;
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);

    if (!state || typeof state !== "object") {
      return;
    }

    const viewState = state as { file?: unknown; absPath?: unknown };

    if (typeof viewState.file === "string") {
      const file = this.app.vault.getAbstractFileByPath(viewState.file);
      if (file instanceof TFile) {
        await this.loadFile(file);
      }
    } else if (typeof viewState.absPath === "string") {
      this.loadAbsolutePath(viewState.absPath);
    }
  }

  reload(): void {
    if (this.currentFile) {
      void this.loadFile(this.currentFile);
      return;
    }

    this.updateFrame();
  }

  private async buildSrcdoc(file: TFile): Promise<string> {
    const baseDir = getDirectory(file.path);
    const originalHtml = await this.app.vault.read(file);
    const withInlineStyles = await this.inlineStylesheets(originalHtml, baseDir);
    const withInlineScripts = await this.inlineScripts(withInlineStyles, baseDir);
    return this.injectNavigationBridge(withInlineScripts, baseDir);
  }

  private async inlineStylesheets(html: string, baseDir: string): Promise<string> {
    return replaceAsync(html, /<link\b[^>]*>/gi, async (match) => {
      const tag = match[0];
      const rel = getHtmlAttribute(tag, "rel")?.toLowerCase() ?? "";
      const href = getHtmlAttribute(tag, "href");

      if (!href || !rel.split(/\s+/).includes("stylesheet")) {
        return tag;
      }

      const vaultPath = resolveRelativeVaultPath(baseDir, href);
      if (!vaultPath) {
        return tag;
      }

      const asset = this.app.vault.getAbstractFileByPath(vaultPath);
      if (!(asset instanceof TFile)) {
        return tag;
      }

      const css = (await this.app.vault.read(asset)).replace(/<\/style/gi, "<\\/style");
      return `<style data-html-viewer-inline="${escapeHtmlAttribute(href)}">\n${css}\n</style>`;
    });
  }

  private async inlineScripts(html: string, baseDir: string): Promise<string> {
    return replaceAsync(
      html,
      /<script\b([^>]*)\bsrc\s*=\s*(["'])(.*?)\2([^>]*)>\s*<\/script>/gi,
      async (match) => {
        const beforeSrc = match[1] ?? "";
        const src = match[3];
        const afterSrc = match[4] ?? "";
        const vaultPath = resolveRelativeVaultPath(baseDir, src);

        if (!vaultPath) {
          return match[0];
        }

        const asset = this.app.vault.getAbstractFileByPath(vaultPath);
        if (!(asset instanceof TFile)) {
          return match[0];
        }

        const attrs = `${beforeSrc}${afterSrc}`
          .replace(/\s+(defer|async)\b/gi, "")
          .replace(/\s+integrity\s*=\s*(["']).*?\1/gi, "")
          .replace(/\s+crossorigin\s*=\s*(["']).*?\1/gi, "")
          .trim();
        const js = (await this.app.vault.read(asset)).replace(/<\/script/gi, "<\\/script");

        return `<script${attrs ? ` ${attrs}` : ""} data-html-viewer-inline="${escapeHtmlAttribute(src)}">\n${js}\n</script>`;
      }
    );
  }

  private injectNavigationBridge(html: string, baseDir: string): string {
    const bridge = `<script data-html-viewer-bridge>
(() => {
  const baseDir = ${JSON.stringify(baseDir)};
  const normalize = (path) => {
    const parts = [];
    for (const part of path.replace(/\\\\/g, "/").split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    return parts.join("/");
  };
  const isRelativeLocal = (href) => href && !href.startsWith("#") && !href.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(href);
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest && event.target.closest("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    const vaultFilePath = anchor.getAttribute("data-vault-file-path");
    if (vaultFilePath && window.parent !== window) {
      event.preventDefault();
      event.stopImmediatePropagation();
      parent.postMessage({ source: "html-viewer", type: "open-vault-file", path: vaultFilePath }, "*");
      return;
    }
    if (!isRelativeLocal(href)) return;
    const cleanHref = href.split(/[?#]/, 1)[0];
    if (!/\.html?$/i.test(cleanHref)) return;
    event.preventDefault();
    parent.postMessage({ source: "html-viewer", type: "open-vault-html", path: normalize(baseDir ? baseDir + "/" + cleanHref : cleanHref) }, "*");
  }, true);
})();
</script>`;

    if (/<\/body\s*>/i.test(html)) {
      return html.replace(/<\/body\s*>/i, `${bridge}\n</body>`);
    }

    return `${html}\n${bridge}`;
  }

  private handleMessage(event: MessageEvent): void {
    if (!this.iframe || event.source !== this.iframe.contentWindow) {
      return;
    }

    const data = event.data as { source?: unknown; type?: unknown; path?: unknown; page?: unknown };
    if (data?.source !== "html-viewer") {
      return;
    }

    if (data.type === "reload-vault-html") {
      void this.reloadCurrentFile(typeof data.page === "string" ? data.page : "");
      return;
    }

    if (typeof data.path !== "string") return;

    if (data.type === "open-vault-html") {
      const file = this.app.vault.getAbstractFileByPath(data.path);
      if (file instanceof TFile && file.extension.toLowerCase() === "html") {
        void this.loadFile(file);
      }
      return;
    }

    if (data.type === "open-vault-file") {
      void this.openCompanionFile(data.path);
    }
  }

  private async reloadCurrentFile(page: string): Promise<void> {
    if (!this.currentFile) return;

    const iframe = this.iframe;
    const restorePage = () => {
      iframe?.contentWindow?.postMessage(
        { source: "html-viewer", type: "set-dashboard-page", page },
        "*"
      );
    };

    if (iframe && page) iframe.addEventListener("load", restorePage, { once: true });

    try {
      await this.loadFile(this.currentFile);
    } catch (error) {
      if (iframe && page) iframe.removeEventListener("load", restorePage);
      console.error("HTML Viewer could not reload the current HTML file.", error);
      new Notice("Unable to reload this HTML file.");
    }
  }

  private async openCompanionFile(path: string): Promise<void> {
    const normalizedPath = normalizeVaultPath(path);
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!(file instanceof TFile)) {
      new Notice(`File not found: ${normalizedPath || path}`);
      return;
    }

    const leaf = this.getCompanionLeaf();
    this.companionLeaf = leaf;
    try {
      await leaf.openFile(file);
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
    } catch (error) {
      console.error(`HTML Viewer could not open companion file: ${normalizedPath}`, error);
      new Notice(`Unable to open file: ${normalizedPath}`);
    }
  }

  private getCompanionLeaf(): WorkspaceLeaf {
    if (this.companionLeaf && this.leafStillExists(this.companionLeaf)) {
      return this.companionLeaf;
    }

    return this.app.workspace.getLeaf("tab");
  }

  private leafStillExists(targetLeaf: WorkspaceLeaf): boolean {
    let found = false;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf === targetLeaf) {
        found = true;
      }
    });

    return found;
  }

  private updateFrame(): void {
    if (!this.iframe) {
      return;
    }

    if (this.currentSrcdoc) {
      this.iframe.removeAttribute("src");
      this.iframe.srcdoc = this.currentSrcdoc;
      return;
    }

    this.iframe.removeAttribute("srcdoc");
    this.iframe.src = this.currentUrl;
  }

  private updatePathLabel(label: string, title: string): void {
    if (!this.pathLabel) {
      return;
    }

    this.pathLabel.setText(label);
    this.pathLabel.setAttr("title", title);
  }
}
