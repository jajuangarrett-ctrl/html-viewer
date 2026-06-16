import { ItemView, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type HtmlViewerPlugin from "../main";
import { absolutePathToFileUrl, vaultFileToFileUrl } from "./pathUtils";

export const VIEW_TYPE_HTML = "html-viewer";

export class HtmlViewerView extends ItemView {
  plugin: HtmlViewerPlugin;
  iframe: HTMLIFrameElement | null = null;
  pathLabel: HTMLElement | null = null;
  currentFile: TFile | null = null;
  currentUrl = "";
  currentBrowserUrl = "";
  currentPath = "";

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

    if (this.currentUrl) {
      this.updateFrame();
      this.updatePathLabel(this.getDisplayText(), this.currentPath);
    }
  }

  async onClose(): Promise<void> {
    this.iframe = null;
    this.pathLabel = null;
  }

  loadFile(file: TFile): void {
    const adapter = this.app.vault.adapter as unknown as { getBasePath?: () => string };
    const basePath = adapter.getBasePath?.();

    if (!basePath) {
      throw new Error("HTML Viewer requires a desktop vault adapter with getBasePath().");
    }

    this.currentUrl = this.app.vault.getResourcePath(file);
    this.currentBrowserUrl = vaultFileToFileUrl(basePath, file.path);
    this.currentFile = file;
    this.currentPath = file.path;
    this.updateFrame();
    this.updatePathLabel(file.name, file.path);
  }

  loadAbsolutePath(absPath: string): void {
    const normalizedPath = absPath.replace(/\\/g, "/");
    this.currentUrl = absolutePathToFileUrl(absPath);
    this.currentBrowserUrl = this.currentUrl;
    this.currentFile = null;
    this.currentPath = normalizedPath;
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
        this.loadFile(file);
      }
    } else if (typeof viewState.absPath === "string") {
      this.loadAbsolutePath(viewState.absPath);
    }
  }

  reload(): void {
    if (!this.iframe || !this.currentUrl) {
      return;
    }

    this.iframe.src = this.currentUrl;
  }

  private updateFrame(): void {
    if (this.iframe) {
      this.iframe.removeAttribute("srcdoc");
      this.iframe.src = this.currentUrl;
    }
  }

  private updatePathLabel(label: string, title: string): void {
    if (!this.pathLabel) {
      return;
    }

    this.pathLabel.setText(label);
    this.pathLabel.setAttr("title", title);
  }
}
