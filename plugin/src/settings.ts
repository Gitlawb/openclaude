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

    containerEl.createEl('h3', { text: 'Vault' });

    new Setting(containerEl)
      .setName('Vault path (override)')
      .setDesc('Caminho completo do vault. Preencha se o agente não estiver acessando suas notas. Ex: G:\\Meu Drive\\Energinova_Hub')
      .addText(t =>
        t.setPlaceholder('Ex: G:\\Meu Drive\\Energinova_Hub')
         .setValue(this.plugin.settings.vaultPathOverride)
         .onChange(async v => {
           this.plugin.settings.vaultPathOverride = v.trim();
           await this.plugin.saveSettings();
         })
      );

    containerEl.createEl('h3', { text: 'Model provider' });

    new Setting(containerEl)
      .setName('Provider type')
      .setDesc('anthropic = Claude OAuth; ollama = local Ollama; openai = OpenAI-compatible (Groq, etc.)')
      .addDropdown(d =>
        d.addOption('anthropic', 'Anthropic (Claude)')
         .addOption('ollama', 'Ollama (local)')
         .addOption('openai', 'OpenAI-compatible (Groq, etc.)')
         .setValue(this.plugin.settings.provider?.type ?? 'anthropic')
         .onChange(async v => {
           this.plugin.settings.provider = {
             ...this.plugin.settings.provider,
             type: v as 'anthropic' | 'ollama' | 'openai',
           };
           await this.plugin.saveSettings();
         })
      );

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Model name (e.g. qwen3-vl:235b-cloud, llama-3.3-70b-versatile). Leave blank for provider default.')
      .addText(t =>
        t.setPlaceholder('qwen3-vl:235b-cloud')
         .setValue(this.plugin.settings.provider?.model ?? '')
         .onChange(async v => {
           this.plugin.settings.provider = { ...this.plugin.settings.provider, model: v.trim() || undefined };
           await this.plugin.saveSettings();
         })
      );

    new Setting(containerEl)
      .setName('Base URL')
      .setDesc('API base URL (e.g. http://localhost:11434/v1 for Ollama, https://api.groq.com/openai/v1 for Groq).')
      .addText(t =>
        t.setPlaceholder('http://localhost:11434/v1')
         .setValue(this.plugin.settings.provider?.baseUrl ?? '')
         .onChange(async v => {
           this.plugin.settings.provider = { ...this.plugin.settings.provider, baseUrl: v.trim() || undefined };
           await this.plugin.saveSettings();
         })
      );

    new Setting(containerEl)
      .setName('API key')
      .setDesc('API key for the provider. Use "ollama" for local Ollama.')
      .addText(t =>
        t.setPlaceholder('ollama')
         .setValue(this.plugin.settings.provider?.apiKey ?? '')
         .onChange(async v => {
           this.plugin.settings.provider = { ...this.plugin.settings.provider, apiKey: v.trim() || undefined };
           await this.plugin.saveSettings();
         })
      );
  }
}
