import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  getCurrentProjectConfig,
  getGlobalConfig,
  saveCurrentProjectConfig,
  saveGlobalConfig,
} from '../../utils/config.js'
import {
  addMcpConfig,
  getMcpConfigByName,
  removeMcpConfig,
} from './config.js'

// The MCP `servers` maps are plain objects built from JSON config, so a bare
// `servers[name]` lookup exposes inherited Object.prototype members. A user
// running `openclaude mcp get constructor` (or `__proto__`, `toString`, …) must
// get "not found", not the Object constructor cast as a server config.
const PROTO_NAMES = [
  'constructor',
  '__proto__',
  'toString',
  'hasOwnProperty',
  'valueOf',
  'isPrototypeOf',
]

let savedGlobalMcp: ReturnType<typeof getGlobalConfig>['mcpServers']
let savedProjectMcp: ReturnType<typeof getCurrentProjectConfig>['mcpServers']

let savedNodeEnv: string | undefined

beforeEach(() => {
  savedNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'
  savedGlobalMcp = getGlobalConfig().mcpServers
  savedProjectMcp = getCurrentProjectConfig().mcpServers
  saveGlobalConfig(config => ({
    ...config,
    mcpServers: { realserver: { command: 'echo', args: [] } },
  }))
  saveCurrentProjectConfig(config => ({
    ...config,
    mcpServers: { locallyreal: { command: 'echo', args: [] } },
  }))
})

afterEach(() => {
  saveGlobalConfig(config => ({ ...config, mcpServers: savedGlobalMcp }))
  saveCurrentProjectConfig(config => ({
    ...config,
    mcpServers: savedProjectMcp,
  }))
  if (savedNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = savedNodeEnv
  }
})

test('resolves a real server by name', () => {
  const found = getMcpConfigByName('realserver')
  expect(found).not.toBeNull()
  expect(found?.scope).toBe('user')
})

test('returns null for a plainly missing name', () => {
  expect(getMcpConfigByName('nope-not-here')).toBeNull()
})

test('returns null for Object.prototype member names', () => {
  // Before the fix each of these resolved to an inherited function (truthy),
  // so the lookup returned a bogus config and callers skipped their not-found
  // guard.
  for (const name of PROTO_NAMES) {
    expect(getMcpConfigByName(name)).toBeNull()
  }
})

test('rejects adding a server named __proto__', async () => {
  // "__proto__" passes the character check but assigning it on a plain object
  // hits the prototype setter, so the server would be reported as added and
  // silently vanish rather than becoming an own property.
  await expect(
    addMcpConfig('__proto__', { command: 'echo', args: [] }, 'user'),
  ).rejects.toThrow('reserved')
})

test('reports proto-name removal as not found instead of succeeding', async () => {
  // Before the fix the scoped-removal existence checks accepted inherited
  // members, so `mcp remove constructor -s user` claimed success while leaving
  // the real configuration untouched.
  for (const name of PROTO_NAMES) {
    await expect(removeMcpConfig(name, 'user')).rejects.toThrow(
      'No user-scoped MCP server found',
    )
  }
})

test('still allows adding and removing a real server name', async () => {
  await addMcpConfig('addedserver', { command: 'echo', args: [] }, 'user')
  expect(getMcpConfigByName('addedserver')).not.toBeNull()
  await removeMcpConfig('addedserver', 'user')
  expect(getMcpConfigByName('addedserver')).toBeNull()
})
