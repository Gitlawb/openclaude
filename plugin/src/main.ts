import { Plugin } from 'obsidian';
import type { PluginSettings } from './types.js';
import { DEFAULT_SETTINGS } from './types.js';
import { ApiClient } from './api-client.js';
import { ServerManager } from './server-manager.js';
import { SettingsTab } from './settings.js';

export default class OpenClaudePlugin extends Plugin {
  settings!: PluginSettings;
  api!: ApiClient;
  serverManager!: ServerManager;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.api = new ApiClient(this.settings.port, this.settings.tokenPath);
    this.serverManager = new ServerManager(this.settings, this.api);

    this.addSettingTab(new SettingsTab(this.app, this));
    this.addRibbonIcon('brain', 'OpenClaude', () => { this.activateSidebar(); });

    this.addCommand({ id: 'open-sidebar', name: 'Open sidebar', callback: () => { this.activateSidebar(); } });
    this.addCommand({
      id: 'open-command-hub',
      name: 'Command hub',
      hotkeys: [{ modifiers: ['Ctrl'], key: 'k' }],
      callback: () => { this.openCommandHub(); },
    });

    if (this.settings.autoStartServer && this.settings.serverBinaryPath) {
      this.app.workspace.onLayoutReady(() => {
        this.serverManager.start().catch(e => console.error('[OpenClaude] start failed:', e));
      });
    }
  }

  async onunload(): Promise<void> {
    this.serverManager.stop();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // Filled in Task 7
  async activateSidebar(): Promise<void> {}

  // Filled in Task 9
  openCommandHub(): void {}
}
