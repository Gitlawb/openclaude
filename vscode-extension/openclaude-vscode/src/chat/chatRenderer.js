/**
 * chatRenderer — produces the full self-contained HTML document for the chat
 * webview.  All CSS and JS are inlined (no external bundles).
 *
 * The webview JS communicates with the extension host via postMessage.
 * Incoming messages update the DOM incrementally so streaming feels fluid.
 */

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function renderChatHtml({ nonce, platform, slashCommands = [] }) {
  const modKey = platform === 'darwin' ? 'Cmd' : 'Ctrl';
  const slashCommandJson = serializeForInlineScript(slashCommands);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --oc-bg: #0a0908;
      --oc-panel: #110d0c;
      --oc-panel-strong: #17110f;
      --oc-panel-soft: #1d1512;
      --oc-border: #645041;
      --oc-border-soft: rgba(220,195,170,0.14);
      --oc-text: #f7efe5;
      --oc-text-dim: #dcc3aa;
      --oc-text-soft: #aa9078;
      --oc-accent: #d77757;
      --oc-accent-bright: #f09464;
      --oc-accent-soft: rgba(240,148,100,0.18);
      --oc-positive: #e8b86b;
      --oc-warning: #f3c969;
      --oc-critical: #ff8a6c;
      --oc-focus: #ffd3a1;
      --oc-user-bg: rgba(240,148,100,0.12);
      --oc-user-border: rgba(240,148,100,0.28);
      --oc-assistant-bg: rgba(255,255,255,0.03);
      --oc-assistant-border: rgba(220,195,170,0.10);
      --oc-code-bg: #1a1310;
      --oc-code-border: rgba(220,195,170,0.12);
      --oc-tool-bg: rgba(232,184,107,0.06);
      --oc-tool-border: rgba(232,184,107,0.22);
      --oc-perm-bg: rgba(255,138,108,0.08);
      --oc-perm-border: rgba(255,138,108,0.35);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; }
    body {
      font-family: var(--vscode-font-family, "Segoe UI", system-ui, sans-serif);
      font-size: 13px;
      color: var(--oc-text);
      background: var(--oc-bg);
      display: flex;
      flex-direction: column;
      position: relative;
    }

    /* ── Header ── */
    .chat-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--oc-border-soft);
      background: var(--oc-panel);
      flex-shrink: 0;
    }
    .chat-header .brand {
      font-weight: 700;
      font-size: 14px;
      color: var(--oc-text);
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chat-header .brand-accent { color: var(--oc-accent-bright); }
    .header-btn {
      border: 1px solid var(--oc-border-soft);
      border-radius: 6px;
      background: rgba(255,255,255,0.04);
      color: var(--oc-text-dim);
      padding: 4px 8px;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .header-btn:hover { border-color: var(--oc-accent); color: var(--oc-text); }
    .header-btn.danger { border-color: var(--oc-critical); color: var(--oc-critical); }
    .header-btn.danger:hover { background: rgba(255,138,108,0.12); }
    #abortBtn { display: none; }

    /* ── Status bar ── */
    .status-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      font-size: 11px;
      color: var(--oc-text-soft);
      border-bottom: 1px solid var(--oc-border-soft);
      background: var(--oc-panel);
      flex-shrink: 0;
    }
    .status-bar .status-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--oc-text-soft);
      flex-shrink: 0;
    }
    .status-bar .status-dot.connected { background: var(--oc-positive); }
    .status-bar .status-dot.streaming { background: var(--oc-accent-bright); animation: pulse 1s infinite; }
    .status-bar .status-dot.error { background: var(--oc-critical); }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    .status-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status-usage { color: var(--oc-text-soft); }

    /* ── Message list ── */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .messages::-webkit-scrollbar { width: 6px; }
    .messages::-webkit-scrollbar-track { background: transparent; }
    .messages::-webkit-scrollbar-thumb { background: rgba(220,195,170,0.18); border-radius: 3px; }

    /* ── Welcome screen ── */
    .welcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      text-align: center;
      padding: 32px 16px;
      gap: 16px;
    }
    .welcome-title { font-size: 20px; font-weight: 700; color: var(--oc-text); }
    .welcome-title .accent { color: var(--oc-accent-bright); }
    .welcome-sub { font-size: 13px; color: var(--oc-text-dim); max-width: 36ch; }
    .welcome-hint { font-size: 11px; color: var(--oc-text-soft); }
    .welcome-hint kbd {
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid var(--oc-border-soft);
      background: rgba(255,255,255,0.04);
      font-family: inherit;
      font-size: 11px;
    }

    /* ── User message ── */
    .msg-user {
      align-self: flex-end;
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 14px 14px 4px 14px;
      background: var(--oc-user-bg);
      border: 1px solid var(--oc-user-border);
      word-break: break-word;
      white-space: pre-wrap;
    }

    /* ── Assistant message ── */
    .msg-assistant {
      align-self: flex-start;
      max-width: 95%;
      padding: 10px 14px;
      border-radius: 4px 14px 14px 14px;
      background: var(--oc-assistant-bg);
      border: 1px solid var(--oc-assistant-border);
      word-break: break-word;
    }
    .msg-assistant .md-content { line-height: 1.55; }
    .msg-assistant .md-content:empty { display: none; }
    .msg-assistant .md-content p { margin-bottom: 8px; }
    .msg-assistant .md-content p:last-child { margin-bottom: 0; }
    .msg-assistant .md-content ul,
    .msg-assistant .md-content ol { padding-left: 20px; margin-bottom: 8px; }
    .msg-assistant .md-content li { margin-bottom: 4px; }
    .msg-assistant .md-content h1,
    .msg-assistant .md-content h2,
    .msg-assistant .md-content h3 {
      color: var(--oc-text);
      margin: 12px 0 6px;
      font-size: 14px;
      font-weight: 700;
    }
    .msg-assistant .md-content h1 { font-size: 16px; }
    .msg-assistant .md-content a { color: var(--oc-accent-bright); text-decoration: underline; }
    .msg-assistant .md-content strong { color: var(--oc-text); font-weight: 700; }
    .msg-assistant .md-content em { font-style: italic; color: var(--oc-text-dim); }
    .msg-assistant .md-content blockquote {
      border-left: 3px solid var(--oc-accent);
      padding: 4px 12px;
      margin: 8px 0;
      color: var(--oc-text-dim);
    }
    .msg-assistant .md-content hr {
      border: none;
      border-top: 1px solid var(--oc-border-soft);
      margin: 12px 0;
    }

    /* inline code */
    .md-content code:not(.code-block code) {
      padding: 1px 5px;
      border-radius: 4px;
      background: var(--oc-code-bg);
      border: 1px solid var(--oc-code-border);
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 12px;
      color: var(--oc-accent-bright);
    }

    /* fenced code */
    .code-wrapper {
      position: relative;
      margin: 8px 0;
      border-radius: 8px;
      border: 1px solid var(--oc-code-border);
      background: var(--oc-code-bg);
      overflow: hidden;
    }
    .code-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 10px;
      font-size: 11px;
      color: var(--oc-text-soft);
      border-bottom: 1px solid var(--oc-code-border);
      background: rgba(255,255,255,0.02);
    }
    .code-copy-btn {
      border: none;
      background: transparent;
      color: var(--oc-text-soft);
      cursor: pointer;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .code-copy-btn:hover { background: rgba(255,255,255,0.08); color: var(--oc-text); }
    .code-block {
      display: block;
      padding: 10px 12px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 12px;
      line-height: 1.5;
      white-space: pre;
      color: var(--oc-text-dim);
    }
    .code-block::-webkit-scrollbar { height: 4px; }
    .code-block::-webkit-scrollbar-thumb { background: rgba(220,195,170,0.2); border-radius: 2px; }

    /* keyword highlighting */
    .hl-keyword { color: #c586c0; }
    .hl-string { color: #ce9178; }
    .hl-comment { color: #6a9955; font-style: italic; }
    .hl-number { color: #b5cea8; }
    .hl-func { color: #dcdcaa; }
    .hl-type { color: #4ec9b0; }

    /* ── Tool use card ── */
    .tool-card {
      margin: 8px 0;
      border-radius: 8px;
      border: 1px solid var(--oc-tool-border);
      background: var(--oc-tool-bg);
      overflow: hidden;
    }
    .tool-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      cursor: pointer;
      user-select: none;
    }
    .tool-icon { font-size: 14px; flex-shrink: 0; }
    .tool-name { font-weight: 600; font-size: 12px; color: var(--oc-text); flex: 1; }
    .tool-status { font-size: 11px; color: var(--oc-text-soft); }
    .tool-status.running { color: var(--oc-accent-bright); }
    .tool-status.error { color: var(--oc-critical); }
    .tool-status.complete { color: var(--oc-positive); }
    .tool-chevron {
      font-size: 10px;
      color: var(--oc-text-soft);
      transition: transform 150ms;
    }
    .tool-card.expanded .tool-chevron { transform: rotate(90deg); }
    .tool-body {
      display: none;
      padding: 0 10px 10px;
      font-size: 12px;
      border-top: 1px solid var(--oc-tool-border);
    }
    .tool-card.expanded .tool-body { display: block; }
    .tool-input-label,
    .tool-output-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--oc-text-soft);
      margin: 8px 0 4px;
    }
    .tool-input-content,
    .tool-output-content {
      padding: 6px 8px;
      border-radius: 6px;
      background: rgba(0,0,0,0.2);
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 11px;
      color: var(--oc-text-dim);
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 200px;
      overflow-y: auto;
    }
    .tool-output-content.error { color: var(--oc-critical); }
    .tool-path {
      font-weight: 400;
      color: var(--oc-text-soft);
      font-size: 11px;
      margin-left: 4px;
    }
    .file-link {
      color: var(--oc-accent-bright);
      cursor: pointer;
      text-decoration: none;
      border-bottom: 1px dotted var(--oc-accent);
      transition: color 120ms, border-color 120ms;
    }
    .file-link:hover {
      color: var(--oc-focus);
      border-bottom-color: var(--oc-focus);
    }
    .tool-input-content.tool-diff-old {
      border-left: 3px solid var(--oc-critical);
      padding-left: 10px;
      color: #ff9e8a;
      text-decoration: line-through;
      opacity: 0.7;
    }
    .tool-input-content.tool-diff-new {
      border-left: 3px solid var(--oc-positive);
      padding-left: 10px;
      color: #c8e6a0;
    }
    .tool-diff-btn {
      margin-top: 6px;
      border: 1px solid var(--oc-accent);
      border-radius: 6px;
      background: rgba(240,148,100,0.08);
      color: var(--oc-accent-bright);
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
    }
    .tool-diff-btn:hover { background: rgba(240,148,100,0.16); }

    /* ── Permission card ── */
    .perm-card {
      margin: 8px 0;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--oc-perm-border);
      background: var(--oc-perm-bg);
    }
    .perm-title { font-weight: 700; font-size: 12px; color: var(--oc-critical); margin-bottom: 6px; }
    .perm-desc { font-size: 12px; color: var(--oc-text-dim); margin-bottom: 8px; }
    .perm-input {
      padding: 6px 8px;
      margin-bottom: 8px;
      border-radius: 6px;
      background: rgba(0,0,0,0.2);
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 11px;
      color: var(--oc-text-dim);
      white-space: pre-wrap;
      max-height: 120px;
      overflow-y: auto;
    }
    .perm-actions { display: flex; gap: 6px; }
    .perm-btn {
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid;
    }
    .perm-btn.allow {
      background: rgba(232,184,107,0.14);
      border-color: var(--oc-positive);
      color: var(--oc-positive);
    }
    .perm-btn.deny {
      background: rgba(255,138,108,0.1);
      border-color: var(--oc-critical);
      color: var(--oc-critical);
    }
    .perm-btn.allow-session {
      background: rgba(232,184,107,0.08);
      border-color: rgba(232,184,107,0.4);
      color: var(--oc-text-dim);
    }
    .perm-btn:hover { filter: brightness(1.15); }

    /* ── Status pill ── */
    .msg-status {
      align-self: center;
      font-size: 11px;
      color: var(--oc-text-soft);
      padding: 4px 12px;
      border-radius: 999px;
      border: 1px solid var(--oc-border-soft);
      background: rgba(255,255,255,0.02);
    }

    /* ── Rate limit ── */
    .msg-rate-limit {
      align-self: center;
      font-size: 11px;
      color: var(--oc-warning);
      padding: 6px 14px;
      border-radius: 8px;
      border: 1px solid rgba(243,201,105,0.3);
      background: rgba(243,201,105,0.06);
    }

    /* ── Thinking block ── */
    .thinking-block {
      display: none;
      align-self: flex-start;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid rgba(200,160,255,0.25);
      background: rgba(160,120,220,0.08);
      margin: 4px 0;
      gap: 6px;
      flex-direction: column;
    }
    .thinking-block.visible { display: flex; }
    .thinking-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #c4a0ff;
      font-weight: 600;
    }
    .thinking-spinner {
      width: 12px; height: 12px;
      border: 2px solid rgba(200,160,255,0.3);
      border-top-color: #c4a0ff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .thinking-meta {
      font-size: 11px;
      color: var(--oc-text-soft);
    }

    /* ── Typing indicator ── */
    .typing-indicator {
      display: none;
      align-self: flex-start;
      padding: 10px 14px;
      gap: 4px;
    }
    .typing-indicator.visible { display: flex; }
    .typing-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--oc-accent);
      animation: typingBounce 1.2s infinite;
    }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typingBounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30% { transform: translateY(-4px); opacity: 1; }
    }

    /* ── Input area ── */
    .input-area {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px 8px;
      padding: 10px 12px;
      border-top: 1px solid var(--oc-border-soft);
      background: var(--oc-panel);
      flex-shrink: 0;
      align-items: flex-end;
      position: relative;
    }
    .input-wrap {
      grid-column: 1;
      min-width: 0;
      position: relative;
    }
    .input-area textarea {
      width: 100%;
      min-height: 36px;
      max-height: 160px;
      padding: 8px 12px;
      border: 1px solid var(--oc-border-soft);
      border-radius: 10px;
      background: rgba(255,255,255,0.04);
      color: var(--oc-text);
      font-family: inherit;
      font-size: 13px;
      resize: none;
      outline: none;
      line-height: 1.4;
    }
    .input-area textarea::placeholder { color: var(--oc-text-soft); }
    .input-area textarea:focus { border-color: var(--oc-accent); }
    .slash-palette,
    .composer-menu {
      display: none;
      position: absolute;
      left: 0;
      right: 0;
      bottom: calc(100% + 8px);
      max-height: 260px;
      overflow-y: auto;
      padding: 6px;
      border: 1px solid var(--oc-border-soft);
      border-radius: 8px;
      background: var(--vscode-quickInput-background, #252526);
      box-shadow: 0 10px 28px rgba(0,0,0,0.35);
      z-index: 40;
    }
    .slash-palette.visible { display: block; }
    .composer-menu.visible { display: block; }
    .composer-menu { z-index: 45; }
    .slash-item {
      display: grid;
      grid-template-columns: minmax(92px, max-content) minmax(0, 1fr);
      gap: 10px;
      align-items: center;
      width: 100%;
      padding: 6px 8px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: var(--oc-text-dim);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .slash-item:hover,
    .slash-item.active {
      background: var(--vscode-list-activeSelectionBackground, #094771);
      color: var(--vscode-list-activeSelectionForeground, #fff);
    }
    .slash-name {
      color: inherit;
      font-weight: 700;
      white-space: nowrap;
    }
    .slash-desc {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: inherit;
      opacity: 0.84;
    }
    .slash-hint {
      opacity: 0.68;
      font-weight: 400;
    }
    .slash-empty {
      padding: 10px 8px;
      color: var(--oc-text-soft);
    }
    .palette-hints {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 5px;
      padding: 6px 8px 1px;
      border-top: 1px solid rgba(255,255,255,0.08);
      color: var(--oc-text-soft);
      font-size: 10px;
      white-space: nowrap;
    }
    .palette-hints kbd {
      padding: 1px 4px;
      border: 1px solid var(--oc-border-soft);
      border-radius: 4px;
      background: rgba(255,255,255,0.05);
      color: var(--oc-text-dim);
      font: inherit;
    }
    .send-btn {
      grid-column: 2;
      grid-row: 1;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      border: 1px solid var(--oc-accent);
      background: linear-gradient(135deg, rgba(240,148,100,0.2), rgba(215,119,87,0.12));
      color: var(--oc-accent-bright);
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .send-btn:hover { background: rgba(240,148,100,0.25); }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .composer-toolbar {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .tool-icon-btn,
    .composer-select {
      height: 26px;
      border: 1px solid var(--oc-border-soft);
      border-radius: 7px;
      background: rgba(255,255,255,0.035);
      color: var(--oc-text-dim);
      font: inherit;
      cursor: pointer;
    }
    .tool-icon-btn {
      width: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      color: var(--oc-text);
    }
    .tool-icon-btn:hover,
    .composer-select:hover { border-color: var(--oc-accent); color: var(--oc-text); }
    .composer-select {
      min-width: 0;
      max-width: 46%;
      padding: 0 8px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .composer-select::after {
      content: '\\25BE';
      opacity: 0.7;
      font-size: 11px;
    }
    .composer-spacer { flex: 1; min-width: 0; }

    /* ── Session list overlay ── */
    .session-overlay {
      display: none;
      position: absolute;
      inset: 0;
      z-index: 100;
      background: rgba(5,5,5,0.92);
      flex-direction: column;
    }
    .session-overlay.visible { display: flex; }
    .session-overlay-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--oc-border-soft);
    }
    .session-overlay-header h2 { font-size: 14px; font-weight: 700; flex: 1; }
    .session-search {
      margin: 8px 12px;
      padding: 8px 10px;
      border: 1px solid var(--oc-border-soft);
      border-radius: 8px;
      background: rgba(255,255,255,0.04);
      color: var(--oc-text);
      font-size: 13px;
      outline: none;
    }
    .session-search:focus { border-color: var(--oc-accent); }
    .session-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px;
    }
    .session-group-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--oc-text-soft);
      padding: 8px 0 4px;
    }
    .session-item {
      padding: 10px;
      border-radius: 8px;
      border: 1px solid transparent;
      cursor: pointer;
      margin-bottom: 4px;
    }
    .session-item:hover { background: rgba(255,255,255,0.04); border-color: var(--oc-border-soft); }
    .session-item-title { font-weight: 600; font-size: 13px; color: var(--oc-text); margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-item-preview { font-size: 11px; color: var(--oc-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-item-time { font-size: 10px; color: var(--oc-text-soft); margin-top: 2px; }
    .session-empty { text-align: center; padding: 32px; color: var(--oc-text-soft); }
    /* ── Provider manager overlay ── */
    .provider-overlay {
      display: none;
      position: absolute;
      inset: 0;
      z-index: 120;
      background: rgba(10,9,8,0.96);
      flex-direction: column;
    }
    .provider-overlay.visible { display: flex; }
    .provider-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--oc-border-soft);
      background: var(--oc-panel);
    }
    .provider-header h2 {
      flex: 1;
      font-size: 14px;
      font-weight: 700;
    }
    .provider-body {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: grid;
      grid-template-columns: minmax(150px, 0.78fr) minmax(0, 1.22fr);
      gap: 12px;
      align-items: start;
    }
    .provider-panel {
      display: grid;
      gap: 8px;
      padding: 10px;
      border: 1px solid var(--oc-border-soft);
      border-radius: 8px;
      background: rgba(255,255,255,0.03);
    }
    .provider-panel-title {
      font-size: 11px;
      color: var(--oc-text-soft);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .provider-summary {
      display: grid;
      gap: 3px;
      color: var(--oc-text-dim);
      font-size: 12px;
    }
    .provider-profile-list {
      display: grid;
      gap: 6px;
    }
    .provider-profile-row {
      width: 100%;
      padding: 8px;
      border: 1px solid var(--oc-border-soft);
      border-radius: 8px;
      background: rgba(255,255,255,0.025);
      color: var(--oc-text);
      cursor: pointer;
      text-align: left;
      font: inherit;
    }
    .provider-profile-row.active {
      border-color: var(--oc-accent);
      background: var(--oc-accent-soft);
    }
    .provider-profile-main {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-weight: 700;
    }
    .provider-profile-meta {
      margin-top: 3px;
      color: var(--oc-text-soft);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .provider-options {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 6px;
    }
    .provider-option {
      min-height: 48px;
      padding: 8px;
      border: 1px solid var(--oc-border-soft);
      border-radius: 8px;
      background: rgba(255,255,255,0.03);
      color: var(--oc-text);
      cursor: pointer;
      text-align: left;
      font: inherit;
    }
    .provider-option.active {
      border-color: var(--oc-accent);
      background: var(--oc-accent-soft);
    }
    .provider-option-label { font-weight: 700; }
    .provider-option-detail {
      margin-top: 3px;
      color: var(--oc-text-soft);
      font-size: 11px;
    }
    .provider-form {
      display: grid;
      gap: 10px;
    }
    .provider-form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .provider-field.wide { grid-column: 1 / -1; }
    .provider-field {
      display: grid;
      gap: 5px;
    }
    .provider-field label {
      font-size: 11px;
      color: var(--oc-text-soft);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .provider-field input,
    .provider-field select {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--oc-border-soft);
      border-radius: 8px;
      background: rgba(255,255,255,0.04);
      color: var(--oc-text);
      outline: none;
      font: inherit;
    }
    .provider-field input:focus,
    .provider-field select:focus { border-color: var(--oc-accent); }
    .provider-field input:disabled {
      opacity: 0.48;
      cursor: not-allowed;
      background: rgba(255,255,255,0.025);
    }
    .provider-secret-note {
      color: var(--oc-text-soft);
      font-size: 11px;
    }
    .provider-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding-top: 4px;
    }
    .provider-btn {
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--oc-border-soft);
      background: rgba(255,255,255,0.04);
      color: var(--oc-text);
      cursor: pointer;
      font: inherit;
    }
    .provider-btn.primary {
      border-color: var(--oc-accent);
      color: var(--oc-accent-bright);
      background: var(--oc-accent-soft);
    }
    .provider-btn.danger {
      border-color: var(--oc-perm-border);
      color: var(--oc-critical);
    }
    .provider-error {
      display: none;
      color: var(--oc-critical);
      border: 1px solid var(--oc-perm-border);
      background: var(--oc-perm-bg);
      border-radius: 8px;
      padding: 8px;
      font-size: 12px;
    }
    .provider-error.visible { display: block; }
    @media (max-width: 560px) {
      .provider-body { grid-template-columns: 1fr; }
      .provider-form-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="chat-header">
    <div class="brand">Open<span class="brand-accent">Claude</span></div>
    <button class="header-btn" id="historyBtn" title="Session history">History</button>
    <button class="header-btn" id="newChatBtn" title="New chat">+ New</button>
    <button class="header-btn danger" id="abortBtn" title="Abort generation">Stop</button>
  </div>
  <div class="status-bar">
    <span class="status-dot" id="statusDot"></span>
    <span class="status-text" id="statusText">Ready</span>
    <span class="status-usage" id="statusUsage"></span>
  </div>

  <div class="messages" id="messages">
    <div class="welcome" id="welcomeScreen">
      <div class="welcome-title">Open<span class="accent">Claude</span></div>
      <div class="welcome-sub">Ask a question, request a code change, or start a new task.</div>
      <div class="welcome-hint">Press <kbd>${escapeHtml(modKey)}+L</kbd> to focus input</div>
    </div>
  </div>

  <div class="thinking-block" id="thinkingBlock">
    <div class="thinking-header">
      <div class="thinking-spinner"></div>
      <span id="thinkingLabel">Thinking...</span>
    </div>
    <div class="thinking-meta" id="thinkingMeta"></div>
  </div>

  <div class="typing-indicator" id="typingIndicator">
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
  </div>

  <div class="input-area">
    <div class="input-wrap">
      <div class="slash-palette" id="slashPalette" role="listbox" aria-label="OpenClaude slash commands"></div>
      <div class="composer-menu" id="composerMenu" role="listbox" aria-label="Provider and model choices"></div>
      <textarea id="chatInput" placeholder="Message OpenClaude..." rows="1"></textarea>
    </div>
    <button class="send-btn" id="sendBtn" title="Send message">&#x27A4;</button>
    <div class="composer-toolbar">
      <button class="tool-icon-btn" id="slashCommandBtn" type="button" title="Slash commands">/</button>
      <button class="composer-select" id="activeProviderBtn" type="button" title="Active provider">Provider</button>
      <button class="composer-select" id="activeModelBtn" type="button" title="Active model">Model</button>
      <span class="composer-spacer"></span>
      <button class="tool-icon-btn" id="providerQuickBtn" type="button" title="Provider manager">&#9881;</button>
    </div>
  </div>

  <!-- Session list overlay -->
  <div class="session-overlay" id="sessionOverlay">
    <div class="session-overlay-header">
      <h2>Session History</h2>
      <button class="header-btn" id="closeSessionsBtn">Close</button>
    </div>
    <input class="session-search" id="sessionSearch" type="text" placeholder="Search sessions..." />
    <div class="session-list" id="sessionList">
      <div class="session-empty">No sessions found</div>
    </div>
  </div>

  <!-- Provider manager overlay -->
  <div class="provider-overlay" id="providerOverlay">
    <div class="provider-header">
      <h2>Provider Manager</h2>
      <button class="header-btn" id="closeProviderBtn">Close</button>
    </div>
    <div class="provider-body">
      <div class="provider-panel">
        <div class="provider-panel-title">Active Profile</div>
        <div class="provider-summary" id="providerSummary">Loading provider profile...</div>
        <div class="provider-panel-title">Configured Profiles</div>
        <div class="provider-profile-list" id="providerProfileList"></div>
        <button class="provider-btn" type="button" id="newProviderProfileBtn">New Integration</button>
      </div>
      <form class="provider-form" id="providerForm">
        <div class="provider-error" id="providerError"></div>
        <div class="provider-panel">
          <div class="provider-panel-title">Setup Presets</div>
          <div class="provider-options" id="providerOptions"></div>
        </div>
        <div class="provider-form-grid">
          <div class="provider-field">
            <label for="providerName">Profile name</label>
            <input id="providerName" type="text" autocomplete="off" />
          </div>
          <div class="provider-field">
            <label for="providerKind">Provider type</label>
            <select id="providerKind">
              <option value="openai">OpenAI-compatible</option>
              <option value="gemini">Gemini</option>
              <option value="mistral">Mistral</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>
          <div class="provider-field">
            <label for="providerModel">Model</label>
            <input id="providerModel" type="text" autocomplete="off" />
          </div>
          <div class="provider-field">
            <label for="providerBaseUrl">Base URL</label>
            <input id="providerBaseUrl" type="text" autocomplete="off" />
          </div>
          <div class="provider-field" id="providerApiKeyWrap">
            <label for="providerApiKey" id="providerApiKeyLabel">API key</label>
            <input id="providerApiKey" type="password" autocomplete="off" />
            <div class="provider-secret-note" id="providerSecretNote"></div>
          </div>
          <div class="provider-field" id="providerApiFormatWrap">
            <label for="providerApiFormat">API format</label>
            <select id="providerApiFormat">
              <option value="responses">Responses</option>
              <option value="chat_completions">Chat completions</option>
            </select>
          </div>
          <div class="provider-field" id="providerAuthHeaderWrap">
            <label for="providerAuthHeader">Custom auth header</label>
            <input id="providerAuthHeader" type="text" autocomplete="off" placeholder="api-key" />
          </div>
          <div class="provider-field" id="providerAuthSchemeWrap">
            <label for="providerAuthScheme">Header scheme</label>
            <select id="providerAuthScheme">
              <option value="">Default</option>
              <option value="bearer">Bearer</option>
              <option value="raw">Raw</option>
            </select>
          </div>
          <div class="provider-field wide" id="providerAuthHeaderValueWrap">
            <label for="providerAuthHeaderValue">Custom header value</label>
            <input id="providerAuthHeaderValue" type="password" autocomplete="off" />
            <div class="provider-secret-note" id="providerHeaderValueNote"></div>
          </div>
        </div>
        <div class="provider-actions">
          <button class="provider-btn primary" type="submit">Save and Activate</button>
          <button class="provider-btn" type="button" id="activateProviderProfileBtn">Activate Selected</button>
          <button class="provider-btn danger" type="button" id="deleteProviderProfileBtn">Delete Selected</button>
          <button class="provider-btn" type="button" id="openProviderConfigBtn">Open Config</button>
          <button class="provider-btn" type="button" id="openProviderJsonBtn">Open Startup Profile</button>
        </div>
      </form>
    </div>
  </div>

<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();
  const slashCommands = ${slashCommandJson};

  const messagesEl = document.getElementById('messages');
  const welcomeEl = document.getElementById('welcomeScreen');
  const inputEl = document.getElementById('chatInput');
  const slashPalette = document.getElementById('slashPalette');
  const slashCommandBtn = document.getElementById('slashCommandBtn');
  const composerMenu = document.getElementById('composerMenu');
  const activeProviderBtn = document.getElementById('activeProviderBtn');
  const activeModelBtn = document.getElementById('activeModelBtn');
  const providerQuickBtn = document.getElementById('providerQuickBtn');
  const sendBtn = document.getElementById('sendBtn');
  const abortBtn = document.getElementById('abortBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const historyBtn = document.getElementById('historyBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const statusUsage = document.getElementById('statusUsage');
  const typingIndicator = document.getElementById('typingIndicator');
  const sessionOverlay = document.getElementById('sessionOverlay');
  const closeSessionsBtn = document.getElementById('closeSessionsBtn');
  const sessionSearch = document.getElementById('sessionSearch');
  const sessionList = document.getElementById('sessionList');
  const providerOverlay = document.getElementById('providerOverlay');
  const closeProviderBtn = document.getElementById('closeProviderBtn');
  const providerSummary = document.getElementById('providerSummary');
  const providerProfileList = document.getElementById('providerProfileList');
  const providerOptions = document.getElementById('providerOptions');
  const providerForm = document.getElementById('providerForm');
  const providerError = document.getElementById('providerError');
  const providerName = document.getElementById('providerName');
  const providerKind = document.getElementById('providerKind');
  const providerModel = document.getElementById('providerModel');
  const providerBaseUrl = document.getElementById('providerBaseUrl');
  const providerApiKeyWrap = document.getElementById('providerApiKeyWrap');
  const providerApiKeyLabel = document.getElementById('providerApiKeyLabel');
  const providerApiKey = document.getElementById('providerApiKey');
  const providerSecretNote = document.getElementById('providerSecretNote');
  const providerApiFormatWrap = document.getElementById('providerApiFormatWrap');
  const providerApiFormat = document.getElementById('providerApiFormat');
  const providerAuthHeaderWrap = document.getElementById('providerAuthHeaderWrap');
  const providerAuthHeader = document.getElementById('providerAuthHeader');
  const providerAuthSchemeWrap = document.getElementById('providerAuthSchemeWrap');
  const providerAuthScheme = document.getElementById('providerAuthScheme');
  const providerAuthHeaderValueWrap = document.getElementById('providerAuthHeaderValueWrap');
  const providerAuthHeaderValue = document.getElementById('providerAuthHeaderValue');
  const providerHeaderValueNote = document.getElementById('providerHeaderValueNote');
  const newProviderProfileBtn = document.getElementById('newProviderProfileBtn');
  const activateProviderProfileBtn = document.getElementById('activateProviderProfileBtn');
  const deleteProviderProfileBtn = document.getElementById('deleteProviderProfileBtn');
  const openProviderConfigBtn = document.getElementById('openProviderConfigBtn');
  const openProviderJsonBtn = document.getElementById('openProviderJsonBtn');

  let isStreaming = false;
  let currentAssistantEl = null;
  let currentTextEl = null;
  let slashMatches = [];
  let slashActiveIndex = 0;
  let providerState = null;
  let selectedProvider = null;
  let selectedProfileId = '';
  let pendingDeleteProfileId = '';
  let composerMenuKind = '';
  let composerMenuItems = [];
  let composerActiveIndex = 0;
  const toolResultMap = {};

  /* ── Markdown renderer ── */
  function renderMarkdown(text) {
    if (!text) return '';
    let html = escapeForMd(text);

    // fenced code blocks
    html = html.replace(/\`\`\`(\\w*?)\\n([\\s\\S]*?)\`\`\`/g, (_, lang, code) => {
      const langLabel = lang || 'text';
      const highlighted = highlightCode(code, langLabel);
      const id = 'cb-' + Math.random().toString(36).slice(2, 8);
      return '<div class="code-wrapper"><div class="code-header">' +
        '<span>' + langLabel + '</span>' +
        '<button class="code-copy-btn" data-copy-id="' + id + '">Copy</button></div>' +
        '<code class="code-block" id="' + id + '">' + highlighted + '</code></div>';
    });

    // inline code
    html = html.replace(/\`([^\`]+?)\`/g, '<code>$1</code>');

    // headings
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // hr
    html = html.replace(/^---$/gm, '<hr/>');

    // bold / italic
    html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');

    // links
    html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" title="$2">$1</a>');

    // unordered lists (simple)
    html = html.replace(/^[\\-\\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\\/li>\\n?)+)/g, '<ul>$1</ul>');

    // ordered lists
    html = html.replace(/^\\d+\\. (.+)$/gm, '<li>$1</li>');

    // paragraphs (double newline)
    html = html.replace(/\\n\\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\\/p>/g, '');
    html = html.replace(/<p>(<h[123]>)/g, '$1');
    html = html.replace(/(<\\/h[123]>)<\\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\\/ul>)<\\/p>/g, '$1');
    html = html.replace(/<p>(<blockquote>)/g, '$1');
    html = html.replace(/(<\\/blockquote>)<\\/p>/g, '$1');
    html = html.replace(/<p>(<hr\\/>)/g, '$1');
    html = html.replace(/(<hr\\/>)<\\/p>/g, '$1');
    html = html.replace(/<p>(<div class="code-wrapper">)/g, '$1');
    html = html.replace(/(<\\/div>)<\\/p>/g, '$1');

    return html;
  }

  function escapeForMd(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function highlightCode(code, lang) {
    let result = code;
    const kwPattern = /\\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|typeof|instanceof|switch|case|break|default|continue|do|in|of|yield|void|delete|true|false|null|undefined|this|super|extends|implements|interface|type|enum|public|private|protected|static|readonly|abstract|def|print|self|elif|except|finally|with|as|lambda|pass|raise|None|True|False)\\b/g;
    const strPattern = /(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|'[^']*?'|"[^"]*?")/g;
    const commentPattern = /(\\/{2}.*$|#.*$)/gm;
    const numPattern = /\\b(\\d+\\.?\\d*)\\b/g;

    result = result.replace(commentPattern, '<span class="hl-comment">$1</span>');
    result = result.replace(strPattern, '<span class="hl-string">$1</span>');
    result = result.replace(kwPattern, '<span class="hl-keyword">$1</span>');
    result = result.replace(numPattern, '<span class="hl-number">$1</span>');

    return result;
  }

  /* ── DOM helpers ── */
  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function hideWelcome() {
    if (welcomeEl) welcomeEl.style.display = 'none';
  }

  function showWelcome() {
    if (welcomeEl) welcomeEl.style.display = 'flex';
  }

  function setStreaming(val, label) {
    isStreaming = val;
    abortBtn.style.display = val ? 'block' : 'none';
    sendBtn.disabled = val;
    typingIndicator.classList.toggle('visible', val);
    statusDot.className = 'status-dot ' + (val ? 'streaming' : 'connected');
    statusText.textContent = label || (val ? 'Generating...' : 'Ready');
  }

  function setStatusLabel(label) {
    statusText.textContent = label;
  }

  function appendUserMessage(text) {
    hideWelcome();
    const el = document.createElement('div');
    el.className = 'msg-user';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function getOrCreateAssistantEl() {
    if (!currentAssistantEl) {
      hideWelcome();
      currentAssistantEl = document.createElement('div');
      currentAssistantEl.className = 'msg-assistant';
      currentTextEl = document.createElement('div');
      currentTextEl.className = 'md-content';
      currentAssistantEl.appendChild(currentTextEl);
      messagesEl.appendChild(currentAssistantEl);
    }
    return { container: currentAssistantEl, textEl: currentTextEl };
  }

  function finalizeAssistant() {
    // Hide the text div if it's empty (model went straight to tool use)
    if (currentTextEl && !currentTextEl.textContent.trim()) {
      currentTextEl.style.display = 'none';
    }
    // Remove the entire bubble if it has no visible content at all
    if (currentAssistantEl) {
      const hasText = currentTextEl && currentTextEl.textContent.trim();
      const hasToolCards = currentAssistantEl.querySelector('.tool-card');
      if (!hasText && !hasToolCards) {
        currentAssistantEl.remove();
      }
    }
    currentAssistantEl = null;
    currentTextEl = null;
  }

  function appendToolCard(toolUse) {
    const { container } = getOrCreateAssistantEl();
    const card = document.createElement('div');
    card.className = 'tool-card expanded';
    card.dataset.toolId = toolUse.id || '';
    const statusClass = toolUse.status || 'running';
    const statusLabel = statusClass === 'running' ? 'Running...'
      : statusClass === 'error' ? 'Error' : 'Done';

    var inputSummary = '';
    if (toolUse.input && typeof toolUse.input === 'object') {
      if (toolUse.input.file_path || toolUse.input.path) {
        inputSummary = (toolUse.input.file_path || toolUse.input.path);
      }
      if (toolUse.input.command) {
        inputSummary = toolUse.input.command;
      }
    }
    if (!inputSummary) inputSummary = toolUse.inputPreview || '';

    var inputDetail = '';
    if (toolUse.input && typeof toolUse.input === 'object') {
      if (toolUse.input.new_string || toolUse.input.content) {
        var content = toolUse.input.new_string || toolUse.input.content || '';
        if (content.length > 500) content = content.slice(0, 500) + '... (truncated)';
        inputDetail = '<div class="tool-input-label">Changes</div>' +
          '<div class="tool-input-content">' + escapeForMd(content) + '</div>';
      }
      if (toolUse.input.old_string && toolUse.input.new_string) {
        var oldStr = toolUse.input.old_string;
        var newStr = toolUse.input.new_string;
        if (oldStr.length > 300) oldStr = oldStr.slice(0, 300) + '...';
        if (newStr.length > 300) newStr = newStr.slice(0, 300) + '...';
        inputDetail = '<div class="tool-input-label">Replace</div>' +
          '<div class="tool-input-content tool-diff-old">' + escapeForMd(oldStr) + '</div>' +
          '<div class="tool-input-label">With</div>' +
          '<div class="tool-input-content tool-diff-new">' + escapeForMd(newStr) + '</div>';
      }
    }

    var isFileTool = inputSummary && !toolUse.input?.command;
    var fileLink = isFileTool
      ? '<a class="file-link" data-filepath="' + escapeForMd(inputSummary) + '" title="Open in editor">' + escapeForMd(inputSummary.split(/[\\/]/).pop() || inputSummary) + '</a>'
      : (inputSummary ? escapeForMd(inputSummary.split(/[\\/]/).pop() || inputSummary) : '');
    var pathDisplay = isFileTool
      ? '<div class="tool-input-label">Path</div><div class="tool-input-content"><a class="file-link" data-filepath="' + escapeForMd(inputSummary) + '" title="Open in editor">' + escapeForMd(inputSummary) + '</a></div>'
      : (inputSummary ? '<div class="tool-input-label">' + (toolUse.input?.command ? 'Command' : 'Path') + '</div><div class="tool-input-content">' + escapeForMd(inputSummary) + '</div>' : '');

    card.innerHTML =
      '<div class="tool-header">' +
        '<span class="tool-icon">' + (toolUse.icon || '') + '</span>' +
        '<span class="tool-name">' + escapeForMd(toolUse.displayName || toolUse.name || 'Tool') +
          (fileLink ? ' <span class="tool-path">' + fileLink + '</span>' : '') +
        '</span>' +
        '<span class="tool-status ' + statusClass + '">' + statusLabel + '</span>' +
        '<span class="tool-chevron">&#9654;</span>' +
      '</div>' +
      '<div class="tool-body">' +
        pathDisplay +
        inputDetail +
        '<div class="tool-output-label">Output</div>' +
        '<div class="tool-output-content" data-tool-output="' + (toolUse.id || '') + '">Running...</div>' +
      '</div>';
    card.querySelector('.tool-header').addEventListener('click', () => {
      card.classList.toggle('expanded');
    });
    container.appendChild(card);
    scrollToBottom();
    return card;
  }

  function updateToolResult(toolUseId, content, isError) {
    const outputEl = document.querySelector('[data-tool-output="' + toolUseId + '"]');
    if (outputEl) {
      outputEl.textContent = content || '(done)';
      if (isError) outputEl.classList.add('error');
    }
    const card = document.querySelector('[data-tool-id="' + toolUseId + '"]');
    if (card) {
      const statusEl = card.querySelector('.tool-status');
      if (statusEl) {
        statusEl.className = 'tool-status ' + (isError ? 'error' : 'complete');
        statusEl.textContent = isError ? 'Error' : 'Done';
      }
    }
  }

  function updateToolProgress(toolUseId, content) {
    const outputEl = document.querySelector('[data-tool-output="' + toolUseId + '"]');
    if (outputEl && (outputEl.textContent === 'Waiting...' || outputEl.textContent === 'Running...')) {
      outputEl.textContent = content || '';
    }
  }

  function updateToolInput(toolUseId, input, toolName) {
    const card = document.querySelector('[data-tool-id="' + toolUseId + '"]');
    if (!card) return;
    const body = card.querySelector('.tool-body');
    if (!body) return;

    if (!input || typeof input !== 'object') return;

    // Update the header with clickable file path
    const nameEl = card.querySelector('.tool-name');
    if (nameEl && (input.file_path || input.path)) {
      const fp = input.file_path || input.path;
      const shortName = fp.split(/[\\/]/).pop() || fp;
      if (!nameEl.querySelector('.tool-path')) {
        nameEl.insertAdjacentHTML('beforeend', ' <span class="tool-path"><a class="file-link" data-filepath="' + escapeForMd(fp) + '" title="Open in editor">' + escapeForMd(shortName) + '</a></span>');
      }
    }

    // Update path display
    var pathHtml = '';
    if (input.file_path || input.path) {
      var fp = input.file_path || input.path;
      pathHtml = '<div class="tool-input-label">Path</div><div class="tool-input-content">' +
        '<a class="file-link" data-filepath="' + escapeForMd(fp) + '" title="Open in editor">' + escapeForMd(fp) + '</a></div>';
    }
    if (input.command) {
      pathHtml = '<div class="tool-input-label">Command</div><div class="tool-input-content">' +
        escapeForMd(input.command) + '</div>';
    }

    // Build diff display for edit operations
    var diffHtml = '';
    if (input.old_string && input.new_string) {
      var oldStr = input.old_string;
      var newStr = input.new_string;
      if (oldStr.length > 500) oldStr = oldStr.slice(0, 500) + '... (truncated)';
      if (newStr.length > 500) newStr = newStr.slice(0, 500) + '... (truncated)';
      diffHtml = '<div class="tool-input-label">Replace</div>' +
        '<div class="tool-input-content tool-diff-old">' + escapeForMd(oldStr) + '</div>' +
        '<div class="tool-input-label">With</div>' +
        '<div class="tool-input-content tool-diff-new">' + escapeForMd(newStr) + '</div>';
    } else if (input.content || input.new_string) {
      var content = input.content || input.new_string || '';
      if (content.length > 800) content = content.slice(0, 800) + '... (truncated)';
      diffHtml = '<div class="tool-input-label">Content</div>' +
        '<div class="tool-input-content tool-diff-new">' + escapeForMd(content) + '</div>';
    }

    // Keep the output element
    const outputEl = body.querySelector('[data-tool-output]');
    const outputHtml = outputEl ? outputEl.outerHTML : '';
    const outputLabel = '<div class="tool-output-label">Output</div>';

    body.innerHTML = pathHtml + diffHtml + outputLabel + outputHtml;
    card.classList.add('expanded');
    scrollToBottom();
  }

  function appendPermissionCard(perm) {
    hideWelcome();
    const el = document.createElement('div');
    el.className = 'perm-card';
    el.dataset.requestId = perm.requestId || '';
    el.innerHTML =
      '<div class="perm-title">Permission Required: ' + escapeForMd(perm.displayName || perm.toolName || 'Tool') + '</div>' +
      (perm.description ? '<div class="perm-desc">' + escapeForMd(perm.description) + '</div>' : '') +
      (perm.inputPreview ? '<div class="perm-input">' + escapeForMd(perm.inputPreview) + '</div>' : '') +
      '<div class="perm-actions">' +
        '<button class="perm-btn allow" data-action="allow">Allow</button>' +
        '<button class="perm-btn deny" data-action="deny">Deny</button>' +
        '<button class="perm-btn allow-session" data-action="allow-session">Allow for session</button>' +
      '</div>';
    el.querySelectorAll('.perm-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        vscode.postMessage({
          type: 'permission_response',
          requestId: perm.requestId,
          toolUseId: perm.toolUseId || null,
          action: action,
        });
        el.querySelectorAll('.perm-btn').forEach(b => { b.disabled = true; b.style.opacity = '0.4'; });
        btn.style.opacity = '1';
      });
    });
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function appendStatusMessage(text) {
    const el = document.createElement('div');
    el.className = 'msg-status';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function appendRateLimitMessage(text) {
    const el = document.createElement('div');
    el.className = 'msg-rate-limit';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  /* ── Thinking block ── */
  const thinkingBlock = document.getElementById('thinkingBlock');
  const thinkingLabel = document.getElementById('thinkingLabel');
  const thinkingMeta = document.getElementById('thinkingMeta');

  function showThinkingBlock() {
    thinkingBlock.classList.add('visible');
    thinkingLabel.textContent = 'Thinking...';
    thinkingMeta.textContent = '';
    setStatusLabel('Thinking...');
    scrollToBottom();
  }

  function updateThinkingBlock(tokens, elapsed) {
    const elapsedStr = elapsed >= 60
      ? Math.floor(elapsed / 60) + 'm ' + (elapsed % 60) + 's'
      : elapsed + 's';
    thinkingLabel.textContent = 'Thinking...';
    thinkingMeta.textContent = elapsedStr + ' · ~' + tokens + ' tokens';
    setStatusLabel('Thinking... (' + elapsedStr + ')');
  }

  function hideThinkingBlock() {
    thinkingBlock.classList.remove('visible');
    setStatusLabel('Generating...');
  }

  /* ── Session list ── */
  function renderSessionList(sessions) {
    if (!sessions || sessions.length === 0) {
      sessionList.innerHTML = '<div class="session-empty">No sessions found</div>';
      return;
    }
    const groups = groupByDate(sessions);
    let html = '';
    for (const [label, items] of groups) {
      html += '<div class="session-group-label">' + escapeForMd(label) + '</div>';
      for (const s of items) {
        html += '<div class="session-item" data-session-id="' + (s.id || '') + '">' +
          '<div class="session-item-title">' + escapeForMd(s.title || s.id || 'Untitled') + '</div>' +
          '<div class="session-item-preview">' + escapeForMd(s.preview || '') + '</div>' +
          '<div class="session-item-time">' + escapeForMd(s.timeLabel || '') + '</div>' +
        '</div>';
      }
    }
    sessionList.innerHTML = html;
    sessionList.querySelectorAll('.session-item').forEach(el => {
      el.addEventListener('click', () => {
        vscode.postMessage({ type: 'resume_session', sessionId: el.dataset.sessionId });
        sessionOverlay.classList.remove('visible');
      });
    });
  }

  function groupByDate(sessions) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const weekAgo = today - 604800000;
    const groups = new Map();
    for (const s of sessions) {
      const t = s.timestamp || 0;
      let label;
      if (t >= today) label = 'Today';
      else if (t >= yesterday) label = 'Yesterday';
      else if (t >= weekAgo) label = 'This Week';
      else label = 'Older';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(s);
    }
    return groups;
  }

  /* ── Input handling ── */
  function openProviderManager() {
    hideSlashPalette();
    closeComposerMenu();
    providerOverlay.classList.add('visible');
    vscode.postMessage({ type: 'open_provider_manager' });
  }

  function openSlashPaletteFromButton() {
    closeComposerMenu();
    inputEl.focus();
    if (!inputEl.value.trim()) {
      inputEl.value = '/';
      inputEl.setSelectionRange(1, 1);
      autoResizeInput();
    }
    renderSlashPalette();
  }

  function getSlashQuery() {
    const value = inputEl.value;
    const cursor = inputEl.selectionStart || 0;
    const beforeCursor = value.slice(0, cursor);
    if (!beforeCursor.startsWith('/')) return null;
    if (beforeCursor.includes('\\n')) return null;
    if (/\\s/.test(beforeCursor.slice(1))) return null;
    return beforeCursor.slice(1).toLowerCase();
  }

  function filterSlashCommands(query) {
    if (query === null) return [];
    const normalized = query.trim();
    const matches = slashCommands.filter(command => {
      const name = String(command.name || '').toLowerCase();
      const description = String(command.description || '').toLowerCase();
      const aliases = Array.isArray(command.aliases) ? command.aliases : [];
      return !normalized ||
        name.includes(normalized) ||
        description.includes(normalized) ||
        aliases.some(alias => String(alias).toLowerCase().includes(normalized));
    });
    return normalized ? matches.slice(0, 24) : matches;
  }

  function getPaletteHintsHtml() {
    return '<div class="palette-hints">' +
      '<span><kbd>&uarr;&darr;</kbd> navigate</span>' +
      '<span><kbd>Enter</kbd>/<kbd>Tab</kbd> select</span>' +
      '<span><kbd>Esc</kbd> close</span>' +
      '</div>';
  }

  function renderSlashPalette() {
    const query = getSlashQuery();
    slashMatches = filterSlashCommands(query);
    if (query === null) {
      hideSlashPalette();
      return;
    }
    slashActiveIndex = Math.min(slashActiveIndex, Math.max(slashMatches.length - 1, 0));
    if (slashMatches.length === 0) {
      slashPalette.innerHTML = '<div class="slash-empty">No matching commands</div>' + getPaletteHintsHtml();
      slashPalette.classList.add('visible');
      return;
    }
    slashPalette.innerHTML = '';
    slashMatches.forEach((command, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'slash-item' + (index === slashActiveIndex ? ' active' : '');
      item.dataset.index = String(index);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', index === slashActiveIndex ? 'true' : 'false');

      const name = document.createElement('span');
      name.className = 'slash-name';
      name.textContent = '/' + command.name;
      if (command.argumentHint) {
        const hint = document.createElement('span');
        hint.className = 'slash-hint';
        hint.textContent = ' ' + command.argumentHint;
        name.appendChild(hint);
      }

      const desc = document.createElement('span');
      desc.className = 'slash-desc';
      desc.textContent = command.description || '';
      item.title = command.description || '/' + command.name;
      item.appendChild(name);
      item.appendChild(desc);
      item.addEventListener('mouseenter', () => {
        slashActiveIndex = index;
        renderSlashPalette();
      });
      item.addEventListener('mousedown', event => {
        event.preventDefault();
        acceptSlashCommand(index);
      });
      slashPalette.appendChild(item);
    });
    slashPalette.insertAdjacentHTML('beforeend', getPaletteHintsHtml());
    slashPalette.classList.add('visible');
  }

  function hideSlashPalette() {
    slashPalette.classList.remove('visible');
    slashPalette.innerHTML = '';
    slashMatches = [];
    slashActiveIndex = 0;
  }

  function acceptSlashCommand(index) {
    const command = slashMatches[index];
    if (!command) return;
    if (command.name === 'provider') {
      inputEl.value = '';
      autoResizeInput();
      openProviderManager();
      return;
    }
    const value = '/' + command.name + (command.argumentHint ? ' ' : '');
    inputEl.value = value;
    inputEl.focus();
    inputEl.setSelectionRange(value.length, value.length);
    hideSlashPalette();
    autoResizeInput();
    if (!command.argumentHint) {
      sendMessage();
    }
  }

  function moveSlashSelection(delta) {
    if (slashMatches.length === 0) return;
    slashActiveIndex = (slashActiveIndex + delta + slashMatches.length) % slashMatches.length;
    renderSlashPalette();
    const active = slashPalette.querySelector('.slash-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isStreaming) return;
    if (text === '/provider') {
      inputEl.value = '';
      autoResizeInput();
      openProviderManager();
      return;
    }
    hideSlashPalette();
    closeComposerMenu();
    appendUserMessage(text);
    vscode.postMessage({ type: 'send_message', text });
    inputEl.value = '';
    autoResizeInput();
    setStreaming(true);
  }

  function autoResizeInput() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  }

  inputEl.addEventListener('input', () => {
    autoResizeInput();
    closeComposerMenu();
    renderSlashPalette();
  });
  inputEl.addEventListener('keydown', (e) => {
    if (slashPalette.classList.contains('visible')) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSlashSelection(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSlashSelection(-1);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        acceptSlashCommand(slashActiveIndex);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideSlashPalette();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && slashMatches.length > 0) {
        e.preventDefault();
        acceptSlashCommand(slashActiveIndex);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  sendBtn.addEventListener('click', sendMessage);
  slashCommandBtn.addEventListener('click', openSlashPaletteFromButton);
  providerQuickBtn.addEventListener('click', openProviderManager);
  abortBtn.addEventListener('click', () => vscode.postMessage({ type: 'abort' }));
  newChatBtn.addEventListener('click', () => vscode.postMessage({ type: 'new_session' }));
  historyBtn.addEventListener('click', () => {
    sessionOverlay.classList.toggle('visible');
    if (sessionOverlay.classList.contains('visible')) {
      vscode.postMessage({ type: 'request_sessions' });
      sessionSearch.focus();
    }
  });
  closeSessionsBtn.addEventListener('click', () => sessionOverlay.classList.remove('visible'));
  sessionSearch.addEventListener('input', () => {
    const q = sessionSearch.value.toLowerCase();
    sessionList.querySelectorAll('.session-item').forEach(el => {
      const text = el.textContent.toLowerCase();
      el.style.display = text.includes(q) ? '' : 'none';
    });
  });

  /* ── Provider manager ── */
  function showProviderError(message) {
    providerError.textContent = message || '';
    providerError.classList.toggle('visible', Boolean(message));
  }

  function getPreset(presetId) {
    if (!providerState || !Array.isArray(providerState.presets)) return null;
    return providerState.presets.find(preset => preset.id === presetId) || null;
  }

  function getConfiguredProfile(profileId) {
    if (!providerState || !Array.isArray(providerState.configuredProfiles)) return null;
    return providerState.configuredProfiles.find(profile => profile.id === profileId) || null;
  }

  function fillProviderForm(profile) {
    providerName.value = profile.name || '';
    providerKind.value = profile.provider || 'openai';
    providerModel.value = profile.model || '';
    providerBaseUrl.value = profile.baseUrl || '';
    providerApiKey.value = '';
    providerAuthHeaderValue.value = '';
    providerApiFormat.value = profile.apiFormat || 'responses';
    providerAuthHeader.value = profile.authHeader || '';
    providerAuthScheme.value = profile.authScheme || '';
    providerSecretNote.dataset.masked = profile.apiKeyMasked || '';
    providerHeaderValueNote.dataset.masked = profile.authHeaderValueMasked || '';
    updateProviderAuthState();
  }

  function renderProviderProfiles() {
    providerProfileList.innerHTML = '';
    pendingDeleteProfileId = pendingDeleteProfileId && getConfiguredProfile(pendingDeleteProfileId)
      ? pendingDeleteProfileId
      : '';
    const profiles = providerState?.configuredProfiles || [];
    if (profiles.length === 0) {
      providerProfileList.innerHTML = '<div class="provider-secret-note">No configured profiles yet. Choose a setup preset to create one.</div>';
      return;
    }
    profiles.forEach(profile => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'provider-profile-row' + (profile.id === selectedProfileId ? ' active' : '');
      const activeLabel = profile.isActive ? 'Active' : (profile.source === 'startup' ? 'Startup' : '');
      button.innerHTML =
        '<div class="provider-profile-main"><span>' + escapeForMd(profile.name) + '</span><span>' + escapeForMd(activeLabel) + '</span></div>' +
        '<div class="provider-profile-meta">' + escapeForMd(profile.label + ' · ' + profile.model) + '</div>' +
        '<div class="provider-profile-meta">' + escapeForMd(profile.baseUrl || '') + '</div>';
      button.addEventListener('click', () => {
        selectedProfileId = profile.id;
        pendingDeleteProfileId = '';
        selectedProvider = profile.provider || 'openai';
        fillProviderForm(profile);
        renderProviderManager(providerState);
      });
      providerProfileList.appendChild(button);
    });
  }

  function renderProviderPresets() {
    providerOptions.innerHTML = '';
    if (!providerState || !Array.isArray(providerState.presets)) return;
    providerState.presets.forEach(preset => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'provider-option' + (preset.id === selectedProvider ? ' active' : '');
      button.innerHTML =
        '<div class="provider-option-label">' + escapeForMd(preset.name) + '</div>' +
        '<div class="provider-option-detail">' + escapeForMd(preset.model || 'custom model') + '</div>';
      button.addEventListener('click', () => {
        selectedProvider = preset.id;
        selectedProfileId = '';
        providerName.value = preset.name || '';
        providerKind.value = preset.provider || 'openai';
        providerModel.value = preset.model || '';
        providerBaseUrl.value = preset.baseUrl || '';
        providerApiKey.value = '';
      providerAuthHeader.value = '';
      providerAuthHeaderValue.value = '';
      providerSecretNote.dataset.masked = '';
      providerHeaderValueNote.dataset.masked = '';
      providerApiFormat.value = 'responses';
        providerAuthScheme.value = '';
        updateProviderAuthState();
        renderProviderManager(providerState);
      });
      providerOptions.appendChild(button);
    });
  }

  function renderProviderManager(state) {
    providerState = state || providerState;
    if (!providerState) return;
    renderComposerProviderControls();
    showProviderError('');
    if (!selectedProfileId) selectedProfileId = providerState.form?.profileId || providerState.activeProviderProfileId || '';
    if (!selectedProvider) selectedProvider = providerState.form?.provider || 'openai';
    const active = providerState.activeProfile;
    providerSummary.innerHTML =
      '<div><strong>Workspace</strong>: ' + escapeForMd(providerState.cwd || '') + '</div>' +
      '<div><strong>Active</strong>: ' + escapeForMd(active ? active.name : 'none') + '</div>' +
      '<div><strong>Model</strong>: ' + escapeForMd(active ? active.model : 'none') + '</div>' +
      '<div><strong>Config</strong>: ' + escapeForMd(providerState.globalConfigPath || '') + '</div>' +
      '<div><strong>Startup</strong>: ' + escapeForMd(providerState.startupProfilePath || '') + '</div>';

    renderProviderProfiles();
    renderProviderPresets();

    const shouldUseServerForm = providerState.form && !providerName.value && !providerModel.value;
    if (shouldUseServerForm) {
      selectedProfileId = providerState.form.profileId || selectedProfileId;
      selectedProvider = providerState.form.provider || selectedProvider;
      providerName.value = providerState.form.name || '';
      providerKind.value = providerState.form.provider || 'openai';
      providerModel.value = providerState.form.model || '';
      providerBaseUrl.value = providerState.form.baseUrl || '';
      providerApiKey.value = '';
      providerApiFormat.value = providerState.form.apiFormat || 'responses';
      providerAuthHeader.value = providerState.form.authHeader || '';
      providerAuthScheme.value = providerState.form.authScheme || '';
      providerAuthHeaderValue.value = '';
      providerSecretNote.dataset.masked = providerState.form.apiKeyMasked || '';
      providerHeaderValueNote.dataset.masked = providerState.form.authHeaderValueMasked || '';
    }
    updateProviderAuthState();
  }

  function renderComposerProviderControls() {
    if (!providerState) return;
    const profiles = providerState.configuredProfiles || [];
    const active = providerState.activeProfile || {};
    activeProviderBtn.textContent = active.name || profiles.find(profile => profile.isActive)?.name || 'Provider';
    activeProviderBtn.title = active.baseUrl || 'Active provider';
    const modelOptions = providerState.models && providerState.models.length > 0
      ? providerState.models
      : (active.model ? [{ value: active.model, label: active.model }] : [{ value: 'model', label: 'model' }]);
    const activeModel = modelOptions.find(model => (typeof model === 'string' ? model : model.value) === active.model) || modelOptions[0];
    activeModelBtn.textContent = typeof activeModel === 'string'
      ? activeModel
      : (activeModel?.label || activeModel?.value || 'Model');
    activeModelBtn.title = active.model || activeModelBtn.textContent || 'Active model';
    if (composerMenu.classList.contains('visible')) renderComposerMenu();
  }

  function getComposerProviderItems() {
    const profiles = providerState?.configuredProfiles || [];
    if (profiles.length === 0) {
      return [{
        id: '',
        label: 'New provider integration',
        description: 'Open Provider Manager',
        action: openProviderManager,
      }];
    }
    return profiles.map(profile => ({
      id: profile.id,
      label: (profile.isActive ? '● ' : '') + profile.name,
      description: [profile.label, profile.model].filter(Boolean).join(' · '),
      action: () => vscode.postMessage({ type: 'set_active_provider_profile', profileId: profile.id }),
    }));
  }

  function getComposerModelItems() {
    const active = providerState?.activeProfile || {};
    const modelOptions = providerState?.models && providerState.models.length > 0
      ? providerState.models
      : (active.model ? [{ value: active.model, label: active.model }] : []);
    if (modelOptions.length === 0) {
      return [{
        id: '',
        label: 'No models found',
        description: 'Open Provider Manager to add one',
        action: openProviderManager,
      }];
    }
    return modelOptions.map(model => {
      const value = typeof model === 'string' ? model : model.value;
      const label = typeof model === 'string' ? model : (model.label || model.value);
      const description = typeof model === 'object' ? model.description || '' : '';
      return {
        id: value,
        label: value === active.model ? '● ' + label : label,
        description,
        action: () => selectComposerModel(value),
      };
    });
  }

  function renderComposerMenu() {
    composerMenu.innerHTML = '';
    composerMenuItems = composerMenuKind === 'provider' ? getComposerProviderItems() : getComposerModelItems();
    if (composerMenuItems.length === 0) {
      composerMenu.innerHTML = '<div class="slash-empty">No choices available</div>' + getPaletteHintsHtml();
      return;
    }
    composerActiveIndex = Math.max(0, Math.min(composerActiveIndex, composerMenuItems.length - 1));
    composerMenuItems.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slash-item' + (index === composerActiveIndex ? ' active' : '');
      button.dataset.index = String(index);
      button.innerHTML =
        '<span class="slash-name">' + escapeForMd(item.label) + '</span>' +
        '<span class="slash-desc">' + escapeForMd(item.description || '') + '</span>';
      button.addEventListener('mouseenter', () => {
        composerActiveIndex = index;
        renderComposerMenu();
      });
      button.addEventListener('mousedown', event => {
        event.preventDefault();
        chooseComposerMenuItem(index);
      });
      composerMenu.appendChild(button);
    });
    composerMenu.insertAdjacentHTML('beforeend', getPaletteHintsHtml());
  }

  function openComposerMenu(kind) {
    composerMenuKind = kind;
    composerActiveIndex = 0;
    hideSlashPalette();
    renderComposerMenu();
    composerMenu.classList.add('visible');
  }

  function closeComposerMenu() {
    composerMenu.classList.remove('visible');
    composerMenuKind = '';
    composerMenuItems = [];
  }

  function chooseComposerMenuItem(index = composerActiveIndex) {
    const item = composerMenuItems[index];
    if (!item) return;
    closeComposerMenu();
    item.action();
  }

  function selectComposerModel(model) {
    const active = providerState?.activeProfile;
    if (!active) return;
    selectedProfileId = providerState.activeProviderProfileId || active.id || '';
    selectedProvider = active.provider || 'openai';
    providerModel.value = model;
    vscode.postMessage({
      type: 'save_provider_profile',
      form: {
        profileId: selectedProfileId,
        name: active.name || 'Custom provider',
        provider: active.provider || 'openai',
        model,
        baseUrl: active.baseUrl || '',
        apiKey: '',
        apiFormat: active.apiFormat || 'responses',
        authHeader: active.authHeader || '',
        authScheme: active.authScheme || '',
        authHeaderValue: '',
      },
    });
  }

  function updateProviderAuthState() {
    const isOpenAI = providerKind.value === 'openai' || providerKind.value === 'anthropic';
    const usesCustomHeader = Boolean(providerAuthHeader.value.trim() || providerAuthHeaderValue.value.trim());
    providerApiKeyWrap.style.display = 'grid';
    providerApiKeyLabel.textContent = providerKind.value === 'gemini'
      ? 'Gemini API key'
      : providerKind.value === 'mistral'
        ? 'Mistral API key'
        : 'API key';
    providerApiKey.disabled = isOpenAI && usesCustomHeader;
    const apiKeyMasked = providerSecretNote.dataset.masked || providerState?.form?.apiKeyMasked || '';
    const headerValueMasked = providerHeaderValueNote.dataset.masked || providerState?.form?.authHeaderValueMasked || '';
    providerSecretNote.textContent = providerApiKey.disabled
      ? 'Disabled because custom header authentication is configured.'
      : (apiKeyMasked ? 'Saved secret: ' + apiKeyMasked + '. Leave blank to keep it.' : 'Leave blank if this provider does not require a key.');
    providerApiFormatWrap.style.display = isOpenAI ? 'grid' : 'none';
    providerAuthHeaderWrap.style.display = isOpenAI ? 'grid' : 'none';
    providerAuthSchemeWrap.style.display = isOpenAI ? 'grid' : 'none';
    providerAuthHeaderValueWrap.style.display = isOpenAI ? 'grid' : 'none';
    providerHeaderValueNote.textContent = headerValueMasked
      ? 'Saved custom header value: ' + headerValueMasked + '. Leave blank to keep it.'
      : 'Use this for providers that expect a custom header like api-key.';
  }

  closeProviderBtn.addEventListener('click', () => providerOverlay.classList.remove('visible'));
  newProviderProfileBtn.addEventListener('click', () => {
    selectedProfileId = '';
    selectedProvider = 'custom';
    const preset = getPreset('custom');
    fillProviderForm(preset || { provider: 'openai', name: 'Custom OpenAI-compatible', baseUrl: '', model: '' });
    renderProviderManager(providerState);
  });
  activateProviderProfileBtn.addEventListener('click', () => {
    if (selectedProfileId && getConfiguredProfile(selectedProfileId)) {
      vscode.postMessage({ type: 'set_active_provider_profile', profileId: selectedProfileId });
    }
  });
  deleteProviderProfileBtn.addEventListener('click', () => {
    const profile = selectedProfileId ? getConfiguredProfile(selectedProfileId) : null;
    if (!profile) return;
    if (pendingDeleteProfileId === profile.id) {
      vscode.postMessage({ type: 'delete_provider_profile', profileId: selectedProfileId });
      pendingDeleteProfileId = '';
      deleteProviderProfileBtn.textContent = 'Delete Selected';
      return;
    }
    pendingDeleteProfileId = profile.id;
    deleteProviderProfileBtn.textContent = 'Confirm Delete';
    showProviderError('Click Confirm Delete to permanently delete "' + profile.name + '".');
  });
  providerKind.addEventListener('change', updateProviderAuthState);
  providerAuthHeader.addEventListener('input', updateProviderAuthState);
  providerAuthHeaderValue.addEventListener('input', updateProviderAuthState);
  openProviderConfigBtn.addEventListener('click', () => {
    if (providerState && providerState.globalConfigPath) {
      vscode.postMessage({ type: 'open_file', path: providerState.globalConfigPath });
    }
  });
  activeProviderBtn.addEventListener('click', () => openComposerMenu('provider'));
  activeModelBtn.addEventListener('click', () => openComposerMenu('model'));
  openProviderJsonBtn.addEventListener('click', () => {
    if (providerState && providerState.startupProfilePath) {
      vscode.postMessage({ type: 'open_file', path: providerState.startupProfilePath });
    }
  });
  providerForm.addEventListener('submit', event => {
    event.preventDefault();
    vscode.postMessage({
      type: 'save_provider_profile',
      form: {
        profileId: selectedProfileId && getConfiguredProfile(selectedProfileId) ? selectedProfileId : '',
        name: providerName.value,
        provider: providerKind.value,
        model: providerModel.value,
        baseUrl: providerBaseUrl.value,
        apiKey: providerApiKey.value,
        apiFormat: providerApiFormat.value,
        authHeader: providerAuthHeader.value,
        authScheme: providerAuthScheme.value,
        authHeaderValue: providerAuthHeaderValue.value,
      },
    });
  });

  // Copy code handler (event delegation)
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.code-copy-btn');
    if (copyBtn) {
      const id = copyBtn.dataset.copyId;
      const codeEl = document.getElementById(id);
      if (codeEl) {
        const text = codeEl.textContent;
        vscode.postMessage({ type: 'copy_code', text });
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      }
      return;
    }

    const fileLink = e.target.closest('.file-link');
    if (fileLink) {
      e.preventDefault();
      e.stopPropagation();
      const filepath = fileLink.dataset.filepath;
      if (filepath) {
        vscode.postMessage({ type: 'open_file', path: filepath });
      }
      return;
    }
  });

  /* ── Message handling from extension ── */
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;

    switch (msg.type) {
      case 'stream_start':
        setStreaming(true, 'Generating...');
        getOrCreateAssistantEl();
        break;

      case 'stream_delta': {
        setStatusLabel('Generating...');
        const { textEl } = getOrCreateAssistantEl();
        textEl.innerHTML = renderMarkdown(msg.text || '');
        scrollToBottom();
        break;
      }

      case 'stream_end':
        if (msg.text) {
          const { textEl } = getOrCreateAssistantEl();
          textEl.innerHTML = renderMarkdown(msg.text);
        }
        finalizeAssistant();
        if (msg.usage) {
          const u = msg.usage;
          statusUsage.textContent = (u.input_tokens || 0) + ' in / ' + (u.output_tokens || 0) + ' out';
        }
        if (msg.final) {
          setStreaming(false);
        }
        scrollToBottom();
        break;

      case 'tool_use':
        appendToolCard(msg.toolUse);
        setStatusLabel('Running: ' + (msg.toolUse.displayName || msg.toolUse.name || 'tool') + '...');
        break;

      case 'tool_result':
        updateToolResult(msg.toolUseId, msg.content, msg.isError);
        break;

      case 'tool_input_ready':
        updateToolInput(msg.toolUseId, msg.input, msg.name);
        break;

      case 'tool_progress':
        updateToolProgress(msg.toolUseId, msg.content);
        break;

      case 'permission_request':
        appendPermissionCard(msg);
        break;

      case 'status':
        setStatusLabel(msg.content || 'Working...');
        break;

      case 'rate_limit':
        appendRateLimitMessage(msg.message || 'Rate limited');
        break;

      case 'thinking_start':
        showThinkingBlock();
        break;

      case 'thinking_delta':
        updateThinkingBlock(msg.tokens || 0, msg.elapsed || 0);
        break;

      case 'thinking_end':
        hideThinkingBlock();
        break;

      case 'system_info':
        if (msg.model) {
          statusUsage.textContent = msg.model;
        }
        break;

      case 'error':
        setStreaming(false);
        finalizeAssistant();
        statusDot.className = 'status-dot error';
        statusText.textContent = 'Error: ' + (msg.message || 'Unknown error');
        break;

      case 'session_list':
        renderSessionList(msg.sessions);
        break;

      case 'provider_manager_state':
        renderProviderManager(msg.state);
        break;

      case 'provider_manager_error':
        showProviderError(msg.message || 'Could not save provider profile');
        break;

      case 'session_cleared':
        messagesEl.innerHTML = '';
        if (welcomeEl) {
          messagesEl.appendChild(welcomeEl);
          showWelcome();
        }
        currentAssistantEl = null;
        currentTextEl = null;
        statusUsage.textContent = '';
        statusDot.className = 'status-dot connected';
        statusText.textContent = 'Ready';
        break;

      case 'restore_messages':
        hideWelcome();
        if (msg.messages) {
          for (const m of msg.messages) {
            if (m.role === 'user') {
              appendUserMessage(m.text || '');
            } else if (m.role === 'assistant') {
              const { textEl } = getOrCreateAssistantEl();
              textEl.innerHTML = renderMarkdown(m.text || '');
              if (m.toolUses && m.toolUses.length > 0) {
                for (const tu of m.toolUses) {
                  var displayName = tu.name || 'Tool';
                  var icon = '';
                  var inputPreview = '';
                  if (tu.input && typeof tu.input === 'object') {
                    inputPreview = tu.input.file_path || tu.input.path || tu.input.command || '';
                  }
                  var card = appendToolCard({
                    id: tu.id,
                    name: tu.name,
                    displayName: displayName,
                    icon: icon,
                    inputPreview: inputPreview,
                    input: tu.input,
                    status: tu.status || 'complete',
                  });
                  if (tu.input) {
                    updateToolInput(String(tu.id), tu.input, tu.name);
                  }
                  if (tu.result !== undefined && tu.result !== null) {
                    updateToolResult(String(tu.id), tu.result, tu.isError || false);
                  } else {
                    updateToolResult(String(tu.id), '(done)', false);
                  }
                }
              }
              finalizeAssistant();
            }
          }
        }
        scrollToBottom();
        break;

      case 'connected':
        setStreaming(false);
        statusDot.className = 'status-dot connected';
        statusText.textContent = msg.message || 'Connected';
        break;

      default:
        break;
    }
  });

  // Focus input on Ctrl/Cmd+L
  document.addEventListener('keydown', (e) => {
    if (composerMenu.classList.contains('visible')) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (composerMenuItems.length === 0) return;
        composerActiveIndex = (composerActiveIndex + 1 + composerMenuItems.length) % composerMenuItems.length;
        renderComposerMenu();
        const active = composerMenu.querySelector('.slash-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (composerMenuItems.length === 0) return;
        composerActiveIndex = (composerActiveIndex - 1 + composerMenuItems.length) % composerMenuItems.length;
        renderComposerMenu();
        const active = composerMenu.querySelector('.slash-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        chooseComposerMenuItem();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeComposerMenu();
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
      e.preventDefault();
      inputEl.focus();
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (!composerMenu.classList.contains('visible')) return;
    if (composerMenu.contains(e.target) || activeProviderBtn.contains(e.target) || activeModelBtn.contains(e.target)) return;
    closeComposerMenu();
  });

  // Restore state
  const prevState = vscode.getState();
  if (prevState && prevState.hasMessages) {
    vscode.postMessage({ type: 'restore_request' });
  }

  // Notify ready
  vscode.postMessage({ type: 'request_provider_state' });
  vscode.postMessage({ type: 'webview_ready' });
})();
</script>
</body>
</html>`;
}

module.exports = { renderChatHtml };
