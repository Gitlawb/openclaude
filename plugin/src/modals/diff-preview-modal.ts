import { App, ButtonComponent, Modal } from 'obsidian';
import type OpenClaudePlugin from '../main.js';
import type { PendingEdit } from '../types.js';

export class DiffPreviewModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: OpenClaudePlugin,
    private readonly edit: PendingEdit,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass('openclaude-diff-modal');
    contentEl.empty();

    const name = this.edit.file.split(/[\\/]/).pop() ?? this.edit.file;
    contentEl.createEl('h2', { text: `Review edit — ${name}` });
    if (this.edit.reason) {
      contentEl.createEl('p', { text: `Reason: ${this.edit.reason}`, cls: 'openclaude-diff-footer' });
    }

    const grid = contentEl.createDiv({ cls: 'openclaude-diff-grid' });

    const before = grid.createDiv({ cls: 'openclaude-diff-col' });
    before.createDiv({ cls: 'openclaude-diff-label', text: 'Before' });
    before.createEl('pre', { cls: 'openclaude-diff-text before', text: this.edit.before });

    const after = grid.createDiv({ cls: 'openclaude-diff-col' });
    after.createDiv({ cls: 'openclaude-diff-label', text: 'After' });
    after.createEl('pre', { cls: 'openclaude-diff-text after', text: this.edit.after });

    contentEl.createDiv({ cls: 'openclaude-diff-footer', text: '✓ Shadow backup created before applying.' });

    const actions = contentEl.createDiv({ cls: 'openclaude-diff-actions' });
    new ButtonComponent(actions).setButtonText('Discard (Esc)').onClick(() => this.close());
    new ButtonComponent(actions).setButtonText('Apply (Enter)').setCta().onClick(() => this.apply());

    this.scope.register([], 'Enter', () => { this.apply(); return false; });
  }

  private applying = false;

  private async apply(): Promise<void> {
    if (this.applying) return;
    this.applying = true;
    try {
      await this.plugin.api.applyEdit(this.edit.id);
      this.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.contentEl.createEl('p', { text: `Apply failed: ${msg}`, cls: 'mod-warning' });
    } finally {
      this.applying = false;
    }
  }

  onClose(): void { this.contentEl.empty(); }
}
