import { App, PluginSettingTab, Setting } from "obsidian";
import type HtmlViewerPlugin from "../main";

export interface HtmlViewerSettings {
  openInNewTab: boolean;
}

export const DEFAULT_SETTINGS: HtmlViewerSettings = {
  openInNewTab: true,
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
  }
}
