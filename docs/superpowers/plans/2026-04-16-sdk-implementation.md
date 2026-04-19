# SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement working SDK exports in `@gitlawb/openclaude` so external consumers (VS Code extensions etc.) can `import { query, listSessions } from '@gitlawb/openclaude'` and get real functionality instead of `throw "not implemented"`.

**Architecture:** SDK entry point (`src/entrypoints/sdk.ts`) wraps `QueryEngine` and session utilities. Build produces a separate `dist/sdk.mjs` bundle alongside existing `dist/cli.mjs`. All session functions delegate to portable implementations in `src/utils/`.

**Tech Stack:** TypeScript, Bun bundler, Node.js ESM

**Node version for testing:** `export PATH="/c/Users/test/AppData/Local/nvm/v24.13.0:$PATH"`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/entrypoints/sdk.ts` | CREATE | Main SDK entry point - exports query, session functions |
| `src/entrypoints/agentSdkTypes.ts` | MODIFY | Replace stubs with real implementations that delegate to sdk.ts |
| `scripts/build.ts` | MODIFY | Add second Bun.build() call for SDK bundle |
| `package.json` | MODIFY | Add exports, files, types fields |
| `dist/sdk.d.ts` | CREATE (generated) | Type declarations for SDK consumers |

---

## Task 1: Create SDK Entry Point with Session Functions

**Files:**
- Create: `src/entrypoints/sdk.ts`

These functions have no heavy dependencies (no QueryEngine, no init). They read JSONL files from disk using existing portable utilities.

- [ ] **Step 1: Create `src/entrypoints/sdk.ts` with session functions**

```typescript
/**
 * OpenClaude SDK — programmatic API for consuming sessions and queries.
 *
 * This entry point is bundled separately as dist/sdk.mjs.
 * It must NOT import CLI/TUI code (React, Ink, etc.).
 */

import { randomUUID } from 'crypto'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type {
  SDKMessage,
  SDKResultMessage,
  SDKSessionInfo,
  SDKUserMessage,
  SessionMessage,
} from './agentSdkTypes.js'
import type {
  ForkSessionOptions,
  ForkSessionResult,
  GetSessionInfoOptions,
  GetSessionMessagesOptions,
  ListSessionsOptions,
  Options,
  Query,
  SessionMutationOptions,
} from './sdk/runtimeTypes.js'
import { listSessionsImpl } from '../utils/listSessionsImpl.js'
import { resolveSessionFilePath, readSessionLite, findProjectDir, canonicalizePath } from '../utils/sessionStoragePortable.js'
import { parseSessionInfoFromLite } from '../utils/listSessionsImpl.js'
```

- [ ] **Step 2: Implement `listSessions`**

```typescript
export async function listSessions(
  options?: ListSessionsOptions,
): Promise<SDKSessionInfo[]> {
  const results = await listSessionsImpl(options)
  return results.map(s => ({
    session_id: s.sessionId,
    title: s.summary,
    created_at: s.createdAt ? new Date(s.createdAt).toISOString() : undefined,
    updated_at: new Date(s.lastModified).toISOString(),
    ...(s.customTitle && { customTitle: s.customTitle }),
    ...(s.firstPrompt && { firstPrompt: s.firstPrompt }),
    ...(s.gitBranch && { gitBranch: s.gitBranch }),
    ...(s.cwd && { cwd: s.cwd }),
    ...(s.tag && { tag: s.tag }),
  }))
}
```

- [ ] **Step 3: Implement `getSessionInfo`**

```typescript
export async function getSessionInfo(
  sessionId: string,
  options?: GetSessionInfoOptions,
): Promise<SDKSessionInfo | undefined> {
  const resolved = await resolveSessionFilePath(sessionId, options?.dir)
  if (!resolved) return undefined
  const lite = await readSessionLite(resolved.filePath)
  if (!lite) return undefined
  const info = parseSessionInfoFromLite(sessionId, lite, resolved.projectPath)
  if (!info) return undefined
  return {
    session_id: info.sessionId,
    title: info.summary,
    created_at: info.createdAt ? new Date(info.createdAt).toISOString() : undefined,
    updated_at: new Date(info.lastModified).toISOString(),
    ...(info.customTitle && { customTitle: info.customTitle }),
    ...(info.firstPrompt && { firstPrompt: info.firstPrompt }),
    ...(info.gitBranch && { gitBranch: info.gitBranch }),
    ...(info.cwd && { cwd: info.cwd }),
    ...(info.tag && { tag: info.tag }),
  }
}
```

- [ ] **Step 4: Implement `getSessionMessages`**

```typescript
export async function getSessionMessages(
  sessionId: string,
  options?: GetSessionMessagesOptions,
): Promise<SessionMessage[]> {
  const resolved = await resolveSessionFilePath(sessionId, options?.dir)
  if (!resolved) return []
  const { loadTranscriptFromFile } = await import('../utils/sessionStorage.js')
  const { buildConversationChain } = await import('../utils/sessionStorage.js')
  const chain = await buildConversationChain(
    sessionId,
    resolved.filePath,
    { includeSystemMessages: options?.includeSystemMessages ?? false },
  )
  if (!chain) return []
  return chain
    .filter((m: any) => m.type === 'user' || m.type === 'assistant')
    .map((m: any) => ({
      role: m.message?.role ?? m.type,
      content: m.message?.content ?? m.content,
      timestamp: m.timestamp,
    }))
}
```

- [ ] **Step 5: Implement `renameSession` and `tagSession`**

```typescript
export async function renameSession(
  sessionId: string,
  title: string,
  options?: SessionMutationOptions,
): Promise<void> {
  const resolved = await resolveSessionFilePath(sessionId, options?.dir)
  const { saveCustomTitle } = await import('../utils/sessionStorage.js')
  await saveCustomTitle(sessionId, title, resolved?.filePath)
}

export async function tagSession(
  sessionId: string,
  tag: string | null,
  options?: SessionMutationOptions,
): Promise<void> {
  const resolved = await resolveSessionFilePath(sessionId, options?.dir)
  const { saveTag } = await import('../utils/sessionStorage.js')
  if (tag === null) {
    // Clear tag by saving empty string — saveTag handles this
    await saveTag(sessionId, '', resolved?.filePath)
  } else {
    await saveTag(sessionId, tag, resolved?.filePath)
  }
}
```

- [ ] **Step 6: Implement `forkSession`**

```typescript
export async function forkSession(
  sessionId: string,
  options?: ForkSessionOptions,
): Promise<ForkSessionResult> {
  const resolved = await resolveSessionFilePath(sessionId, options?.dir)
  if (!resolved) throw new Error(`Session ${sessionId} not found`)

  const fs = await import('fs/promises')
  const { join, dirname } = await import('path')
  const content = await fs.readFile(resolved.filePath, 'utf-8')
  const lines = content.trim().split('\n').filter(Boolean)

  const newSessionId = randomUUID()
  const uuidMap = new Map<string, string>()

  const remappedLines = lines.map(line => {
    try {
      const entry = JSON.parse(line)
      // Remap uuid
      if (entry.uuid) {
        const newUuid = randomUUID()
        uuidMap.set(entry.uuid, newUuid)
        entry.uuid = newUuid
      }
      // Remap parentUuid
      if (entry.parentUuid && uuidMap.has(entry.parentUuid)) {
        entry.parentUuid = uuidMap.get(entry.parentUuid)
      }
      // Set new sessionId
      if (entry.sessionId) entry.sessionId = newSessionId
      // Apply title if provided
      if (options?.title && entry.type === 'custom-title') {
        entry.customTitle = options.title
      }
      // Apply upToMessageId cutoff
      if (options?.upToMessageId && entry.uuid === options.upToMessageId) {
        return JSON.stringify(entry)
      }
      return JSON.stringify(entry)
    } catch {
      return line
    }
  })

  // If upToMessageId was specified, only keep lines up to and including that message
  const finalLines = options?.upToMessageId
    ? remappedLines.slice(0, remappedLines.indexOf(remappedLines.find(l => {
        try { return JSON.parse(l).uuid === options.upToMessageId } catch { return false }
      })! + 1))
    : remappedLines

  // Add custom-title if title option provided and no existing title entry
  if (options?.title) {
    finalLines.push(JSON.stringify({
      type: 'custom-title',
      customTitle: options.title,
      sessionId: newSessionId,
    }))
  }

  const newFilePath = join(dirname(resolved.filePath), `${newSessionId}.jsonl`)
  await fs.writeFile(newFilePath, finalLines.join('\n') + '\n')

  return { sessionId: newSessionId }
}
```

- [ ] **Step 7: Commit session functions**

```bash
git add src/entrypoints/sdk.ts
git commit -m "feat(sdk): add session management functions (listSessions, getSessionInfo, etc.)"
```

---

## Task 2: Implement `query()` Function

**Files:**
- Modify: `src/entrypoints/sdk.ts`

This is the core SDK function. It creates a QueryEngine, feeds it prompts from an AsyncIterable, and yields SDKMessages.

- [ ] **Step 1: Add query implementation to `src/entrypoints/sdk.ts`**

The `query()` function must:
1. Call `init()` for bootstrap
2. Create tool set via `getTools()`
3. Set up AppState, file cache, permission callbacks
4. Create QueryEngine with the config
5. Return a `Query` object wrapping AsyncIterable

```typescript
import type { AbortController } from 'abort-controller'
import { init } from './init.js'
import { getTools, assembleToolPool } from '../tools.js'
import type { Tools } from '../Tool.js'
import type { AppState } from '../state/AppState.js'
import type { FileStateCache } from '../utils/fileStateCache.js'
import { cloneFileStateCache, createEmptyFileStateCache } from '../utils/fileStateCache.js'
import { QueryEngine } from '../QueryEngine.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import { setCwd } from '../utils/Shell.js'
```

Add the `query()` function body with two overloads (Options vs InternalOptions).

- [ ] **Step 2: Implement Query wrapper class**

```typescript
class QueryImpl implements Query {
  private engine: QueryEngine
  private promptIter: AsyncIterable<SDKUserMessage> | string
  private abortController: AbortController

  constructor(
    engine: QueryEngine,
    promptIter: AsyncIterable<SDKUserMessage> | string,
    abortController: AbortController,
  ) {
    this.engine = engine
    this.promptIter = promptIter
    this.abortController = abortController
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    if (typeof this.promptIter === 'string') {
      yield* this.engine.submitMessage(this.promptIter)
    } else {
      for await (const userMsg of this.promptIter) {
        const content = userMsg.message?.content
        if (typeof content === 'string') {
          yield* this.engine.submitMessage(content, { uuid: userMsg.uuid })
        } else {
          yield* this.engine.submitMessage(
            Array.isArray(content) ? content : [{ type: 'text', text: String(content) }],
            { uuid: userMsg.uuid },
          )
        }
      }
    }
  }

  async setModel(model: string): Promise<void> {
    this.engine.setModel(model)
  }

  async setPermissionMode(mode: any): Promise<void> {
    // Permission mode changes require tool reload
    // For now, delegate to engine config update
  }
}
```

- [ ] **Step 3: Implement the full `query()` function with init + engine setup**

The function needs to:
- Call `init()` once
- Create `AppState` with tool permission context
- Create tools via `getTools()`
- Handle `canUseTool` callback from options
- Create and return `QueryImpl`

- [ ] **Step 4: Commit query implementation**

```bash
git add src/entrypoints/sdk.ts
git commit -m "feat(sdk): implement query() with QueryEngine integration"
```

---

## Task 3: Implement V2 API Functions (unstable_v2_createSession, unstable_v2_resumeSession, unstable_v2_prompt)

**Files:**
- Modify: `src/entrypoints/sdk.ts`

- [ ] **Step 1: Implement `unstable_v2_createSession`**

Creates a persistent SDKSession wrapping a QueryEngine.

- [ ] **Step 2: Implement `unstable_v2_resumeSession`**

Resumes a session by loading existing messages and creating a QueryEngine with them.

- [ ] **Step 3: Implement `unstable_v2_prompt`**

One-shot convenience: creates session, sends prompt, returns result message.

- [ ] **Step 4: Commit V2 API**

```bash
git add src/entrypoints/sdk.ts
git commit -m "feat(sdk): add V2 unstable API (createSession, resumeSession, prompt)"
```

---

## Task 4: Implement `tool()` and `createSdkMcpServer()`

**Files:**
- Modify: `src/entrypoints/sdk.ts`

- [ ] **Step 1: Implement `tool()` helper**

Returns an `SdkMcpToolDefinition` object wrapping the handler.

- [ ] **Step 2: Implement `createSdkMcpServer()`**

Creates an MCP server instance for in-process tool definitions.

- [ ] **Step 3: Commit**

```bash
git add src/entrypoints/sdk.ts
git commit -m "feat(sdk): implement tool() and createSdkMcpServer()"
```

---

## Task 5: Update `agentSdkTypes.ts` to Delegate to SDK

**Files:**
- Modify: `src/entrypoints/agentSdkTypes.ts`

Replace all `throw "not implemented"` stubs with re-exports from `sdk.ts`.

- [ ] **Step 1: Replace function stubs with re-exports**

Each function currently throws. Change to:
```typescript
export { query, listSessions, getSessionInfo, getSessionMessages, renameSession, tagSession, forkSession, tool, createSdkMcpServer } from './sdk.js'
```

Remove the old function bodies entirely.

- [ ] **Step 2: Verify types still export correctly**

The type exports (SDKMessage, Options, Query, etc.) remain unchanged — only function implementations change.

- [ ] **Step 3: Commit**

```bash
git add src/entrypoints/agentSdkTypes.ts
git commit -m "feat(sdk): wire agentSdkTypes stubs to real implementations"
```

---

## Task 6: Update Build System

**Files:**
- Modify: `scripts/build.ts`

Add a second `Bun.build()` call for the SDK entry point.

- [ ] **Step 1: Add SDK build target after CLI build**

After the existing `Bun.build()` call, add a second build:

```javascript
// SDK build — separate entry point, no React/Ink
const sdkResult = await Bun.build({
  entrypoints: ['./src/entrypoints/sdk.ts'],
  outdir: './dist',
  target: 'node',
  format: 'esm',
  splitting: false,
  sourcemap: 'external',
  minify: false,
  naming: 'sdk.mjs',
  define: {
    'MACRO.VERSION': JSON.stringify('99.0.0'),
    'MACRO.DISPLAY_VERSION': JSON.stringify(version),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'MACRO.ISSUES_EXPLAINER': JSON.stringify('report the issue at https://github.com/anthropics/claude-code/issues'),
    'MACRO.PACKAGE_URL': JSON.stringify('@gitlawb/openclaude'),
    'MACRO.NATIVE_PACKAGE_URL': 'undefined',
  },
  external: [
    '@opentelemetry/api',
    '@opentelemetry/api-logs',
    '@opentelemetry/core',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/sdk-trace-node',
    '@opentelemetry/sdk-logs',
    '@opentelemetry/sdk-metrics',
    '@opentelemetry/semantic-conventions',
    '@anthropic-ai/sdk',
    '@anthropic-ai/bedrock-sdk',
    '@anthropic-ai/vertex-sdk',
    'sharp',
    '@aws-sdk/client-bedrock',
    '@aws-sdk/client-bedrock-runtime',
    '@aws-sdk/client-sts',
    '@aws-sdk/credential-providers',
    '@azure/identity',
    'google-auth-library',
  ],
})
```

- [ ] **Step 2: Add success/failure logging for SDK build**

```javascript
if (!sdkResult.success) {
  console.error('SDK build failed:')
  for (const log of sdkResult.logs) console.error(log)
  process.exitCode = 1
} else {
  console.log(`✓ Built SDK → dist/sdk.mjs`)
}
```

- [ ] **Step 3: Test build doesn't break CLI**

```bash
bun run build
```

Verify both `dist/cli.mjs` and `dist/sdk.mjs` are produced.

- [ ] **Step 4: Commit**

```bash
git add scripts/build.ts
git commit -m "feat(sdk): add SDK build target to build script"
```

---

## Task 7: Update `package.json` for SDK Exports

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add exports, types, and files fields**

```json
{
  "exports": {
    ".": {
      "types": "./dist/sdk.d.ts",
      "import": "./dist/sdk.mjs"
    }
  },
  "types": "./dist/sdk.d.ts",
  "files": [
    "bin/",
    "dist/cli.mjs",
    "dist/cli.mjs.map",
    "dist/sdk.mjs",
    "dist/sdk.mjs.map",
    "dist/sdk.d.ts",
    "README.md"
  ]
}
```

- [ ] **Step 2: Verify `package.json` is valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf-8')); console.log('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(sdk): add SDK exports and types to package.json"
```

---

## Task 8: Generate Type Declarations (`dist/sdk.d.ts`)

**Files:**
- Create: `scripts/generate-sdk-dts.ts`

- [ ] **Step 1: Create a script to generate `dist/sdk.d.ts`**

Write a script that extracts type exports from `agentSdkTypes.ts` and produces a declaration file. Simplest approach: manual `.d.ts` that re-exports all SDK types.

- [ ] **Step 2: Add `build:dts` npm script**

```json
"build:dts": "bun run scripts/generate-sdk-dts.ts"
```

- [ ] **Step 3: Integrate into main build**

Update `build` script to also run `build:dts`:
```json
"build": "bun run scripts/build.ts && bun run build:dts"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-sdk-dts.ts package.json
git commit -m "feat(sdk): add type declaration generation"
```

---

## Task 9: Integration Test

**Files:**
- Create: `tests/sdk/test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { describe, test, expect } from 'bun:test'
import { listSessions, getSessionInfo } from '../../src/entrypoints/sdk.js'

describe('SDK session functions', () => {
  test('listSessions returns array', async () => {
    const sessions = await listSessions({ dir: process.cwd() })
    expect(Array.isArray(sessions)).toBe(true)
  })

  test('getSessionInfo returns undefined for non-existent session', async () => {
    const info = await getSessionInfo('00000000-0000-0000-0000-000000000000')
    expect(info).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests**

```bash
bun test tests/sdk/test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/sdk/
git commit -m "test(sdk): add basic integration tests for session functions"
```

---

## Task 10: Smoke Test with Real Query

**Files:**
- Create: `tests/sdk/query-test.ts`

- [ ] **Step 1: Create query smoke test**

Test that `query()` can initialize and yield at least one message.

- [ ] **Step 2: Run with Node 24**

```bash
export PATH="/c/Users/test/AppData/Local/nvm/v24.13.0:$PATH"
node --experimental-strip-types tests/sdk/query-test.ts
```

Or via bun:
```bash
bun test tests/sdk/query-test.ts
```

- [ ] **Step 3: Verify CLI still works**

```bash
bun run build && node dist/cli.mjs --version
```

- [ ] **Step 4: Final commit**

```bash
git add tests/sdk/
git commit -m "test(sdk): add query smoke test"
```
