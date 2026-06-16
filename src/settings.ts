import { App, PluginSettingTab, Setting } from "obsidian";
import type HtmlViewerPlugin from "../main";

export interface HtmlViewerSettings {
  openInNewTab: boolean;
  excludedPathPatterns: string;
}

export const DEFAULT_SETTINGS: HtmlViewerSettings = {
  openInNewTab: true,
  excludedPathPatterns: "",
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
      .setDesc("Hide matching HTML files from the chooser. Add one path fragment or * wildcard pattern per line. System folders like node_modules are hidden automatically.")
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
  }
}
