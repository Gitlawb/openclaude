import { afterEach, expect, test } from 'bun:test'
import type { MCPServerConnection } from '../services/mcp/types.js'
import type { Message } from '../types/message.js'
import type { Tools } from '../Tool.js'
import { TOOL_SEARCH_TOOL_NAME } from '../tools/ToolSearchTool/constants.js'
import { getDeferredToolsDeltaAttachment } from './attachments.js'
import { getDeferredToolsDelta } from './toolSearch.js'

const savedUserType = process.env.USER_TYPE
const savedEnableToolSearch = process.env.ENABLE_TOOL_SEARCH

afterEach(() => {
  if (savedUserType === undefined) delete process.env.USER_TYPE
  else process.env.USER_TYPE = savedUserType
  if (savedEnableToolSearch === undefined) delete process.env.ENABLE_TOOL_SEARCH
  else process.env.ENABLE_TOOL_SEARCH = savedEnableToolSearch
})

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

function toolSearchPool(...extra: Tools[number][]): Tools {
  return [
    { name: TOOL_SEARCH_TOOL_NAME, isMcp: false } as Tools[number],
    ...extra,
  ] as Tools
}

// --- Core hold / settle (jatmn [P2]) ---

test('getDeferredToolsDelta holds removals when tools pool is empty (resume race)', () => {
  // jatmn [P2]: transcript announces mcp__docs__search, tools still [].
  const messages = [
    deltaMessage(['mcp__docs__search'], ['mcp__docs__search']),
  ]
  const delta = getDeferredToolsDelta([] as Tools, messages)
  expect(delta).toBeNull()
})

test('getDeferredToolsDelta holds MCP removals while MCP client set is unsettled', () => {
  // Non-empty tools but no MCP yet + empty clients → hold MCP removals.
  const messages = [
    deltaMessage(['mcp__docs__search'], ['mcp__docs__search']),
  ]
  const tools = [{ name: 'SomeBuiltin', isMcp: false }] as unknown as Tools
  const delta = getDeferredToolsDelta(tools, messages, undefined, [])
  expect(delta).toBeNull()
})

test('getDeferredToolsDelta holds MCP removals while that server is still pending', () => {
  const messages = [
    deltaMessage(['mcp__docs__search'], ['mcp__docs__search']),
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
    deltaMessage(['mcp__docs__search'], ['mcp__docs__search']),
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

// --- Different angles ---

test('holds MCP removals while every MCP client is still pending (sibling of instructions hold)', () => {
  const messages = [
    deltaMessage(['mcp__docs__search'], ['mcp__docs__search']),
  ]
  const tools = [{ name: 'SomeBuiltin', isMcp: false }] as unknown as Tools
  const delta = getDeferredToolsDelta(tools, messages, undefined, [
    pending('docs'),
    pending('other'),
  ])
  expect(delta).toBeNull()
})

test('does not report removal when announced tool is still in pool but no longer deferred', () => {
  // Undeferred path: still callable directly — silent, not "removed".
  const messages = [deltaMessage(['SomeTool'], ['SomeTool'])]
  const tools = [
    { name: 'SomeTool', isMcp: false, alwaysLoad: true },
  ] as unknown as Tools
  expect(getDeferredToolsDelta(tools, messages)).toBeNull()
})

test('two-pass resume: empty pool holds, then settled pool emits removal', () => {
  const messages = [
    deltaMessage(['mcp__docs__search'], ['mcp__docs__search']),
  ]
  expect(getDeferredToolsDelta([] as Tools, messages)).toBeNull()

  const settled = getDeferredToolsDelta(
    [mcpTool('mcp__other__list')] as unknown as Tools,
    messages,
    undefined,
    [connected('other')],
  )
  expect(settled).not.toBeNull()
  expect(settled!.removedNames).toEqual(['mcp__docs__search'])
})

test('keeps announced MCP tool when it reappears as deferred after resume', () => {
  const messages = [
    deltaMessage(['mcp__docs__search'], ['mcp__docs__search']),
  ]
  const tools = [mcpTool('mcp__docs__search')] as unknown as Tools
  expect(
    getDeferredToolsDelta(tools, messages, undefined, [connected('docs')]),
  ).toBeNull()
})

test('attachment wrapper holds empty-pool removal (gate + call-site angle)', () => {
  process.env.USER_TYPE = 'ant'
  process.env.ENABLE_TOOL_SEARCH = 'true'
  const messages = [
    deltaMessage(['mcp__docs__search'], ['mcp__docs__search']),
  ]
  // ToolSearch present so the wrapper gate opens; tools otherwise empty of MCP.
  const tools = toolSearchPool()
  const atts = getDeferredToolsDeltaAttachment(
    tools,
    'claude-sonnet-4-20250514',
    messages,
    { callSite: 'test_resume_hold' },
    [],
  )
  // Empty MCP + unsettled clients → hold → no removal attachment.
  expect(atts).toEqual([])
})

test('attachment wrapper emits removal once MCP pool settled (gate + call-site angle)', () => {
  process.env.USER_TYPE = 'ant'
  process.env.ENABLE_TOOL_SEARCH = 'true'
  const messages = [
    deltaMessage(['mcp__docs__search'], ['mcp__docs__search']),
  ]
  const tools = toolSearchPool(mcpTool('mcp__other__list'))
  const atts = getDeferredToolsDeltaAttachment(
    tools,
    'claude-sonnet-4-20250514',
    messages,
    { callSite: 'test_resume_settle' },
    [connected('other')],
  )
  expect(atts).toHaveLength(1)
  expect(atts[0]).toMatchObject({
    type: 'deferred_tools_delta',
    removedNames: ['mcp__docs__search'],
    addedNames: ['mcp__other__list'],
  })
})
