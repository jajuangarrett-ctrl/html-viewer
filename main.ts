import { Notice, Plugin, SuggestModal, TFile } from "obsidian";
import { HtmlViewerSettingTab, DEFAULT_SETTINGS, HtmlViewerSettings } from "./src/settings";
import { HtmlViewerView, VIEW_TYPE_HTML } from "./src/HtmlViewerView";
import { isPathExcluded, parseExcludePatterns } from "./src/fileFilters";

const BUILT_IN_EXCLUDED_PATH_PATTERNS = [
  "node_modules/",
  ".git/",
  ".obsidian/plugins/",
];

class HtmlFileSuggestModal extends SuggestModal<TFile> {
  plugin: HtmlViewerPlugin;

  constructor(plugin: HtmlViewerPlugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.setPlaceholder("Choose an HTML file to open");
  }

  getSuggestions(query: string): TFile[] {
    const normalizedQuery = query.trim().toLowerCase();
    return this.plugin.getHtmlFiles().filter((file) => {
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

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_HTML, (leaf) => new HtmlViewerView(leaf, this));
    this.registerExtensions(["html"], VIEW_TYPE_HTML);

    this.addRibbonIcon("code-2", "Open HTML file", () => {
      this.openFileSuggestModal();
    });

    this.addCommand({
      id: "open-file",
      name: "Open HTML file in viewer",
      callback: () => this.openFileSuggestModal(),
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "html") {
          menu.addItem((item) => {
            item
              .setTitle("Open in HTML Viewer")
              .setIcon("code-2")
              .onClick(() => this.openHtmlFile(file));
          });
        }
      })
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

    if (leaf.view instanceof HtmlViewerView) {
      leaf.view.loadFile(file);
    }
  }

  openFileSuggestModal(): void {
    new HtmlFileSuggestModal(this).open();
  }

  getHtmlFiles(): TFile[] {
    const excludePatterns = [
      ...BUILT_IN_EXCLUDED_PATH_PATTERNS,
      ...parseExcludePatterns(this.settings.excludedPathPatterns),
    ];
    const exactExcludedPaths = new Set(
      this.settings.exactExcludedPaths.map((path) => path.toLowerCase())
    );

    return this.app.vault
      .getFiles()
      .filter((file) => file.extension.toLowerCase() === "html")
      .filter((file) => !exactExcludedPaths.has(file.path.toLowerCase()))
      .filter((file) => !isPathExcluded(file.path, excludePatterns))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async hideHtmlFileFromChooser(file: TFile): Promise<void> {
    if (!this.settings.exactExcludedPaths.includes(file.path)) {
      this.settings.exactExcludedPaths = [...this.settings.exactExcludedPaths, file.path].sort();
      await this.saveSettings();
    }

    new Notice(`Hidden from HTML Viewer chooser: ${file.name}`);
  }

  async removeHiddenHtmlFile(path: string): Promise<void> {
    this.settings.exactExcludedPaths = this.settings.exactExcludedPaths.filter(
      (hiddenPath) => hiddenPath !== path
    );
    await this.saveSettings();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.exactExcludedPaths = this.settings.exactExcludedPaths ?? [];
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
