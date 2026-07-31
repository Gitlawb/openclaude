import { expect, test } from 'bun:test'
import type { MCPServerConnection } from '../services/mcp/types.js'
import type { Message } from '../types/message.js'
import {
  getAnnouncedMcpInstructionBlocks,
  getMcpInstructionsDelta,
} from './mcpInstructionsDelta.js'

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

function deltaMessage(
  addedNames: string[],
  addedBlocks: string[],
  removedNames: string[] = [],
): Message {
  return {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000m001',
    attachment: {
      type: 'mcp_instructions_delta',
      addedNames,
      addedBlocks,
      removedNames,
    },
  } as unknown as Message
}

test('getMcpInstructionsDelta returns null when same-name block is unchanged', () => {
  const block = '## docs\nUse the search tool.'
  const messages = [deltaMessage(['docs'], [block])]
  const delta = getMcpInstructionsDelta(
    [connected('docs', 'Use the search tool.')],
    messages,
    [],
  )
  expect(delta).toBeNull()
})

test('getMcpInstructionsDelta re-announces when same-name instructions change after resume', () => {
  // Reviewer case: old-block in transcript, fresh handshake returns new
  // InitializeResult.instructions under the same configured server name.
  const oldBlock = '## docs\nUse the legacy search tool.'
  const messages = [deltaMessage(['docs'], [oldBlock])]
  const delta = getMcpInstructionsDelta(
    [connected('docs', 'Use the v2 search tool with filters.')],
    messages,
    [],
  )
  expect(delta).not.toBeNull()
  expect(delta!.addedNames).toEqual(['docs'])
  expect(delta!.addedBlocks).toEqual([
    '## docs\nUse the v2 search tool with filters.',
  ])
  expect(delta!.removedNames).toEqual([])
})

test('getMcpInstructionsDelta removes disconnected servers by name', () => {
  const messages = [
    deltaMessage(['docs'], ['## docs\nUse the search tool.']),
  ]
  const delta = getMcpInstructionsDelta([], messages, [])
  expect(delta).not.toBeNull()
  expect(delta!.addedNames).toEqual([])
  expect(delta!.removedNames).toEqual(['docs'])
})

test('getMcpInstructionsDelta removes a connected server that no longer has instructions', () => {
  const messages = [deltaMessage(['docs'], ['## docs\nUse the search tool.'])]
  const delta = getMcpInstructionsDelta([connected('docs', '')], messages, [])
  expect(delta).not.toBeNull()
  expect(delta!.addedNames).toEqual([])
  expect(delta!.removedNames).toEqual(['docs'])
})

test('getAnnouncedMcpInstructionBlocks applies removals before same-name re-adds', () => {
  const messages = [
    deltaMessage(['docs'], ['## docs\nold']),
    deltaMessage(['docs'], ['## docs\nnew'], ['docs']),
  ]
  const announced = getAnnouncedMcpInstructionBlocks(messages)
  expect(announced.get('docs')).toBe('## docs\nnew')
})

test('getMcpInstructionsDelta announces newly connected servers', () => {
  const delta = getMcpInstructionsDelta(
    [connected('chrome', 'Prefer keyboard shortcuts.')],
    [],
    [],
  )
  expect(delta).not.toBeNull()
  expect(delta!.addedNames).toEqual(['chrome'])
  expect(delta!.addedBlocks).toEqual([
    '## chrome\nPrefer keyboard shortcuts.',
  ])
})
