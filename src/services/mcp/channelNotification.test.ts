/**
 * Focused tests for the channel notification trust-sensitive paths:
 *   - gateChannelServer(): approved plugin, dev channel, non-allowlisted,
 *     server-kind, marketplace verification
 *   - findChannelEntry(): plugin vs server matching
 *
 * These validate that the OpenClaude trust model: explicit opt-in via
 * --channels for all entries (no auto-registration).
 */
import {
  describe,
  expect,
  test,
  mock,
  beforeEach,
  afterEach,
} from 'bun:test'
import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js'
import type { ChannelEntry } from '../../bootstrap/state.js'

// ---------------------------------------------------------------------------
// Module-level mocks — isolate from real global state
// ---------------------------------------------------------------------------

let mockAllowedChannels: ChannelEntry[] = []
let mockChannelsEnabled = true
const mockAllowlist = [
  { marketplace: 'claude-plugins-official', plugin: 'telegram' },
  { marketplace: 'claude-plugins-official', plugin: 'discord' },
  { marketplace: 'claude-plugins-official', plugin: 'imessage' },
  { marketplace: 'claude-plugins-official', plugin: 'fakechat' },
]

beforeEach(() => {
  mockAllowedChannels = []
  mockChannelsEnabled = true

  mock.module('../../bootstrap/state.js', () => ({
    getAllowedChannels: () => mockAllowedChannels,
  }))

  mock.module('./channelAllowlist.js', () => ({
    getChannelAllowlist: () => mockAllowlist,
    isChannelsEnabled: () => mockChannelsEnabled,
  }))
})

afterEach(() => {
  mock.restore()
})

// Dynamic import to pick up mocks — bust module cache each time
async function loadModule() {
  return await import(`./channelNotification.ts?ts=${Date.now()}`)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHANNEL_CAP: ServerCapabilities = {
  experimental: { 'claude/channel': {} },
}

const NO_CHANNEL_CAP: ServerCapabilities = { experimental: {} }

// ---------------------------------------------------------------------------
// findChannelEntry
// ---------------------------------------------------------------------------

describe('findChannelEntry', () => {
  test('matches plugin-kind entry by second segment of server name', async () => {
    const { findChannelEntry } = await loadModule()
    const channels: ChannelEntry[] = [
      { kind: 'plugin', name: 'telegram', marketplace: 'claude-plugins-official' },
    ]
    const result = findChannelEntry('plugin:telegram:abc', channels)
    expect(result).toEqual(channels[0])
  })

  test('matches server-kind entry by exact name', async () => {
    const { findChannelEntry } = await loadModule()
    const channels: ChannelEntry[] = [
      { kind: 'server', name: 'my-slack-bridge' },
    ]
    const result = findChannelEntry('my-slack-bridge', channels)
    expect(result).toEqual(channels[0])
  })

  test('returns undefined when no match', async () => {
    const { findChannelEntry } = await loadModule()
    const channels: ChannelEntry[] = [
      { kind: 'plugin', name: 'discord', marketplace: 'claude-plugins-official' },
    ]
    expect(findChannelEntry('plugin:telegram:abc', channels)).toBeUndefined()
    expect(findChannelEntry('unknown-server', channels)).toBeUndefined()
  })

  test('does not match plugin entry against bare name', async () => {
    const { findChannelEntry } = await loadModule()
    const channels: ChannelEntry[] = [
      { kind: 'plugin', name: 'telegram', marketplace: 'claude-plugins-official' },
    ]
    // bare name "telegram" should NOT match a plugin entry
    expect(findChannelEntry('telegram', channels)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// gateChannelServer — capability check
// ---------------------------------------------------------------------------

describe('gateChannelServer — capability check', () => {
  test('skips servers without claude/channel capability', async () => {
    const { gateChannelServer } = await loadModule()
    const result = gateChannelServer('plugin:telegram:abc', NO_CHANNEL_CAP, 'telegram@claude-plugins-official')
    expect(result.action).toBe('skip')
    expect((result as any).kind).toBe('capability')
  })

  test('skips servers with undefined capabilities', async () => {
    const { gateChannelServer } = await loadModule()
    const result = gateChannelServer('plugin:telegram:abc', undefined, 'telegram@claude-plugins-official')
    expect(result.action).toBe('skip')
    expect((result as any).kind).toBe('capability')
  })

  test('passes servers with claude/channel: {} capability', async () => {
    const { gateChannelServer } = await loadModule()
    // Pre-add an allowed channel entry
    mockAllowedChannels = [
      { kind: 'plugin', name: 'telegram', marketplace: 'claude-plugins-official' },
    ]
    const result = gateChannelServer('plugin:telegram:abc', CHANNEL_CAP, 'telegram@claude-plugins-official')
    expect(result.action).toBe('register')
  })
})

// ---------------------------------------------------------------------------
// gateChannelServer — runtime disabled
// ---------------------------------------------------------------------------

describe('gateChannelServer — runtime disabled', () => {
  test('skips when channels feature is disabled', async () => {
    mockChannelsEnabled = false
    const { gateChannelServer } = await loadModule()
    const result = gateChannelServer('plugin:telegram:abc', CHANNEL_CAP, 'telegram@claude-plugins-official')
    expect(result.action).toBe('skip')
    expect((result as any).kind).toBe('disabled')
  })
})

// ---------------------------------------------------------------------------
// gateChannelServer — approved plugin path
// ---------------------------------------------------------------------------

describe('gateChannelServer — approved plugin path', () => {
  test('registers an approved plugin that is in --channels list', async () => {
    const { gateChannelServer } = await loadModule()
    mockAllowedChannels = [
      { kind: 'plugin', name: 'telegram', marketplace: 'claude-plugins-official' },
    ]
    const result = gateChannelServer(
      'plugin:telegram:abc',
      CHANNEL_CAP,
      'telegram@claude-plugins-official',
    )
    expect(result.action).toBe('register')
  })

  test('skips an approved plugin NOT in --channels list (no auto-registration)', async () => {
    const { gateChannelServer } = await loadModule()
    // Plugin is on the hardcoded allowlist but NOT in --channels
    mockAllowedChannels = []
    const result = gateChannelServer(
      'plugin:telegram:abc',
      CHANNEL_CAP,
      'telegram@claude-plugins-official',
    )
    expect(result.action).toBe('skip')
    expect((result as any).kind).toBe('session')
    // Verify no auto-registration occurred
    expect(mockAllowedChannels).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// gateChannelServer — non-allowlisted plugin
// ---------------------------------------------------------------------------

describe('gateChannelServer — non-allowlisted plugin', () => {
  test('skips a plugin not on the approved allowlist', async () => {
    const { gateChannelServer } = await loadModule()
    // Plugin in session list but NOT in hardcoded allowlist
    mockAllowedChannels = [
      { kind: 'plugin', name: 'evil-chat', marketplace: 'evil-marketplace' },
    ]
    const result = gateChannelServer(
      'plugin:evil-chat:xyz',
      CHANNEL_CAP,
      'evil-chat@evil-marketplace',
    )
    expect(result.action).toBe('skip')
    expect((result as any).kind).toBe('allowlist')
  })

  test('does not auto-register a non-allowlisted plugin', async () => {
    const { gateChannelServer } = await loadModule()
    mockAllowedChannels = []
    const result = gateChannelServer(
      'plugin:evil-chat:xyz',
      CHANNEL_CAP,
      'evil-chat@evil-marketplace',
    )
    expect(result.action).toBe('skip')
    expect((result as any).kind).toBe('session')
    expect(mockAllowedChannels).toHaveLength(0)
  })

  test('non-allowlisted plugin with dev flag DOES register', async () => {
    const { gateChannelServer } = await loadModule()
    mockAllowedChannels = [
      { kind: 'plugin', name: 'custom-chat', marketplace: 'my-marketplace', dev: true },
    ]
    const result = gateChannelServer(
      'plugin:custom-chat:xyz',
      CHANNEL_CAP,
      'custom-chat@my-marketplace',
    )
    expect(result.action).toBe('register')
  })
})

// ---------------------------------------------------------------------------
// gateChannelServer — marketplace verification
// ---------------------------------------------------------------------------

describe('gateChannelServer — marketplace verification', () => {
  test('rejects when installed marketplace does not match entry', async () => {
    const { gateChannelServer } = await loadModule()
    mockAllowedChannels = [
      { kind: 'plugin', name: 'telegram', marketplace: 'claude-plugins-official' },
    ]
    // pluginSource says "evil-marketplace" but entry expects "claude-plugins-official"
    const result = gateChannelServer(
      'plugin:telegram:abc',
      CHANNEL_CAP,
      'telegram@evil-marketplace',
    )
    expect(result.action).toBe('skip')
    expect((result as any).kind).toBe('marketplace')
  })

  test('rejects when pluginSource has no marketplace (@-less)', async () => {
    const { gateChannelServer } = await loadModule()
    mockAllowedChannels = [
      { kind: 'plugin', name: 'telegram', marketplace: 'claude-plugins-official' },
    ]
    const result = gateChannelServer(
      'plugin:telegram:abc',
      CHANNEL_CAP,
      'telegram', // no @marketplace
    )
    expect(result.action).toBe('skip')
    expect((result as any).kind).toBe('marketplace')
  })
})

// ---------------------------------------------------------------------------
// gateChannelServer — server-kind path
// ---------------------------------------------------------------------------

describe('gateChannelServer — server-kind entries', () => {
  test('rejects server-kind entry WITHOUT dev flag', async () => {
    const { gateChannelServer } = await loadModule()
    mockAllowedChannels = [{ kind: 'server', name: 'my-bridge' }]
    const result = gateChannelServer('my-bridge', CHANNEL_CAP, undefined)
    expect(result.action).toBe('skip')
    expect((result as any).kind).toBe('allowlist')
    expect((result as any).reason).toContain(
      '--dangerously-load-development-channels',
    )
  })

  test('registers server-kind entry WITH dev flag', async () => {
    const { gateChannelServer } = await loadModule()
    mockAllowedChannels = [{ kind: 'server', name: 'my-bridge', dev: true }]
    const result = gateChannelServer('my-bridge', CHANNEL_CAP, undefined)
    expect(result.action).toBe('register')
  })

  test('server-kind dev entry is not blocked by allowlist', async () => {
    const { gateChannelServer } = await loadModule()
    // "my-bridge" is not on the hardcoded plugin allowlist — doesn't matter,
    // server-kind with dev=true bypasses the plugin allowlist entirely
    mockAllowedChannels = [{ kind: 'server', name: 'my-bridge', dev: true }]
    const result = gateChannelServer('my-bridge', CHANNEL_CAP, undefined)
    expect(result.action).toBe('register')
  })
})

// ---------------------------------------------------------------------------
// gateChannelServer — dev channel path (plugin with dev flag)
// ---------------------------------------------------------------------------

describe('gateChannelServer — dev channel path', () => {
  test('dev plugin bypasses allowlist entirely', async () => {
    const { gateChannelServer } = await loadModule()
    mockAllowedChannels = [
      { kind: 'plugin', name: 'my-custom', marketplace: 'my-custom-marketplace', dev: true },
    ]
    const result = gateChannelServer(
      'plugin:my-custom:abc',
      CHANNEL_CAP,
      'my-custom@my-custom-marketplace',
    )
    expect(result.action).toBe('register')
  })

  test('dev plugin still requires marketplace match', async () => {
    const { gateChannelServer } = await loadModule()
    mockAllowedChannels = [
      { kind: 'plugin', name: 'my-custom', marketplace: 'expected-marketplace', dev: true },
    ]
    const result = gateChannelServer(
      'plugin:my-custom:abc',
      CHANNEL_CAP,
      'my-custom@wrong-marketplace',
    )
    expect(result.action).toBe('skip')
    expect((result as any).kind).toBe('marketplace')
  })
})
