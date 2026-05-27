# MCP_SKILLS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the missing `src/skills/mcpSkills.ts` module so MCP servers can advertise skills as `skill://` resources, and enable the `MCP_SKILLS` feature flag.

**Architecture:** When an MCP server connects and supports resources, `fetchMcpSkillsForClient(client)` lists its resources, keeps those whose `uri` starts with `skill://`, reads each via `resources/read`, parses the markdown frontmatter, and converts each into a skill `Command` using the already-registered builders (`createSkillCommand` + `parseSkillFrontmatterFields` from `mcpSkillBuilders.ts`). The result is memoized per server name (LRU) so the existing `.cache.delete(name)` call sites work. Every consumer, call site, and cache-invalidation path already exists and is wired behind `feature('MCP_SKILLS')`; this plan supplies the one module they import.

**Tech Stack:** TypeScript, Bun test runner, `@modelcontextprotocol/sdk` (resources/list + resources/read), existing `memoizeWithLRU` helper, existing skill-command builders.

---

## Background: why only one file

`MCP_SKILLS` is **not** general MCP support — that already works (tools, prompts-as-commands, resources). This flag adds one capability: surfacing `skill://` resources as invocable skill commands. Verified state of the wiring:

| Piece | Status | Location |
|---|---|---|
| Flag definition | exists, `false` | `scripts/build.ts:38` |
| Call sites (2 connect paths) | exist, gated | `client.ts:2217`, `client.ts:2391` |
| Cache invalidation on `resources/list_changed` | exists | `useManageMCPConnections.ts:717-738` |
| Cache invalidation on `prompts/list_changed` | exists | `useManageMCPConnections.ts:682-694` |
| Generic server-cache clear | exists | `client.ts:1414`, `client.ts:1692` |
| Skill-command builders + registry | exists | `mcpSkillBuilders.ts`, registered `loadSkillsDir.ts:1168` |
| Consumers (skill index, SkillTool) | exist | `commands.ts:577`, `SkillTool.ts:89`, `utils.ts:92` |
| **`src/skills/mcpSkills.ts`** | **MISSING** | — |

The only external symbol read off the module is `fetchMcpSkillsForClient` (`client.ts:121`, `useManageMCPConnections.ts:25`), accessed as a memoized function with `.cache.delete(name)`.

## Contract (verified against all call sites)

```ts
// Shape required by every call site:
fetchMcpSkillsForClient: LRUMemoizedFunction<[MCPServerConnection], Promise<Command[]>>
//   - callable: fetchMcpSkillsForClient(client) => Promise<Command[]>
//   - has .cache.delete(name: string): boolean   (from memoizeWithLRU)
//   - keyed by client.name
```

Key facts confirmed from source:
- `memoizeWithLRU(fn, cacheFn, maxCacheSize)` (`src/utils/memoize.ts:234`) returns exactly this shape; `fetchToolsForClient`/`fetchCommandsForClient`/`fetchResourcesForClient` all use it with `(client) => client.name` and `MCP_FETCH_CACHE_SIZE` (=20).
- `ServerResource = Resource & { server: string }` (`types.ts:229`); `Resource` has `uri: string`, `name: string`, `description?: string`, `mimeType?: string`, `title?: string` (MCP SDK `ResourceSchema`).
- `resources/read` returns `ReadResourceResult` with `contents: Array<{ uri; mimeType?; text? } | { uri; mimeType?; blob? }>` (`ReadMcpResourceTool.ts:95-101`).
- `parseFrontmatter(markdown, sourcePath?)` → `{ frontmatter: FrontmatterData, content: string }` (`frontmatterParser.ts:130`).
- `parseSkillFrontmatterFields(frontmatter, markdownContent, resolvedName, fallbackLabel?)` returns a fields object (`loadSkillsDir.ts:185`).
- `createSkillCommand({...})` returns a `Command` (`loadSkillsDir.ts:270`); requires `source`, `loadedFrom`, `baseDir`, `paths`, `executionContext` among the parsed fields.
- For MCP skills: `source: 'mcp'`, `loadedFrom: 'mcp'`, `baseDir: undefined`, `paths: undefined`, `executionContext: parsed.executionContext`.
- Builders are obtained via `getMCPSkillBuilders()` from `mcpSkillBuilders.ts` (NOT a direct import of `loadSkillsDir.ts`, to avoid the dependency cycle documented in that file).
- **Cycle avoidance:** `mcpSkills.ts` must NOT import from `services/mcp/client.ts` — that file already `require`s `mcpSkills.js` (gated by `feature`), so any static import back would form a direct 2-node cycle that dependency-cruiser flags. The sibling `fetchResourcesForClient` (`client.ts:2043`) reads resources by calling `client.client.request(...)` directly on the already-connected client (no `ensureConnectedClient`). Do the same here.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/skills/mcpSkills.ts` | `fetchMcpSkillsForClient` + `skill://` discovery + frontmatter→Command conversion |
| Create | `src/skills/mcpSkills.test.ts` | Unit tests for the skill-name derivation and resource filtering helpers |
| Modify | `scripts/build.ts:38` | Flip `MCP_SKILLS` to `true` |

---

## Task 1: Pure helpers — `skill://` filter and skill-name derivation

These are the testable pure functions. They have no MCP I/O, so they're unit-tested directly. The I/O wrapper (Task 2) composes them.

**Files:**
- Create: `src/skills/mcpSkills.ts`
- Create: `src/skills/mcpSkills.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/skills/mcpSkills.test.ts
import { describe, expect, test } from 'bun:test'
import { deriveMcpSkillName, isSkillResource } from './mcpSkills.js'

describe('isSkillResource', () => {
  test('true for skill:// uri', () => {
    expect(isSkillResource({ uri: 'skill://code-review', name: 'code-review' })).toBe(true)
  })
  test('false for file:// uri', () => {
    expect(isSkillResource({ uri: 'file:///tmp/x.md', name: 'x' })).toBe(false)
  })
  test('false for https resource', () => {
    expect(isSkillResource({ uri: 'https://example.com/r', name: 'r' })).toBe(false)
  })
  test('case-insensitive scheme', () => {
    expect(isSkillResource({ uri: 'SKILL://Thing', name: 'Thing' })).toBe(true)
  })
  test('false for empty uri', () => {
    expect(isSkillResource({ uri: '', name: 'x' })).toBe(false)
  })
})

describe('deriveMcpSkillName', () => {
  test('namespaces with mcp__<server>__<skill>', () => {
    expect(deriveMcpSkillName('my-server', 'skill://code-review')).toBe('mcp__my-server__code-review')
  })
  test('strips skill:// scheme and uses the remainder', () => {
    expect(deriveMcpSkillName('s', 'skill://deploy/prod')).toBe('mcp__s__deploy/prod')
  })
  test('normalizes server name segment', () => {
    // normalizeNameForMCP lowercases/strips — assert the server segment is normalized,
    // not the raw value. "My Server" must not appear verbatim.
    const name = deriveMcpSkillName('My Server', 'skill://x')
    expect(name.startsWith('mcp__')).toBe(true)
    expect(name.endsWith('__x')).toBe(true)
    expect(name).not.toContain('My Server')
  })
  test('falls back to bare uri when no skill:// prefix', () => {
    expect(deriveMcpSkillName('s', 'weird')).toBe('mcp__s__weird')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/ubuntu/projects/openclaude/openclaude
bun test src/skills/mcpSkills.test.ts
```
Expected: FAIL — `Cannot find module './mcpSkills.js'`

- [ ] **Step 3: Create `src/skills/mcpSkills.ts` with the helpers only**

```ts
// src/skills/mcpSkills.ts
import type { Command } from '../types/command.js'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import { memoizeWithLRU } from '../utils/memoize.js'
import { recursivelySanitizeUnicode } from '../utils/sanitization.js'
import { normalizeNameForMCP } from '../services/mcp/normalization.js'
import type { MCPServerConnection, ServerResource } from '../services/mcp/types.js'
import { getMCPSkillBuilders } from './mcpSkillBuilders.js'
import { logForDebugging } from '../utils/debug.js'

// NOTE: do NOT import from '../services/mcp/client.js' — it require()s this
// module behind feature('MCP_SKILLS'), so importing back forms a cycle. Read
// resources directly off the connected client, exactly like fetchResourcesForClient.

const SKILL_URI_PREFIX = 'skill://'

/** True when an MCP resource advertises itself as a skill via the skill:// URI scheme. */
export function isSkillResource(resource: { uri: string; name?: string }): boolean {
  return resource.uri.toLowerCase().startsWith(SKILL_URI_PREFIX)
}

/**
 * Build the namespaced skill command name: mcp__<normalized-server>__<skill-path>.
 * The skill path is the resource URI with the skill:// scheme stripped; if the URI
 * has no skill:// prefix the whole URI is used as the path.
 */
export function deriveMcpSkillName(serverName: string, uri: string): string {
  const lower = uri.toLowerCase()
  const path = lower.startsWith(SKILL_URI_PREFIX)
    ? uri.slice(SKILL_URI_PREFIX.length)
    : uri
  return `mcp__${normalizeNameForMCP(serverName)}__${path}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/skills/mcpSkills.test.ts
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/skills/mcpSkills.ts src/skills/mcpSkills.test.ts
git commit -m "feat(mcp-skills): add skill:// resource filter and name derivation helpers"
```

---

## Task 2: `fetchMcpSkillsForClient` — discovery + conversion

Wraps the helpers with MCP I/O: list resources, filter to `skill://`, read each, parse frontmatter, build a `Command`. Memoized per server name so the existing `.cache.delete(name)` call sites function.

No new unit test file — this function performs live MCP RPC and is verified by build + smoke + the existing call sites. The pure logic it depends on is already covered in Task 1.

**Files:**
- Modify: `src/skills/mcpSkills.ts` (append)

- [ ] **Step 1: Append the reader + the memoized fetcher to `src/skills/mcpSkills.ts`**

```ts
// --- append to src/skills/mcpSkills.ts ---

import {
  type ReadResourceResult,
  ReadResourceResultSchema,
} from '@modelcontextprotocol/sdk/types.js'

// Match the other MCP fetchers (fetchToolsForClient etc.) — 20 entries.
const MCP_SKILL_CACHE_SIZE = 20

/**
 * Read a single skill:// resource and convert it into a skill Command.
 * Returns null when the resource has no text body or can't be parsed.
 */
async function readSkillResource(
  client: Extract<MCPServerConnection, { type: 'connected' }>,
  resource: ServerResource,
): Promise<Command | null> {
  try {
    const result = (await client.client.request(
      { method: 'resources/read', params: { uri: resource.uri } },
      ReadResourceResultSchema,
    )) as ReadResourceResult

    // Skills are markdown text. Use the first text content block.
    const textContent = result.contents.find(
      (c): c is { uri: string; mimeType?: string; text: string } =>
        typeof (c as { text?: unknown }).text === 'string',
    )
    if (!textContent) {
      logForDebugging(
        `[mcp-skills] resource ${resource.uri} on ${client.name} has no text content; skipping`,
      )
      return null
    }

    const markdown = recursivelySanitizeUnicode(textContent.text) as string
    const { frontmatter, content: markdownContent } = parseFrontmatter(markdown)

    const skillName = deriveMcpSkillName(client.name, resource.uri)
    const { createSkillCommand, parseSkillFrontmatterFields } = getMCPSkillBuilders()
    const parsed = parseSkillFrontmatterFields(frontmatter, markdownContent, skillName)

    return createSkillCommand({
      ...parsed,
      skillName,
      markdownContent,
      source: 'mcp',
      baseDir: undefined,
      loadedFrom: 'mcp',
      paths: undefined,
      executionContext: parsed.executionContext,
    })
  } catch (error) {
    logForDebugging(
      `[mcp-skills] failed to read skill resource ${resource.uri} on ${client.name}: ${String(error)}`,
      { level: 'warn' },
    )
    return null
  }
}

/**
 * Discover skill:// resources advertised by an MCP server and surface them as
 * invocable skill commands. Memoized per server name; cache invalidated by
 * client.ts / useManageMCPConnections.ts on resources/list_changed.
 */
export const fetchMcpSkillsForClient = memoizeWithLRU(
  async (client: MCPServerConnection): Promise<Command[]> => {
    if (client.type !== 'connected') return []
    if (!client.capabilities?.resources) return []

    try {
      const result = await client.client.request(
        { method: 'resources/list' },
        // Reuse the SDK list schema indirectly: resources/list returns { resources }.
        // We only read uri/name/description here, so a structural cast is safe.
        (await import('@modelcontextprotocol/sdk/types.js')).ListResourcesResultSchema,
      )

      const resources = (result.resources ?? []).map(r => ({
        ...r,
        server: client.name,
      })) as ServerResource[]

      const skillResources = resources.filter(isSkillResource)
      if (skillResources.length === 0) return []

      const commands = await Promise.all(
        skillResources.map(r => readSkillResource(client, r)),
      )
      return commands.filter((c): c is Command => c !== null)
    } catch (error) {
      logForDebugging(
        `[mcp-skills] failed to list skills for ${client.name}: ${String(error)}`,
        { level: 'warn' },
      )
      return []
    }
  },
  (client: MCPServerConnection) => client.name,
  MCP_SKILL_CACHE_SIZE,
)
```

- [ ] **Step 2: Replace the dynamic `import(...)` for the list schema with a static top-of-file import**

The inline `await import(...)` above works but is ugly and re-imports on every call. Move `ListResourcesResultSchema` to the static import block. Edit the SDK types import you added in Step 1 to include it:

```ts
import {
  ListResourcesResultSchema,
  type ReadResourceResult,
  ReadResourceResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
```

Then change the `resources/list` request line in `fetchMcpSkillsForClient` to use it directly:

```ts
      const result = await client.client.request(
        { method: 'resources/list' },
        ListResourcesResultSchema,
      )
```

- [ ] **Step 3: Typecheck the new module in isolation**

```bash
cd /home/ubuntu/projects/openclaude/openclaude
bun run typecheck 2>&1 | grep -i "mcpSkills" || echo "no mcpSkills type errors"
```
Expected: `no mcpSkills type errors`

- [ ] **Step 4: Re-run Task 1 tests (still green after append)**

```bash
bun test src/skills/mcpSkills.test.ts
```
Expected: all PASS (the appended I/O code doesn't affect the pure-helper tests)

- [ ] **Step 5: Commit**

```bash
git add src/skills/mcpSkills.ts
git commit -m "feat(mcp-skills): implement fetchMcpSkillsForClient resource discovery"
```

---

## Task 3: Enable the flag and verify end-to-end

**Files:**
- Modify: `scripts/build.ts:38`

- [ ] **Step 1: Flip the flag**

In `scripts/build.ts`, the line currently reads:
```ts
  MCP_SKILLS: false,              // Dynamic MCP skill discovery (src/skills/mcpSkills.ts not mirrored; enabling this causes "fetchMcpSkillsForClient is not a function" when MCP servers with resources connect — see #856)
```

Replace with:
```ts
  MCP_SKILLS: true,               // Dynamic MCP skill discovery via skill:// resources
```

- [ ] **Step 2: Build**

```bash
cd /home/ubuntu/projects/openclaude/openclaude
bun run build
```
Expected: exits 0, `dist/cli.mjs` updated.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```
Expected: exits 0, or only the same pre-existing errors that exist on `main` (no new errors mentioning `mcpSkills`, `client.ts`, or `useManageMCPConnections.ts`).

- [ ] **Step 4: Smoke test**

```bash
bun run smoke
```
Expected: version string printed, exits 0. (This is the regression guard for the old `"fetchMcpSkillsForClient is not a function"` crash — with the flag on and the module present, startup must stay clean.)

- [ ] **Step 5: Focused MCP + skills tests**

```bash
bun test src/skills/ src/services/mcp/
```
Expected: no new failures versus `main`.

- [ ] **Step 6: Commit**

```bash
git add scripts/build.ts
git commit -m "feat(mcp-skills): enable MCP_SKILLS feature flag"
```

---

## Task 4: Full suite + PR

- [ ] **Step 1: Run the full unit suite**

```bash
bun test
```
Expected: no new failures versus `main`.

- [ ] **Step 2: Open PR**

```bash
git push origin <branch>
gh pr create \
  --title "feat: enable MCP_SKILLS — discover skill:// resources as invocable skills" \
  --body "$(cat <<'EOF'
## Summary
- Implements the missing `src/skills/mcpSkills.ts` (the only piece `MCP_SKILLS` lacked)
- `fetchMcpSkillsForClient(client)`: lists MCP resources, keeps `skill://` ones, reads each via `resources/read`, parses frontmatter, builds skill commands with `loadedFrom: 'mcp'` / `source: 'mcp'`
- Memoized per server name (LRU, size 20) so existing `.cache.delete(name)` invalidation paths work
- Enables `MCP_SKILLS: true` in `scripts/build.ts`

General MCP support (tools, prompts, resources) already existed. This flag only adds skill discovery from `skill://` resources. All call sites, cache-invalidation paths, and consumers (`commands.ts:577`, `SkillTool.ts`, skill-search index) were already wired behind `feature('MCP_SKILLS')`.

Fixes the `"fetchMcpSkillsForClient is not a function"` crash (#856) that occurred when the flag was force-enabled without the module present.

## Test plan
- [ ] `bun test src/skills/mcpSkills.test.ts` — helper tests pass
- [ ] `bun run build && bun run smoke` — clean build + startup (regression guard for #856)
- [ ] `bun run typecheck` — no new errors
- [ ] `bun test src/skills/ src/services/mcp/` — no regressions
- [ ] Full `bun test` — no regressions
EOF
)"
```

---

## Self-Review Checklist

- **Spec coverage:** The one missing symbol (`fetchMcpSkillsForClient`) is implemented in Task 2; pure helpers in Task 1; flag in Task 3. All consumers/call sites already exist — no other files need changes.
- **Placeholder scan:** No TBDs. All code blocks complete.
- **Type consistency:**
  - `isSkillResource` / `deriveMcpSkillName` defined in Task 1, used in Task 2.
  - `fetchMcpSkillsForClient` returns `Promise<Command[]>` and is built with `memoizeWithLRU(fn, (client) => client.name, 20)` → yields the `.cache.delete(name)` method the call sites require (`memoize.ts:234-269`).
  - `createSkillCommand` / `parseSkillFrontmatterFields` obtained via `getMCPSkillBuilders()` (not direct `loadSkillsDir` import) — respects the documented cycle-avoidance in `mcpSkillBuilders.ts`.
  - **No import from `client.ts`**: `readSkillResource` calls `client.client.request(...)` directly (client is guaranteed `connected` by the caller's guard), mirroring `fetchResourcesForClient`. This avoids the `mcpSkills ↔ client` import cycle.
  - `source: 'mcp'` and `loadedFrom: 'mcp'` are both valid (`command.ts:33` union includes `'mcp'`; `LoadedFrom` at `loadSkillsDir.ts:67` includes `'mcp'`).
  - `ensureConnectedClient(client)` requires `ConnectedMCPServer`; `readSkillResource` types its param as `Extract<MCPServerConnection, { type: 'connected' }>` and is only called after the `client.type !== 'connected'` guard.
- **Known caveat to flag for the executor:** the structural cast of `resources/list` results to `ServerResource[]` mirrors `fetchResourcesForClient` (`client.ts:2060`). If `tsc` complains about the SDK's `Resource` type vs the local cast, copy the exact `.map(resource => ({ ...resource, server: client.name }))` shape used there. No behavioral difference.
- **One open question for review (not a blocker):** whether MCP skills should also respect `disable-model-invocation` / `user-invocable` frontmatter — they do automatically, because `parseSkillFrontmatterFields` already parses those and `createSkillCommand` honors them. No extra work needed.
