import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'

import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js'

import {
  setAllowedChannels,
  setHasDevChannels,
} from '../../bootstrap/state.js'
import type { ChannelEntry } from '../../bootstrap/state.js'
import { gateChannelServer } from './channelNotification.js'

// Module-level mocks for the GrowthBook-backed helpers. The gate
// reads these on every call; resetting between tests keeps the
// scenarios independent.
let _channelsEnabled = true
let _allowlist: ReadonlyArray<{ marketplace: string; plugin: string }> = []

mock.module('./channelAllowlist.js', () => ({
  isChannelsEnabled: () => _channelsEnabled,
  getChannelAllowlist: () => _allowlist,
  isChannelAllowlisted: (pluginSource: string | undefined) => {
    if (!pluginSource) return false
    // Tests don't exercise this path — it duplicates
    // gateChannelServer's logic for UI pre-filtering only.
    return false
  },
}))

function cap(extra: Record<string, unknown> = {}): ServerCapabilities {
  return {
    experimental: {
      'claude/channel': {},
      ...extra,
    },
  } as ServerCapabilities
}

beforeEach(() => {
  _channelsEnabled = true
  _allowlist = []
  setAllowedChannels([])
  setHasDevChannels(false)
})

afterEach(() => {
  setAllowedChannels([])
  setHasDevChannels(false)
})

describe('gateChannelServer', () => {
  // 1. Capability gate — channel path requires the experimental
  // capability; absent/undefined/false skips.
  test('skips when server has no claude/channel capability', () => {
    const result = gateChannelServer(
      'slack',
      {} as ServerCapabilities,
      undefined,
    )
    if (result.action !== 'skip') {
      throw new Error(`expected skip, got ${result.action}`)
    }
    expect(result.kind).toBe('capability')
  })

  test('skips when capability is explicitly false', () => {
    const result = gateChannelServer(
      'slack',
      {
        experimental: { 'claude/channel': false },
      } as unknown as ServerCapabilities,
      undefined,
    )
    if (result.action !== 'skip') {
      throw new Error(`expected skip, got ${result.action}`)
    }
    expect(result.kind).toBe('capability')
  })

  test('capability alone is not sufficient — session allowlist still applies', () => {
    // Capability present, but no --channels entry. The gate must
    // still hit the session gate. The dev-bypass test below
    // covers the success path through capability → session →
    // server-entry dev gate.
    const result = gateChannelServer('slack', cap(), undefined)
    if (result.action !== 'skip') {
      throw new Error(`expected skip, got ${result.action}`)
    }
    expect(result.kind).toBe('session')
  })

  // 2. Runtime gate — disabled when GrowthBook says so.
  test('skips when channels are globally disabled', () => {
    _channelsEnabled = false
    const result = gateChannelServer('slack', cap(), undefined)
    if (result.action !== 'skip') {
      throw new Error(`expected skip, got ${result.action}`)
    }
    expect(result.kind).toBe('disabled')
  })

  // 3. Session allowlist gate — server not in --channels list.
  test('skips when server is not in --channels session list', () => {
    const result = gateChannelServer('slack', cap(), undefined)
    if (result.action !== 'skip') {
      throw new Error(`expected skip, got ${result.action}`)
    }
    expect(result.kind).toBe('session')
  })

  test('registers server-kind entry when present in --channels list', () => {
    setAllowedChannels([{ kind: 'server', name: 'slack', dev: true }])
    const result = gateChannelServer('slack', cap(), undefined)
    expect(result.action).toBe('register')
  })

  // 4. Marketplace gate (plugin only) — tag and runtime source disagree.
  test('skips when plugin tag marketplace differs from installed source', () => {
    setAllowedChannels([
      { kind: 'plugin', name: 'slack', marketplace: 'anthropic' },
    ])
    const result = gateChannelServer(
      'plugin:slack',
      cap(),
      'plugin:slack@evilcorp',
    )
    if (result.action !== 'skip') {
      throw new Error(`expected skip, got ${result.action}`)
    }
    expect(result.kind).toBe('marketplace')
  })

  test('proceeds past marketplace check when tag matches source', () => {
    setAllowedChannels([
      { kind: 'plugin', name: 'slack', marketplace: 'anthropic' },
    ])
    _allowlist = [{ marketplace: 'anthropic', plugin: 'slack' }]
    const result = gateChannelServer(
      'plugin:slack',
      cap(),
      'plugin:slack@anthropic',
    )
    expect(result.action).toBe('register')
  })

  // 5. Plugin allowlist gate — entry kind=plugin and not on ledger.
  test('skips plugin not on the approved channels allowlist', () => {
    setAllowedChannels([
      { kind: 'plugin', name: 'slack', marketplace: 'anthropic' },
    ])
    _allowlist = [] // empty — slack not approved
    const result = gateChannelServer(
      'plugin:slack',
      cap(),
      'plugin:slack@anthropic',
    )
    if (result.action !== 'skip') {
      throw new Error(`expected skip, got ${result.action}`)
    }
    expect(result.kind).toBe('allowlist')
  })

  test('plugin dev flag bypasses the approved-list check', () => {
    setAllowedChannels([
      { kind: 'plugin', name: 'slack', marketplace: 'anthropic', dev: true },
    ])
    _allowlist = [] // would normally fail
    const result = gateChannelServer(
      'plugin:slack',
      cap(),
      'plugin:slack@anthropic',
    )
    expect(result.action).toBe('register')
  })

  // 6. Server-entry dev gate — server-kind entries always need dev.
  test('skips server-kind entry without dev flag', () => {
    setAllowedChannels([{ kind: 'server', name: 'slack' }]) // no dev
    const result = gateChannelServer('slack', cap(), undefined)
    if (result.action !== 'skip') {
      throw new Error(`expected skip, got ${result.action}`)
    }
    expect(result.kind).toBe('allowlist')
  })

  test('server-kind entry with dev flag bypasses the allowlist gate', () => {
    setAllowedChannels([{ kind: 'server', name: 'slack', dev: true }])
    const result = gateChannelServer('slack', cap(), undefined)
    expect(result.action).toBe('register')
  })

  // 7. End-to-end positive path.
  test('end-to-end register: capable server, allowlisted plugin, matching marketplace', () => {
    _allowlist = [{ marketplace: 'anthropic', plugin: 'slack' }]
    setAllowedChannels([
      { kind: 'plugin', name: 'slack', marketplace: 'anthropic' },
    ])
    const result = gateChannelServer(
      'plugin:slack',
      cap(),
      'plugin:slack@anthropic',
    )
    expect(result.action).toBe('register')
  })
})
