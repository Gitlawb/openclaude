import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import {
  getCurrentProjectConfig,
  getGlobalConfig,
  saveCurrentProjectConfig,
  saveGlobalConfig,
} from '../../utils/config.js'
import {
  addMcpConfig,
  getMcpConfigByName,
  parseMcpConfig,
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

beforeEach(async () => {
  // This suite swaps NODE_ENV and the process-wide global/project MCP configs,
  // so it has to be serialized against the other state-mutating suites bun may
  // run alongside it -- otherwise they observe the injected fixtures, or their
  // updates are clobbered when this teardown restores a stale snapshot.
  await acquireSharedMutationLock('services/mcp/config.protoName.test.ts')
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
  try {
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
  } finally {
    releaseSharedMutationLock()
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

test('surfaces a __proto__ entry in file config instead of dropping it', () => {
  // A hand-authored .mcp.json can carry this name: the schema accepts it, but
  // copying it into a plain object hits the prototype setter, so the entry
  // vanished with no diagnostic and the user could not tell why their server
  // did not exist. It must be reported, not silently discarded.
  // Parsed from text, exactly as the real file is: JSON.parse creates a true
  // own "__proto__" key, which an object literal would not.
  const { config, errors } = parseMcpConfig({
    configObject: JSON.parse(
      '{"mcpServers":{"__proto__":{"command":"echo","args":[]},' +
        '"realone":{"command":"echo","args":[]}}}',
    ),
    expandVars: false,
    scope: 'project',
    filePath: '/tmp/.mcp.json',
  })

  const protoError = errors.find(e => e.path === 'mcpServers.__proto__')
  expect(protoError).toBeDefined()
  expect(protoError?.message).toContain('reserved')
  expect(protoError?.mcpErrorMetadata?.severity).toBe('fatal')
  // The rest of the file still parses, and the bad name is not an own key.
  expect(Object.hasOwn(config?.mcpServers ?? {}, 'realone')).toBe(true)
  expect(Object.hasOwn(config?.mcpServers ?? {}, '__proto__')).toBe(false)
})

test('still allows adding and removing a real server name', async () => {
  await addMcpConfig('addedserver', { command: 'echo', args: [] }, 'user')
  expect(getMcpConfigByName('addedserver')).not.toBeNull()
  await removeMcpConfig('addedserver', 'user')
  expect(getMcpConfigByName('addedserver')).toBeNull()
})
