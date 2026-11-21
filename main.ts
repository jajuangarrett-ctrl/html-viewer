import { Notice, Platform, Plugin, SuggestModal, TFile, TFolder } from "obsidian";
import {
  HtmlViewerSettingTab,
  DEFAULT_SETTINGS,
  HtmlViewerSettings,
} from "./src/settings";
import { confirmAction, HtmlViewerView, VIEW_TYPE_HTML } from "./src/HtmlViewerView";
import { isPage, isReadablePage, safePath, pagePath, inRoot } from "./src/core";
import { isPathExcluded, parseExcludePatterns } from "./src/fileFilters";

import { HtmlCatalog, HtmlCatalogEntry } from "./src/htmlCatalog";
import { IOS_CATALOG_FILE, IOSCatalogExporter, isIOSCatalogPage, iosPageURL, type IOSCatalogExportResult } from "./src/iosCatalogExport";
import { desktopCatalogOutput, iosPublishingEnabled, saveIOSPublishingEnabled } from "./src/iosDesktopCatalog";


const BUILT_IN_EXCLUDED_PATH_PATTERNS = [
  "node_modules/",
  ".git/",
  ".obsidian/plugins/",
];

class FolderSuggestModal extends SuggestModal<TFolder> {
  constructor(
    private plugin: HtmlViewerPlugin,
    private view: HtmlViewerView,
  ) {
    super(plugin.app);
    this.setPlaceholder("Choose a project folder in the vault");
  }
  async getSuggestions(query: string) {
    const catalog = await this.plugin.getHtmlCatalog();
    return this.app.vault
      .getAllLoadedFiles()
      .filter(
        (f): f is TFolder =>
          f instanceof TFolder &&
          safePath(f.path) &&
          catalog.some(page => inRoot(page.path, f.path)) &&
          f.path.toLowerCase().includes(query.toLowerCase()),
      );
  }
  renderSuggestion(folder: TFolder, el: HTMLElement) {
    el.setText(folder.path);
  }
  onChooseSuggestion(folder: TFolder) {
    void this.view.addFolder(folder);
  }
}

class HtmlFileSuggestModal extends SuggestModal<TFile> {
  plugin: HtmlViewerPlugin;

  constructor(plugin: HtmlViewerPlugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.setPlaceholder("Choose an HTML file to open");
  }

  async getSuggestions(query: string): Promise<TFile[]> {
    const normalizedQuery = query.trim().toLowerCase();
    return (await this.plugin.getHtmlFiles()).filter((file) => {
      if (!normalizedQuery) {
        return true;
      }

      return file.path.toLowerCase().includes(normalizedQuery);
    });
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    const row = el.createDiv({ cls: "html-viewer-suggestion" });
    const text = row.createDiv({ cls: "html-viewer-suggestion-text" });
    text.createEl("div", { text: file.name });
    text.createEl("small", { text: file.path });

    const excludeButton = row.createEl("button", {
      text: "Exclude",
      cls: "html-viewer-exclude-button",
      attr: { "aria-label": `Exclude ${file.path} from HTML Viewer chooser` },
    });

    const stopSelection = (evt: Event) => {
      evt.preventDefault();
      evt.stopPropagation();
    };

    excludeButton.addEventListener("mousedown", stopSelection);
    excludeButton.addEventListener("click", async (evt) => {
      stopSelection(evt);
      await this.plugin.hideHtmlFileFromChooser(file);
      this.close();
    });
  }

  onChooseSuggestion(file: TFile): void {
    this.plugin.openHtmlFile(file);
  }
}

export default class HtmlViewerPlugin extends Plugin {
  settings: HtmlViewerSettings = DEFAULT_SETTINGS;
  private htmlCatalog?: HtmlCatalog<TFile>;
  private htmlFilters = "";
  private nativeExporter?: IOSCatalogExporter;
  private layoutReady = false;
  private unloading = false;
  private lastAutomaticIssue = "";


  async onload(): Promise<void> {
    this.unloading = false;
    this.layoutReady = false;
    this.lastAutomaticIssue = "";
    await this.loadSettings();
    this.htmlFilters = this.htmlFilterKey();
    this.htmlCatalog = new HtmlCatalog(
      () => this.app.vault.getFiles(),
      file => this.app.vault.cachedRead(file),
      path => this.isHtmlPathVisible(path),
    );
    if (this.canProduceIOSCatalog()) {
      this.nativeExporter = new IOSCatalogExporter(() => this.htmlCatalog!.getForPublishing(), desktopCatalogOutput(this.app), (result) => {
        if (this.unloading || !this.isPublishingIOSCatalog()) return;
        const issue = result.status === "collision" || result.status === "error" || result.status === "too-large" ? result.message : "";
        if (issue && this.lastAutomaticIssue !== issue) new Notice(issue);
        this.lastAutomaticIssue = issue;
      });
    }
    this.registerEvent(this.app.vault.on("create", file => {
      if (file instanceof TFile && this.affectsHtmlCatalog(file.path)) this.invalidateHtmlCatalog(file.path);
    }));
    this.registerEvent(this.app.vault.on("modify", file => {
      if (file instanceof TFile && this.affectsHtmlCatalog(file.path)) this.invalidateHtmlCatalog(file.path);
    }));
    this.registerEvent(this.app.vault.on("delete", file => {
      if (file instanceof TFolder) this.invalidateHtmlCatalog();
      else if (file instanceof TFile && this.affectsHtmlCatalog(file.path)) this.invalidateHtmlCatalog(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFolder || (file instanceof TFile && (this.affectsHtmlCatalog(file.path) || this.affectsHtmlCatalog(oldPath)))) this.invalidateHtmlCatalog();
    }));
    this.app.workspace.onLayoutReady(() => {
      if (this.unloading) return;
      this.layoutReady = true;
      this.invalidateHtmlCatalog();
      this.nativeExporter?.setEnabled(this.isPublishingIOSCatalog());
    });

    this.registerView(VIEW_TYPE_HTML, (leaf) => new HtmlViewerView(leaf, this));
    this.registerExtensions(["html", "htm"], VIEW_TYPE_HTML);

    this.addRibbonIcon("code-2", "Open HTML file", () => {
      this.openFileSuggestModal();
    });

    this.addCommand({
      id: "open-file",
      name: "Open HTML file in viewer",
      callback: () => this.openFileSuggestModal(),
    });

    this.addCommand({
      id: "toggle-focus-reading",
      name: "Toggle Focus Reading / show reader controls",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(HtmlViewerView);
        if (!view) return false;
        if (!checking) view.toggleFocusReading();
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && isReadablePage(file.path)) {
          menu.addItem((item) => {
            item
              .setTitle("Open in HTML Viewer")
              .setIcon("code-2")
              .onClick(() => this.openHtmlFile(file));
          });
        }
      }),
    );

    if (this.canProduceIOSCatalog()) {
      this.addCommand({
        id: "regenerate-ios-catalog",
        name: "Regenerate iOS HTML Viewer catalog",
        checkCallback: checking => {
          if (!this.isPublishingIOSCatalog()) return false;
          if (!checking) void this.regenerateIOSCatalogWithNotice();
          return true;
        },
      });
    }
    if (Platform.isIosApp) {
      this.addCommand({
        id: "open-in-ios-html-viewer",
        name: "Open in iOS HTML Viewer",
        checkCallback: checking => {
          const file = this.activeIOSPage();
          if (!file) return false;
          if (!checking) void this.confirmOpenInIOSViewer(file);
          return true;
        },
      });
    }

    this.addSettingTab(new HtmlViewerSettingTab(this.app, this));
  }

  private affectsHtmlCatalog(path: string): boolean {
    // Export JSON, local preferences and temp files cannot feed a refresh loop.
    return isPage(path) && safePath(path);
  }

  private invalidateHtmlCatalog(path?: string): void {
    this.htmlCatalog?.invalidate(path);
    this.nativeExporter?.requestRefresh();
  }

  canProduceIOSCatalog(): boolean {
    return Platform.isDesktopApp === true;
  }

  isPublishingIOSCatalog(): boolean {
    return this.canProduceIOSCatalog() && iosPublishingEnabled(this.app);
  }

  /** Explicit device-local opt-in; no synchronized plugin preference is changed. */
  async enableIOSCatalogPublishing(): Promise<IOSCatalogExportResult> {
    if (!this.nativeExporter) return { status: "disabled", message: "Only desktop Obsidian can publish the iOS catalog." };
    try {
      saveIOSPublishingEnabled(this.app, true);
    } catch {
      return { status: "error", message: "Could not save the device-local iOS catalog preference." };
    }
    if (!this.layoutReady) return { status: "superseded", message: "Publishing is enabled. The first export will run after this vault opens." };
    this.nativeExporter.setEnabled(true);
    return this.nativeExporter.regenerate();
  }

  disableIOSCatalogPublishing(): void {
    if (!this.nativeExporter) return;
    saveIOSPublishingEnabled(this.app, false);
    this.nativeExporter.setEnabled(false);
  }

  regenerateIOSCatalog(): Promise<IOSCatalogExportResult> {
    return this.nativeExporter?.regenerate() ?? Promise.resolve({ status: "disabled", message: "Only desktop Obsidian can publish the iOS catalog." });
  }

  showIOSCatalogResult(result: IOSCatalogExportResult): void {
    if ("message" in result) new Notice(result.message);
    else new Notice(`iOS HTML Viewer catalog ${result.status === "written" ? "saved" : "already up to date"}: ${result.entries} pages in ${IOS_CATALOG_FILE}`);
  }

  async regenerateIOSCatalogWithNotice(): Promise<void> {
    this.showIOSCatalogResult(await this.regenerateIOSCatalog());
  }

  private activeIOSPage(): TFile | null {
    const file = this.app.workspace.getActiveViewOfType(HtmlViewerView)?.currentFile
      ?? this.app.workspace.getActiveFile();
    return file instanceof TFile && isIOSCatalogPage(file.path) && this.isHtmlPathVisible(file.path) ? file : null;
  }

  private async confirmOpenInIOSViewer(file: TFile): Promise<void> {
    const path = file.path;
    const stamp = `${file.stat.mtime}:${file.stat.size}`;
    const current = () => !this.unloading && this.activeIOSPage() === file &&
      file.path === path && `${file.stat.mtime}:${file.stat.size}` === stamp;
    const url = iosPageURL(path);
    if (!url) return;
    if (!(await this.getHtmlCatalog()).some(row => row.path === path) || !current()) {
      if (!this.unloading) new Notice("The selected file is no longer an eligible HTML page.");
      return;
    }
    confirmAction(this, "Open in iOS HTML Viewer", "The iOS app will receive only the vault-relative path of this page. The page must be in the published catalog on that device.", "Open app", () => {
      if (current()) window.open(url, "_blank", "noopener,noreferrer");
      else new Notice("The current HTML page changed. Run the command again.");
    });
  }

  async openHtmlFile(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(this.settings.openInNewTab);
    await leaf.setViewState({
      type: VIEW_TYPE_HTML,
      state: { file: file.path },
      active: true,
    });
  }

  openFolderSuggestModal(view: HtmlViewerView): void {
    new FolderSuggestModal(this, view).open();
  }

  openFileSuggestModal(): void {
    new HtmlFileSuggestModal(this).open();
  }

  /** Version 1 metadata-only catalog used by this chooser, Library/Pages and VCC. */
  getHtmlCatalog(): Promise<readonly HtmlCatalogEntry[]> {
    return this.htmlCatalog?.get() ?? Promise.resolve([]);
  }

  subscribeHtmlCatalog(listener: () => void): () => void {
    return this.htmlCatalog?.subscribe(listener) ?? (() => {});
  }

  onunload(): void {
    this.unloading = true;
    this.nativeExporter?.dispose();
    this.htmlCatalog?.dispose();
  }

  async getHtmlFiles(): Promise<TFile[]> {
    return (await this.getHtmlCatalog()).map(row => this.app.vault.getAbstractFileByPath(row.path)).filter((file): file is TFile => file instanceof TFile);
  }

  private htmlFilterKey(): string {
    return JSON.stringify([this.settings.excludedPathPatterns, this.settings.exactExcludedPaths]);
  }

  private isHtmlPathVisible(path: string): boolean {
    const excludePatterns = [...BUILT_IN_EXCLUDED_PATH_PATTERNS, ...parseExcludePatterns(this.settings.excludedPathPatterns)];
    return !this.settings.exactExcludedPaths.some(hidden => hidden.toLowerCase() === path.toLowerCase()) && !isPathExcluded(path, excludePatterns);
  }

  async hideHtmlFileFromChooser(file: TFile): Promise<void> {
    if (!this.settings.exactExcludedPaths.includes(file.path)) {
      this.settings.exactExcludedPaths = [
        ...this.settings.exactExcludedPaths,
        file.path,
      ].sort();
      await this.saveSettings();
    }

    new Notice(`Hidden from HTML Viewer chooser: ${file.name}`);
  }

  async removeHiddenHtmlFile(path: string): Promise<void> {
    this.settings.exactExcludedPaths = this.settings.exactExcludedPaths.filter(
      (hiddenPath) => hiddenPath !== path,
    );
    await this.saveSettings();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.exactExcludedPaths = Array.isArray(
      this.settings.exactExcludedPaths,
    )
      ? this.settings.exactExcludedPaths.filter(
          (p: unknown) => typeof p === "string",
        )
      : [];
    this.settings.allowExternal = this.settings.allowExternal === true;
    this.settings.projects = Array.isArray(this.settings.projects)
      ? this.settings.projects
          .filter(
            (p) =>
              p &&
              typeof p.id === "string" &&
              typeof p.entry === "string" &&
              safePath(p.entry) &&
              typeof p.root === "string" &&
              (!p.root || safePath(p.root)) &&
              typeof p.last === "string" &&
              safePath(pagePath(p.last)) &&
              typeof p.name === "string" &&
              (p.root
                ? inRoot(p.entry, p.root) && inRoot(pagePath(p.last), p.root)
                : pagePath(p.last) === p.entry),
          )
          .map((p) => ({ ...p, trusted: p.trusted === true }))
      : [];
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    const filters = this.htmlFilterKey();
    if (filters !== this.htmlFilters) {
      this.htmlFilters = filters;
      this.invalidateHtmlCatalog();
    }
  }
}
