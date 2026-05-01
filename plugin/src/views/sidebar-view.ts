import { ItemView, MarkdownView, WorkspaceLeaf } from 'obsidian';
import type OpenClaudePlugin from '../main.js';
import type { SseEvent } from '../types.js';

export const SIDEBAR_VIEW_TYPE = 'openclaude-sidebar';

export class SidebarView extends ItemView {
  private abortController: AbortController | null = null;
  private currentSessionId: string | undefined;
  private pendingCount = 0;
  private toolCallEls = new Map<string, HTMLElement>();
  private boundStatusListener = (s: import('../server-manager.js').ServerStatus) => this.setStatus(s);

  // DOM refs set in buildUI()
  private statusDot!: HTMLElement;
  private contextTitle!: HTMLElement;
  private chatLog!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private pendingBadge!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: OpenClaudePlugin) {
    super(leaf);
  }

  getViewType(): string { return SIDEBAR_VIEW_TYPE; }
  getDisplayText(): string { return 'OpenClaude'; }
  getIcon(): string { return 'brain'; }

  async onOpen(): Promise<void> {
    this.buildUI();
    this.updateContextCard();
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.updateContextCard()));
    this.plugin.serverManager.onStatus(this.boundStatusListener);

    // Handle prompts injected from CommandHubModal
    this.registerDomEvent(window, 'openclaude:inject-prompt' as keyof WindowEventMap, (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      this.inputEl.value = detail;
      this.sendMessage();
    });
    this.registerDomEvent(window, 'openclaude:new-session' as keyof WindowEventMap, () => {
      this.currentSessionId = undefined;
      this.toolCallEls.clear();
      this.chatLog.empty();
    });

    this.startPendingPoll();
  }

  async onClose(): Promise<void> {
    this.plugin.serverManager.offStatus(this.boundStatusListener);
    this.abortController?.abort();
  }

  private buildUI(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass('openclaude-sidebar');

    // Header
    const header = root.createDiv({ cls: 'openclaude-header' });
    this.statusDot = header.createSpan({ cls: 'oc-status-dot' });
    this.statusDot.dataset['status'] = 'starting';
    header.createSpan({ cls: 'openclaude-title', text: 'OpenClaude' });
    const newBtn = header.createEl('button', { cls: 'openclaude-header-btn', text: '+', attr: { title: 'New session' } });
    newBtn.onclick = () => { this.currentSessionId = undefined; this.toolCallEls.clear(); this.chatLog.empty(); };

    // Context card
    const card = root.createDiv({ cls: 'openclaude-context-card' });
    card.createSpan({ text: '📄 ' });
    this.contextTitle = card.createSpan({ cls: 'openclaude-context-title', text: 'No note open' });

    // Chat log
    this.chatLog = root.createDiv({ cls: 'openclaude-chat-log' });

    // Input area
    const area = root.createDiv({ cls: 'openclaude-input-area' });
    this.inputEl = area.createEl('textarea', {
      cls: 'openclaude-input',
      attr: { placeholder: 'Ask something… (Shift+Enter for newline)', rows: '2' },
    });
    this.registerDomEvent(this.inputEl, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
    });

    const footer = area.createDiv({ cls: 'openclaude-input-footer' });
    this.pendingBadge = footer.createSpan({ cls: 'openclaude-pending-badge' });
    this.pendingBadge.style.display = 'none';
    this.pendingBadge.onclick = () => this.openFirstPendingEdit();

    this.sendBtn = footer.createEl('button', { cls: 'openclaude-send-btn', text: 'Send' });
    this.sendBtn.disabled = true;
    this.sendBtn.onclick = () => this.sendMessage();
  }

  private updateContextCard(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    this.contextTitle.setText(
      view instanceof MarkdownView && view.file ? view.file.basename : 'No note open'
    );
  }

  private setStatus(status: 'starting' | 'ok' | 'error'): void {
    this.statusDot.dataset['status'] = status;
    this.sendBtn.disabled = status !== 'ok';
  }

  private getActiveContext(): { activeNote?: string; vault?: string; selection?: string } {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return {};
    const editor = view.editor;
    const selection = editor.getSelection() || undefined;
    const lines = editor.getValue().split('\n').slice(0, 200).join('\n');
    const basePath = (this.app.vault.adapter as { basePath?: string }).basePath ?? '';
    return { activeNote: lines, vault: basePath, selection };
  }

  async sendMessage(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.abortController) return;

    this.inputEl.value = '';
    this.addMessage('user', text);
    const assistantContent = this.addMessage('assistant', '');

    this.abortController = new AbortController();
    this.statusDot.dataset['status'] = 'streaming';
    this.inputEl.disabled = true;
    this.sendBtn.textContent = '■ Stop';
    this.sendBtn.disabled = false;
    this.sendBtn.onclick = () => this.abortController?.abort();

    try {
      await this.plugin.api.chat(
        { message: text, sessionId: this.currentSessionId, context: this.getActiveContext() },
        evt => this.handleEvent(evt, assistantContent),
        this.abortController.signal,
      );
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        this.appendText(assistantContent, `\n[Error: ${(err as Error).message}]`);
      }
    } finally {
      this.abortController = null;
      this.inputEl.disabled = false;
      this.toolCallEls.clear();
      this.sendBtn.textContent = 'Send';
      this.sendBtn.onclick = () => this.sendMessage();
      // Restore status from health check
      this.plugin.api.health()
        .then(() => this.setStatus('ok'))
        .catch(() => this.setStatus('error'));
    }
  }

  private handleEvent(evt: SseEvent, contentEl: HTMLElement): void {
    switch (evt.event) {
      case 'token':
        this.appendText(contentEl, evt.data.text);
        break;
      case 'tool_call': {
        const parent = contentEl.parentElement;
        if (!parent) break;
        const el = parent.createDiv({ cls: 'oc-tool-call' });
        el.setText(`🔧 ${evt.data.name}…`);
        this.toolCallEls.set(evt.data.id, el);
        break;
      }
      case 'tool_result': {
        const el = this.toolCallEls.get(evt.data.id);
        if (el) {
          el.setText(evt.data.ok ? `✅ ${(el.textContent ?? '').replace('…', '')}` : `❌ ${(el.textContent ?? '').replace('…', '')}`);
          this.toolCallEls.delete(evt.data.id);
        }
        break;
      }
      case 'pending_edit':
        this.appendPendingInline(contentEl, evt.data);
        this.pendingCount++;
        this.refreshBadge();
        break;
      case 'done':
        this.currentSessionId = evt.data.sessionId;
        break;
      case 'error':
        this.appendText(contentEl, `\n[Error: ${evt.data.message}]`);
        break;
      case 'insight':
        this.appendText(contentEl, `\n💡 ${evt.data.text}`);
        break;
      default: {
        const _exhaustive: never = evt;
        console.warn('[OpenClaude] unhandled SSE event:', _exhaustive);
      }
    }
  }

  private addMessage(role: 'user' | 'assistant', text: string): HTMLElement {
    const wrap = this.chatLog.createDiv({ cls: `openclaude-message ${role}` });
    wrap.createDiv({ cls: 'openclaude-message-role', text: role === 'user' ? 'You' : 'OpenClaude' });
    const content = wrap.createDiv({ cls: 'openclaude-message-content', text });
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    return content;
  }

  private appendText(el: HTMLElement, text: string): void {
    el.textContent = (el.textContent ?? '') + text;
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  private appendPendingInline(contentEl: HTMLElement, data: { id: string; file: string; reason: string }): void {
    const row = contentEl.parentElement?.createDiv({ cls: 'openclaude-pending-inline' });
    if (!row) return;
    const name = data.file.split(/[\\/]/).pop() ?? data.file;
    row.createSpan({ cls: 'openclaude-pending-inline-file', text: `📝 ${name}` });

    const applyBtn = row.createEl('button', { cls: 'openclaude-pending-inline-btn apply', text: 'Apply' });
    applyBtn.onclick = async () => {
      const { DiffPreviewModal } = await import('../modals/diff-preview-modal.js');
      const edits = await this.plugin.api.listPendingEdits();
      const edit = edits.find(e => e.id === data.id);
      if (edit) new DiffPreviewModal(this.app, this.plugin, edit).open();
    };

    const rejectBtn = row.createEl('button', { cls: 'openclaude-pending-inline-btn reject', text: 'Reject' });
    rejectBtn.onclick = async () => {
      await this.plugin.api.rejectEdit(data.id);
      row.remove();
      this.pendingCount = Math.max(0, this.pendingCount - 1);
      this.refreshBadge();
    };
  }

  private refreshBadge(): void {
    this.pendingBadge.style.display = this.pendingCount > 0 ? 'inline' : 'none';
    this.pendingBadge.textContent = String(this.pendingCount);
  }

  private async openFirstPendingEdit(): Promise<void> {
    const edits = await this.plugin.api.listPendingEdits();
    if (!edits.length) return;
    const { DiffPreviewModal } = await import('../modals/diff-preview-modal.js');
    new DiffPreviewModal(this.app, this.plugin, edits[0]).open();
  }

  private startPendingPoll(): void {
    this.registerInterval(window.setInterval(async () => {
      try {
        const edits = await this.plugin.api.listPendingEdits();
        this.pendingCount = edits.length;
        this.refreshBadge();
      } catch { /* server may be down */ }
    }, 10_000));
  }
}
