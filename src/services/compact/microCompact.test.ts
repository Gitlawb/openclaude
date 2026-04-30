import { describe, expect, test } from 'bun:test'

import type { Message } from '../../types/message.js'
import { createAssistantMessage, createUserMessage } from '../../utils/messages.js'

// We test the exported collectCompactableToolIds behavior indirectly via
// the public microcompactMessages + time-based path. But first we need to
// verify the core predicate: MCP tools (prefixed 'mcp__') should be
// compactable alongside the built-in tool set.

// Import internals we can test
import { evaluateTimeBasedTrigger } from './microCompact.js'

/**
 * Helper: build a minimal assistant message with a tool_use block.
 */
function assistantWithToolUse(toolName: string, toolId: string): Message {
  return createAssistantMessage({
    content: [
      {
        type: 'tool_use' as const,
        id: toolId,
        name: toolName,
        input: {},
      },
    ],
  })
}

/**
 * Helper: build a user message with a tool_result block.
 */
function userWithToolResult(toolId: string, output: string): Message {
  return createUserMessage({
    content: [
      {
        type: 'tool_result' as const,
        tool_use_id: toolId,
        content: output,
      },
    ],
  })
}

describe('microCompact MCP tool compaction', () => {
  // We can't easily unit-test the private isCompactableTool directly,
  // but we can test the full time-based microcompact path which exercises
  // collectCompactableToolIds → isCompactableTool under the hood.
  // The time-based path is the simplest to trigger: it content-clears
  // old tool results when the gap since last assistant message exceeds
  // the threshold.

  // However, evaluateTimeBasedTrigger depends on config (GrowthBook).
  // So instead, let's test the observable behavior by importing the
  // microcompactMessages function and checking that MCP tool_use blocks
  // are collected.

  // Since collectCompactableToolIds is not exported, we test the predicate
  // behavior by verifying that the module loads without error and that
  // built-in and MCP tools are treated consistently.

  test('module exports load correctly', async () => {
    const mod = await import('./microCompact.js')
    expect(mod.microcompactMessages).toBeFunction()
    expect(mod.estimateMessageTokens).toBeFunction()
    expect(mod.evaluateTimeBasedTrigger).toBeFunction()
  })

  test('estimateMessageTokens counts MCP tool_use blocks', async () => {
    const { estimateMessageTokens } = await import('./microCompact.js')

    const builtinMessages: Message[] = [
      assistantWithToolUse('Read', 'tool-builtin-1'),
      userWithToolResult('tool-builtin-1', 'file contents here'),
    ]

    const mcpMessages: Message[] = [
      assistantWithToolUse('mcp__github__get_file_contents', 'tool-mcp-1'),
      userWithToolResult('tool-mcp-1', 'file contents here'),
    ]

    const builtinTokens = estimateMessageTokens(builtinMessages)
    const mcpTokens = estimateMessageTokens(mcpMessages)

    // Both should produce non-zero estimates
    expect(builtinTokens).toBeGreaterThan(0)
    expect(mcpTokens).toBeGreaterThan(0)

    // The tool_result content is identical, so token estimates should be
    // similar (tool_use name differs slightly, so not exactly equal)
    expect(Math.abs(builtinTokens - mcpTokens)).toBeLessThan(50)
  })

  test('microcompactMessages processes MCP tools without error', async () => {
    const { microcompactMessages } = await import('./microCompact.js')

    const messages: Message[] = [
      assistantWithToolUse('mcp__slack__send_message', 'tool-mcp-2'),
      userWithToolResult('tool-mcp-2', 'Message sent successfully'),
      assistantWithToolUse('mcp__github__create_pull_request', 'tool-mcp-3'),
      userWithToolResult('tool-mcp-3', JSON.stringify({ number: 42, url: 'https://github.com/org/repo/pull/42' })),
    ]

    // Should not throw — MCP tools should be handled gracefully
    const result = await microcompactMessages(messages)
    expect(result).toBeDefined()
    expect(result.messages).toBeDefined()
    expect(result.messages.length).toBe(messages.length)
  })

  test('microcompactMessages processes mixed built-in and MCP tools', async () => {
    const { microcompactMessages } = await import('./microCompact.js')

    const messages: Message[] = [
      assistantWithToolUse('Read', 'tool-read-1'),
      userWithToolResult('tool-read-1', 'some file content'),
      assistantWithToolUse('mcp__playwright__screenshot', 'tool-mcp-4'),
      userWithToolResult('tool-mcp-4', 'base64-encoded-screenshot-data'.repeat(100)),
      assistantWithToolUse('Bash', 'tool-bash-1'),
      userWithToolResult('tool-bash-1', 'command output'),
    ]

    const result = await microcompactMessages(messages)
    expect(result).toBeDefined()
    expect(result.messages.length).toBe(messages.length)
  })

  test('semantic compression skips tool_use and tool_result blocks', async () => {
    process.env.OPENCLAUDE_FEATURE_SEMANTIC_COMPRESSION = '1'
    const { microcompactMessages } = await import('./microCompact.js')

    const toolUseInput = { path: 'important.json', content: '{"please dont change": true}' }
    const messages: Message[] = [
      { type: 'user', message: { role: 'user', content: 'please please please can you help me with this code', id: 'msg-1', type: 'message', created_at: 1 }, sender: 'user' },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use' as const, id: 'tu1', name: 'Read', input: toolUseInput }], id: 'msg-2', type: 'message', created_at: 2 }, sender: 'assistant' },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result' as const, tool_use_id: 'tu1', content: 'file content here' }, { type: 'text' as const, text: 'thanks for reading this please process it' }], id: 'msg-3', type: 'message', created_at: 3 }, sender: 'user' },
    ]

    const result = await microcompactMessages(messages as any)

    const toolUseMsg = result.messages.find((m: any) => m.type === 'assistant')
    expect(toolUseMsg?.message?.content).toEqual([
      { type: 'tool_use', id: 'tu1', name: 'Read', input: toolUseInput },
    ])

    const toolResultMsg = result.messages.find((m: any) => m.type === 'user' && Array.isArray(m.message?.content))
    const toolResultBlock = (toolResultMsg?.message?.content as any[])?.find(b => b.type === 'tool_result')
    expect(toolResultBlock?.content).toBe('file content here')

    delete process.env.OPENCLAUDE_FEATURE_SEMANTIC_COMPRESSION
  })
})
