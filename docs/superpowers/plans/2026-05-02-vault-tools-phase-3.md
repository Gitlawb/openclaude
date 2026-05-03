# Phase 3 — Vault Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `lightweightOpenAIAgent` (Groq/Ollama path) four vault tools — `list_vault`, `read_note`, `search_vault`, and `write_note` — so the agent can navigate, read, and propose changes to the user's Obsidian vault during a chat session.

**Architecture:** Convert `lightweightOpenAIAgent` from a single-pass SSE reader into an OpenAI function-calling agentic loop (max 5 turns): model streams a response; if `finish_reason` is `"tool_calls"`, run the requested tools locally on the server filesystem, inject results into the message history, and continue. For `write_note`, route through the existing `PendingEditStore` so the user gets a diff preview before anything is written. Extract shared vault filesystem utilities into a new `src/serve/vaultUtils.ts` module that both `tools.ts` and `agentAdapter.ts` can import from.

**Tech Stack:** OpenAI function-calling API (Groq-compatible streaming), Node.js `fs` sync APIs, existing `PendingEditStore`, `bun:test`

---

## Why T1 (active note content) is already done

`sidebar-view.ts` `getActiveContext()` already reads the first 200 lines of the active note and sends them as `activeNote` content (not just the file path):

```typescript
const lines = editor.getValue().split('\n').slice(0, 200).join('\n');
return { activeNote: lines, vault: basePath, selection };
```

`lightweightOpenAIAgent` already puts this in the user message as `[Active note: <content>]`. The agent can read the current note without any tool. The gap is browsing *other* notes, listing the vault, and writing.

---

## File Map

| Action  | Path                                    | Responsibility                                                          |
|---------|-----------------------------------------|-------------------------------------------------------------------------|
| Create  | `src/serve/vaultUtils.ts`               | Exported `walk()`, `searchVault()`, `readNote()` shared utilities       |
| Modify  | `src/serve/handlers/tools.ts`           | Import from `vaultUtils` instead of local private definitions           |
| Modify  | `src/serve/agentAdapter.ts`             | Add tool definitions, agentic loop, `write_note` support                |
| Modify  | `src/serve/index.ts`                    | Pass `PendingEditStore` instance to `createRealAgent()`                 |

---

## Task 1: Extract vault utilities to `vaultUtils.ts`

**Files:**
- Create: `src/serve/vaultUtils.ts`
- Modify: `src/serve/handlers/tools.ts` (replace private `walk`, `searchVault` with imports)

- [ ] **Step 1: Write the failing test**

Create `src/serve/vaultUtils.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "bun:test";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { walk, searchVault, readNote } from "./vaultUtils";

let vault: string;
beforeAll(() => {
  vault = mkdtempSync(join(tmpdir(), "oc-vault-"));
  mkdirSync(join(vault, "Projects"), { recursive: true });
  writeFileSync(join(vault, "index.md"), "# Index\n[[Projects/Alpha]]");
  writeFileSync(join(vault, "Projects", "Alpha.md"), "# Alpha\nBudget: 100k\nStatus: active");
  writeFileSync(join(vault, "Projects", "Beta.md"), "# Beta\nBudget: 50k\nStatus: planning");
});

describe("walk", () => {
  it("returns all .md files recursively", () => {
    const files = walk(vault);
    expect(files).toHaveLength(3);
    expect(files.every(f => f.endsWith(".md"))).toBe(true);
  });

  it("skips hidden directories", () => {
    const files = walk(vault);
    expect(files.some(f => f.includes(".obsidian"))).toBe(false);
  });
});

describe("searchVault", () => {
  it("returns hits with snippet and line number", () => {
    const hits = searchVault(vault, "budget", 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toHaveProperty("snippet");
    expect(hits[0]).toHaveProperty("line");
  });

  it("respects max results", () => {
    const hits = searchVault(vault, "status", 1);
    expect(hits).toHaveLength(1);
  });

  it("is case-insensitive", () => {
    const hits = searchVault(vault, "ALPHA", 10);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("readNote", () => {
  it("reads a note by relative path", () => {
    const content = readNote(vault, "index.md");
    expect(content).toContain("# Index");
  });

  it("returns null for non-existent note", () => {
    expect(readNote(vault, "does-not-exist.md")).toBeNull();
  });

  it("rejects path traversal", () => {
    expect(readNote(vault, "../../etc/passwd")).toBeNull();
  });

  it("reads nested note", () => {
    const content = readNote(vault, "Projects/Alpha.md");
    expect(content).toContain("Budget: 100k");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test src/serve/vaultUtils.test.ts
```

Expected: `Cannot find module './vaultUtils'`

- [ ] **Step 3: Create `src/serve/vaultUtils.ts`**

```typescript
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";

export interface SearchHit {
  file: string;
  vault: string;
  snippet: string;
  line: number;
}

/** Recursively collect all .md files under root (skips hidden dirs/files). */
export function walk(root: string, out: string[] = []): string[] {
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(root, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** Full-text search across all .md files in vault. Returns up to max hits. */
export function searchVault(vault: string, query: string, max: number): SearchHit[] {
  const needle = query.toLowerCase();
  const out: SearchHit[] = [];
  for (const f of walk(vault)) {
    const content = readFileSync(f, "utf8");
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.toLowerCase().includes(needle)) {
        out.push({ file: f, vault, snippet: lines[i]!.slice(0, 200), line: i + 1 });
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

/**
 * Read a note by path relative to the vault root.
 * Returns null if not found or if path tries to escape the vault.
 */
export function readNote(vault: string, relPath: string): string | null {
  try {
    const vaultAbs = resolve(vault);
    const abs = resolve(vaultAbs, relPath);
    // Prevent path traversal
    if (abs !== vaultAbs && !abs.startsWith(vaultAbs + "/") && !abs.startsWith(vaultAbs + "\\")) {
      return null;
    }
    if (!existsSync(abs)) return null;
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

/** Return a note path relative to the vault root. */
export function vaultRelative(vault: string, abs: string): string {
  return relative(resolve(vault), abs);
}
```

- [ ] **Step 4: Update `src/serve/handlers/tools.ts` — replace private definitions with imports**

The file currently defines private `walk()`, `SearchHit`, and `searchVault()` on lines 7–33.
Replace the entire top of the file (imports block through line 43) with:

```typescript
import type { Route } from "../http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ServerError, ErrorCode } from "../errors";
import { getActiveAgent, type AgentFn } from "./chat";
import { walk, searchVault, type SearchHit } from "../vaultUtils";

function extractWikilinks(content: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(content)) !== null) out.push(m[1]!.trim());
  return out;
}

function slugId(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "_");
}

async function runAgentToString(agent: AgentFn, message: string): Promise<string> {
  const pieces: string[] = [];
  for await (const ev of agent({ message, sessionId: "internal", context: {} })) {
    if (ev.event === "token") pieces.push((ev.data as { text: string }).text);
  }
  return pieces.join("");
}
```

Everything from `export const toolsRoutes` onward stays unchanged.

- [ ] **Step 5: Run tests**

```bash
bun test src/serve/vaultUtils.test.ts
bun test src/serve/handlers/tools.search.test.ts
bun test src/serve/handlers/tools.dataview.test.ts
bun test src/serve/handlers/tools.mermaid.test.ts
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/serve/vaultUtils.ts src/serve/vaultUtils.test.ts src/serve/handlers/tools.ts
git commit -m "refactor: extract vault utils to vaultUtils.ts (shared by tools.ts and agentAdapter)"
```

---

## Task 2: Add OpenAI tool-calling agentic loop (read tools)

**Files:**
- Modify: `src/serve/agentAdapter.ts`

The key redesign: `lightweightOpenAIAgent` becomes an agentic loop that sends requests, processes tool_call deltas, runs tools locally, and continues until `finish_reason: "stop"` or max turns.

- [ ] **Step 1: Write the failing test**

Add to `src/serve/agentAdapter.test.ts` (after existing imports):

```typescript
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("agentAdapter — vault tools (mocked provider)", () => {
  let vault: string;
  let mockServer: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    vault = mkdtempSync(join(tmpdir(), "oc-vault-test-"));
    mkdirSync(join(vault, "Projects"), { recursive: true });
    writeFileSync(join(vault, "index.md"), "# Index\nWelcome to the vault.");
    writeFileSync(join(vault, "Projects", "Alpha.md"), "# Alpha\nBudget: 100k");
  });

  beforeEach(async () => {
    // Minimal OpenAI-compatible mock that returns a normal stop
    mockServer = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          [
            `data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}`,
            `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}`,
            `data: [DONE]`,
            "",
          ].join("\n\n"),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    });
    process.env.CLAUDE_CODE_USE_OPENAI = "1";
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${mockServer.port}`;
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENCLAUDE_MODEL = "test-model";
  });

  afterEach(async () => {
    await mockServer.stop();
    delete process.env.CLAUDE_CODE_USE_OPENAI;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENCLAUDE_MODEL;
  });

  it("yields token events from mock provider", async () => {
    const agent = createRealAgent();
    const events = await drainEvents(
      agent({ message: "hello", sessionId: "s1", context: { vault } }),
    );
    const tokens = events.filter(e => e.event === "token");
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("yields done event with finishReason stop", async () => {
    const agent = createRealAgent();
    const events = await drainEvents(
      agent({ message: "hello", sessionId: "s2", context: { vault } }),
    );
    const done = events.find(e => e.event === "done");
    expect(done).toBeDefined();
    expect((done!.data as any).finishReason).toBe("stop");
  });
});
```

- [ ] **Step 2: Run to confirm the new tests need the mock server**

```bash
bun test src/serve/agentAdapter.test.ts
```

Expected: existing tests PASS; new mock-server tests may skip/fail if `Bun.serve` is unavailable at test scope — note for Step 4.

- [ ] **Step 3: Add vault tool types and the agentic loop to `src/serve/agentAdapter.ts`**

**3a. Add these imports after the existing `homedir` import:**

```typescript
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { walk, searchVault, readNote, vaultRelative } from "./vaultUtils";
import type { PendingEditStore, PendingEdit } from "./pendingEditStore";
```

**3b. Insert the tool definitions constant before `lightweightOpenAIAgent`:**

```typescript
// ─── OpenAI function-calling tool definitions ──────────────────────────────

const VAULT_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_vault",
      description:
        "List all markdown notes in the vault. Returns a JSON array of file paths relative to the vault root. Use to discover what notes exist before reading them.",
      parameters: {
        type: "object",
        properties: {
          subdir: {
            type: "string",
            description:
              "Optional subdirectory to list (relative to vault root). Omit to list the entire vault.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_note",
      description:
        "Read the full content of a note by its relative path. Use paths returned by list_vault.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Path to the note relative to the vault root (e.g. 'Projects/Alpha.md').",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_vault",
      description:
        "Full-text search across all notes in the vault. Returns matching lines with file, line number, and snippet. Case-insensitive.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search term (case-insensitive substring match).",
          },
          maxResults: {
            type: "number",
            description: "Maximum results to return (default 10, max 20).",
          },
        },
        required: ["query"],
      },
    },
  },
];

// ─── Internal types for the agentic loop ───────────────────────────────────

interface OAIToolCallAccum {
  id: string;
  name: string;
  argsBuffer: string;
}

interface OAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface VaultToolResult {
  ok: boolean;
  content: string;
  preview?: string;
}

type OAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

// ─── Vault tool runner ─────────────────────────────────────────────────────

function runVaultTool(
  name: string,
  args: Record<string, unknown>,
  vault: string,
): VaultToolResult {
  switch (name) {
    case "list_vault": {
      const subdir = typeof args.subdir === "string" && args.subdir ? args.subdir : "";
      const root = subdir ? join(vault, subdir) : vault;
      if (!existsSync(root)) {
        return { ok: false, content: `Directory not found: ${subdir || vault}` };
      }
      const files = walk(root).map(f => vaultRelative(vault, f));
      return { ok: true, content: JSON.stringify(files), preview: `${files.length} notes` };
    }
    case "read_note": {
      const path = String(args.path ?? "");
      const content = readNote(vault, path);
      if (content === null) {
        return { ok: false, content: `Note not found or path invalid: ${path}` };
      }
      const truncated = content.length > 10_000;
      return {
        ok: true,
        content: truncated ? content.slice(0, 10_000) + "\n…[truncated]" : content,
        preview: `${content.length} chars`,
      };
    }
    case "search_vault": {
      const query = String(args.query ?? "");
      if (!query) return { ok: false, content: "query is required" };
      const max = Math.min(Number(args.maxResults ?? 10), 20);
      const hits = searchVault(vault, query, max).map(h => ({
        ...h,
        file: vaultRelative(vault, h.file),
      }));
      return {
        ok: true,
        content: JSON.stringify(hits),
        preview: `${hits.length} matches for "${query}"`,
      };
    }
    default:
      return { ok: false, content: `Unknown tool: ${name}` };
  }
}
```

**3c. Replace the `lightweightOpenAIAgent` function body (keep the signature the same for now — `pendingEditStore` added in Task 3):**

```typescript
const MAX_AGENT_TURNS = 5;

async function* lightweightOpenAIAgent(
  message: string,
  sessionId: string,
  context?: { activeNote?: string; vault?: string; selection?: string },
): AsyncIterable<AgentEvent> {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey  = process.env.OPENAI_API_KEY ?? "";
  const model   = process.env.OPENCLAUDE_MODEL ?? "gpt-4o-mini";
  const vault   = context?.vault;

  const vaultLine = vault
    ? `You are an AI assistant inside the Obsidian vault at: ${vault}.`
    : "You are a helpful AI assistant inside Obsidian.";
  const toolsHint = vault
    ? " You have tools to list, read, and search vault notes — use them proactively when the user asks about vault contents."
    : "";
  const systemPrompt = `${vaultLine}${toolsHint} Answer concisely and helpfully in the same language as the user.`;

  const contextLines: string[] = [];
  if (context?.vault)       contextLines.push(`[Vault: ${context.vault}]`);
  if (context?.activeNote)  contextLines.push(`[Active note:\n${context.activeNote}]`);
  if (context?.selection)   contextLines.push(`[Selection:\n${context.selection}]`);
  const userContent = contextLines.length > 0
    ? `${contextLines.join("\n")}\n\n${message}`
    : message;

  const tools = vault ? VAULT_TOOLS : undefined;

  const messages: OAIMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user",   content: userContent  },
  ];

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const body = JSON.stringify({
      model,
      stream: true,
      messages,
      ...(tools ? { tools } : {}),
    });

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => String(res.status));
      yield { event: "error", data: { code: String(res.status), message: errText } };
      yield { event: "done",  data: { sessionId, finishReason: "error" } };
      return;
    }

    // ── Stream SSE, accumulate tool-call deltas ─────────────────────────────
    const decoder     = new TextDecoder();
    const reader      = res.body.getReader();
    let   buffer      = "";
    let   finishReason: string | null = null;
    const toolCallMap = new Map<number, OAIToolCallAccum>();
    const assistantText: string[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") break;

          try {
            const chunk  = JSON.parse(data);
            const choice = chunk.choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) finishReason = choice.finish_reason;

            const delta = choice.delta;
            if (delta?.content) {
              assistantText.push(delta.content);
              yield { event: "token", data: { text: delta.content } };
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls as Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>) {
                if (!toolCallMap.has(tc.index)) {
                  toolCallMap.set(tc.index, { id: "", name: "", argsBuffer: "" });
                }
                const entry = toolCallMap.get(tc.index)!;
                if (tc.id)                  entry.id         = tc.id;
                if (tc.function?.name)      entry.name       = tc.function.name;
                if (tc.function?.arguments) entry.argsBuffer += tc.function.arguments;
              }
            }
          } catch {
            // Malformed chunk — skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Assemble complete tool calls from accumulated deltas
    const toolCalls: OAIToolCall[] = [...toolCallMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, tc]) => ({
        id:       tc.id,
        type:     "function" as const,
        function: { name: tc.name, arguments: tc.argsBuffer },
      }));

    if (finishReason !== "tool_calls" || toolCalls.length === 0) {
      yield { event: "done", data: { sessionId, finishReason: finishReason ?? "stop" } };
      return;
    }

    // ── Model requested tools — run them and inject results ─────────────────
    messages.push({
      role:       "assistant",
      content:    assistantText.join("") || null,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* bad JSON */ }

      yield {
        event: "tool_call",
        data:  { id: tc.id, name: tc.function.name, args },
      };

      const result = vault
        ? runVaultTool(tc.function.name, args, vault)
        : { ok: false, content: "No vault available for tool calls", preview: undefined };

      yield {
        event: "tool_result",
        data:  { id: tc.id, ok: result.ok, preview: result.preview },
      };

      messages.push({
        role:         "tool",
        tool_call_id: tc.id,
        content:      result.content,
      });
    }
    // Continue agentic loop with updated history
  }

  yield { event: "done", data: { sessionId, finishReason: "max_turns" } };
}
```

- [ ] **Step 4: Run tests**

```bash
bun test src/serve/agentAdapter.test.ts
bun test src/serve/vaultUtils.test.ts
```

Expected: all PASS (existing tests unaffected; new mock-server tests pass if Bun.serve is available).

- [ ] **Step 5: Commit**

```bash
git add src/serve/agentAdapter.ts
git commit -m "feat: add OpenAI function-calling agentic loop to lightweightOpenAIAgent (list_vault, read_note, search_vault)"
```

---

## Task 3: Add `write_note` tool and wire `PendingEditStore` through

**Files:**
- Modify: `src/serve/agentAdapter.ts`
- Modify: `src/serve/index.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/serve/agentAdapter.test.ts`:

```typescript
import { PendingEditStore } from "./pendingEditStore";

describe("agentAdapter — write_note config", () => {
  it("createRealAgent accepts pendingEditStore option without throwing", () => {
    const store = new PendingEditStore(tmpdir());
    expect(() => createRealAgent({ pendingEditStore: store })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test src/serve/agentAdapter.test.ts --test-name-pattern "write_note"
```

Expected: FAIL — `pendingEditStore` is not a valid key in `RealAgentOpts`.

- [ ] **Step 3: Extend `RealAgentOpts` and add `write_note` tool in `agentAdapter.ts`**

**3a. Extend `RealAgentOpts` (already imported `PendingEditStore` in Task 2):**

```typescript
export type RealAgentOpts = {
  strictMode?: boolean;
  pendingEditStore?: PendingEditStore;
};
```

**3b. Add `write_note` as the 4th entry in `VAULT_TOOLS` (the array now needs to drop `as const` to stay mutable):**

```typescript
  {
    type: "function",
    function: {
      name: "write_note",
      description:
        "Propose creating or updating a note. The change is queued for user review — nothing is written until the user clicks Apply in the diff preview. Always use this for any note creation or modification.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Destination path relative to vault root (e.g. 'Projects/NewNote.md'). Creates the note if it does not exist.",
          },
          content: {
            type: "string",
            description: "Full new content for the note (markdown).",
          },
          reason: {
            type: "string",
            description: "Short explanation of why this change is being made (shown to user in diff preview).",
          },
        },
        required: ["path", "content", "reason"],
      },
    },
  },
```

**3c. Add `PendingEditResult` to the result type and a new `write_note` case in `runVaultTool`:**

```typescript
interface VaultToolResult {
  ok: boolean;
  content: string;
  preview?: string;
  // Populated only by write_note
  pendingEdit?: { id: string; file: string; reason: string };
}

// Update runVaultTool signature to accept optional store:
function runVaultTool(
  name: string,
  args: Record<string, unknown>,
  vault: string,
  pendingEditStore?: PendingEditStore,
  sessionId?: string,
): VaultToolResult {
  switch (name) {
    // ... existing cases unchanged ...

    case "write_note": {
      if (!pendingEditStore) {
        return {
          ok: false,
          content: "write_note requires a pending edit store. Make sure the server started with a store configured.",
        };
      }
      const path    = String(args.path ?? "");
      const content = String(args.content ?? "");
      const reason  = String(args.reason ?? "Agent-proposed change");
      if (!path) return { ok: false, content: "path is required" };

      const vaultAbs = resolve(vault);
      const abs      = resolve(vaultAbs, path);
      // Block path traversal
      if (abs !== vaultAbs && !abs.startsWith(vaultAbs + "/") && !abs.startsWith(vaultAbs + "\\")) {
        return { ok: false, content: "Path traversal rejected" };
      }

      const before = readNote(vault, path) ?? "";
      const edit   = pendingEditStore.create({
        file: abs, vault, sessionId: sessionId ?? "unknown", reason, before, after: content,
      });

      return {
        ok:          true,
        content:     `Pending edit created (id: ${edit.id}). The user will be prompted to review and apply the change.`,
        preview:     `pending edit for ${path}`,
        pendingEdit: { id: edit.id, file: abs, reason },
      };
    }

    default:
      return { ok: false, content: `Unknown tool: ${name}` };
  }
}
```

**3d. Thread `pendingEditStore` into `lightweightOpenAIAgent`:**

Update signature:

```typescript
async function* lightweightOpenAIAgent(
  message: string,
  sessionId: string,
  context?: { activeNote?: string; vault?: string; selection?: string },
  pendingEditStore?: PendingEditStore,
): AsyncIterable<AgentEvent>
```

Update the `runVaultTool` call site:

```typescript
const result = vault
  ? runVaultTool(tc.function.name, args, vault, pendingEditStore, sessionId)
  : { ok: false, content: "No vault available for tool calls" };
```

After the `tool_result` yield, add the `pending_edit` event:

```typescript
yield {
  event: "tool_result",
  data:  { id: tc.id, ok: result.ok, preview: result.preview },
};

if (result.pendingEdit) {
  yield {
    event: "pending_edit",
    data:  {
      id:     result.pendingEdit.id,
      file:   result.pendingEdit.file,
      reason: result.pendingEdit.reason,
    },
  };
}
```

**3e. Update `createRealAgent` to read `pendingEditStore` from opts and forward it:**

```typescript
export function createRealAgent(_opts: RealAgentOpts = {}): AgentFn {
  let appState: AppState = getDefaultAppState();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let messages: any[] = [];
  const readFileCache = createFileStateCacheWithSizeLimit(100);
  const { pendingEditStore } = _opts;

  return async function* (input): AsyncIterable<AgentEvent> {
    try {
      if (process.env.CLAUDE_CODE_USE_OPENAI) {
        yield* lightweightOpenAIAgent(
          input.message,
          input.sessionId,
          input.context,
          pendingEditStore,
        );
        return;
      }
      // ... Anthropic path unchanged ...
```

- [ ] **Step 4: Update `src/serve/index.ts` to pass `pe` to `createRealAgent()`**

In `startServer()`, after `const pe = new PendingEditStore(homedir())`:

```typescript
// Override with a store-aware agent for real server runs
// (The module-level call above has no store — write_note will be disabled there,
//  but tests only use setMockAgent so this is fine.)
setRealAgent(createRealAgent({ pendingEditStore: pe }));
```

- [ ] **Step 5: Run tests**

```bash
bun test src/serve/agentAdapter.test.ts
bun test src/serve/pendingEditStore.test.ts
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/serve/agentAdapter.ts src/serve/index.ts
git commit -m "feat: add write_note tool — routes through PendingEditStore for user-reviewed diff preview"
```

---

## Task 4: Full test suite + plugin rebuild + E2E

**Files:** no new code — verification only

- [ ] **Step 1: Run full server test suite**

```bash
bun test src/serve/
```

Expected: all PASS. Fix any failures before proceeding.

- [ ] **Step 2: Build the plugin**

```bash
cd E:\Agente_OpenClaude_Segundo_cérebro\.worktrees\plugin\plugin
bun run build
```

Expected: `dist/main.js` produced with no errors.

- [ ] **Step 3: Install plugin to vault**

```bash
node install.mjs "G:/Meu Drive/Estratégia Energinova 2026"
```

Expected: success message.

- [ ] **Step 4: Restart the server**

In a PowerShell terminal (kill any existing server first):

```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
cd "E:\Agente_OpenClaude_Segundo_cérebro"
node dist/cli.mjs serve --port 7777
```

Expected: `{"type":"server-started","url":"http://127.0.0.1:7777","port":7777,"token":"..."}`

- [ ] **Step 5: Disable and re-enable the OpenClaude plugin in Obsidian**

This reloads the new build and re-connects to the server.

- [ ] **Step 6: Manual E2E test in Obsidian**

Test each prompt in the sidebar:

| Prompt | Expected |
|--------|----------|
| `lista todas as pastas no vault` | `🔧 list_vault…` appears, then `✅ list_vault`, then reply with note list |
| `leia o arquivo index.md` | `🔧 read_note…` → `✅ read_note` → reply with content |
| `pesquise por "energinova" no vault` | `🔧 search_vault…` → `✅ search_vault` → reply with matches |
| `crie uma nota chamada Teste/Nota.md com o texto "# Teste\nNota criada pelo agente."` | `🔧 write_note…` → `✅ write_note` → Apply/Reject buttons appear in chat |

For the `write_note` test: clicking Apply should open `DiffPreviewModal` with before (empty) and after (new content); clicking Confirm in the modal writes the file.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "test: phase 3 vault tools verified E2E in Obsidian"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|-------------|------|
| Active note content in context | Already done (sidebar-view.ts) — no task needed |
| `list_vault` tool | Task 2 |
| `read_note` tool | Task 2 |
| `search_vault` tool | Task 2 |
| `write_note` → pending edit → DiffPreviewModal | Task 3 |
| Shared vault utils (DRY — remove duplication) | Task 1 |
| `PendingEditStore` wired through to agent | Task 3 |
| Full tests pass | Task 4 |
| Plugin rebuilt and installed | Task 4 |

### Type consistency

- `OAIToolCallAccum.{id, name, argsBuffer}` — accumulated per-index in the streaming loop; assembled into `OAIToolCall[]`
- `VaultToolResult.{ok, content, preview?, pendingEdit?}` — returned by `runVaultTool`, consumed in the loop
- `runVaultTool(name, args, vault, pendingEditStore?, sessionId?)` — consistent at definition and call site
- `PendingEditStore` imported as `type` in `agentAdapter.ts` → updated to a value import when `pendingEditStore.create()` is called
- `vaultRelative(vault, abs)` exported from `vaultUtils.ts` and imported in `agentAdapter.ts`
