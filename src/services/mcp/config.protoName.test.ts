import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  getCurrentProjectConfig,
  getGlobalConfig,
  saveCurrentProjectConfig,
  saveGlobalConfig,
} from '../../utils/config.js'
import { getMcpConfigByName } from './config.js'

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

beforeEach(() => {
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
