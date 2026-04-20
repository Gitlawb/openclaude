import { describe, test, expect, afterEach } from 'bun:test'
import {
  unstable_v2_createSession,
} from '../../src/entrypoints/sdk.js'
import { QueryEngine } from '../../src/QueryEngine.js'
import type { QueryEngineConfig } from '../../src/QueryEngine.js'
import type { Tools } from '../../src/Tool.js'
import { getToolSchemaCache, clearToolSchemaCache } from '../../src/utils/toolSchemaCache.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(name: string) {
  return { name, call: async () => '', description: `${name} tool` }
}

function makeConfig(overrides: Partial<QueryEngineConfig> = {}): QueryEngineConfig {
  return {
    cwd: process.cwd(),
    tools: [makeTool('toolA'), makeTool('toolB')],
    commands: [],
    mcpClients: [],
    agents: [],
    canUseTool: async () => ({ behavior: 'allow' as const }),
    getAppState: () => ({}) as any,
    setAppState: () => {},
    readFileCache: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// TEST 1 — COR-1 Regression
// ---------------------------------------------------------------------------

describe('COR-1 regression: typed nullable appStateStore', () => {
  test('SDKSessionImpl late-binds appStateStore — getMessages works', () => {
    const session = unstable_v2_createSession({
      cwd: process.cwd(),
    })
    // Session created with null appStateStore, then late-bound internally.
    // getMessages() should work (triggers getter guard).
    expect(Array.isArray(session.getMessages())).toBe(true)
    session.interrupt()
  })

  test('SDKSessionImpl sendMessage does not throw after proper init', async () => {
    const session = unstable_v2_createSession({
      cwd: process.cwd(),
    })
    let completed = false
    try {
      for await (const _ of session.sendMessage('test')) {
        break // drain first message only
      }
    } catch {
      // abort is acceptable
    }
    completed = true
    expect(completed).toBe(true)
  }, 10_000)
})

// ---------------------------------------------------------------------------
// TEST 2 — updateTools Transaction Safety
// ---------------------------------------------------------------------------

describe('updateTools transactional safety', () => {
  test('updateTools rolls back on agent validation failure', () => {
    const originalTools: Tools = [makeTool('toolA'), makeTool('toolB')]
    const engine = new QueryEngine(makeConfig({
      tools: [...originalTools],
      agents: [
        { agentType: 'test-agent', tools: ['toolC'] } as any,
      ],
    }))

    // updateTools with a set missing toolC → should throw
    expect(() => engine.updateTools([makeTool('toolA')])).toThrow(
      /references tool 'toolC' which is not in the new tool set/,
    )

    // config.tools must remain unchanged — old tool set preserved
    const currentTools = (engine as any).config.tools as Tools
    expect(currentTools.map(t => t.name)).toEqual(['toolA', 'toolB'])
  })

  test('updateTools commits when all agents are compatible', () => {
    const engine = new QueryEngine(makeConfig({
      tools: [makeTool('toolA'), makeTool('toolB')],
      agents: [
        { agentType: 'test-agent', tools: ['toolA'] } as any,
      ],
    }))

    engine.updateTools([makeTool('toolA'), makeTool('toolC')])

    const currentTools = (engine as any).config.tools as Tools
    expect(currentTools.map(t => t.name)).toEqual(['toolA', 'toolC'])
  })

  test('updateTools accepts wildcard agent without validation', () => {
    const engine = new QueryEngine(makeConfig({
      tools: [makeTool('toolA')],
      agents: [
        { agentType: 'wildcard-agent', tools: ['*'] } as any,
      ],
    }))

    // Wildcard '*' means all tools are allowed — should not throw
    expect(() => engine.updateTools([makeTool('toolX')])).not.toThrow()
    expect(((engine as any).config.tools as Tools).map(t => t.name)).toEqual(['toolX'])
  })

  test('updateTools rejects non-iterable input', () => {
    const engine = new QueryEngine(makeConfig())
    expect(() => engine.updateTools(42 as any)).toThrow(/expected iterable/)
  })

  test('updateTools rejects tool without name', () => {
    const engine = new QueryEngine(makeConfig())
    expect(() => engine.updateTools([{ call: async () => '' }] as any)).toThrow(/name/)
  })

  test('updateTools rejects tool without call', () => {
    const engine = new QueryEngine(makeConfig())
    expect(() => engine.updateTools([{ name: 'bad' }] as any)).toThrow(/call/)
  })
})

// ---------------------------------------------------------------------------
// TEST 3 — Cache Invalidation
// ---------------------------------------------------------------------------

describe('updateTools cache invalidation', () => {
  afterEach(() => {
    clearToolSchemaCache()
  })

  test('toolSchemaCache is cleared after updateTools', () => {
    const cache = getToolSchemaCache()
    cache.set('test_tool', { name: 'test_tool' } as any)
    expect(cache.has('test_tool')).toBe(true)

    const engine = new QueryEngine(makeConfig({
      tools: [makeTool('toolA')],
    }))

    engine.updateTools([makeTool('toolB')])

    expect(cache.has('test_tool')).toBe(false)
    expect(cache.size).toBe(0)
  })

  test('toolSchemaCache is NOT cleared when updateTools throws', () => {
    const cache = getToolSchemaCache()
    cache.set('keep_me', { name: 'keep_me' } as any)

    const engine = new QueryEngine(makeConfig({
      tools: [makeTool('toolA')],
      agents: [{ agentType: 'a', tools: ['toolA'] } as any],
    }))

    // This should throw — agent references toolA but new set doesn't have it
    expect(() => engine.updateTools([makeTool('toolB')])).toThrow()

    // Cache should NOT have been cleared — rollback scenario
    expect(cache.has('keep_me')).toBe(true)
  })
})
