import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import command from './index.js'
import * as settingsModule from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import type { LocalCommandResult } from '../../types/command.js'

// The command always returns a `text` result; narrow the union so `.value` is
// accessible without an `as` cast (and assert that contract while we're here).
function expectText(res: LocalCommandResult): Extract<LocalCommandResult, { type: 'text' }> {
  if (res.type !== 'text') throw new Error(`expected a text result, got ${res.type}`)
  return res
}

// Two model-only agentModels keys with first-party-priced models so the
// cheaper-than warning can be exercised: haiku (cheap) vs opus (expensive).
const AGENT_MODELS = {
  mini: { model: 'claude-haiku-4-5' },
  main: { model: 'claude-opus-4-5' },
}
const SMART_ROUTING_ENV_KEYS = [
  'OPENCLAUDE_SMART_ROUTING',
  'OPENCLAUDE_SMART_ROUTING_SIMPLE',
  'OPENCLAUDE_SMART_ROUTING_STRONG',
] as const

function makeContext(initial: Partial<SettingsJson> = {}) {
  let state = {
    settings: { agentModels: AGENT_MODELS, ...initial } as SettingsJson,
  }
  return {
    getAppState: () => state as never,
    setAppState: (updater: (s: typeof state) => typeof state) => {
      state = updater(state)
    },
    _state: () => state,
  } as unknown as Parameters<Awaited<ReturnType<typeof command.load>>['call']>[1] & {
    _state: () => typeof state
  }
}

describe('/smartroute command', () => {
  let writeSpy: ReturnType<typeof spyOn>
  let call: Awaited<ReturnType<typeof command.load>>['call']
  let savedEnv: Record<(typeof SMART_ROUTING_ENV_KEYS)[number], string | undefined>

  beforeEach(async () => {
    savedEnv = Object.fromEntries(SMART_ROUTING_ENV_KEYS.map(key => [key, process.env[key]])) as typeof savedEnv
    for (const key of SMART_ROUTING_ENV_KEYS) delete process.env[key]
    writeSpy = spyOn(settingsModule, 'updateSettingsForSource').mockImplementation(() => ({ error: null }))
    call = (await command.load()).call
  })
  afterEach(() => {
    writeSpy.mockRestore()
    for (const key of SMART_ROUTING_ENV_KEYS) {
      const value = savedEnv[key]
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
  })

  test('status with no config shows disabled and available keys', async () => {
    const ctx = makeContext()
    const res = expectText(await call('', ctx))
    expect(res.value).toContain('status: disabled')
    expect(res.value).toContain('mini, main')
  })

  test('status shows env-backed role values when settings have no smartRouting block', async () => {
    process.env.OPENCLAUDE_SMART_ROUTING = '1'
    process.env.OPENCLAUDE_SMART_ROUTING_SIMPLE = 'mini'
    process.env.OPENCLAUDE_SMART_ROUTING_STRONG = 'main'
    const ctx = makeContext()
    const res = expectText(await call('', ctx))
    expect(res.value).toContain('status: enabled')
    expect(res.value).toContain('simple: mini')
    expect(res.value).toContain('strong: main')
  })

  test('on without both roles set is rejected', async () => {
    const ctx = makeContext({ smartRouting: { enabled: false, simpleModel: 'mini' } })
    const res = expectText(await call('on', ctx))
    expect(res.value).toContain('Set both roles first')
    expect(writeSpy).not.toHaveBeenCalled()
  })

  test('on accepts env-backed roles and persists the normalized settings block', async () => {
    process.env.OPENCLAUDE_SMART_ROUTING = '1'
    process.env.OPENCLAUDE_SMART_ROUTING_SIMPLE = 'mini'
    process.env.OPENCLAUDE_SMART_ROUTING_STRONG = 'main'
    const ctx = makeContext()
    const res = expectText(await call('on', ctx))
    expect(res.value).toContain('Smart routing enabled')
    expect(writeSpy).toHaveBeenCalledWith('userSettings', {
      smartRouting: { enabled: true, simpleModel: 'mini', strongModel: 'main' },
    })
    expect(ctx._state().settings.smartRouting).toEqual({
      enabled: true,
      simpleModel: 'mini',
      strongModel: 'main',
    })
  })

  test('setting simple/strong to a valid key persists', async () => {
    const ctx = makeContext()
    await call('simple mini', ctx)
    expect(writeSpy).toHaveBeenCalledWith('userSettings', { smartRouting: { simpleModel: 'mini' } })
    expect((ctx as never as { _state: () => { settings: SettingsJson } })._state().settings.smartRouting).toEqual({
      simpleModel: 'mini',
    })
  })

  test('setting a role reports persistence errors without mutating app state', async () => {
    writeSpy.mockImplementation(() => ({ error: new Error('settings are read-only') }))
    const ctx = makeContext()
    const res = expectText(await call('simple mini', ctx))
    expect(res.value).toContain('Failed to update smart routing settings: settings are read-only')
    expect(ctx._state().settings.smartRouting).toBeUndefined()
  })

  test('setting the strong role to a valid key persists', async () => {
    const ctx = makeContext()
    await call('strong main', ctx)
    expect(writeSpy).toHaveBeenCalledWith('userSettings', { smartRouting: { strongModel: 'main' } })
  })

  test('setting one role preserves env-backed defaults instead of shadowing them with a partial block', async () => {
    process.env.OPENCLAUDE_SMART_ROUTING = '1'
    process.env.OPENCLAUDE_SMART_ROUTING_SIMPLE = 'mini'
    process.env.OPENCLAUDE_SMART_ROUTING_STRONG = 'main'
    const ctx = makeContext()
    await call('simple main', ctx)
    expect(writeSpy).toHaveBeenCalledWith('userSettings', {
      smartRouting: { enabled: true, simpleModel: 'main', strongModel: 'main' },
    })
  })

  test('simple/strong with no value argument is rejected', async () => {
    const ctx = makeContext()
    const res = expectText(await call('simple', ctx))
    expect(res.value).toContain('Specify an agentModels key')
    expect(writeSpy).not.toHaveBeenCalled()
  })

  test('setting a role to an unknown key is rejected with available keys', async () => {
    const ctx = makeContext()
    const res = expectText(await call('simple nope', ctx))
    expect(res.value).toContain('not a configured agentModels key')
    expect(res.value).toContain('mini, main')
    expect(writeSpy).not.toHaveBeenCalled()
  })

  test('enabling with simple cheaper than strong gives no warning', async () => {
    const ctx = makeContext({ smartRouting: { enabled: false, simpleModel: 'mini', strongModel: 'main' } })
    const res = expectText(await call('on', ctx))
    expect(res.value).toContain('Smart routing enabled')
    expect(res.value).not.toContain('Heads up')
    expect(writeSpy).toHaveBeenCalledWith('userSettings', {
      smartRouting: { enabled: true, simpleModel: 'mini', strongModel: 'main' },
    })
  })

  test('warns when the simple model is not cheaper than the strong model', async () => {
    // Swap roles: simple=opus (expensive), strong=haiku (cheap).
    const ctx = makeContext({ smartRouting: { enabled: false, simpleModel: 'main', strongModel: 'mini' } })
    const res = expectText(await call('on', ctx))
    expect(res.value).toContain('Heads up')
    expect(res.value).toContain('not cheaper')
    // The warning must be hedged as first-party reference pricing, since the
    // active provider may bill these models differently (jatmn P2).
    expect(res.value).toContain('first-party reference pricing')
    expect(res.value).toContain('provider may bill differently')
  })

  test('off disables', async () => {
    const ctx = makeContext({ smartRouting: { enabled: true, simpleModel: 'mini', strongModel: 'main' } })
    const res = expectText(await call('off', ctx))
    expect(res.value).toContain('disabled')
    expect(writeSpy).toHaveBeenCalledWith('userSettings', {
      smartRouting: { enabled: false, simpleModel: 'mini', strongModel: 'main' },
    })
  })
})
