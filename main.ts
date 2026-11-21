import { Notice, Plugin, SuggestModal, TFile, TFolder } from "obsidian";
import {
  HtmlViewerSettingTab,
  DEFAULT_SETTINGS,
  HtmlViewerSettings,
} from "./src/settings";
import { HtmlViewerView, VIEW_TYPE_HTML } from "./src/HtmlViewerView";
import { isReadablePage, safePath, pagePath, inRoot } from "./src/core";
import { isPathExcluded, parseExcludePatterns } from "./src/fileFilters";

import { HtmlCatalog, HtmlCatalogEntry } from "./src/htmlCatalog";

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

  async onload(): Promise<void> {
    await this.loadSettings();
    this.htmlFilters = this.htmlFilterKey();
    this.htmlCatalog = new HtmlCatalog(
      () => this.app.vault.getFiles(),
      file => this.app.vault.cachedRead(file),
      path => this.isHtmlPathVisible(path),
    );
    this.registerEvent(this.app.vault.on("create", file => this.htmlCatalog?.invalidate(file instanceof TFile ? file.path : undefined)));
    this.registerEvent(this.app.vault.on("modify", file => this.htmlCatalog?.invalidate(file.path)));
    this.registerEvent(this.app.vault.on("delete", file => this.htmlCatalog?.invalidate(file instanceof TFile ? file.path : undefined)));
    this.registerEvent(this.app.vault.on("rename", () => this.htmlCatalog?.invalidate()));
    this.app.workspace.onLayoutReady(() => this.htmlCatalog?.invalidate());


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

    this.addSettingTab(new HtmlViewerSettingTab(this.app, this));
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
      this.htmlCatalog?.invalidate();
    }
  }
}
