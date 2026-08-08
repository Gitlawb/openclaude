/**
 * Different-angle coverage for jatmn [P3] (needs-auth unsettled for
 * instruction removals) — not the same direct getMcpInstructionsDelta
 * cases already in mcpInstructionsDelta.test.ts.
 *
 * Angles:
 * 1) Production attachment wrapper (getMcpInstructionsDeltaAttachment)
 * 2) Contrast with the old buggy settled check (type !== 'pending')
 * 3) Two-pass resume timeline (needs-auth hold → later settle/remove)
 * 4) failed / disabled count as settled (unlike needs-auth)
 */
import { afterEach, expect, test } from 'bun:test'
import {
  isMcpClientUnsettledForRemovals,
  type MCPServerConnection,
} from '../services/mcp/types.js'
import type { Message } from '../types/message.js'
import type { Tools } from '../Tool.js'
import { getMcpInstructionsDeltaAttachment } from './attachments.js'
import {
  getAnnouncedMcpInstructionBlocks,
  getMcpInstructionsDelta,
} from './mcpInstructionsDelta.js'

const savedUserType = process.env.USER_TYPE
const savedInstrDelta = process.env.CLAUDE_CODE_MCP_INSTR_DELTA
const savedEnableToolSearch = process.env.ENABLE_TOOL_SEARCH

afterEach(() => {
  if (savedUserType === undefined) delete process.env.USER_TYPE
  else process.env.USER_TYPE = savedUserType
  if (savedInstrDelta === undefined) delete process.env.CLAUDE_CODE_MCP_INSTR_DELTA
  else process.env.CLAUDE_CODE_MCP_INSTR_DELTA = savedInstrDelta
  if (savedEnableToolSearch === undefined) delete process.env.ENABLE_TOOL_SEARCH
  else process.env.ENABLE_TOOL_SEARCH = savedEnableToolSearch
})

function connected(
  name: string,
  instructions: string,
): MCPServerConnection {
  return {
    type: 'connected',
    name,
    instructions,
    client: {} as never,
    capabilities: {},
    config: {} as never,
    cleanup: async () => {},
  }
}

function needsAuth(name: string): MCPServerConnection {
  return {
    type: 'needs-auth',
    name,
    config: {} as never,
  }
}

function failed(name: string): MCPServerConnection {
  return {
    type: 'failed',
    name,
    config: {} as never,
    error: 'connect failed',
  }
}

function disabled(name: string): MCPServerConnection {
  return {
    type: 'disabled',
    name,
    config: {} as never,
  }
}

function deltaMessage(
  addedNames: string[],
  addedBlocks: string[],
  removedNames: string[] = [],
): Message {
  return {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000a301',
    attachment: {
      type: 'mcp_instructions_delta',
      addedNames,
      addedBlocks,
      removedNames,
    },
  } as unknown as Message
}

/** Old settled check jatmn described: needs-auth incorrectly counted as settled. */
function oldBuggyWouldRemoveDocs(
  mcpClients: MCPServerConnection[],
  announced: Set<string>,
): string[] {
  const connectedNames = new Set(
    mcpClients.filter(c => c.type === 'connected').map(c => c.name),
  )
  const clientSetSettledForRemovals =
    mcpClients.length > 0 && mcpClients.some(c => c.type !== 'pending')
  const removed: string[] = []
  for (const n of announced) {
    if (connectedNames.has(n)) continue
    const serverStillPending = mcpClients.some(
      c => c.type === 'pending' && c.name === n,
    )
    if (serverStillPending) continue
    if (!clientSetSettledForRemovals) continue
    removed.push(n)
  }
  return removed
}

// --- Angle 1: attachment call-site (what compact / turn loop actually emit) ---

test('attachment wrapper: needs-auth docs alone emits no mcp_instructions_delta removal', () => {
  process.env.CLAUDE_CODE_MCP_INSTR_DELTA = 'true'
  process.env.ENABLE_TOOL_SEARCH = 'false'
  const messages = [
    deltaMessage(['docs'], ['## docs\nUse the search tool.']),
  ]
  const atts = getMcpInstructionsDeltaAttachment(
    [needsAuth('docs')],
    [] as Tools,
    'claude-opus-4-20250514',
    messages,
  )
  expect(atts).toEqual([])
})

test('attachment wrapper: empty mcpClients emits no removal attachment', () => {
  process.env.CLAUDE_CODE_MCP_INSTR_DELTA = 'true'
  process.env.ENABLE_TOOL_SEARCH = 'false'
  const messages = [
    deltaMessage(['docs'], ['## docs\nUse the search tool.']),
  ]
  const atts = getMcpInstructionsDeltaAttachment(
    [],
    [] as Tools,
    'claude-opus-4-20250514',
    messages,
  )
  expect(atts).toEqual([])
})

test('attachment wrapper: settled other + missing docs emits removal attachment', () => {
  process.env.CLAUDE_CODE_MCP_INSTR_DELTA = 'true'
  process.env.ENABLE_TOOL_SEARCH = 'false'
  const messages = [
    deltaMessage(['docs'], ['## docs\nUse the search tool.']),
  ]
  const atts = getMcpInstructionsDeltaAttachment(
    [connected('other', 'Still here.')],
    [] as Tools,
    'claude-opus-4-20250514',
    messages,
  )
  expect(atts).toHaveLength(1)
  expect(atts[0]).toMatchObject({
    type: 'mcp_instructions_delta',
    removedNames: ['docs'],
    addedNames: ['other'],
  })
})

// --- Angle 2: prove old buggy predicate ≠ current helper ---

test('old type!==pending would remove needs-auth docs; current helper holds', () => {
  const clients = [needsAuth('docs')]
  expect(isMcpClientUnsettledForRemovals(clients[0]!)).toBe(true)
  expect(oldBuggyWouldRemoveDocs(clients, new Set(['docs']))).toEqual(['docs'])

  const delta = getMcpInstructionsDelta(
    clients,
    [deltaMessage(['docs'], ['## docs\nUse the search tool.'])],
    [],
  )
  expect(delta).toBeNull()
})

test('old buggy predicate also wrongly settles needs-auth when mixed with connected', () => {
  const clients = [connected('other', 'Still here.'), needsAuth('docs')]
  // Old: some type !== pending → settled; docs not pending → remove docs
  expect(oldBuggyWouldRemoveDocs(clients, new Set(['docs']))).toEqual(['docs'])

  const delta = getMcpInstructionsDelta(
    clients,
    [deltaMessage(['docs'], ['## docs\nUse the search tool.'])],
    [],
  )
  expect(delta).not.toBeNull()
  expect(delta!.removedNames).toEqual([])
  expect(delta!.addedNames).toEqual(['other'])
})

// --- Angle 3: two-pass resume timeline ---

test('two-pass resume: needs-auth holds, then connected same name does not remove', () => {
  const messages = [
    deltaMessage(['docs'], ['## docs\nUse the search tool.']),
  ]
  const pass1 = getMcpInstructionsDelta([needsAuth('docs')], messages, [])
  expect(pass1).toBeNull()
  // Announced map must still contain docs after a hold (no removal delta applied).
  expect([...getAnnouncedMcpInstructionBlocks(messages).keys()]).toEqual([
    'docs',
  ])

  const pass2 = getMcpInstructionsDelta(
    [connected('docs', 'Use the search tool.')],
    messages,
    [],
  )
  expect(pass2).toBeNull()
})

test('two-pass resume: needs-auth holds, then only other connected removes docs', () => {
  const messages = [
    deltaMessage(['docs'], ['## docs\nUse the search tool.']),
  ]
  expect(getMcpInstructionsDelta([needsAuth('docs')], messages, [])).toBeNull()

  const pass2 = getMcpInstructionsDelta(
    [connected('other', 'Still here.')],
    messages,
    [],
  )
  expect(pass2).not.toBeNull()
  expect(pass2!.removedNames).toEqual(['docs'])
  expect(pass2!.addedNames).toEqual(['other'])
})

// --- Angle 4: failed / disabled are settled (contrast with needs-auth) ---

test('failed docs alone authorizes removal (unlike needs-auth)', () => {
  const messages = [
    deltaMessage(['docs'], ['## docs\nUse the search tool.']),
  ]
  expect(isMcpClientUnsettledForRemovals(failed('docs'))).toBe(false)
  const delta = getMcpInstructionsDelta([failed('docs')], messages, [])
  expect(delta).not.toBeNull()
  expect(delta!.removedNames).toEqual(['docs'])
})

test('disabled docs alone authorizes removal (unlike needs-auth)', () => {
  const messages = [
    deltaMessage(['docs'], ['## docs\nUse the search tool.']),
  ]
  expect(isMcpClientUnsettledForRemovals(disabled('docs'))).toBe(false)
  const delta = getMcpInstructionsDelta([disabled('docs')], messages, [])
  expect(delta).not.toBeNull()
  expect(delta!.removedNames).toEqual(['docs'])
})
