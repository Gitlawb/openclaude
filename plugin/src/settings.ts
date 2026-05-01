import { App, PluginSettingTab, Setting } from 'obsidian';
import type OpenClaudePlugin from './main.js';

export class SettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: OpenClaudePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'OpenClaude' });

    new Setting(containerEl)
      .setName('Server port')
      .setDesc('Port the OpenClaude server listens on (default: 7777).')
      .addText(t =>
        t.setPlaceholder('7777').setValue(String(this.plugin.settings.port))
         .onChange(async v => {
           const p = parseInt(v, 10);
           if (!isNaN(p) && p > 1024 && p < 65535) {
             this.plugin.settings.port = p;
             await this.plugin.saveSettings();
           }
         })
      );

    new Setting(containerEl)
      .setName('Server binary path')
      .setDesc('Full path to dist/cli.mjs (or the openclaude binary). Leave blank to use PATH.')
      .addText(t =>
        t.setPlaceholder('/path/to/dist/cli.mjs')
         .setValue(this.plugin.settings.serverBinaryPath)
         .onChange(async v => { this.plugin.settings.serverBinaryPath = v.trim(); await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName('Token path')
      .setDesc('Path to the server token file. Default: ~/.openclaude/server-token')
      .addText(t =>
        t.setValue(this.plugin.settings.tokenPath)
         .onChange(async v => { this.plugin.settings.tokenPath = v.trim(); await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName('Auto-start server')
      .setDesc('Start the server automatically when Obsidian opens.')
      .addToggle(tog =>
        tog.setValue(this.plugin.settings.autoStartServer)
           .onChange(async v => { this.plugin.settings.autoStartServer = v; await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName('Permission preset')
      .setDesc('How the agent handles file edits.')
      .addDropdown(d =>
        d.addOption('conservative', 'Conservative — confirm everything')
         .addOption('balanced', 'Balanced (recommended)')
         .addOption('aggressive', 'Aggressive — auto-apply most edits')
         .setValue(this.plugin.settings.preset)
         .onChange(async v => {
           this.plugin.settings.preset = v as 'conservative' | 'balanced' | 'aggressive';
           await this.plugin.saveSettings();
         })
      );
  }
}
