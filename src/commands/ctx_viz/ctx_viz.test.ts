/**
 * Coverage for the /ctx command surface added in PR #1610.
 *
 * Reviewer (P2) asked for tests that lock down:
 *   1. Command registration in the public COMMANDS list (i.e. it left
 *      INTERNAL_ONLY_COMMANDS and now resolves via getCommands()).
 *   2. Aliases are wired so /ctx, /ctx_viz, and /context-viz all resolve
 *      to the same command.
 *   3. The remote-mode and bridge allowlists accept /ctx, so it works
 *      in --remote and from the iOS/mobile client.
 *   4. supportsNonInteractive is true, so the headless -p path
 *      dispatches to ctx-noninteractive.ts.
 *   5. The non-interactive call() renders the report sections so a
 *      future refactor cannot silently drop a header or category row.
 *
 * The existing commands.test.ts file did not exercise any of this, so a
 * future refactor could silently demote /ctx back to internal-only or
 * drop the bridge/remote flags without any test failing.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import {
  BRIDGE_SAFE_COMMANDS,
  clearCommandMemoizationCaches,
  findCommand,
  getCommand,
  getCommands,
  hasCommand,
  INTERNAL_ONLY_COMMANDS,
  isBridgeSafeCommand,
  REMOTE_SAFE_COMMANDS,
} from '../../commands.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from '../../utils/settings/settingsCache.js'

function findCtx(commands: ReturnType<typeof getCommands> extends Promise<infer T> ? T : never) {
  return commands.find(c => c.name === 'ctx')
}

beforeEach(() => {
  delete process.env['USER_TYPE']
  delete process.env['IS_DEMO']
  clearCommandMemoizationCaches()
  resetSettingsCache()
  setSessionSettingsCache({ settings: {}, errors: [] })
})

afterEach(() => {
  mock.restore()
  resetSettingsCache()
  clearCommandMemoizationCaches()
})

describe('/ctx command surface (PR #1610)', () => {
  test('is registered in the public COMMANDS list for normal users', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oc-test-ctx-pub-'))
    try {
      const cmds = await getCommands(cwd)
      expect(hasCommand('ctx', cmds)).toBe(true)
      const internalNames = INTERNAL_ONLY_COMMANDS.map(c => c.name)
      // /ctx was promoted out of INTERNAL_ONLY_COMMANDS in this PR — keep it out.
      expect(internalNames).not.toContain('ctx')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('exposes /ctx, /ctx_viz, and /context-viz as resolving to the same command', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oc-test-ctx-aliases-'))
    try {
      const cmds = await getCommands(cwd)
      const ctx = getCommand('ctx', cmds)
      expect(ctx.name).toBe('ctx')
      expect(ctx.aliases).toEqual(expect.arrayContaining(['ctx_viz', 'context-viz']))

      for (const alias of ['ctx_viz', 'context-viz']) {
        // findCommand + getCommand both resolve aliases back to /ctx.
        expect(findCommand(alias, cmds)?.name).toBe('ctx')
        expect(getCommand(alias, cmds).name).toBe('ctx')
        expect(hasCommand(alias, cmds)).toBe(true)
      }
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('is in REMOTE_SAFE_COMMANDS so it works under --remote', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oc-test-ctx-remote-'))
    try {
      const cmds = await getCommands(cwd)
      const ctx = findCtx(cmds)
      expect(ctx).toBeDefined()
      expect(REMOTE_SAFE_COMMANDS.has(ctx!)).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('is in BRIDGE_SAFE_COMMANDS so it is reachable from the mobile/web bridge', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oc-test-ctx-bridge-'))
    try {
      const cmds = await getCommands(cwd)
      const ctx = findCtx(cmds)
      expect(ctx).toBeDefined()
      // isBridgeSafeCommand is the runtime gate in the bridge inbound path;
      // the allowlist membership is the source of truth.
      expect(BRIDGE_SAFE_COMMANDS.has(ctx!)).toBe(true)
      expect(isBridgeSafeCommand(ctx!)).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('supports headless / non-interactive dispatch (supportsNonInteractive: true)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oc-test-ctx-nonint-'))
    try {
      const cmds = await getCommands(cwd)
      const ctx = findCtx(cmds)
      expect(ctx).toBeDefined()
      // Narrow from discriminated union so TS allows property access
      const cmd = ctx!
      if (cmd.type !== 'local') throw new Error('expected local command')
      // Drives the -p / piped-arg path into ctx-noninteractive.ts.
      expect(cmd.supportsNonInteractive).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('is a local command that lazy-loads ctx-noninteractive.ts', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oc-test-ctx-load-'))
    try {
      const cmds = await getCommands(cwd)
      const ctx = findCtx(cmds)
      expect(ctx).toBeDefined()
      const cmd = ctx!
      if (cmd.type !== 'local') throw new Error('expected local command')
      // `load` returns a dynamic import. Call it and verify the
      // non-interactive module's `call` function is exported.
      const mod = await cmd.load()
      expect(typeof mod.call).toBe('function')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('call() renders the report sections and category bars', async () => {
    // Stub the heavy data-collection pipeline so the rendering path runs
    // against a small, deterministic ContextData. The bar/header logic in
    // call() is what we want to lock down — collectCtxData/analyzeContextUsage
    // are out of scope for this PR.
    mock.module('../../services/compact/microCompact.js', () => ({
      microcompactMessages: async (m: unknown[]) => ({
        messages: m,
        toolResults: [],
        compacted: false,
      }),
    }))

    mock.module('../../utils/analyzeContext.js', () => ({
      analyzeContextUsage: async () => ({
        categories: [
          { name: 'System prompt', tokens: 7_800, color: 'claude' },
          { name: 'System tools', tokens: 15_500, color: 'promptBorder' },
          { name: 'Memory files', tokens: 956, color: 'inactive' },
          { name: 'Messages', tokens: 84, color: 'permission' },
        ],
        totalTokens: 24_340,
        maxTokens: 131_072,
        rawMaxTokens: 131_072,
        percentage: 19,
        gridRows: [],
        model: 'claude-sonnet-4',
        memoryFiles: [],
        mcpTools: [],
        agents: [],
        isAutoCompactEnabled: true,
        autoCompactThreshold: 98_000,
      }),
    }))

    mock.module('../../services/compact/autoCompact.js', () => ({
      getEffectiveContextWindowSize: () => 200_000,
      getAutoCompactThreshold: () => 98_000,
      isAutoCompactEnabled: () => true,
    }))

    mock.module('../../utils/context.js', () => ({
      getContextWindowForModel: () => 200_000,
      getModelMaxOutputTokens: () => ({ default: 8_192, upperLimit: 8_192 }),
    }))

    mock.module('../../utils/model/model.js', () => ({
      getCanonicalName: (m: string) => m,
    }))

    mock.module('../../bootstrap/state.js', () => ({
      getSdkBetas: () => [],
      getModelUsage: () => ({}),
      getTotalInputTokens: () => 0,
      getTotalOutputTokens: () => 0,
      getTotalCacheReadInputTokens: () => 0,
      getTotalCacheCreationInputTokens: () => 0,
      getTotalCostUSD: () => 0,
      getTotalAPIDuration: () => 0,
      getTotalDuration: () => 0,
      getTotalLinesAdded: () => 0,
      getTotalLinesRemoved: () => 0,
    }))

    // Re-import the module so the mocks above are wired up.
    const mod = (await import(
      `./ctx-noninteractive.ts?render=${Date.now()}-${Math.random()}`
    )) as {
      call: (
        args: string,
        context: unknown,
      ) => Promise<{ type: string; value: string }>
    }

    const result = await mod.call('', {
      messages: [],
      getAppState: () => ({ toolPermissionContext: { mode: 'default' } }),
      options: {
        mainLoopModel: 'claude-sonnet-4',
        tools: [],
        agentDefinitions: { activeAgents: [], allAgents: [] },
      },
    } as unknown as Parameters<typeof mod.call>[1])

    expect(result.type).toBe('text')
    const out = String(result.value)

    // Header line — confirms the model name is rendered.
    expect(out).toContain('Context Window:')
    // Window Capacity block (4 bullets).
    expect(out).toContain('Window Capacity')
    expect(out).toContain('Context window:')
    expect(out).toContain('Effective context:')
    expect(out).toContain('Max output:')
    // Auto-compact line is rendered because the fixture sets
    // isAutoCompactEnabled: true.
    expect(out).toContain('Auto-compact at:')
    // Current Context block + total.
    expect(out).toContain('Current Context (what the model sees)')
    expect(out).toContain('Total:')
    expect(out).toMatch(/used\)/)
    // Each non-zero category in the fixture appears in the output.
    for (const cat of [
      'System prompt',
      'System tools',
      'Memory files',
      'Messages',
    ]) {
      expect(out).toContain(cat)
    }
    // Bar characters — width 30, ratio = tokens / contextWindow (200k).
    // With the fixture:
    //   System tools  15.5k / 200k →  2 filled
    //   System prompt  7.8k  / 200k →  1 filled
    //   Memory files   956   / 200k →  0 filled
    //   Messages       84    / 200k →  0 filled
    expect(out).toContain('█'.repeat(2) + '░'.repeat(28))
    expect(out).toContain('█'.repeat(1) + '░'.repeat(29))
    expect(out).toMatch(/░{30}/)
    // Footer cross-references the sibling commands.
    expect(out).toContain('/context')
    expect(out).toContain('/cost')
    expect(out).toContain('/stats')
  })
})
