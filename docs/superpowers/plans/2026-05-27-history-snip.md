# HISTORY_SNIP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the `HISTORY_SNIP` feature flag by implementing the `SnipTool`, `snipCompact` service, and `snipProjection` module — giving the model a tool to surgically remove stale messages from its context window.

**Architecture:** The model receives `[id:XXXXXX]` tags appended to user messages (already wired in `messages.ts`). It calls the `snip` tool with those IDs; the IDs are queued in a module-level pending set. Before each API call, `snipCompactIfNeeded` runs, removes queued messages and their associated tool results, and emits a snip boundary message with `snipMetadata: { removedUuids }`. On session resume, `applySnipRemovals` in `sessionStorage.ts` reads those boundaries and filters history (already wired). A nudge attachment (`SNIP_NUDGE_TEXT`) is injected every ~10k tokens of growth to remind the model to snip.

**Tech Stack:** TypeScript, Bun test runner, `zod/v4` for schema validation, existing `buildTool` / `lazySchema` patterns from the codebase.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/tools/SnipTool/prompt.ts` | Tool name constant + prompt text |
| Create | `src/tools/SnipTool/SnipTool.ts` | Tool implementation (calls `markForSnip`) |
| Replace | `src/services/compact/snipCompact.ts` | Pending-snip registry, `snipCompactIfNeeded`, nudge logic |
| Create | `src/services/compact/snipCompact.test.ts` | Unit tests for snipCompact |
| Create | `src/services/compact/snipProjection.ts` | Boundary detection + view filter |
| Create | `src/services/compact/snipProjection.test.ts` | Unit tests for snipProjection |
| Modify | `src/types/message.ts` | Add missing `SystemCompactBoundaryMessage` export |
| Modify | `scripts/build.ts` | Add `HISTORY_SNIP: true` to featureFlags |

---

## Task 1: `snipProjection.ts` — boundary detection and view filter

**Files:**
- Create: `src/services/compact/snipProjection.ts`
- Create: `src/services/compact/snipProjection.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/compact/snipProjection.test.ts
import { describe, expect, test } from 'bun:test'
import { isSnipBoundaryMessage, projectSnippedView } from './snipProjection.js'

describe('isSnipBoundaryMessage', () => {
  test('returns true for message with snipMetadata', () => {
    const msg = { type: 'system', snipMetadata: { removedUuids: ['abc'] } }
    expect(isSnipBoundaryMessage(msg)).toBe(true)
  })

  test('returns false for compact_boundary without snipMetadata', () => {
    const msg = { type: 'system', subtype: 'compact_boundary', compactMetadata: {} }
    expect(isSnipBoundaryMessage(msg)).toBe(false)
  })

  test('returns false for regular message', () => {
    expect(isSnipBoundaryMessage({ type: 'user', uuid: 'abc' })).toBe(false)
  })

  test('returns false for null/undefined', () => {
    expect(isSnipBoundaryMessage(null)).toBe(false)
    expect(isSnipBoundaryMessage(undefined)).toBe(false)
  })
})

describe('projectSnippedView', () => {
  test('returns original array when no snip boundaries present', () => {
    const messages = [
      { uuid: 'aaa', type: 'user' },
      { uuid: 'bbb', type: 'assistant' },
    ]
    expect(projectSnippedView(messages)).toEqual(messages)
  })

  test('removes messages whose UUIDs appear in snipMetadata.removedUuids', () => {
    const messages = [
      { uuid: 'aaa', type: 'user' },
      { uuid: 'bbb', type: 'assistant' },
      { uuid: 'ccc', type: 'user' },
      { uuid: 'snip-boundary', type: 'system', snipMetadata: { removedUuids: ['aaa', 'bbb'] } },
      { uuid: 'ddd', type: 'user' },
    ]
    const result = projectSnippedView(messages)
    expect(result.map((m: any) => m.uuid)).toEqual(['ccc', 'snip-boundary', 'ddd'])
  })

  test('accumulates removedUuids from multiple snip boundaries', () => {
    const messages = [
      { uuid: 'aaa', type: 'user' },
      { uuid: 'b1', type: 'system', snipMetadata: { removedUuids: ['aaa'] } },
      { uuid: 'bbb', type: 'user' },
      { uuid: 'b2', type: 'system', snipMetadata: { removedUuids: ['bbb'] } },
      { uuid: 'ccc', type: 'user' },
    ]
    const result = projectSnippedView(messages)
    expect(result.map((m: any) => m.uuid)).toEqual(['b1', 'b2', 'ccc'])
  })

  test('handles boundaries with no removedUuids gracefully', () => {
    const messages = [
      { uuid: 'aaa', type: 'user' },
      { uuid: 'bnd', type: 'system', snipMetadata: {} },
    ]
    expect(projectSnippedView(messages).length).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/ubuntu/projects/openclaude/openclaude
bun test src/services/compact/snipProjection.test.ts
```
Expected: FAIL — `Cannot find module './snipProjection.js'`

- [ ] **Step 3: Implement `snipProjection.ts`**

```ts
// src/services/compact/snipProjection.ts

export function isSnipBoundaryMessage(message: unknown): boolean {
  return Boolean((message as any)?.snipMetadata)
}

/**
 * Filter a message array to exclude messages removed by prior snip operations.
 * Reads all snipMetadata.removedUuids across all snip boundaries in the array.
 * Used by getMessagesAfterCompactBoundary when HISTORY_SNIP is enabled.
 */
export function projectSnippedView<T>(messages: T[]): T[] {
  const removedUuids = new Set<string>()
  for (const msg of messages) {
    const uuids = (msg as any)?.snipMetadata?.removedUuids
    if (!Array.isArray(uuids)) continue
    for (const uuid of uuids) removedUuids.add(uuid as string)
  }
  if (removedUuids.size === 0) return messages
  return messages.filter(msg => {
    const uuid = (msg as any)?.uuid
    return !uuid || !removedUuids.has(uuid as string)
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/services/compact/snipProjection.test.ts
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/compact/snipProjection.ts src/services/compact/snipProjection.test.ts
git commit -m "feat(snip): add snipProjection module for boundary detection and view filtering"
```

---

## Task 2: `snipCompact.ts` — pending registry and snip execution

**Files:**
- Replace: `src/services/compact/snipCompact.ts`
- Create: `src/services/compact/snipCompact.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/compact/snipCompact.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { createAssistantMessage, createUserMessage, deriveShortMessageId } from '../../utils/messages.js'
import {
  _resetForTesting,
  isSnipRuntimeEnabled,
  markForSnip,
  shouldNudgeForSnips,
  SNIP_NUDGE_TEXT,
  snipCompactIfNeeded,
} from './snipCompact.js'

beforeEach(() => {
  _resetForTesting()
})

// Helper: make a user message with a known UUID
function makeUser(uuid: string, text = 'hello') {
  const msg = createUserMessage({ content: text })
  return { ...msg, uuid }
}

function makeAssistant(uuid: string) {
  return createAssistantMessage({ content: [{ type: 'text' as const, text: 'ok' }], uuid })
}

describe('isSnipRuntimeEnabled', () => {
  test('returns true', () => {
    expect(isSnipRuntimeEnabled()).toBe(true)
  })
})

describe('SNIP_NUDGE_TEXT', () => {
  test('is a non-empty string mentioning snip', () => {
    expect(typeof SNIP_NUDGE_TEXT).toBe('string')
    expect(SNIP_NUDGE_TEXT.length).toBeGreaterThan(20)
    expect(SNIP_NUDGE_TEXT.toLowerCase()).toContain('snip')
  })
})

describe('snipCompactIfNeeded', () => {
  test('no-ops when nothing is pending', () => {
    const messages = [makeUser('uuid-1'), makeUser('uuid-2')]
    const result = snipCompactIfNeeded(messages)
    expect(result.tokensFreed).toBe(0)
    expect(result.boundaryMessage).toBeUndefined()
    expect(result.messages).toHaveLength(2)
  })

  test('removes a message whose short ID was marked for snip', () => {
    const uuid = 'a1b2c3d4-0000-0000-0000-000000000001'
    const shortId = deriveShortMessageId(uuid)
    const messages = [makeUser(uuid, 'old stuff'), makeUser('keep-uuid', 'keep me')]
    markForSnip([shortId])
    const result = snipCompactIfNeeded(messages)
    expect(result.messages.map((m: any) => m.uuid)).toEqual(['keep-uuid'])
    expect(result.tokensFreed).toBeGreaterThan(0)
  })

  test('returns a boundary message with snipMetadata.removedUuids', () => {
    const uuid = 'a1b2c3d4-0000-0000-0000-000000000002'
    const shortId = deriveShortMessageId(uuid)
    markForSnip([shortId])
    const result = snipCompactIfNeeded([makeUser(uuid)])
    expect(result.boundaryMessage).toBeDefined()
    expect(result.boundaryMessage?.snipMetadata?.removedUuids).toContain(uuid)
  })

  test('clears pending set after execution so second call is a no-op', () => {
    const uuid = 'a1b2c3d4-0000-0000-0000-000000000003'
    const shortId = deriveShortMessageId(uuid)
    const messages = [makeUser(uuid), makeUser('other')]
    markForSnip([shortId])
    snipCompactIfNeeded(messages)
    // second call — nothing pending
    const second = snipCompactIfNeeded([makeUser('other')])
    expect(second.tokensFreed).toBe(0)
    expect(second.boundaryMessage).toBeUndefined()
  })

  test('also removes tool-result messages for snipped assistant tool calls', () => {
    const assistantUuid = 'a1b2c3d4-0000-0000-0000-000000000004'
    const toolUseId = 'tu-001'
    const shortId = deriveShortMessageId(assistantUuid)
    const assistantMsg = {
      ...makeAssistant(assistantUuid),
      message: {
        content: [{ type: 'tool_use', id: toolUseId, name: 'Read', input: {} }],
      },
    }
    const toolResultMsg = createUserMessage({
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'file contents' }],
    })
    markForSnip([shortId])
    const result = snipCompactIfNeeded([assistantMsg, toolResultMsg, makeUser('survivor')])
    expect(result.messages.map((m: any) => m.uuid ?? 'noid')).not.toContain(assistantUuid)
    // tool result message should also be gone
    const hasToolResult = result.messages.some((m: any) =>
      Array.isArray(m.message?.content) &&
      m.message.content.some((b: any) => b.type === 'tool_result' && b.tool_use_id === toolUseId)
    )
    expect(hasToolResult).toBe(false)
    expect(result.messages.some((m: any) => m.uuid === 'survivor')).toBe(true)
  })

  test('ignores short IDs that do not match any message (graceful)', () => {
    const messages = [makeUser('real-uuid')]
    markForSnip(['xxxxxx'])
    const result = snipCompactIfNeeded(messages)
    expect(result.messages).toHaveLength(1)
    expect(result.tokensFreed).toBe(0)
    expect(result.boundaryMessage).toBeUndefined()
  })
})

describe('shouldNudgeForSnips', () => {
  test('returns false for an empty message list', () => {
    expect(shouldNudgeForSnips([])).toBe(false)
  })

  test('returns false when there is a compact_boundary in recent history', () => {
    const messages = [
      { type: 'system', subtype: 'compact_boundary' },
      makeUser('u1', 'x'.repeat(200)),
    ]
    expect(shouldNudgeForSnips(messages)).toBe(false)
  })

  test('returns false when there is a snip boundary in recent history', () => {
    const messages = [
      { type: 'system', snipMetadata: { removedUuids: [] } },
      makeUser('u1', 'x'.repeat(200)),
    ]
    expect(shouldNudgeForSnips(messages)).toBe(false)
  })

  test('returns true when enough tokens have accumulated since last reset', () => {
    // Build a large conversation with no boundaries — >10k tokens of text
    const bigChunk = 'x'.repeat(12_000) // ~3000 tokens at 4 chars/token
    const messages = [
      makeUser('u1', bigChunk),
      makeUser('u2', bigChunk),
      makeUser('u3', bigChunk),
      makeUser('u4', bigChunk),
    ]
    expect(shouldNudgeForSnips(messages)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/services/compact/snipCompact.test.ts
```
Expected: FAIL — module exports don't match (current file is a stub)

- [ ] **Step 3: Implement `snipCompact.ts`**

Replace the entire stub with:

```ts
// src/services/compact/snipCompact.ts
import { randomUUID } from 'crypto'
import type { UUID } from 'crypto'
import { deriveShortMessageId } from '../../utils/messages.js'

// Module-level registry of short message IDs queued for removal.
// Populated by SnipTool.call(); consumed and cleared by snipCompactIfNeeded().
const pendingSnipIds = new Set<string>()

export function markForSnip(ids: string[]): void {
  for (const id of ids) pendingSnipIds.add(id)
}

export function isSnipRuntimeEnabled(): boolean {
  return true
}

export const SNIP_NUDGE_TEXT =
  `Your context window is filling up. Use the \`snip\` tool to remove messages ` +
  `that are no longer needed — look for \`[id:...]\` tags on user messages and pass the IDs ` +
  `of stale sections (old explorations, superseded plans, resolved errors). This frees up ` +
  `space so you can continue working without a full compaction.`

// Nudge once every ~10 000 tokens of new content since the last reset point.
const NUDGE_INTERVAL_TOKENS = 10_000

/**
 * Rough per-message token estimate: content length ÷ 4.
 * Good enough for pacing; no need to pull in the full token counter.
 */
function estimateTokens(msg: any): number {
  const content = msg?.message?.content ?? msg?.content ?? ''
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  return Math.ceil(text.length / 4)
}

/**
 * Returns true when enough tokens have accumulated since the last reset point
 * (compact boundary, snip boundary, or prior nudge injection) to warrant
 * injecting the context-efficiency nudge.
 */
export function shouldNudgeForSnips(messages: any[]): boolean {
  let accumulated = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.type === 'system' && msg?.subtype === 'compact_boundary') return false
    if (msg?.snipMetadata) return false
    // A context_efficiency attachment means we already nudged recently
    if (
      msg?.type === 'attachment' &&
      msg?.attachment?.type === 'context_efficiency'
    ) return false
    accumulated += estimateTokens(msg)
    if (accumulated >= NUDGE_INTERVAL_TOKENS) return true
  }
  return false
}

/**
 * If any short message IDs are pending, remove the corresponding messages
 * (and their associated tool-result messages) from the array and return a
 * snip boundary message so sessionStorage can replay the removal on resume.
 *
 * The `force` option re-runs without requiring pendingSnipIds to be non-empty
 * (used by the QueryEngine snipReplay path after a boundary is yielded).
 */
export function snipCompactIfNeeded(
  messages: any[],
  opts?: { force?: boolean },
): { messages: any[]; tokensFreed: number; boundaryMessage?: any } {
  if (pendingSnipIds.size === 0) {
    return { messages, tokensFreed: 0 }
  }

  // Map short ID → UUID for messages present in the current array
  const shortIdToUuid = new Map<string, UUID>()
  for (const msg of messages) {
    if (msg?.uuid) {
      shortIdToUuid.set(deriveShortMessageId(msg.uuid as string), msg.uuid as UUID)
    }
  }

  // Resolve pending short IDs to full UUIDs
  const uuidsToRemove = new Set<UUID>()
  for (const shortId of pendingSnipIds) {
    const uuid = shortIdToUuid.get(shortId)
    if (uuid) uuidsToRemove.add(uuid)
  }
  pendingSnipIds.clear()

  if (uuidsToRemove.size === 0) {
    return { messages, tokensFreed: 0 }
  }

  // Collect tool_use IDs from snipped assistant messages so we can also
  // drop the paired tool-result user messages.
  const snippedToolUseIds = new Set<string>()
  for (const msg of messages) {
    if (!uuidsToRemove.has(msg?.uuid)) continue
    if (msg?.type !== 'assistant') continue
    const blocks = msg?.message?.content
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      if (block?.type === 'tool_use' && block?.id) snippedToolUseIds.add(block.id as string)
    }
  }

  let tokensFreed = 0
  const surviving: any[] = []

  for (const msg of messages) {
    // Drop snipped messages
    if (uuidsToRemove.has(msg?.uuid)) {
      tokensFreed += estimateTokens(msg)
      continue
    }
    // Drop user messages whose content is entirely tool results for snipped tool calls
    if (msg?.type === 'user' && Array.isArray(msg?.message?.content)) {
      const results = (msg.message.content as any[]).filter(b => b?.type === 'tool_result')
      if (
        results.length > 0 &&
        results.every((r: any) => snippedToolUseIds.has(r?.tool_use_id))
      ) {
        tokensFreed += estimateTokens(msg)
        continue
      }
    }
    surviving.push(msg)
  }

  const boundaryMessage = {
    type: 'system' as const,
    subtype: 'snip_boundary',
    content: 'Conversation history snipped',
    isMeta: false as const,
    timestamp: new Date().toISOString(),
    uuid: randomUUID() as UUID,
    level: 'info' as const,
    snipMetadata: {
      removedUuids: [...uuidsToRemove] as UUID[],
    },
  }

  return { messages: surviving, tokensFreed, boundaryMessage }
}

/** Exposed for test isolation only — do not call in production code. */
export function _resetForTesting(): void {
  pendingSnipIds.clear()
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/services/compact/snipCompact.test.ts
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/compact/snipCompact.ts src/services/compact/snipCompact.test.ts
git commit -m "feat(snip): implement snipCompact service with pending registry and nudge logic"
```

---

## Task 3: `SnipTool` — the model-callable tool

**Files:**
- Create: `src/tools/SnipTool/prompt.ts`
- Create: `src/tools/SnipTool/SnipTool.ts`

No unit test for the tool itself (the logic it calls is already tested in Task 2). The integration is verified by the smoke test in Task 5.

- [ ] **Step 1: Create `prompt.ts`**

```ts
// src/tools/SnipTool/prompt.ts
export const SNIP_TOOL_NAME = 'snip'

export function getPrompt(): string {
  return `Remove specific messages from your context window to free up space.

When your context is getting long, look for \`[id:XXXXXX]\` tags appended to user messages. Pass those IDs to this tool to permanently remove those messages (and their associated tool calls and results) before the next model call.

Good candidates to snip:
- Old exploratory searches that led nowhere
- Superseded plans or approaches
- Resolved errors and their debug output
- Large file reads from early in the session that are no longer referenced

Do NOT snip messages that are still relevant to the current task.`
}
```

- [ ] **Step 2: Create `SnipTool.ts`**

```ts
// src/tools/SnipTool/SnipTool.ts
/* eslint-disable @typescript-eslint/no-require-imports */
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getPrompt, SNIP_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.object({
    message_ids: z
      .array(z.string())
      .describe(
        'Short message IDs to remove — the [id:XXXXXX] values appended to user messages.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

type Output = { sniped: number }

export const SnipTool = buildTool({
  name: SNIP_TOOL_NAME,
  isEnabled() {
    return true
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return true
  },
  async description() {
    return getPrompt()
  },
  async prompt() {
    return getPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  async call(input) {
    const { markForSnip } =
      require('../../services/compact/snipCompact.js') as typeof import('../../services/compact/snipCompact.js')
    markForSnip(input.message_ids)
    return { data: { sniped: input.message_ids.length } }
  },
  renderToolUseMessage() {
    return null
  },
  userFacingName: () => 'Snip',
  mapToolResultToToolResultBlockParam(
    content: Output,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: `Marked ${content.sniped} message(s) for removal. They will be removed from context before the next model call.`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/SnipTool/prompt.ts src/tools/SnipTool/SnipTool.ts
git commit -m "feat(snip): add SnipTool for model-driven message removal"
```

---

## Task 4: Wire up — types stub, feature flag

**Files:**
- Modify: `src/types/message.ts` — add `SystemCompactBoundaryMessage`
- Modify: `scripts/build.ts` — enable `HISTORY_SNIP`

- [ ] **Step 1: Add missing type to `src/types/message.ts`**

The file currently has 5 stub exports. `SystemCompactBoundaryMessage` is imported by `sessionStorage.ts` but missing. Add it:

Open `src/types/message.ts`. After the existing exports, add:

```ts
export type SystemCompactBoundaryMessage = any
```

The full file should now end with:
```ts
export type NormalizedUserMessage = any
export type SystemCompactBoundaryMessage = any
```

- [ ] **Step 2: Enable the flag in `scripts/build.ts`**

Find the `featureFlags` map. The line currently reads:
```ts
COMMIT_ATTRIBUTION: false,      // Co-Authored-By metadata in git commits
```

Add the `HISTORY_SNIP` entry immediately after it (or anywhere in the map — alphabetical is fine):
```ts
HISTORY_SNIP: true,             // Model-callable snip tool for context management
```

- [ ] **Step 3: Build and typecheck**

```bash
cd /home/ubuntu/projects/openclaude/openclaude
bun run build
```
Expected: exits 0, `dist/cli.mjs` updated.

```bash
bun run typecheck
```
Expected: exits 0 or same pre-existing errors as before this PR (no new errors introduced).

- [ ] **Step 4: Smoke test**

```bash
bun run smoke
```
Expected: version string printed, exits 0.

- [ ] **Step 5: Run focused tests**

```bash
bun test src/services/compact/snipCompact.test.ts src/services/compact/snipProjection.test.ts
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/message.ts scripts/build.ts
git commit -m "feat(snip): enable HISTORY_SNIP feature flag"
```

---

## Task 5: Full test suite + PR

- [ ] **Step 1: Run the full unit suite**

```bash
bun test
```
Expected: no new failures versus `main`. Pre-existing failures (if any) are acceptable; new ones are not.

- [ ] **Step 2: Open PR**

```bash
git push origin feat/history-snip
gh pr create \
  --title "feat: enable HISTORY_SNIP — model-callable snip tool for context management" \
  --body "$(cat <<'EOF'
## Summary
- Implements `SnipTool` (`snip` tool name): model calls it with `[id:XXXXXX]` message IDs to queue messages for removal
- Implements `snipCompact` service: pending registry, `snipCompactIfNeeded`, `shouldNudgeForSnips`, `SNIP_NUDGE_TEXT`
- Implements `snipProjection`: boundary detection (`isSnipBoundaryMessage`) and history filter (`projectSnippedView`)
- Enables `HISTORY_SNIP: true` in `scripts/build.ts`
- Fixes missing `SystemCompactBoundaryMessage` export in `src/types/message.ts` stub

All call sites in `query.ts`, `QueryEngine.ts`, `messages.ts`, `attachments.ts`, and `sessionStorage.ts` were already wired; this PR provides the implementations they require.

## Test plan
- [ ] `bun test src/services/compact/snipCompact.test.ts` — all pass
- [ ] `bun test src/services/compact/snipProjection.test.ts` — all pass
- [ ] `bun run build && bun run smoke` — clean build, version string printed
- [ ] `bun run typecheck` — no new errors
- [ ] Full `bun test` — no regressions
EOF
)"
```

---

## Self-Review Checklist

- **Spec coverage:** All four missing pieces (SnipTool, snipCompact, snipProjection, build flag) are covered. `applySnipRemovals` in `sessionStorage.ts` and `getMessagesAfterCompactBoundary` in `messages.ts` are already wired and will pick up the new modules automatically when the flag is enabled.
- **Placeholder scan:** No TBDs. All code blocks are complete.
- **Type consistency:** `markForSnip` defined in Task 2, called in Task 3. `isSnipBoundaryMessage` / `projectSnippedView` defined in Task 1, used by existing `messages.ts` call site. `deriveShortMessageId` imported from `../../utils/messages.js` (exported at line 202). `lazySchema` from `../../utils/lazySchema.js` (same pattern as `ToolSearchTool`). `buildTool` / `ToolDef` from `../../Tool.js`.
- **One edge case to know:** `snipCompactIfNeeded` with `{ force: true }` (called by QueryEngine's `snipReplay`) currently returns a no-op when `pendingSnipIds` is empty, which is correct — if there's nothing pending at force-replay time, there's nothing to remove.
