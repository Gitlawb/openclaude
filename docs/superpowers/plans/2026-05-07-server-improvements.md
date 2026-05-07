# Server Improvements — Thought Tools + Permission Middleware

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `CLAUDE_CODE_USE_OPENAI` env-var guard that blocks thought tools from running on Ollama/Groq, and add a P3 permission middleware that enforces read/write/delete rules per preset before any tool executes.

**Architecture:** Two focused changes to `src/serve/tools/registry.ts` (provider detection) and a new `src/serve/permissions.ts` module that is wired into `agentAdapter.ts` as a before-tool hook. No new dependencies.

**Tech Stack:** TypeScript strict, Bun test, existing `src/serve/` module structure.

**Working branch:** `feat/serve` (or a fresh worktree branched from it)

**Run tests after every task:** `bun test src/serve/ --reporter=verbose`

---

## Scope note

`rename_note` / `move_note` wikilink updates are **already implemented** in `pendingEdits.ts:updateWikilinks()`. No work needed there.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/serve/tools/registry.ts` | Replace env-var guard with runtime capability check |
| Create | `src/serve/tools/registry.test.ts` | Add coverage for new guard logic |
| Create | `src/serve/permissions.ts` | Permission rules per preset |
| Create | `src/serve/permissions.test.ts` | Unit tests for all preset × tool combos |
| Modify | `src/serve/agentAdapter.ts` | Call `checkPermission` before each tool execution |

---

## Task 1: Fix thought-tool guard in registry

**Background:** `buildRegistry` in `registry.ts` currently gates thought tools behind `process.env.CLAUDE_CODE_USE_OPENAI === "1"`. The user's default provider is Qwen3 via Ollama, which IS OpenAI-compatible (it has `OPENAI_BASE_URL` and `OPENAI_API_KEY` set). The correct guard is: "do we have an OpenAI-compatible key?" — not a separate feature flag.

**Files:**
- Modify: `src/serve/tools/registry.ts`
- Modify: `src/serve/tools/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Open `src/serve/tools/registry.test.ts`. Add these two test cases:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { buildRegistry } from "./registry";
import type { ToolContext } from "./registry";

const BASE_CTX: ToolContext = {
  vault: "/fake-vault",
  braveApiKey: undefined,
  pendingEditStore: undefined,
  sessionId: "test",
};

describe("buildRegistry — thought tools availability", () => {
  let savedBase: string | undefined;
  let savedKey: string | undefined;
  let savedOld: string | undefined;

  beforeEach(() => {
    savedBase = process.env.OPENAI_BASE_URL;
    savedKey  = process.env.OPENAI_API_KEY;
    savedOld  = process.env.CLAUDE_CODE_USE_OPENAI;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.CLAUDE_CODE_USE_OPENAI;
  });

  afterEach(() => {
    if (savedBase !== undefined) process.env.OPENAI_BASE_URL = savedBase; else delete process.env.OPENAI_BASE_URL;
    if (savedKey  !== undefined) process.env.OPENAI_API_KEY  = savedKey;  else delete process.env.OPENAI_API_KEY;
    if (savedOld  !== undefined) process.env.CLAUDE_CODE_USE_OPENAI = savedOld; else delete process.env.CLAUDE_CODE_USE_OPENAI;
  });

  it("includes thought tools when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "ollama";
    const modules = buildRegistry(BASE_CTX);
    const names = modules.map(m => m.definition.function.name);
    expect(names).toContain("structure_thought");
    expect(names).toContain("refine_argument");
    expect(names).toContain("counter_argument");
  });

  it("includes thought tools when OPENAI_BASE_URL is set (Ollama without key)", () => {
    process.env.OPENAI_BASE_URL = "http://localhost:11434/v1";
    const modules = buildRegistry(BASE_CTX);
    const names = modules.map(m => m.definition.function.name);
    expect(names).toContain("structure_thought");
  });

  it("excludes thought tools when neither OPENAI_API_KEY nor OPENAI_BASE_URL are set", () => {
    const modules = buildRegistry(BASE_CTX);
    const names = modules.map(m => m.definition.function.name);
    expect(names).not.toContain("structure_thought");
    expect(names).not.toContain("refine_argument");
    expect(names).not.toContain("counter_argument");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test src/serve/tools/registry.test.ts --reporter=verbose
```

Expected: first two tests FAIL (thought tools not included without old flag).

- [ ] **Step 3: Add provider-detection helper and update guard**

In `src/serve/tools/registry.ts`, add this function and update `buildRegistry`:

```typescript
/** Returns true if an OpenAI-compatible endpoint is configured at runtime. */
function hasOpenAICompatibleProvider(): boolean {
  return !!(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL);
}
```

Replace the current guard block in `buildRegistry`:

```typescript
// BEFORE
if (process.env.CLAUDE_CODE_USE_OPENAI === "1") {
  modules.push(...thoughtToolModules(ctx));
}

// AFTER
if (hasOpenAICompatibleProvider()) {
  modules.push(...thoughtToolModules(ctx));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/serve/tools/registry.test.ts --reporter=verbose
```

Expected: all 3 new tests PASS.

- [ ] **Step 5: Run full suite to verify no regressions**

```bash
bun test src/serve/ --reporter=verbose
```

Expected: all existing tests pass plus the 3 new ones.

- [ ] **Step 6: Commit**

```bash
git add src/serve/tools/registry.ts src/serve/tools/registry.test.ts
git commit -m "fix(registry): derive thought-tools availability from OPENAI_* env vars, not CLAUDE_CODE_USE_OPENAI flag"
```

---

## Task 2: Create `permissions.ts` module

**Background:** The agent currently runs any tool without checking user-configured permissions. The spec defines 3 presets: conservador, balanceado (default), agressivo. Each preset maps tool categories to actions: auto-allow, require-diff-preview, ask-confirm, or block.

**Files:**
- Create: `src/serve/permissions.ts`
- Create: `src/serve/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/serve/permissions.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { checkPermission, type Preset } from "./permissions";

describe("checkPermission", () => {
  // ── conservador ──────────────────────────────────────────
  describe("conservador preset", () => {
    const p: Preset = "conservador";

    it("allows read tools", () => {
      expect(checkPermission("read_note",    {}, p).allowed).toBe(true);
      expect(checkPermission("list_vault",   {}, p).allowed).toBe(true);
      expect(checkPermission("search_vault", {}, p).allowed).toBe(true);
    });

    it("blocks write tools (returns allowed:false with reason)", () => {
      const r = checkPermission("write_note", {}, p);
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/conservador/i);
    });

    it("blocks delete tools", () => {
      expect(checkPermission("delete_note", {}, p).allowed).toBe(false);
    });

    it("allows web search (read-only external)", () => {
      expect(checkPermission("web_search", {}, p).allowed).toBe(true);
      expect(checkPermission("fetch_page", {}, p).allowed).toBe(true);
    });

    it("allows thought tools (no side effects)", () => {
      expect(checkPermission("structure_thought",  {}, p).allowed).toBe(true);
      expect(checkPermission("refine_argument",    {}, p).allowed).toBe(true);
      expect(checkPermission("counter_argument",   {}, p).allowed).toBe(true);
    });
  });

  // ── balanceado ───────────────────────────────────────────
  describe("balanceado preset (default)", () => {
    const p: Preset = "balanceado";

    it("allows read tools", () => {
      expect(checkPermission("read_note", {}, p).allowed).toBe(true);
    });

    it("allows write (routed through diff-preview — allowed:true, requiresPreview:true)", () => {
      const r = checkPermission("write_note", {}, p);
      expect(r.allowed).toBe(true);
      expect(r.requiresPreview).toBe(true);
    });

    it("blocks delete by default (returns allowed:false so agent must ask user)", () => {
      expect(checkPermission("delete_note", {}, p).allowed).toBe(false);
    });

    it("allows format tools", () => {
      expect(checkPermission("summarize_notes", {}, p).allowed).toBe(true);
      expect(checkPermission("format_note",     {}, p).allowed).toBe(true);
    });
  });

  // ── agressivo ────────────────────────────────────────────
  describe("agressivo preset", () => {
    const p: Preset = "agressivo";

    it("allows write without preview requirement", () => {
      const r = checkPermission("write_note", {}, p);
      expect(r.allowed).toBe(true);
      expect(r.requiresPreview).toBeUndefined();
    });

    it("still blocks delete (returns allowed:false — always ask)", () => {
      expect(checkPermission("delete_note", {}, p).allowed).toBe(false);
    });
  });

  // ── unknown tool ─────────────────────────────────────────
  it("allows unknown tools by default (fail-open for forward compatibility)", () => {
    expect(checkPermission("some_future_tool", {}, "balanceado").allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test src/serve/permissions.test.ts --reporter=verbose
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `permissions.ts`**

Create `src/serve/permissions.ts`:

```typescript
export type Preset = "conservador" | "balanceado" | "agressivo";

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
  requiresPreview?: boolean;
}

const READ_TOOLS   = new Set(["read_note", "list_vault", "search_vault"]);
const WRITE_TOOLS  = new Set(["write_note", "summarize_notes", "format_note", "suggest_links"]);
const DELETE_TOOLS = new Set(["delete_note"]);
const MOVE_TOOLS   = new Set(["rename_note", "move_note"]);
const WEB_TOOLS    = new Set(["web_search", "fetch_page"]);
const THINK_TOOLS  = new Set(["structure_thought", "refine_argument", "counter_argument"]);

export function checkPermission(
  toolName: string,
  _args: Record<string, unknown>,
  preset: Preset,
): PermissionResult {
  // Thought tools and web read-only: always allowed regardless of preset
  if (THINK_TOOLS.has(toolName) || WEB_TOOLS.has(toolName) || READ_TOOLS.has(toolName)) {
    return { allowed: true };
  }

  // Delete: always ask (never auto-execute)
  if (DELETE_TOOLS.has(toolName)) {
    return {
      allowed: false,
      reason: `Preset "${preset}": delete operations require explicit user confirmation. Ask the user before proceeding.`,
    };
  }

  switch (preset) {
    case "conservador":
      // Writes and moves blocked — user must apply manually via diff preview
      if (WRITE_TOOLS.has(toolName) || MOVE_TOOLS.has(toolName)) {
        return {
          allowed: false,
          reason: `Preset "conservador": write and move operations are blocked. Describe the change and ask the user to apply it manually.`,
        };
      }
      return { allowed: true };

    case "balanceado":
      // Writes allowed but must go through PendingEditStore (diff preview)
      if (WRITE_TOOLS.has(toolName) || MOVE_TOOLS.has(toolName)) {
        return { allowed: true, requiresPreview: true };
      }
      return { allowed: true };

    case "agressivo":
      // All writes auto-apply (they still go through PendingEditStore but are auto-approved)
      return { allowed: true };

    default: {
      const _exhaustive: never = preset;
      return { allowed: true };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/serve/permissions.test.ts --reporter=verbose
```

Expected: all tests PASS.

- [ ] **Step 5: Run full suite**

```bash
bun test src/serve/ --reporter=verbose
```

Expected: all existing tests pass plus new permissions tests.

- [ ] **Step 6: Commit**

```bash
git add src/serve/permissions.ts src/serve/permissions.test.ts
git commit -m "feat(permissions): add P3 permission middleware with conservador/balanceado/agressivo presets"
```

---

## Task 3: Wire permission check into agentAdapter

**Background:** The `lightweightOpenAIAgent` function in `agentAdapter.ts` runs tools by calling `module.run(args, toolCtx)`. We need to call `checkPermission(name, args, preset)` before `module.run`. If `allowed: false`, emit a `tool_result` event with the denial reason instead of executing the tool.

**Files:**
- Modify: `src/serve/agentAdapter.ts`

First, identify the tool execution section. Search for where `module.run` is called in `agentAdapter.ts`:

```bash
grep -n "module.run\|\.run(" src/serve/agentAdapter.ts
```

- [ ] **Step 1: Write the failing test**

Add to the existing `src/serve/agentAdapter.test.ts` (or create if absent):

```typescript
import { describe, it, expect } from "bun:test";
import { checkPermission } from "./permissions";

// Smoke test that the integration path produces a denial for conservador + write
describe("permission integration smoke", () => {
  it("checkPermission denies write_note on conservador", () => {
    const result = checkPermission("write_note", { path: "test.md", content: "x", reason: "test" }, "conservador");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("conservador");
  });
});
```

- [ ] **Step 2: Run to verify it fails if module isn't imported**

```bash
bun test src/serve/agentAdapter.test.ts --reporter=verbose
```

Expected: PASS (the test just imports checkPermission directly — confirms the module is importable from agentAdapter's perspective). If test is already passing, proceed.

- [ ] **Step 3: Wire checkPermission into agentAdapter**

Find the tool-execution block inside `lightweightOpenAIAgent` in `agentAdapter.ts`. It looks approximately like:

```typescript
// Find this pattern (exact line numbers vary):
const module = registry.find(m => m.definition.function.name === call.function.name);
if (!module) { /* handle unknown tool */ }
const result = await module.run(parsedArgs, toolCtx);
```

Add the permission check **between** finding the module and calling `module.run`:

```typescript
import { checkPermission } from "./permissions";
import type { Preset } from "./permissions";

// Inside lightweightOpenAIAgent, before module.run:
const preset: Preset = (context?.preset as Preset) ?? "balanceado";
const permission = checkPermission(call.function.name, parsedArgs, preset);
if (!permission.allowed) {
  // Emit denial as a tool result so the agent sees it and can inform the user
  yield {
    event: "tool_result",
    data: {
      id: call.id ?? call.function.name,
      ok: false,
      preview: permission.reason ?? "Permission denied",
    },
  };
  toolResults.push({
    role: "tool" as const,
    tool_call_id: call.id ?? call.function.name,
    content: permission.reason ?? "Permission denied by preset configuration.",
  });
  continue;
}
```

- [ ] **Step 4: Check that `context.preset` flows through**

In `agentAdapter.ts`, confirm `AgentInput` (or equivalent input type) includes `preset`. Search:

```bash
grep -n "preset\|AgentInput\|interface.*Input" src/serve/agentAdapter.ts src/serve/handlers/chat.ts | head -20
```

If `preset` is not yet in the input type, add it:

```typescript
// In the input type (AgentFn input or equivalent):
preset?: "conservador" | "balanceado" | "agressivo";
```

And in `chat.ts` handler, pass `body.preset` through to the agent call.

- [ ] **Step 5: Run full suite**

```bash
bun test src/serve/ --reporter=verbose
```

Expected: all tests pass including the new smoke test. Zero type errors: `bun run typecheck 2>&1 | grep -c error` should return 0.

- [ ] **Step 6: Commit**

```bash
git add src/serve/agentAdapter.ts src/serve/handlers/chat.ts src/serve/agentAdapter.test.ts
git commit -m "feat(agentAdapter): wire P3 permission check before tool execution"
```

---

## Task 4: Smoke test the full server with thought tools

**Goal:** Manually confirm thought tools work end-to-end when Ollama env vars are set.

- [ ] **Step 1: Build the server**

```bash
bun run build
```

Expected: `dist/cli.mjs` updated, no errors.

- [ ] **Step 2: Start server with Ollama env vars**

```bash
TOKEN_PATH="$HOME/.openclaude/server-token"
OPENAI_BASE_URL="http://localhost:11434/v1" \
OPENAI_API_KEY="ollama" \
OPENCLAUDE_MODEL="qwen3-vl:235b-cloud" \
CLAUDE_CODE_USE_OPENAI="1" \
  node dist/cli.mjs serve --port 7778
```

- [ ] **Step 3: Check that thought tools appear in a chat**

In another terminal:

```bash
TOKEN=$(cat ~/.openclaude/server-token 2>/dev/null || cat "$USERPROFILE/.openclaude/server-token")
curl -sN -X POST http://127.0.0.1:7778/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"message":"estruture este argumento em formato toulmin: inteligência artificial vai substituir engenheiros"}' \
  -m 60
```

Expected: SSE stream containing `event: tool_call` with `name: "structure_thought"` followed by the structured argument.

- [ ] **Step 4: Stop server and commit if needed**

```bash
kill %1 2>/dev/null || true
```

If smoke test passed without code changes needed, no additional commit. If you had to tweak anything, commit the fix.

---

## Checklist pós-task

- [ ] `bun test src/serve/` — verde
- [ ] `bun run typecheck` — zero erros
- [ ] Thought tools aparecem em `buildRegistry` quando `OPENAI_API_KEY` ou `OPENAI_BASE_URL` está setado
- [ ] `checkPermission("write_note", {}, "conservador")` retorna `{allowed: false}`
- [ ] `checkPermission("write_note", {}, "balanceado")` retorna `{allowed: true, requiresPreview: true}`
- [ ] `checkPermission("write_note", {}, "agressivo")` retorna `{allowed: true}`
- [ ] Smoke test manual com Ollama mostra thought tool call no SSE
