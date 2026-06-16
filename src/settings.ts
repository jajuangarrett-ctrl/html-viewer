import { App, PluginSettingTab, Setting } from "obsidian";
import type HtmlViewerPlugin from "../main";

export interface HtmlViewerSettings {
  openInNewTab: boolean;
  excludedPathPatterns: string;
  exactExcludedPaths: string[];
}

export const DEFAULT_SETTINGS: HtmlViewerSettings = {
  openInNewTab: true,
  excludedPathPatterns: "",
  exactExcludedPaths: [],
};

export class HtmlViewerSettingTab extends PluginSettingTab {
  plugin: HtmlViewerPlugin;

  constructor(app: App, plugin: HtmlViewerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "HTML Viewer" });

    new Setting(containerEl)
      .setName("Always open in new tab")
      .setDesc("Open HTML files in a new tab instead of replacing the current leaf.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.openInNewTab).onChange(async (value) => {
          this.plugin.settings.openInNewTab = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Excluded paths")
      .setDesc("Hide matching HTML files from the chooser. Add one path fragment, path pieces in order, or * wildcard pattern per line. System folders like node_modules are hidden automatically.")
      .addTextArea((text) => {
        text.inputEl.rows = 8;
        text.inputEl.cols = 48;
        text
          .setPlaceholder("AI Team/owner_inbox/\n**/Archive/**\nArtifacts/system/")
          .setValue(this.plugin.settings.excludedPathPatterns)
          .onChange(async (value) => {
            this.plugin.settings.excludedPathPatterns = value;
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl("h3", { text: "Hidden files" });

    if (this.plugin.settings.exactExcludedPaths.length === 0) {
      containerEl.createEl("p", {
        text: "No individual HTML files are hidden.",
        cls: "html-viewer-settings-empty",
      });
      return;
    }

    for (const path of this.plugin.settings.exactExcludedPaths) {
      new Setting(containerEl)
        .setName(path.split("/").pop() ?? path)
        .setDesc(path)
        .addButton((button) =>
          button.setButtonText("Remove").onClick(async () => {
            await this.plugin.removeHiddenHtmlFile(path);
            this.display();
          })
        );
    }
  }
}
