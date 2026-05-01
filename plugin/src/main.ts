import { Plugin } from 'obsidian';
import type { PluginSettings } from './types.js';
import { DEFAULT_SETTINGS } from './types.js';
import { ApiClient } from './api-client.js';
import { ServerManager } from './server-manager.js';
import { SettingsTab } from './settings.js';
import { SidebarView, SIDEBAR_VIEW_TYPE } from './views/sidebar-view.js';

export default class OpenClaudePlugin extends Plugin {
  settings!: PluginSettings;
  api!: ApiClient;
  serverManager!: ServerManager;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.api = new ApiClient(this.settings.port, this.settings.tokenPath);
    this.serverManager = new ServerManager(this.settings, this.api);
    this.registerView(SIDEBAR_VIEW_TYPE, leaf => new SidebarView(leaf, this));

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

    this.app.workspace.onLayoutReady(() => { this.activateSidebar(); });
  }

  async onunload(): Promise<void> {
    this.serverManager.stop();
    this.app.workspace.detachLeavesOfType(SIDEBAR_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateSidebar(): Promise<void> {
    let [leaf] = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf();
      await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  // Filled in Task 9
  openCommandHub(): void {}
}
