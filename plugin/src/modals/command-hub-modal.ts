import { App, Modal } from 'obsidian';
import type OpenClaudePlugin from '../main.js';

interface HubItem {
  icon: string;
  name: string;
  shortcut?: string;
  action: () => void | Promise<void>;
}

export class CommandHubModal extends Modal {
  private selectedIdx = 0;
  private listEl!: HTMLElement;

  constructor(app: App, private readonly plugin: OpenClaudePlugin) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const search = contentEl.createEl('input', {
      cls: 'openclaude-hub-search',
      attr: { placeholder: 'Search commands…', type: 'text', autocomplete: 'off' },
    });
    this.listEl = contentEl.createDiv({ cls: 'openclaude-hub-list' });

    const allItems = this.buildItems();
    this.renderList(allItems);

    search.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      this.renderList(q ? allItems.filter(i => i.name.toLowerCase().includes(q)) : allItems);
    });

    search.addEventListener('keydown', e => {
      const rows = this.listEl.querySelectorAll<HTMLElement>('.openclaude-hub-item');
      if (e.key === 'ArrowDown') { e.preventDefault(); this.moveSel(rows, 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.moveSel(rows, -1); }
      else if (e.key === 'Enter') { e.preventDefault(); rows[this.selectedIdx]?.click(); }
    });

    search.focus();
  }

  private async inject(prompt: string): Promise<void> {
    this.close();
    try {
      await this.plugin.activateSidebar();
      window.dispatchEvent(new CustomEvent('openclaude:inject-prompt', { detail: prompt }));
    } catch {
      // Sidebar failed to open; nothing to inject into
    }
  }

  private buildItems(): HubItem[] {
    return [
      {
        icon: '✦', name: 'Summarize note', shortcut: 'Ctrl+Shift+A',
        action: () => this.inject('Summarize this note concisely.'),
      },
      {
        icon: '⚡', name: 'Expand selection to Zettels', shortcut: 'Ctrl+Shift+Z',
        action: () => this.inject('Expand the selected text into Zettelkasten atomic notes with [[wikilinks]].'),
      },
      {
        icon: '🗺', name: 'Generate MOC',
        action: () => this.inject('Generate a Map of Content (MOC) for this note, listing related topics as [[wikilinks]].'),
      },
      {
        icon: '🔗', name: 'Suggest backlinks',
        action: () => this.inject('Suggest relevant [[wikilinks]] I should add to this note based on its content.'),
      },
      {
        icon: '+', name: 'New session',
        action: () => {
          this.close();
          window.dispatchEvent(new CustomEvent('openclaude:new-session'));
        },
      },
      {
        icon: '🩺', name: 'Server health check',
        action: async () => {
          let detail: string;
          try {
            const h = await this.plugin.api.health();
            detail = `Server status: ${h.status} | version: ${h.version} | uptime: ${Math.round(h.uptime_ms / 1000)}s`;
          } catch (e) {
            detail = `Server unreachable: ${e instanceof Error ? e.message : String(e)}`;
          }
          await this.inject(detail);
        },
      },
    ];
  }

  private renderList(items: HubItem[]): void {
    this.listEl.empty();
    this.selectedIdx = 0;
    items.forEach((item, idx) => {
      const row = this.listEl.createDiv({ cls: `openclaude-hub-item${idx === 0 ? ' selected' : ''}` });
      row.createSpan({ cls: 'openclaude-hub-item-icon', text: item.icon });
      row.createSpan({ cls: 'openclaude-hub-item-name', text: item.name });
      if (item.shortcut) row.createSpan({ cls: 'openclaude-hub-item-shortcut', text: item.shortcut });
      row.onclick = () => { item.action(); };
    });
  }

  private moveSel(rows: NodeListOf<HTMLElement>, delta: number): void {
    rows[this.selectedIdx]?.removeClass('selected');
    this.selectedIdx = Math.max(0, Math.min(rows.length - 1, this.selectedIdx + delta));
    rows[this.selectedIdx]?.addClass('selected');
    rows[this.selectedIdx]?.scrollIntoView({ block: 'nearest' });
  }

  onClose(): void { this.contentEl.empty(); }
}
