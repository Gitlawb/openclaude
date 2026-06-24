import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { SettingsJson } from '../../utils/settings/types.js'
import * as settingsModule from '../../utils/settings/settings.js'
import {
  CLEAR_ROUTE_VALUE,
  buildRouteOptions,
  clearAgentRoute,
  computeClearRouteUpdate,
  computeSetRouteUpdate,
  collectShadowedModelKeys,
  currentRouteValue,
  describeRouteLine,
  findModelKeyShadowingSource,
  findShadowingSource,
  readAgentRoute,
  setAgentRoute,
  shadowRemediation,
} from './agentRouteSettings.js'
import type { SettingsWithSources } from '../../utils/settings/settings.js'
import {
  getAllowedSettingSources,
  setAllowedSettingSources,
} from '../../bootstrap/state.js'

const modelOnly: SettingsJson = {
  agentModels: { mini: { model: 'gpt-5-mini' } },
  agentRouting: { verification: 'mini' },
} as unknown as SettingsJson

const crossProvider: SettingsJson = {
  agentModels: { ds: { base_url: 'https://api.deepseek.com/v1', api_key: 'sk-x', model: 'deepseek-chat' } },
  agentRouting: { Explore: 'ds' },
} as unknown as SettingsJson

const dangling: SettingsJson = {
  agentRouting: { Plan: 'ghost' },
} as unknown as SettingsJson

describe('readAgentRoute', () => {
  test('none when no agentRouting entry', () => {
    expect(readAgentRoute({} as SettingsJson, 'verification')).toEqual({ kind: 'none' })
    expect(readAgentRoute(null, 'verification')).toEqual({ kind: 'none' })
  })

  test('model-only entry', () => {
    expect(readAgentRoute(modelOnly, 'verification')).toEqual({
      kind: 'model-only',
      routeKey: 'mini',
      model: 'gpt-5-mini',
    })
  })

  test('cross-provider entry', () => {
    expect(readAgentRoute(crossProvider, 'Explore')).toEqual({
      kind: 'cross-provider',
      routeKey: 'ds',
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
    })
  })

  test('dangling when routing points at a missing agentModels key', () => {
    expect(readAgentRoute(dangling, 'Plan')).toEqual({ kind: 'dangling', routeKey: 'ghost' })
  })

  test('partial cross-provider entry (one cred) is unconfigured like the runtime', () => {
    // toAgentRoute skips an entry with only base_url or only api_key, so it
    // inherits at runtime; the UI must not present it as a working route.
    const halfBase = {
      agentModels: { half: { base_url: 'https://api.example.com/v1' } },
      agentRouting: { verification: 'half' },
    } as unknown as SettingsJson
    expect(readAgentRoute(halfBase, 'verification')).toEqual({ kind: 'dangling', routeKey: 'half' })

    const halfKey = {
      agentModels: { half: { api_key: 'sk-only' } },
      agentRouting: { verification: 'half' },
    } as unknown as SettingsJson
    expect(readAgentRoute(halfKey, 'verification')).toEqual({ kind: 'dangling', routeKey: 'half' })
  })

  test('model defaults to the route key when entry has no model', () => {
    const s = { agentModels: { haiku: {} }, agentRouting: { verification: 'haiku' } } as unknown as SettingsJson
    expect(readAgentRoute(s, 'verification')).toEqual({ kind: 'model-only', routeKey: 'haiku', model: 'haiku' })
  })

  test('matches a normalized routing key the runtime would resolve (hyphen vs underscore)', () => {
    // Runtime normalizes "general_purpose" and "general-purpose" to the same key,
    // so an exact-key read would wrongly report this agent as inheriting.
    const s = {
      agentModels: { mini: { model: 'gpt-5-mini' } },
      agentRouting: { general_purpose: 'mini' },
    } as unknown as SettingsJson
    expect(readAgentRoute(s, 'general-purpose')).toEqual({ kind: 'model-only', routeKey: 'mini', model: 'gpt-5-mini' })
  })

  test('surfaces a default-fallback route with viaDefault', () => {
    const s = {
      agentModels: { mini: { model: 'gpt-5-mini' } },
      agentRouting: { default: 'mini' },
    } as unknown as SettingsJson
    expect(readAgentRoute(s, 'Explore')).toEqual({
      kind: 'model-only',
      routeKey: 'mini',
      model: 'gpt-5-mini',
      viaDefault: true,
    })
  })

  test('an own route key wins over the default fallback', () => {
    const s = {
      agentModels: { mini: { model: 'gpt-5-mini' }, haiku: {} },
      agentRouting: { default: 'mini', Explore: 'haiku' },
    } as unknown as SettingsJson
    expect(readAgentRoute(s, 'Explore')).toEqual({ kind: 'model-only', routeKey: 'haiku', model: 'haiku' })
  })
})

describe('computeSetRouteUpdate', () => {
  test('creates a model-only entry and points routing at it', () => {
    const next = computeSetRouteUpdate({} as SettingsJson, 'verification', 'haiku')
    expect(next.agentModels).toEqual({ haiku: { model: 'haiku' } })
    expect(next.agentRouting).toEqual({ verification: 'haiku' })
  })

  test('does NOT clobber an existing agentModels entry (e.g. cross-provider)', () => {
    const next = computeSetRouteUpdate(crossProvider, 'verification', 'ds')
    expect(next.agentModels).toEqual({
      ds: { base_url: 'https://api.deepseek.com/v1', api_key: 'sk-x', model: 'deepseek-chat' },
    })
    expect(next.agentRouting).toEqual({ Explore: 'ds', verification: 'ds' })
  })

  test('preserves unrelated routing entries', () => {
    const next = computeSetRouteUpdate(modelOnly, 'Explore', 'mini')
    expect(next.agentRouting).toEqual({ verification: 'mini', Explore: 'mini' })
  })

  test('overwrites the existing normalized key in place instead of adding a sibling', () => {
    const s = {
      agentModels: { mini: { model: 'gpt-5-mini' }, haiku: {} },
      agentRouting: { general_purpose: 'mini' },
    } as unknown as SettingsJson
    const next = computeSetRouteUpdate(s, 'general-purpose', 'haiku')
    // The runtime first-wins lookup would ignore a "general-purpose" sibling, so
    // we must reuse the existing "general_purpose" spelling.
    expect(next.agentRouting).toEqual({ general_purpose: 'haiku' })
  })
})

describe('computeClearRouteUpdate', () => {
  test('marks the routing key as undefined for deletion', () => {
    const next = computeClearRouteUpdate(modelOnly, 'verification') as unknown as {
      agentRouting: Record<string, string | undefined>
    }
    expect('verification' in next.agentRouting).toBe(true)
    expect(next.agentRouting.verification).toBeUndefined()
  })

  test('clears the existing normalized key spelling', () => {
    const s = { agentRouting: { general_purpose: 'mini' } } as unknown as SettingsJson
    const next = computeClearRouteUpdate(s, 'general-purpose') as unknown as {
      agentRouting: Record<string, string | undefined>
    }
    expect('general_purpose' in next.agentRouting).toBe(true)
    expect(next.agentRouting.general_purpose).toBeUndefined()
  })
})

describe('buildRouteOptions', () => {
  test('includes built-in model aliases, excludes inherit, no clear when route is none', () => {
    const opts = buildRouteOptions({} as SettingsJson, { kind: 'none' })
    const values = opts.map(o => o.value)
    expect(values).toContain('sonnet')
    expect(values).toContain('opus')
    expect(values).toContain('haiku')
    expect(values).not.toContain('inherit')
    expect(values).not.toContain(CLEAR_ROUTE_VALUE)
  })

  test('adds a clear option when a route is set, and labels cross-provider keys', () => {
    const opts = buildRouteOptions(crossProvider, { kind: 'cross-provider', routeKey: 'ds', model: 'deepseek-chat', baseURL: 'x' })
    const clear = opts.find(o => o.value === CLEAR_ROUTE_VALUE)
    expect(clear).toBeDefined()
    const ds = opts.find(o => o.value === 'ds')
    expect(ds?.label).toContain('cross-provider')
  })

  test('omits the clear option for a default-inherited route (nothing own to clear)', () => {
    const s = {
      agentModels: { mini: { model: 'gpt-5-mini' } },
      agentRouting: { default: 'mini' },
    } as unknown as SettingsJson
    const opts = buildRouteOptions(s, { kind: 'model-only', routeKey: 'mini', model: 'gpt-5-mini', viaDefault: true })
    expect(opts.map(o => o.value)).not.toContain(CLEAR_ROUTE_VALUE)
  })

  test('labels a partial cross-provider key as unconfigured, not cross-provider', () => {
    const half = {
      agentModels: { half: { base_url: 'https://api.example.com/v1' } },
      agentRouting: { verification: 'half' },
    } as unknown as SettingsJson
    const opts = buildRouteOptions(half, { kind: 'dangling', routeKey: 'half' })
    const entry = opts.find(o => o.value === 'half')
    expect(String(entry?.label)).toContain('unconfigured')
    expect(String(entry?.label)).not.toContain('cross-provider')
  })

  test('clear label promises default route, not parent, when a default applies', () => {
    const opts = buildRouteOptions(
      modelOnly,
      { kind: 'model-only', routeKey: 'mini', model: 'gpt-5-mini' },
      { defaultRouteApplies: true },
    )
    const clear = opts.find(o => o.value === CLEAR_ROUTE_VALUE)
    expect(String(clear?.label)).toContain('default route')
    expect(String(clear?.label)).not.toContain('inherit from parent')
  })

  test('clear label promises parent inheritance when no default applies', () => {
    const opts = buildRouteOptions(
      modelOnly,
      { kind: 'model-only', routeKey: 'mini', model: 'gpt-5-mini' },
      { defaultRouteApplies: false },
    )
    const clear = opts.find(o => o.value === CLEAR_ROUTE_VALUE)
    expect(String(clear?.label)).toContain('inherit from parent')
  })

  test('flags a model key shadowed by a higher source', () => {
    const opts = buildRouteOptions(
      {} as SettingsJson,
      { kind: 'none' },
      { shadowedModelKeys: new Set(['sonnet']) },
    )
    const sonnet = opts.find(o => o.value === 'sonnet')
    expect(String(sonnet?.label)).toContain('shadowed by higher settings')
    // Non-shadowed built-ins are unaffected.
    const opus = opts.find(o => o.value === 'opus')
    expect(String(opus?.label)).not.toContain('shadowed')
  })
})

describe('currentRouteValue', () => {
  test('returns the route key for any assigned route, undefined only for none', () => {
    expect(currentRouteValue({ kind: 'model-only', routeKey: 'mini', model: 'gpt-5-mini' })).toBe('mini')
    expect(currentRouteValue({ kind: 'dangling', routeKey: 'ghost' })).toBe('ghost')
    expect(currentRouteValue({ kind: 'none' })).toBeUndefined()
  })
})

describe('describeRouteLine', () => {
  test('produces a readable line per kind', () => {
    expect(describeRouteLine({ kind: 'none' })).toContain('inherits')
    expect(describeRouteLine({ kind: 'model-only', routeKey: 'm', model: 'gpt-5-mini' })).toContain('gpt-5-mini')
    expect(describeRouteLine({ kind: 'cross-provider', routeKey: 'ds', model: 'deepseek-chat', baseURL: 'x' })).toContain('cross-provider')
    expect(describeRouteLine({ kind: 'dangling', routeKey: 'ghost' })).toContain('ghost')
  })

  test('marks a default-inherited route', () => {
    expect(
      describeRouteLine({ kind: 'model-only', routeKey: 'm', model: 'gpt-5-mini', viaDefault: true }),
    ).toContain('via default')
  })
})

describe('findShadowingSource', () => {
  const src = (
    source: string,
    agentRouting: Record<string, string>,
  ): SettingsWithSources['sources'][number] =>
    ({ source, settings: { agentRouting } } as unknown as SettingsWithSources['sources'][number])

  test('null when only userSettings defines the route', () => {
    expect(findShadowingSource([src('userSettings', { verification: 'mini' })], 'verification')).toBeNull()
  })

  test('null when a higher source has no matching key', () => {
    const sources = [src('userSettings', { verification: 'mini' }), src('projectSettings', { Explore: 'haiku' })]
    expect(findShadowingSource(sources, 'verification')).toBeNull()
  })

  test('returns a higher-priority source that overrides the user route', () => {
    const sources = [src('userSettings', { verification: 'mini' }), src('projectSettings', { verification: 'proj' })]
    expect(findShadowingSource(sources, 'verification')).toBe('projectSettings')
  })

  test('matches by runtime normalization, not exact key', () => {
    const sources = [src('userSettings', {}), src('localSettings', { general_purpose: 'x' })]
    expect(findShadowingSource(sources, 'general-purpose')).toBe('localSettings')
  })

  test('shadows even when userSettings is absent', () => {
    expect(findShadowingSource([src('projectSettings', { verification: 'proj' })], 'verification')).toBe('projectSettings')
  })

  test('returns the highest-priority shadowing source', () => {
    const sources = [
      src('userSettings', { verification: 'mini' }),
      src('projectSettings', { verification: 'proj' }),
      src('policySettings', { verification: 'pol' }),
    ]
    expect(findShadowingSource(sources, 'verification')).toBe('policySettings')
  })
})

describe('findModelKeyShadowingSource', () => {
  const src = (
    source: string,
    agentModels: Record<string, unknown>,
  ): SettingsWithSources['sources'][number] =>
    ({ source, settings: { agentModels } } as unknown as SettingsWithSources['sources'][number])

  test('null when only userSettings defines the model key', () => {
    expect(findModelKeyShadowingSource([src('userSettings', { sonnet: { model: 'sonnet' } })], 'sonnet')).toBeNull()
  })

  test('returns a higher source that defines the same agentModels key', () => {
    const sources = [
      src('userSettings', {}),
      src('projectSettings', { sonnet: { base_url: 'x', api_key: 'k', model: 'team-sonnet' } }),
    ]
    expect(findModelKeyShadowingSource(sources, 'sonnet')).toBe('projectSettings')
  })

  test('uses exact key match (not normalized), mirroring the resolver', () => {
    const sources = [src('userSettings', {}), src('projectSettings', { 'gpt_5': {} })]
    expect(findModelKeyShadowingSource(sources, 'gpt-5')).toBeNull()
  })

  test('shadows even when userSettings is absent', () => {
    expect(findModelKeyShadowingSource([src('policySettings', { sonnet: {} })], 'sonnet')).toBe('policySettings')
  })

  test('returns the highest-priority shadowing source', () => {
    const sources = [
      src('userSettings', { sonnet: { model: 'sonnet' } }),
      src('projectSettings', { sonnet: {} }),
      src('policySettings', { sonnet: {} }),
    ]
    expect(findModelKeyShadowingSource(sources, 'sonnet')).toBe('policySettings')
  })

  test('shadows a key the user also defines (the user entry is the one shadowed)', () => {
    const sources = [
      src('userSettings', { sonnet: { model: 'sonnet' } }),
      src('projectSettings', { sonnet: { base_url: 'x', api_key: 'k', model: 'team' } }),
    ]
    // Owning the key in userSettings does not save it from being shadowed.
    expect(findModelKeyShadowingSource(sources, 'sonnet')).toBe('projectSettings')
  })

  test('collectShadowedModelKeys agrees with findModelKeyShadowingSource', () => {
    // The offer path (this set) and the save guard (find...) must never disagree
    // on what is shadowed, or the picker flags a key it still lets you save.
    const sources = [
      src('userSettings', { sonnet: { model: 'sonnet' }, mine: {} }),
      src('projectSettings', { sonnet: {}, teamModel: {} }),
      src('policySettings', { locked: {} }),
    ]
    const set = collectShadowedModelKeys(sources)
    expect(set).toEqual(new Set(['sonnet', 'teamModel', 'locked']))
    for (const key of set) {
      expect(findModelKeyShadowingSource(sources, key)).not.toBeNull()
    }
    // A user-only key is not in the set and is not shadowed.
    expect(set.has('mine')).toBe(false)
    expect(findModelKeyShadowingSource(sources, 'mine')).toBeNull()
  })
})

describe('shadowRemediation', () => {
  test('points file-backed sources at their settings file', () => {
    expect(shadowRemediation('projectSettings')).toContain('Edit the projectSettings settings')
    expect(shadowRemediation('policySettings')).toContain('Edit the policySettings settings')
  })

  test('flagSettings has no file to edit', () => {
    const msg = shadowRemediation('flagSettings')
    expect(msg).not.toContain('Edit the')
    expect(msg).toContain('--settings flag')
  })
})

describe('setAgentRoute model-key shadow guard', () => {
  const sourcesWith = (
    entries: Array<[string, Record<string, unknown>]>,
  ): SettingsWithSources =>
    ({
      effective: {} as SettingsJson,
      sources: entries.map(([source, agentModels]) => ({
        source,
        settings: { agentModels },
      })),
    } as unknown as SettingsWithSources)

  let withSources: ReturnType<typeof spyOn> | undefined
  let update: ReturnType<typeof spyOn> | undefined
  let forSource: ReturnType<typeof spyOn> | undefined

  afterEach(() => {
    withSources?.mockRestore()
    update?.mockRestore()
    forSource?.mockRestore()
    withSources = update = forSource = undefined
  })

  test('rejects a key shadowed by a higher-priority source', () => {
    // projectSettings defines agentModels.mini, which wins on merge, so a
    // user-level route to "mini" would resolve to the project entry, not the
    // current-provider model the option promised. The save must be refused.
    withSources = spyOn(settingsModule, 'getSettingsWithSources').mockReturnValue(
      sourcesWith([
        ['userSettings', { mini: { model: 'gpt-5-mini' } }],
        ['projectSettings', { mini: { model: 'project-model' } }],
      ]),
    )
    update = spyOn(settingsModule, 'updateSettingsForSource')

    const { error } = setAgentRoute('verification', 'mini')
    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toContain('projectSettings')
    // The guard must short-circuit before any write lands.
    expect(update).not.toHaveBeenCalled()
  })

  test('saves a user-only key that nothing higher shadows', () => {
    withSources = spyOn(settingsModule, 'getSettingsWithSources').mockReturnValue(
      sourcesWith([['userSettings', { mine: { model: 'gpt-5-mini' } }]]),
    )
    forSource = spyOn(settingsModule, 'getSettingsForSource').mockReturnValue(
      { agentModels: { mine: { model: 'gpt-5-mini' } } } as unknown as SettingsJson,
    )
    update = spyOn(settingsModule, 'updateSettingsForSource').mockReturnValue({
      error: null,
    })

    const { error } = setAgentRoute('verification', 'mine')
    expect(error).toBeNull()
    expect(update).toHaveBeenCalledTimes(1)
    const [source, next] = update.mock.calls[0] as [string, SettingsJson]
    expect(source).toBe('userSettings')
    expect((next.agentRouting as Record<string, string>).verification).toBe('mine')
  })
})

describe('write guard when user settings are disabled', () => {
  afterEach(() => {
    // Restore the full default source set for other tests.
    setAllowedSettingSources([
      'userSettings',
      'projectSettings',
      'localSettings',
      'flagSettings',
      'policySettings',
    ])
  })

  test('setAgentRoute refuses and explains when userSettings is not enabled', () => {
    const before = getAllowedSettingSources()
    expect(before).toContain('userSettings')
    // Simulate `--setting-sources project`: user settings excluded.
    setAllowedSettingSources(['projectSettings'])

    const { error } = setAgentRoute('verification', 'gpt-5-mini')
    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toContain('User settings are disabled')
    expect(error!.message).toContain('--setting-sources')
  })

  test('clearAgentRoute refuses when userSettings is not enabled', () => {
    setAllowedSettingSources(['projectSettings'])
    const { error } = clearAgentRoute('verification')
    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toContain('User settings are disabled')
  })
})
