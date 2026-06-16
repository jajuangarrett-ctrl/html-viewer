import { Plugin, SuggestModal, TFile } from "obsidian";
import { HtmlViewerSettingTab, DEFAULT_SETTINGS, HtmlViewerSettings } from "./src/settings";
import { HtmlViewerView, VIEW_TYPE_HTML } from "./src/HtmlViewerView";
import { isPathExcluded, parseExcludePatterns } from "./src/fileFilters";

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
    el.createEl("div", { text: file.name });
    el.createEl("small", { text: file.path });
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
    const excludePatterns = parseExcludePatterns(this.settings.excludedPathPatterns);

    return this.app.vault
      .getFiles()
      .filter((file) => file.extension.toLowerCase() === "html")
      .filter((file) => !isPathExcluded(file.path, excludePatterns))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
