import { expect, test } from 'bun:test'
import type { MCPServerConnection } from '../services/mcp/types.js'
import type { Message } from '../types/message.js'
import type { Tools } from '../Tool.js'
import { getDeferredToolsDelta } from './toolSearch.js'

function deltaMessage(
  addedNames: string[],
  addedLines: string[],
  removedNames: string[] = [],
): Message {
  return {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000d101',
    attachment: {
      type: 'deferred_tools_delta',
      addedNames,
      addedLines,
      removedNames,
    },
  } as unknown as Message
}

function mcpTool(name: string): Tools[number] {
  return { name, isMcp: true } as Tools[number]
}

function connected(name: string): MCPServerConnection {
  return {
    type: 'connected',
    name,
    client: {} as never,
    capabilities: {},
    config: {} as never,
    cleanup: async () => {},
  }
}

function pending(name: string): MCPServerConnection {
  return {
    type: 'pending',
    name,
    config: {} as never,
  }
}

test('getDeferredToolsDelta holds removals when tools pool is empty (resume race)', () => {
  // jatmn Finding 2: transcript announces mcp__docs__search, tools still [].
  const messages = [
    deltaMessage(
      ['mcp__docs__search'],
      ['mcp__docs__search'],
    ),
  ]
  const delta = getDeferredToolsDelta([] as Tools, messages)
  expect(delta).toBeNull()
})

test('getDeferredToolsDelta holds MCP removals while MCP client set is unsettled', () => {
  // Non-empty tools but no MCP yet + empty clients → hold MCP removals.
  const messages = [
    deltaMessage(
      ['mcp__docs__search'],
      ['mcp__docs__search'],
    ),
  ]
  const tools = [{ name: 'SomeBuiltin', isMcp: false }] as unknown as Tools
  const delta = getDeferredToolsDelta(tools, messages, undefined, [])
  expect(delta).toBeNull()
})

test('getDeferredToolsDelta holds MCP removals while that server is still pending', () => {
  const messages = [
    deltaMessage(
      ['mcp__docs__search'],
      ['mcp__docs__search'],
    ),
  ]
  const tools = [mcpTool('mcp__other__list')] as unknown as Tools
  const delta = getDeferredToolsDelta(tools, messages, undefined, [
    connected('other'),
    pending('docs'),
  ])
  expect(delta).not.toBeNull()
  expect(delta!.removedNames).toEqual([])
  expect(delta!.addedNames).toEqual(['mcp__other__list'])
})

test('getDeferredToolsDelta removes MCP tool once client set settled and server gone', () => {
  const messages = [
    deltaMessage(
      ['mcp__docs__search'],
      ['mcp__docs__search'],
    ),
  ]
  const tools = [mcpTool('mcp__other__list')] as unknown as Tools
  const delta = getDeferredToolsDelta(tools, messages, undefined, [
    connected('other'),
  ])
  expect(delta).not.toBeNull()
  expect(delta!.removedNames).toEqual(['mcp__docs__search'])
  expect(delta!.addedNames).toEqual(['mcp__other__list'])
})

test('getDeferredToolsDelta removes non-MCP deferred tool once pool is non-empty', () => {
  const messages = [deltaMessage(['SomeTool'], ['SomeTool'])]
  const tools = [mcpTool('mcp__other__list')] as unknown as Tools
  const delta = getDeferredToolsDelta(tools, messages)
  expect(delta).not.toBeNull()
  expect(delta!.removedNames).toEqual(['SomeTool'])
  expect(delta!.addedNames).toEqual(['mcp__other__list'])
})
