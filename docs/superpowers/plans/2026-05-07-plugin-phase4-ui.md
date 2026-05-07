# Plugin Phase 4 UI — Provider Env Vars + Thought Tool Display

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Make the plugin pass Ollama/OpenAI provider config as env vars when spawning the server process, so the server picks up the right provider without manual env setup. (2) Give thought tools a visually distinct expandable/collapsible display in the sidebar instead of the generic 🔧 treatment.

**Architecture:** Two focused changes — `server-manager.ts` gets env var injection from `PluginSettings.provider`, and `sidebar-view.ts` gets a thought-tool-specific render path in `handleEvent`. No new dependencies.

**Tech Stack:** TypeScript strict, Obsidian plugin API, Bun test (run from `plugin/` directory).

**Working branch:** `feat/plugin` (or a fresh worktree branched from it)

**Run tests:** `cd plugin && bun test tests/ --reporter=verbose`

---

## Scope note

`suggestions` chips, web search 🌐 icon, and `tool_result` updates are **already implemented** in `sidebar-view.ts`. This plan only fills the two remaining gaps.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `plugin/src/server-manager.ts` | Pass `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENCLAUDE_MODEL`, `CLAUDE_CODE_USE_OPENAI` when spawning server |
| Modify | `plugin/tests/server-manager.test.ts` | Test that env vars are passed for ollama/openai provider types |
| Modify | `plugin/src/views/sidebar-view.ts` | Expandable thought-tool blocks in `handleEvent` |
| Modify | `plugin/styles.css` | CSS for `.oc-thought-block` |
| Modify | `plugin/tests/sidebar-view.test.ts` | Test thought-tool rendering |

---

## Task 1: Pass provider env vars on server spawn

**Background:** `server-manager.ts` calls `spawn(cmd, args, { stdio: 'ignore', detached: false })` with no `env` option. The server process inherits the OS environment, which may not have `OPENAI_BASE_URL` or `OPENAI_API_KEY` set. The plugin has this info in `settings.provider` — it must pass it explicitly.

**Files:**
- Modify: `plugin/src/server-manager.ts`
- Modify: `plugin/tests/server-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Open `plugin/tests/server-manager.test.ts`. Add:

```typescript
import { describe, it, expect, mock, beforeEach } from "bun:test";

// We test the env-building logic in isolation by extracting it.
// The test imports a helper we're about to create.
import { buildServerEnv } from "../src/server-manager.js";
import type { PluginSettings } from "../src/types.js";

const BASE_SETTINGS: PluginSettings = {
  port: 7777,
  serverBinaryPath: "/fake/cli.mjs",
  tokenPath: "~/.openclaude/server-token",
  autoStartServer: true,
  preset: "balanced",
  vaultPathOverride: "",
  braveApiKey: "",
  provider: { type: "anthropic" },
};

describe("buildServerEnv", () => {
  it("returns undefined for anthropic provider (inherit OS env)", () => {
    expect(buildServerEnv({ ...BASE_SETTINGS, provider: { type: "anthropic" } })).toBeUndefined();
  });

  it("sets OPENAI_BASE_URL and OPENAI_API_KEY for ollama", () => {
    const env = buildServerEnv({
      ...BASE_SETTINGS,
      provider: {
        type: "ollama",
        baseUrl: "http://localhost:11434/v1",
        apiKey: "ollama",
        model: "qwen3-vl:235b-cloud",
      },
    });
    expect(env).toBeDefined();
    expect(env!.OPENAI_BASE_URL).toBe("http://localhost:11434/v1");
    expect(env!.OPENAI_API_KEY).toBe("ollama");
    expect(env!.OPENCLAUDE_MODEL).toBe("qwen3-vl:235b-cloud");
    expect(env!.CLAUDE_CODE_USE_OPENAI).toBe("1");
  });

  it("sets OPENAI vars for openai provider type", () => {
    const env = buildServerEnv({
      ...BASE_SETTINGS,
      provider: {
        type: "openai",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: "gsk_test",
        model: "llama-3.3-70b",
      },
    });
    expect(env!.OPENAI_BASE_URL).toBe("https://api.groq.com/openai/v1");
    expect(env!.CLAUDE_CODE_USE_OPENAI).toBe("1");
  });

  it("passes BRAVE_API_KEY if braveApiKey is set", () => {
    const env = buildServerEnv({
      ...BASE_SETTINGS,
      braveApiKey: "BSAtest123",
      provider: { type: "ollama", baseUrl: "http://localhost:11434/v1", apiKey: "ollama" },
    });
    expect(env!.BRAVE_API_KEY).toBe("BSAtest123");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd plugin && bun test tests/server-manager.test.ts --reporter=verbose
```

Expected: FAIL — `buildServerEnv` not exported.

- [ ] **Step 3: Add `buildServerEnv` export and wire into `start()`**

In `plugin/src/server-manager.ts`, add this export before the class and update `start()`:

```typescript
import { spawn, type ChildProcess } from 'node:child_process';
import { extname } from 'node:path';
import type { PluginSettings } from './types.js';
import type { ApiClient } from './api-client.js';

/** Build the env object to pass when spawning the server process.
 *  Returns undefined for the Anthropic provider (inherit OS env as-is). */
export function buildServerEnv(settings: PluginSettings): NodeJS.ProcessEnv | undefined {
  const { provider, braveApiKey } = settings;
  if (provider.type === 'anthropic') return undefined;

  const env: NodeJS.ProcessEnv = {
    ...process.env,  // inherit existing OS env
    CLAUDE_CODE_USE_OPENAI: '1',
  };
  if (provider.baseUrl)  env.OPENAI_BASE_URL  = provider.baseUrl;
  if (provider.apiKey)   env.OPENAI_API_KEY   = provider.apiKey;
  if (provider.model)    env.OPENCLAUDE_MODEL  = provider.model;
  if (braveApiKey)       env.BRAVE_API_KEY     = braveApiKey;
  return env;
}
```

Then in the `start()` method, update the `spawn` call:

```typescript
async start(): Promise<void> {
  if (this.isRunning()) return;
  this.emit('starting');

  const { serverBinaryPath, port } = this.settings;
  const isMjs = extname(serverBinaryPath) === '.mjs';
  const cmd  = isMjs ? 'node' : serverBinaryPath;
  const args = isMjs
    ? [serverBinaryPath, 'serve', '--port', String(port)]
    : ['serve', '--port', String(port)];

  const env = buildServerEnv(this.settings);   // NEW
  this.proc = spawn(cmd, args, {
    stdio: 'ignore',
    detached: false,
    ...(env ? { env } : {}),                   // NEW — only pass env if non-anthropic
  });
  this.proc.on('exit', (code) => this.onExit(code));

  await this.api.connect();
  this.startHealthPoll();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd plugin && bun test tests/server-manager.test.ts --reporter=verbose
```

Expected: all `buildServerEnv` tests PASS.

- [ ] **Step 5: Run full plugin test suite**

```bash
cd plugin && bun test tests/ --reporter=verbose
```

Expected: all existing tests pass plus the new ones.

- [ ] **Step 6: Commit**

```bash
git add plugin/src/server-manager.ts plugin/tests/server-manager.test.ts
git commit -m "feat(server-manager): pass provider env vars (OPENAI_BASE_URL, OPENAI_API_KEY, OPENCLAUDE_MODEL) on server spawn"
```

---

## Task 2: Thought tool expandable display in sidebar

**Background:** The current `tool_call` handler in `sidebar-view.ts` renders all tools as `🔧 toolname…` and updates to `✅/❌` on result. Thought tools (`structure_thought`, `refine_argument`, `counter_argument`) produce long structured output that deserves a collapsible block with the result visible on expand.

**Files:**
- Modify: `plugin/src/views/sidebar-view.ts`
- Modify: `plugin/styles.css`

- [ ] **Step 1: Write the failing test**

In `plugin/tests/sidebar-view.test.ts` (create if absent), add:

```typescript
import { describe, it, expect } from "bun:test";

// Unit-test the classification helper in isolation
const THOUGHT_TOOLS = new Set(["structure_thought", "refine_argument", "counter_argument"]);

function isThoughtTool(name: string): boolean {
  return THOUGHT_TOOLS.has(name);
}

describe("isThoughtTool", () => {
  it("identifies thought tools correctly", () => {
    expect(isThoughtTool("structure_thought")).toBe(true);
    expect(isThoughtTool("refine_argument")).toBe(true);
    expect(isThoughtTool("counter_argument")).toBe(true);
  });

  it("does not classify other tools as thought tools", () => {
    expect(isThoughtTool("web_search")).toBe(false);
    expect(isThoughtTool("write_note")).toBe(false);
    expect(isThoughtTool("list_vault")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify test is importable**

```bash
cd plugin && bun test tests/sidebar-view.test.ts --reporter=verbose
```

Expected: PASS (pure logic, no Obsidian deps).

- [ ] **Step 3: Add thought-tool render in `sidebar-view.ts`**

In `plugin/src/views/sidebar-view.ts`, add the constant at the top of the class (after the existing `private toolCallEls` line):

```typescript
private thoughtBlockEls = new Map<string, HTMLElement>();  // id → content div
private static readonly THOUGHT_TOOLS = new Set([
  'structure_thought', 'refine_argument', 'counter_argument',
]);
```

Then update the `case 'tool_call'` block in `handleEvent`:

```typescript
case 'tool_call': {
  const parent = contentEl.parentElement;
  if (!parent) break;

  if (SidebarView.THOUGHT_TOOLS.has(evt.data.name)) {
    // Expandable thought block
    const block = parent.createDiv({ cls: 'oc-thought-block' });
    const labels: Record<string, string> = {
      structure_thought: '🧠 Estruturando pensamento',
      refine_argument:   '✏️ Refinando argumento',
      counter_argument:  '⚔️ Gerando contra-argumento',
    };
    const summary = block.createEl('button', {
      cls: 'oc-thought-summary',
      text: `${labels[evt.data.name] ?? '🧠 Processando'}…`,
    });
    const body = block.createDiv({ cls: 'oc-thought-body', text: '' });
    body.style.display = 'none';  // collapsed by default
    summary.addEventListener('click', () => {
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      summary.classList.toggle('oc-thought-open', !isOpen);
    });
    this.thoughtBlockEls.set(evt.data.id, body);
    this.toolCallEls.set(evt.data.id, summary);  // reuse for ✅/❌ prefix update
  } else {
    // Generic tool (web, vault, format)
    const el = parent.createDiv({ cls: 'oc-tool-call' });
    const icon = evt.data.name === 'web_search' || evt.data.name === 'fetch_page' ? '🌐' : '🔧';
    el.setText(`${icon} ${evt.data.name}…`);
    this.toolCallEls.set(evt.data.id, el);
  }
  break;
}
```

Update `case 'tool_result'` to fill in the thought body:

```typescript
case 'tool_result': {
  const el = this.toolCallEls.get(evt.data.id);
  if (el) {
    const prefix = evt.data.ok ? '✅ ' : '❌ ';
    el.setText(prefix + (el.textContent ?? '').replace(/^[✅❌🧠✏️⚔️🔧🌐]\s*/, '').replace('…', ''));
    this.toolCallEls.delete(evt.data.id);
  }
  // Fill thought block body with the structured result preview
  const bodyEl = this.thoughtBlockEls.get(evt.data.id);
  if (bodyEl && evt.data.preview) {
    bodyEl.textContent = evt.data.preview;
    this.thoughtBlockEls.delete(evt.data.id);
  }
  break;
}
```

Also reset `thoughtBlockEls` in the new-session handler (alongside `toolCallEls`):

```typescript
// In the new-session event handler and onClose:
this.thoughtBlockEls.clear();
```

- [ ] **Step 4: Add CSS for thought blocks**

In `plugin/styles.css`, append:

```css
/* ── Thought tool blocks ──────────────────────────────────── */
.oc-thought-block {
  margin: 6px 0;
  border-left: 3px solid var(--interactive-accent);
  border-radius: 0 6px 6px 0;
  background: var(--background-secondary);
  overflow: hidden;
}

.oc-thought-summary {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
}

.oc-thought-summary:hover { color: var(--text-normal); }

.oc-thought-summary.oc-thought-open { color: var(--interactive-accent); }

.oc-thought-body {
  padding: 8px 10px;
  font-size: 11px;
  color: var(--text-muted);
  white-space: pre-wrap;
  border-top: 1px solid var(--background-modifier-border);
}
```

- [ ] **Step 5: Build plugin and verify no TypeScript errors**

```bash
cd plugin && bun run build 2>&1 | head -30
```

Expected: build succeeds, `main.js` updated, no TS errors.

- [ ] **Step 6: Run full plugin tests**

```bash
cd plugin && bun test tests/ --reporter=verbose
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add plugin/src/views/sidebar-view.ts plugin/styles.css plugin/tests/sidebar-view.test.ts
git commit -m "feat(sidebar): expandable collapsible thought-tool blocks for structure/refine/counter"
```

---

## Task 3: Manual smoke test

- [ ] **Step 1: Install the updated plugin**

```bash
bun run plugin:install
```

- [ ] **Step 2: Start server with Ollama env vars** (from repo root)

```bash
OPENAI_BASE_URL="http://localhost:11434/v1" \
OPENAI_API_KEY="ollama" \
OPENCLAUDE_MODEL="qwen3-vl:235b-cloud" \
CLAUDE_CODE_USE_OPENAI="1" \
  node dist/cli.mjs serve --port 7777
```

Or: enable auto-start in plugin Settings with provider set to Ollama — the env vars will now be passed automatically by the updated `server-manager.ts`.

- [ ] **Step 3: In Obsidian sidebar**

Send a message that triggers thought tools:

> "estruture este argumento em formato toulmin: dados abertos melhoram democracia"

Expected:
- A collapsible block `🧠 Estruturando pensamento…` appears in the chat
- After the tool result arrives: block shows `✅ Estruturando pensamento`
- Clicking the block expands to show the structured argument
- Suggestions chips appear below the final response

- [ ] **Step 4: Verify env vars are passed by plugin**

Stop any manually-started server. In Obsidian plugin Settings, set provider to Ollama with:
- Base URL: `http://localhost:11434/v1`
- API Key: `ollama`
- Model: `qwen3-vl:235b-cloud`

Restart Obsidian or toggle autostart OFF then ON. Confirm the server starts and responds (green dot in sidebar).

---

## Checklist pós-task

- [ ] `cd plugin && bun test tests/` — verde
- [ ] `cd plugin && bun run build` — zero erros
- [ ] `buildServerEnv` retorna env com `CLAUDE_CODE_USE_OPENAI=1` para provider ollama
- [ ] `buildServerEnv` retorna `undefined` para provider anthropic
- [ ] Thought tools mostram bloco colapsável (não `🔧 tool_name…`)
- [ ] Click no bloco expande o resultado
- [ ] Suggestions chips ainda funcionam (não regressão)
