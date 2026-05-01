import { Plugin } from 'obsidian';
import type { PluginSettings } from './types.js';
import { DEFAULT_SETTINGS } from './types.js';

export default class OpenClaudePlugin extends Plugin {
  settings!: PluginSettings;

  async onload(): Promise<void> {
    await this.loadSettings();
    console.log('[OpenClaude] loaded');
  }

  async onunload(): Promise<void> {
    console.log('[OpenClaude] unloaded');
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
