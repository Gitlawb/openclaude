import { describe, expect, test } from 'bun:test'
import type { SettingsJson } from '../../utils/settings/types.js'
import {
  CLEAR_ROUTE_VALUE,
  buildRouteOptions,
  computeClearRouteUpdate,
  computeSetRouteUpdate,
  currentRouteValue,
  describeRouteLine,
  readAgentRoute,
} from './agentRouteSettings.js'

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

  test('model defaults to the route key when entry has no model', () => {
    const s = { agentModels: { haiku: {} }, agentRouting: { verification: 'haiku' } } as unknown as SettingsJson
    expect(readAgentRoute(s, 'verification')).toEqual({ kind: 'model-only', routeKey: 'haiku', model: 'haiku' })
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
})

describe('computeClearRouteUpdate', () => {
  test('marks the routing key as undefined for deletion', () => {
    const next = computeClearRouteUpdate('verification') as unknown as {
      agentRouting: Record<string, string | undefined>
    }
    expect('verification' in next.agentRouting).toBe(true)
    expect(next.agentRouting.verification).toBeUndefined()
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
})
