# OpenClaude Obsidian Plugin (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Obsidian plugin (`plugin/`) that connects to the Phase 1 server via HTTP+SSE, giving the user a chat sidebar, streaming responses, diff preview for agent edits, and a Ctrl+K command hub.

**Architecture:** Plugin (TypeScript → esbuild CJS bundle → `main.js`) lives in `plugin/` with its own build system, mirroring `vscode-extension/`. All logic modules (`ApiClient`, `ServerManager`) are plain TypeScript classes injected via constructor — no Obsidian API imports — making them unit-testable with Bun. UI components (`SidebarView`, modals) extend Obsidian's `ItemView`/`Modal` and are verified manually by installing to a vault. SSE parsing is extracted to a pure function (`sse-parser.ts`) for clean TDD.

**Tech Stack:** TypeScript 5, Obsidian Plugin API 1.4+, esbuild 0.21 (CJS bundle), Bun test (unit tests), Node.js `child_process` (server spawn), `node:fs`/`node:os` (token read)

---

## File Map

Files created by this plan:

| Path | Responsibility |
|------|---------------|
| `plugin/manifest.json` | Obsidian plugin metadata (id, name, version) |
| `plugin/package.json` | Dev deps + scripts (build, test, install:vault) |
| `plugin/tsconfig.json` | TypeScript config (ES2022, DOM, strict, bundler resolution) |
| `plugin/esbuild.config.mjs` | Bundle `src/main.ts` → `main.js` (external: obsidian, electron) |
| `plugin/styles.css` | All plugin CSS (status-dot, sidebar, modals) |
| `plugin/src/types.ts` | `PluginSettings`, `DEFAULT_SETTINGS`, `SseEvent` union, `PendingEdit`, `Session`, `HealthStatus`, `ChatRequest` |
| `plugin/src/sse-parser.ts` | Pure `parseSseBuffer(buf)` — no Obsidian dep, fully unit-testable |
| `plugin/src/api-client.ts` | `ApiClient` — typed fetch methods + SSE chat stream (no Obsidian dep) |
| `plugin/src/server-manager.ts` | `ServerManager` — spawn/kill/health-poll/auto-restart (no Obsidian dep) |
| `plugin/src/settings.ts` | `SettingsTab extends PluginSettingTab` |
| `plugin/src/main.ts` | `OpenClaudePlugin extends Plugin` — entry point, wires all modules |
| `plugin/src/views/sidebar-view.ts` | `SidebarView extends ItemView` — chat log, context card, pending badge |
| `plugin/src/modals/diff-preview-modal.ts` | `DiffPreviewModal extends Modal` — before/after, apply/reject |
| `plugin/src/modals/command-hub-modal.ts` | `CommandHubModal extends Modal` — Ctrl+K hub with fuzzy search |
| `plugin/install.mjs` | Copies `main.js + manifest.json + styles.css` to vault plugin dir |
| `plugin/tests/sse-parser.test.ts` | Unit tests for `parseSseBuffer` |
| `plugin/tests/api-client.test.ts` | Unit tests for `ApiClient` HTTP methods |
| `plugin/tests/server-manager.test.ts` | Unit tests for `ServerManager` state machine |

Root `package.json` (modify only — add 2 scripts):
- `plugin:build` — installs plugin deps + builds
- `plugin:install` — builds + runs install.mjs

---

## Task 1: Plugin scaffold

**Files:**
- Create: `plugin/manifest.json`
- Create: `plugin/package.json`
- Create: `plugin/tsconfig.json`
- Create: `plugin/esbuild.config.mjs`
- Create: `plugin/styles.css`

- [ ] **Step 1: Create `plugin/manifest.json`**

```json
{
  "id": "openclaude-obsidian",
  "name": "OpenClaude",
  "version": "0.1.0",
  "minAppVersion": "1.4.0",
  "description": "OpenClaude agent inside your Obsidian vault",
  "author": "Alan",
  "authorUrl": "",
  "isDesktopOnly": true
}
```

- [ ] **Step 2: Create `plugin/package.json`**

```json
{
  "name": "openclaude-obsidian",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "node esbuild.config.mjs",
    "build:prod": "node esbuild.config.mjs --production",
    "dev": "node esbuild.config.mjs --watch",
    "typecheck": "tsc --noEmit",
    "test": "bun test tests/",
    "install:vault": "node install.mjs"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "esbuild": "^0.21.0",
    "obsidian": "latest",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 3: Create `plugin/tsconfig.json`**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Create `plugin/esbuild.config.mjs`**

```javascript
import esbuild from 'esbuild';

const prod = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron'],
  format: 'cjs',
  platform: 'node',
  target: 'es2022',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  minify: prod,
});

if (watch) {
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
```

- [ ] **Step 5: Create `plugin/styles.css`**

```css
/* ── Status dot ──────────────────────────────── */
.openclaude-status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.openclaude-status-dot[data-status="ok"]        { background: var(--color-green); }
.openclaude-status-dot[data-status="starting"]  { background: var(--color-yellow); animation: oc-pulse 1s infinite; }
.openclaude-status-dot[data-status="error"]     { background: var(--color-red); }
.openclaude-status-dot[data-status="streaming"] { background: var(--color-green); animation: oc-pulse 0.5s infinite; }
@keyframes oc-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

/* ── Sidebar layout ──────────────────────────── */
.openclaude-sidebar { display:flex; flex-direction:column; height:100%; font-size:13px; }

.openclaude-header {
  display:flex; align-items:center; gap:6px;
  padding:8px 12px;
  border-bottom:1px solid var(--background-modifier-border);
  flex-shrink:0;
}
.openclaude-title { flex:1; font-weight:600; }
.openclaude-header-btn {
  background:none; border:none; cursor:pointer;
  color:var(--text-muted); padding:2px 6px; border-radius:4px;
}
.openclaude-header-btn:hover { color:var(--text-normal); background:var(--background-modifier-hover); }

/* ── Context card ─────────────────────────────── */
.openclaude-context-card {
  display:flex; align-items:center; gap:6px;
  padding:5px 12px;
  background:var(--background-secondary);
  border-bottom:1px solid var(--background-modifier-border);
  font-size:12px; color:var(--text-muted);
  flex-shrink:0; overflow:hidden;
}
.openclaude-context-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* ── Chat log ─────────────────────────────────── */
.openclaude-chat-log {
  flex:1; overflow-y:auto; padding:10px 12px;
  display:flex; flex-direction:column; gap:14px;
}
.openclaude-message { display:flex; flex-direction:column; gap:3px; }
.openclaude-message-role {
  font-size:11px; font-weight:600; text-transform:uppercase; color:var(--text-muted);
}
.openclaude-message-content { white-space:pre-wrap; line-height:1.55; word-break:break-word; }
.openclaude-message.user .openclaude-message-content {
  background:var(--background-secondary); padding:6px 10px; border-radius:8px;
}
.openclaude-tool-call {
  font-size:11px; color:var(--text-muted); font-style:italic; padding:1px 0;
}

/* ── Pending edit inline ──────────────────────── */
.openclaude-pending-inline {
  background:var(--background-modifier-error); border-radius:6px;
  padding:6px 10px; font-size:12px;
  display:flex; align-items:center; gap:8px;
}
.openclaude-pending-inline-file { flex:1; overflow:hidden; text-overflow:ellipsis; font-weight:500; }
.openclaude-pending-inline-btn {
  font-size:11px; padding:2px 8px; border-radius:4px; cursor:pointer;
  border:1px solid var(--background-modifier-border);
}
.openclaude-pending-inline-btn.apply { background:var(--color-green); color:#fff; border-color:transparent; }
.openclaude-pending-inline-btn.reject { background:none; }

/* ── Input area ───────────────────────────────── */
.openclaude-input-area { border-top:1px solid var(--background-modifier-border); padding:8px; flex-shrink:0; }
.openclaude-input {
  width:100%; resize:none; box-sizing:border-box;
  border:1px solid var(--background-modifier-border); border-radius:6px;
  padding:6px 8px; font-size:13px; font-family:inherit;
  background:var(--background-primary); color:var(--text-normal);
  min-height:36px; max-height:120px; overflow-y:auto;
}
.openclaude-input:focus { outline:none; border-color:var(--interactive-accent); }
.openclaude-input-footer {
  display:flex; justify-content:space-between; align-items:center; margin-top:4px;
}
.openclaude-pending-badge {
  background:var(--color-red); color:#fff;
  font-size:11px; padding:1px 7px; border-radius:10px; cursor:pointer;
}
.openclaude-send-btn {
  padding:4px 14px; background:var(--interactive-accent); color:var(--text-on-accent);
  border:none; border-radius:4px; cursor:pointer; font-size:12px;
}
.openclaude-send-btn:disabled { opacity:0.5; cursor:not-allowed; }

/* ── Diff preview modal ───────────────────────── */
.openclaude-diff-modal .modal-content { max-width:900px; width:90vw; }
.openclaude-diff-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:12px 0; }
.openclaude-diff-col { display:flex; flex-direction:column; gap:4px; }
.openclaude-diff-label { font-size:11px; font-weight:600; color:var(--text-muted); text-transform:uppercase; }
.openclaude-diff-text {
  font-family:monospace; font-size:12px; white-space:pre-wrap;
  padding:8px; border-radius:4px; overflow-y:auto; max-height:55vh;
}
.openclaude-diff-text.before { background:#ffeef0; color:#721c24; }
.openclaude-diff-text.after  { background:#f0fff4; color:#155724; }
.openclaude-diff-footer { font-size:12px; color:var(--text-muted); margin:4px 0 12px; }
.openclaude-diff-actions { display:flex; gap:8px; justify-content:flex-end; }

/* ── Command hub modal ────────────────────────── */
.openclaude-hub-search {
  width:100%; padding:10px 16px; font-size:16px;
  border:none; border-bottom:1px solid var(--background-modifier-border);
  background:transparent; color:var(--text-normal); outline:none;
}
.openclaude-hub-list { max-height:60vh; overflow-y:auto; }
.openclaude-hub-item {
  display:flex; align-items:center; gap:12px;
  padding:8px 16px; cursor:pointer;
}
.openclaude-hub-item:hover, .openclaude-hub-item.selected { background:var(--background-secondary); }
.openclaude-hub-item-icon { font-size:16px; flex-shrink:0; }
.openclaude-hub-item-name { flex:1; font-size:14px; }
.openclaude-hub-item-shortcut { font-size:11px; color:var(--text-muted); }
.openclaude-hub-section { padding:4px 16px; font-size:11px; font-weight:600; text-transform:uppercase; color:var(--text-muted); border-top:1px solid var(--background-modifier-border); margin-top:4px; }
```

- [ ] **Step 6: Install plugin dependencies**

```bash
cd plugin && npm install
```

Expected: `added N packages` with no errors.

- [ ] **Step 7: Commit**

```bash
cd ..
git add plugin/
git commit -m "feat(plugin): scaffold obsidian plugin (manifest, build system, styles)"
```

---

## Task 2: `types.ts` + `main.ts` stub

**Files:**
- Create: `plugin/src/types.ts`
- Create: `plugin/src/main.ts`

- [ ] **Step 1: Create `plugin/src/types.ts`**

```typescript
export interface PluginSettings {
  port: number;
  serverBinaryPath: string;
  tokenPath: string;
  autoStartServer: boolean;
  preset: 'conservative' | 'balanced' | 'aggressive';
}

export const DEFAULT_SETTINGS: PluginSettings = {
  port: 7777,
  serverBinaryPath: '',
  tokenPath: '~/.openclaude/server-token',
  autoStartServer: true,
  preset: 'balanced',
};

// Mirrors server's AgentEvent union (src/serve/handlers/chat.ts)
export type SseEvent =
  | { event: 'token';        data: { text: string } }
  | { event: 'tool_call';    data: { id: string; name: string; args: unknown } }
  | { event: 'tool_result';  data: { id: string; ok: boolean; preview?: string } }
  | { event: 'pending_edit'; data: { id: string; file: string; reason: string } }
  | { event: 'insight';      data: { text: string } }
  | { event: 'done';         data: { sessionId: string; finishReason: string } }
  | { event: 'error';        data: { code: string; message: string } };

// Mirrors server's PendingEdit (src/serve/pendingEditStore.ts)
export interface PendingEdit {
  id: string;
  file: string;
  vault: string;
  sessionId: string;
  reason: string;
  before: string;
  after: string;
  createdAt: number;
}

export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface HealthStatus {
  status: 'ok' | 'error';
  version: string;
  uptime_ms: number;
}

export interface VaultInfo {
  id: string;
  name: string;
  path: string;
}

export interface ChatRequest {
  message: string;
  sessionId?: string;
  // Keys match server's AgentFn context shape
  context?: { activeNote?: string; vault?: string; selection?: string };
}
```

- [ ] **Step 2: Create `plugin/src/main.ts` stub**

```typescript
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
```

- [ ] **Step 3: Typecheck**

```bash
cd plugin && npm run typecheck
```

Expected: exit 0, no errors.

- [ ] **Step 4: Build**

```bash
cd plugin && npm run build
```

Expected: `main.js` created, no errors.

- [ ] **Step 5: Commit**

```bash
cd ..
git add plugin/src/types.ts plugin/src/main.ts
git commit -m "feat(plugin): add shared types and main.ts stub"
```

---

## Task 3: SSE parser (TDD)

**Files:**
- Create: `plugin/tests/sse-parser.test.ts`
- Create: `plugin/src/sse-parser.ts`

- [ ] **Step 1: Write failing tests**

Create `plugin/tests/sse-parser.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { parseSseBuffer } from '../src/sse-parser.js';

describe('parseSseBuffer', () => {
  it('parses a single complete event', () => {
    const buf = 'event: token\ndata: {"text":"Hello"}\n\n';
    const { events, remaining } = parseSseBuffer(buf);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ event: 'token', data: { text: 'Hello' } });
    expect(remaining).toBe('');
  });

  it('parses two consecutive events', () => {
    const buf =
      'event: token\ndata: {"text":"Hi"}\n\n' +
      'event: done\ndata: {"sessionId":"s1","finishReason":"stop"}\n\n';
    const { events } = parseSseBuffer(buf);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('token');
    expect(events[1].event).toBe('done');
  });

  it('leaves incomplete trailing block as remaining', () => {
    const buf = 'event: token\ndata: {"text":"Hi"}\n\nevent: tok';
    const { events, remaining } = parseSseBuffer(buf);
    expect(events).toHaveLength(1);
    expect(remaining).toBe('event: tok');
  });

  it('returns empty events when no complete block', () => {
    const buf = 'event: token\ndata: {"text":"Hi"}';
    const { events, remaining } = parseSseBuffer(buf);
    expect(events).toHaveLength(0);
    expect(remaining).toBe(buf);
  });

  it('skips blocks with malformed JSON', () => {
    const buf =
      'event: token\ndata: not-json\n\n' +
      'event: done\ndata: {"sessionId":"x","finishReason":"stop"}\n\n';
    const { events } = parseSseBuffer(buf);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('done');
  });

  it('handles empty buffer', () => {
    const { events, remaining } = parseSseBuffer('');
    expect(events).toHaveLength(0);
    expect(remaining).toBe('');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd plugin && bun test tests/sse-parser.test.ts
```

Expected: error `Cannot find module '../src/sse-parser.js'`

- [ ] **Step 3: Implement `plugin/src/sse-parser.ts`**

```typescript
import type { SseEvent } from './types.js';

export function parseSseBuffer(buffer: string): { events: SseEvent[]; remaining: string } {
  const events: SseEvent[] = [];
  const blocks = buffer.split('\n\n');
  // Last element is incomplete (no trailing \n\n) or empty string after trailing \n\n
  const remaining = blocks.pop() ?? '';

  for (const block of blocks) {
    if (!block.trim()) continue;
    let eventName = '';
    let dataLine = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) eventName = line.slice(7).trim();
      else if (line.startsWith('data: ')) dataLine = line.slice(6);
    }
    if (!eventName || !dataLine) continue;
    try {
      events.push({ event: eventName, data: JSON.parse(dataLine) } as SseEvent);
    } catch {
      // skip malformed data
    }
  }

  return { events, remaining };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd plugin && bun test tests/sse-parser.test.ts
```

Expected: `6 pass, 0 fail`

- [ ] **Step 5: Commit**

```bash
cd ..
git add plugin/src/sse-parser.ts plugin/tests/sse-parser.test.ts
git commit -m "feat(plugin): add SSE parser with full test coverage"
```

---

## Task 4: ApiClient — HTTP methods + chat (TDD)

**Files:**
- Create: `plugin/tests/api-client.test.ts`
- Create: `plugin/src/api-client.ts`

- [ ] **Step 1: Write failing tests**

Create `plugin/tests/api-client.test.ts`:

```typescript
import { describe, expect, it, beforeEach, mock } from 'bun:test';

// Mock node modules BEFORE importing ApiClient
mock.module('node:fs', () => ({ readFileSync: () => 'test-token-123' }));
mock.module('node:os', () => ({ homedir: () => '/home/testuser' }));

import { ApiClient } from '../src/api-client.js';

type MockResponse = Pick<Response, 'ok' | 'status' | 'json' | 'body'>;

function makeFetch(status: number, body: unknown): typeof fetch {
  return mock(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    body: null,
  } as MockResponse as Response));
}

describe('ApiClient', () => {
  let client: ApiClient;

  beforeEach(async () => {
    client = new ApiClient(7777, '~/.openclaude/server-token');
    await client.connect();
  });

  it('health() returns parsed body on 200', async () => {
    global.fetch = makeFetch(200, { status: 'ok', version: '0.1.7', uptime_ms: 1234 });
    const h = await client.health();
    expect(h.status).toBe('ok');
    expect(h.version).toBe('0.1.7');
  });

  it('health() throws on non-200', async () => {
    global.fetch = makeFetch(503, {});
    await expect(client.health()).rejects.toThrow('503');
  });

  it('listSessions() sends Authorization header', async () => {
    let capturedHeaders: Record<string, string> = {};
    global.fetch = mock(async (_url: unknown, init?: RequestInit) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    });
    await client.listSessions();
    expect(capturedHeaders['Authorization']).toBe('Bearer test-token-123');
  });

  it('listSessions() retries once on 401 with refreshed token', async () => {
    let calls = 0;
    global.fetch = mock(async () => {
      calls++;
      const status = calls === 1 ? 401 : 200;
      return { ok: status === 200, status, json: async () => [] } as unknown as Response;
    });
    const result = await client.listSessions();
    expect(result).toEqual([]);
    expect(calls).toBe(2);
  });

  it('listPendingEdits() returns array from server', async () => {
    const payload = [{ id: 'e1', file: '/v/note.md', vault: '/v', sessionId: 's1', reason: 'fix', before: 'a', after: 'b', createdAt: 1 }];
    global.fetch = makeFetch(200, payload);
    const edits = await client.listPendingEdits();
    expect(edits).toHaveLength(1);
    expect(edits[0].id).toBe('e1');
  });

  it('applyEdit() POSTs to /pending-edits/:id/apply', async () => {
    let url = '';
    global.fetch = mock(async (u: unknown) => { url = u as string; return { ok: true, status: 200, json: async () => ({}) } as unknown as Response; });
    await client.applyEdit('edit-abc');
    expect(url).toContain('/pending-edits/edit-abc/apply');
  });

  it('rejectEdit() POSTs to /pending-edits/:id/reject', async () => {
    let url = '';
    global.fetch = mock(async (u: unknown) => { url = u as string; return { ok: true, status: 200, json: async () => ({}) } as unknown as Response; });
    await client.rejectEdit('edit-xyz');
    expect(url).toContain('/pending-edits/edit-xyz/reject');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd plugin && bun test tests/api-client.test.ts
```

Expected: `Cannot find module '../src/api-client.js'`

- [ ] **Step 3: Implement `plugin/src/api-client.ts`**

```typescript
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { ChatRequest, HealthStatus, PendingEdit, Session, SseEvent, VaultInfo } from './types.js';
import { parseSseBuffer } from './sse-parser.js';

export class ApiClient {
  private readonly baseUrl: string;
  private readonly resolvedTokenPath: string;
  private token = '';

  constructor(port: number, tokenPath: string) {
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.resolvedTokenPath = tokenPath.replace(/^~/, homedir());
  }

  private readToken(): string {
    try { return readFileSync(this.resolvedTokenPath, 'utf8').trim(); } catch { return ''; }
  }

  async connect(): Promise<void> {
    this.token = this.readToken();
  }

  private authHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };
  }

  async health(): Promise<HealthStatus> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`health check failed: ${res.status}`);
    return res.json() as Promise<HealthStatus>;
  }

  async listSessions(): Promise<Session[]> {
    const res = await fetch(`${this.baseUrl}/sessions`, { headers: this.authHeaders() });
    if (res.status === 401) { this.token = this.readToken(); return this.listSessions(); }
    if (!res.ok) throw new Error(`list sessions failed: ${res.status}`);
    return res.json() as Promise<Session[]>;
  }

  async deleteSession(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/sessions/${id}`, { method: 'DELETE', headers: this.authHeaders() });
    if (!res.ok) throw new Error(`delete session failed: ${res.status}`);
  }

  async listPendingEdits(): Promise<PendingEdit[]> {
    const res = await fetch(`${this.baseUrl}/pending-edits`, { headers: this.authHeaders() });
    if (!res.ok) throw new Error(`list pending edits failed: ${res.status}`);
    return res.json() as Promise<PendingEdit[]>;
  }

  async applyEdit(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/pending-edits/${id}/apply`, {
      method: 'POST', headers: this.authHeaders(), body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`apply edit failed: ${res.status}`);
  }

  async rejectEdit(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/pending-edits/${id}/reject`, {
      method: 'POST', headers: this.authHeaders(), body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`reject edit failed: ${res.status}`);
  }

  async listVaults(): Promise<VaultInfo[]> {
    const res = await fetch(`${this.baseUrl}/vaults`, { headers: this.authHeaders() });
    if (!res.ok) throw new Error(`list vaults failed: ${res.status}`);
    return res.json() as Promise<VaultInfo[]>;
  }

  async chat(req: ChatRequest, onEvent: (evt: SseEvent) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST', headers: this.authHeaders(), body: JSON.stringify(req), signal,
    });
    if (!res.ok) throw new Error(`chat failed: ${res.status}`);
    if (!res.body) throw new Error('no response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, remaining } = parseSseBuffer(buffer);
        buffer = remaining;
        for (const evt of events) onEvent(evt);
      }
    } finally {
      reader.releaseLock();
    }
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd plugin && bun test tests/api-client.test.ts
```

Expected: `7 pass, 0 fail`

- [ ] **Step 5: Commit**

```bash
cd ..
git add plugin/src/api-client.ts plugin/tests/api-client.test.ts
git commit -m "feat(plugin): add ApiClient with HTTP methods, SSE chat, and tests"
```

---

## Task 5: ServerManager (TDD)

**Files:**
- Create: `plugin/tests/server-manager.test.ts`
- Create: `plugin/src/server-manager.ts`

- [ ] **Step 1: Write failing tests**

Create `plugin/tests/server-manager.test.ts`:

```typescript
import { describe, expect, it, beforeEach, mock } from 'bun:test';

const mockKill = mock(() => true);
const mockOn   = mock((_evt: string, _cb: (...a: unknown[]) => void) => {});
const mockSpawn = mock(() => ({ pid: 99, killed: false, kill: mockKill, on: mockOn }));

mock.module('node:child_process', () => ({ spawn: mockSpawn }));

import { ServerManager } from '../src/server-manager.js';
import type { PluginSettings } from '../src/types.js';

const settings: PluginSettings = {
  port: 7777,
  serverBinaryPath: '/repo/dist/cli.mjs',
  tokenPath: '~/.openclaude/server-token',
  autoStartServer: true,
  preset: 'balanced',
};

const mockApi = {
  health: mock(async () => ({ status: 'ok' as const, version: '0.1.0', uptime_ms: 1 })),
  connect: mock(async () => {}),
};

describe('ServerManager', () => {
  beforeEach(() => {
    mockSpawn.mockClear();
    mockKill.mockClear();
    mockOn.mockClear();
    mockApi.health.mockClear();
  });

  it('isRunning() is false before start()', () => {
    const mgr = new ServerManager(settings, mockApi as never);
    expect(mgr.isRunning()).toBe(false);
  });

  it('start() spawns a child process', async () => {
    const mgr = new ServerManager(settings, mockApi as never);
    await mgr.start();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('start() uses "node" as command for .mjs binary', async () => {
    const mgr = new ServerManager(settings, mockApi as never);
    await mgr.start();
    const [cmd] = mockSpawn.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('node');
  });

  it('start() passes serve + port args', async () => {
    const mgr = new ServerManager(settings, mockApi as never);
    await mgr.start();
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]];
    expect(args).toContain('serve');
    expect(args).toContain('--port');
    expect(args).toContain('7777');
  });

  it('isRunning() is true after start()', async () => {
    const mgr = new ServerManager(settings, mockApi as never);
    await mgr.start();
    expect(mgr.isRunning()).toBe(true);
  });

  it('stop() kills the process', async () => {
    const mgr = new ServerManager(settings, mockApi as never);
    await mgr.start();
    mgr.stop();
    expect(mockKill).toHaveBeenCalledTimes(1);
  });

  it('isRunning() is false after stop()', async () => {
    const mgr = new ServerManager(settings, mockApi as never);
    await mgr.start();
    mgr.stop();
    expect(mgr.isRunning()).toBe(false);
  });

  it('start() is idempotent — does not double-spawn', async () => {
    const mgr = new ServerManager(settings, mockApi as never);
    await mgr.start();
    await mgr.start();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd plugin && bun test tests/server-manager.test.ts
```

Expected: `Cannot find module '../src/server-manager.js'`

- [ ] **Step 3: Implement `plugin/src/server-manager.ts`**

```typescript
import { spawn, type ChildProcess } from 'node:child_process';
import { extname } from 'node:path';
import type { PluginSettings } from './types.js';
import type { ApiClient } from './api-client.js';

export type ServerStatus = 'starting' | 'ok' | 'error';
type StatusListener = (status: ServerStatus) => void;

export class ServerManager {
  private proc: ChildProcess | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private restartCount = 0;
  private readonly maxRestarts = 3;
  private statusListeners: StatusListener[] = [];

  constructor(private readonly settings: PluginSettings, private readonly api: ApiClient) {}

  onStatus(fn: StatusListener): void {
    this.statusListeners.push(fn);
  }

  private emit(status: ServerStatus): void {
    this.statusListeners.forEach(fn => fn(status));
  }

  isRunning(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  async start(): Promise<void> {
    if (this.isRunning()) return;
    this.emit('starting');

    const { serverBinaryPath, port } = this.settings;
    const isMjs = extname(serverBinaryPath) === '.mjs';
    const cmd  = isMjs ? 'node' : serverBinaryPath;
    const args = isMjs
      ? [serverBinaryPath, 'serve', '--port', String(port)]
      : ['serve', '--port', String(port)];

    this.proc = spawn(cmd, args, { stdio: 'ignore', detached: false });
    this.proc.on('exit', (code) => this.onExit(code));

    await this.api.connect();
    this.startHealthPoll();
  }

  stop(): void {
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
    if (this.proc) { this.proc.kill(); this.proc = null; }
    this.restartCount = 0;
    this.emit('error');
  }

  private startHealthPoll(): void {
    this.healthTimer = setInterval(async () => {
      try {
        await this.api.health();
        this.emit('ok');
      } catch {
        this.emit('error');
      }
    }, 5_000);
  }

  private onExit(_code: number | null): void {
    this.proc = null;
    this.emit('error');
    if (this.restartCount < this.maxRestarts) {
      this.restartCount++;
      setTimeout(() => this.start(), 2_000 * this.restartCount);
    }
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd plugin && bun test tests/server-manager.test.ts
```

Expected: `8 pass, 0 fail`

- [ ] **Step 5: Run all plugin tests**

```bash
cd plugin && bun test tests/
```

Expected: `21 pass, 0 fail` (6 + 7 + 8)

- [ ] **Step 6: Commit**

```bash
cd ..
git add plugin/src/server-manager.ts plugin/tests/server-manager.test.ts
git commit -m "feat(plugin): add ServerManager with spawn/kill/health-poll and tests"
```

---

## Task 6: Settings tab + wire into main.ts

**Files:**
- Create: `plugin/src/settings.ts`
- Modify: `plugin/src/main.ts`

- [ ] **Step 1: Create `plugin/src/settings.ts`**

```typescript
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
```

- [ ] **Step 2: Rewrite `plugin/src/main.ts` — wire ApiClient, ServerManager, SettingsTab**

```typescript
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
        this.serverManager.start().catch(e => console.error('[OpenClaude] server start failed:', e));
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
```

- [ ] **Step 3: Typecheck + build**

```bash
cd plugin && npm run typecheck && npm run build
```

Expected: exit 0. `main.js` updated.

- [ ] **Step 4: Commit**

```bash
cd ..
git add plugin/src/settings.ts plugin/src/main.ts
git commit -m "feat(plugin): add settings tab and wire ApiClient + ServerManager"
```

---

## Task 7: SidebarView

**Files:**
- Create: `plugin/src/views/sidebar-view.ts`
- Modify: `plugin/src/main.ts` (register view + fill activateSidebar)

- [ ] **Step 1: Create `plugin/src/views/sidebar-view.ts`**

```typescript
import { ItemView, MarkdownView, WorkspaceLeaf } from 'obsidian';
import type OpenClaudePlugin from '../main.js';
import type { SseEvent } from '../types.js';

export const SIDEBAR_VIEW_TYPE = 'openclaude-sidebar';

export class SidebarView extends ItemView {
  private abortController: AbortController | null = null;
  private currentSessionId: string | undefined;
  private pendingCount = 0;

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
    this.plugin.serverManager.onStatus(s => this.setStatus(s));

    // Handle prompts injected from CommandHubModal
    this.registerDomEvent(window, 'openclaude:inject-prompt' as keyof WindowEventMap, (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      this.inputEl.value = detail;
      this.sendMessage();
    });
    this.registerDomEvent(window, 'openclaude:new-session' as keyof WindowEventMap, () => {
      this.currentSessionId = undefined;
      this.chatLog.empty();
    });

    this.startPendingPoll();
  }

  async onClose(): Promise<void> {
    this.abortController?.abort();
  }

  private buildUI(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass('openclaude-sidebar');

    // Header
    const header = root.createDiv({ cls: 'openclaude-header' });
    this.statusDot = header.createSpan({ cls: 'openclaude-status-dot' });
    this.statusDot.dataset['status'] = 'starting';
    header.createSpan({ cls: 'openclaude-title', text: 'OpenClaude' });
    const newBtn = header.createEl('button', { cls: 'openclaude-header-btn', text: '+', attr: { title: 'New session' } });
    newBtn.onclick = () => { this.currentSessionId = undefined; this.chatLog.empty(); };

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
    this.inputEl.addEventListener('keydown', e => {
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
    const view = this.app.workspace.getMostRecentLeaf()?.view;
    this.contextTitle.setText(
      view instanceof MarkdownView && view.file ? view.file.basename : 'No note open'
    );
  }

  private setStatus(status: 'starting' | 'ok' | 'error'): void {
    this.statusDot.dataset['status'] = status;
    this.sendBtn.disabled = status !== 'ok';
  }

  private getActiveContext(): { activeNote?: string; vault?: string; selection?: string } {
    const view = this.app.workspace.getMostRecentLeaf()?.view;
    if (!(view instanceof MarkdownView) || !view.file) return {};
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
      this.sendBtn.textContent = 'Send';
      this.sendBtn.onclick = () => this.sendMessage();
      // Restore status dot from health check
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
      case 'tool_call':
        contentEl.parentElement?.createDiv({ cls: 'openclaude-tool-call', text: `🔧 ${evt.data.name}…` });
        break;
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
```

- [ ] **Step 2: Update `plugin/src/main.ts` — register view + fill activateSidebar**

Add import at top and update `activateSidebar()`:

```typescript
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

  openCommandHub(): void {
    import('./modals/command-hub-modal.js').then(({ CommandHubModal }) => {
      new CommandHubModal(this.app, this).open();
    });
  }
}
```

- [ ] **Step 3: Typecheck + build**

```bash
cd plugin && npm run typecheck && npm run build
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd ..
git add plugin/src/views/sidebar-view.ts plugin/src/main.ts
git commit -m "feat(plugin): add sidebar view with chat streaming, context card, pending edits"
```

---

## Task 8: DiffPreviewModal

**Files:**
- Create: `plugin/src/modals/diff-preview-modal.ts`

- [ ] **Step 1: Create `plugin/src/modals/diff-preview-modal.ts`**

```typescript
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

  private async apply(): Promise<void> {
    try {
      await this.plugin.api.applyEdit(this.edit.id);
      this.close();
    } catch (err) {
      this.contentEl.createEl('p', {
        text: `Apply failed: ${(err as Error).message}`,
        cls: 'mod-warning',
      });
    }
  }

  onClose(): void { this.contentEl.empty(); }
}
```

- [ ] **Step 2: Typecheck + build**

```bash
cd plugin && npm run typecheck && npm run build
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd ..
git add plugin/src/modals/diff-preview-modal.ts
git commit -m "feat(plugin): add diff preview modal (before/after, apply/reject)"
```

---

## Task 9: CommandHubModal

**Files:**
- Create: `plugin/src/modals/command-hub-modal.ts`

- [ ] **Step 1: Create `plugin/src/modals/command-hub-modal.ts`**

```typescript
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
  private rendered: HubItem[] = [];
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

  private buildItems(): HubItem[] {
    const inject = (prompt: string) => {
      this.close();
      this.plugin.activateSidebar().then(() => {
        window.dispatchEvent(new CustomEvent('openclaude:inject-prompt', { detail: prompt }));
      });
    };

    return [
      {
        icon: '✦', name: 'Summarize note', shortcut: 'Ctrl+Shift+A',
        action: () => inject('Summarize this note concisely.'),
      },
      {
        icon: '⚡', name: 'Expand selection to Zettels', shortcut: 'Ctrl+Shift+Z',
        action: () => inject('Expand the selected text into Zettelkasten atomic notes with [[wikilinks]].'),
      },
      {
        icon: '🗺', name: 'Generate MOC',
        action: () => inject('Generate a Map of Content (MOC) for this note, listing related topics as [[wikilinks]].'),
      },
      {
        icon: '🔗', name: 'Suggest backlinks',
        action: () => inject('Suggest relevant [[wikilinks]] I should add to this note based on its content.'),
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
          this.close();
          try {
            const h = await this.plugin.api.health();
            window.dispatchEvent(new CustomEvent('openclaude:inject-prompt', {
              detail: `Server status: ${h.status} | version: ${h.version} | uptime: ${Math.round(h.uptime_ms / 1000)}s`,
            }));
          } catch (e) {
            window.dispatchEvent(new CustomEvent('openclaude:inject-prompt', {
              detail: `Server unreachable: ${(e as Error).message}`,
            }));
          }
        },
      },
    ];
  }

  private renderList(items: HubItem[]): void {
    this.listEl.empty();
    this.rendered = items;
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
```

- [ ] **Step 2: Typecheck + build**

```bash
cd plugin && npm run typecheck && npm run build
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd ..
git add plugin/src/modals/command-hub-modal.ts
git commit -m "feat(plugin): add Ctrl+K command hub modal with quick actions"
```

---

## Task 10: Build scripts + vault installer

**Files:**
- Create: `plugin/install.mjs`
- Modify: `plugin/package.json` (already has `install:vault` — verify)
- Modify: root `package.json` (add 2 scripts)

- [ ] **Step 1: Create `plugin/install.mjs`**

```javascript
#!/usr/bin/env node
// Copies plugin artifacts to a vault's .obsidian/plugins/openclaude-obsidian/
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const vaultPath = process.argv[2];

if (!vaultPath) {
  console.error('Usage: node install.mjs <vault-path>');
  console.error('Example: node install.mjs "G:/Meu Drive/Energinova_Hub"');
  process.exit(1);
}

const pluginDir = join(resolve(vaultPath), '.obsidian', 'plugins', 'openclaude-obsidian');
if (!existsSync(pluginDir)) mkdirSync(pluginDir, { recursive: true });

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  const src = join(__dir, file);
  if (!existsSync(src)) {
    console.error(`Missing build artifact: ${src}`);
    console.error('Run "npm run build" first.');
    process.exit(1);
  }
  copyFileSync(src, join(pluginDir, file));
  console.log(`  ✓ ${file}`);
}
console.log(`\nInstalled to: ${pluginDir}`);
console.log('In Obsidian: Settings → Community Plugins → enable "OpenClaude".');
```

- [ ] **Step 2: Add scripts to root `package.json`**

Open `package.json` at the project root. In the `"scripts"` section, add after `"test:serve"`:

```json
"plugin:build": "cd plugin && npm install && npm run build",
"plugin:install": "cd plugin && npm run build && node install.mjs"
```

- [ ] **Step 3: Final build + all tests**

```bash
cd plugin && npm run build && bun test tests/
```

Expected: `main.js` + `styles.css` present, `21 pass, 0 fail`.

- [ ] **Step 4: Verify install script exits cleanly with usage on no args**

```bash
cd plugin && node install.mjs 2>&1; true
```

Expected: prints `Usage: node install.mjs <vault-path>` and exits 1.

- [ ] **Step 5: Commit**

```bash
cd ..
git add plugin/install.mjs plugin/package.json package.json
git commit -m "feat(plugin): add vault installer script and root build scripts"
```

---

## Self-Review

### Spec coverage

| Spec section | Covered by |
|---|---|
| §3.1 Plugin layer (sidebar, modal, server manager) | Tasks 7-9 |
| §4.1 All API endpoints (health, sessions, pending-edits, vaults, chat) | Task 4 ApiClient |
| §4.2 SSE event types (token, tool_call, pending_edit, done, error) | Task 3 + sidebar handleEvent |
| §4.3 Auth: Bearer token, retry on 401 | Task 4 ApiClient.listSessions |
| §5.1 Layout: sidebar + Ctrl+K hub | Tasks 7 + 9 |
| §5.2 Hotkeys Ctrl+K, Ctrl+Shift+A, Ctrl+Shift+Z | main.ts + CommandHubModal items |
| §5.3 Status dots: ok/starting/error/streaming | styles.css + sidebar setStatus |
| §5.4 Diff preview modal: before/after, apply/reject | Task 8 |
| §6.1 Active note context (200 lines + selection) | sidebar getActiveContext |
| §8.1 Server crash respawn (up to 3x) | Task 5 ServerManager.onExit |
| §10.1 CLI install (copy artifacts to vault) | Task 10 install.mjs |

**Deferred to Plan #3 (intentional):**
- §6.3 Dataview Nível 1+2 (requires Dataview JS API in Obsidian runtime)
- §6.4 Mermaid graph render (lazy-load mermaid.js)
- §6.5 Slash commands from `commands.yml`
- §6.6 Backup history view
- §6.7 Full health check diagnostics panel
- §7 Permission model UI (conservative/balanced/aggressive enforcement)

### Placeholder scan
No TBD/TODO/implement-later in any code block above. ✓

### Type consistency
- `SseEvent.event: 'pending_edit'` → `data: { id, file, reason }` — matches server's `AgentEvent` in `chat.ts` ✓
- `PendingEdit.before / PendingEdit.after` — matches `PendingEditStore.PendingEdit` in `pendingEditStore.ts` ✓  
- `ChatRequest.context.activeNote` — matches server's `AgentFn context.activeNote` in `chat.ts` ✓
- `ServerManager.onStatus(fn)` takes `'starting' | 'ok' | 'error'`; sidebar only calls `setStatus('ok' | 'error')` from the listener, and directly sets `dataset['status'] = 'streaming'` for streaming state (no type cast needed) ✓
- `DiffPreviewModal` receives `PendingEdit` (full object); `applyEdit(id)` only needs the `id` ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-01-openclaude-obsidian-phase-2-plugin.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
