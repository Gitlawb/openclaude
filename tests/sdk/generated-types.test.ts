import { describe, test, expect } from 'bun:test'
import {
  SDKAssistantMessageSchema,
  SDKSystemMessageSchema,
  SDKCompactBoundaryMessageSchema,
  SDKMessageSchema,
  SDKUserMessageSchema,
  SDKResultMessageSchema,
  SDKResultSuccessSchema,
  SDKResultErrorSchema,
  SDKSessionInfoSchema,
  PermissionModeSchema,
  ThinkingConfigSchema,
  AgentDefinitionSchema,
  McpServerStatusSchema,
  ModelUsageSchema,
  FastModeStateSchema,
  HookInputSchema,
  ExitReasonSchema,
} from '../../src/entrypoints/sdk/coreSchemas.js'
import { z } from 'zod/v4'

/**
 * Tests for generated SDK types from Zod schemas.
 *
 * These tests verify that:
 * 1. All schemas materialize correctly (no lazy errors)
 * 2. Schemas can parse valid data
 * 3. Key discriminated fields are correct
 * 4. The full SDKMessage union accepts all message variants
 */
describe('SDK Zod schemas (type generation source)', () => {
  test('SDKAssistantMessageSchema accepts valid data', () => {
    const schema = SDKAssistantMessageSchema()
    const result = schema.safeParse({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      parent_tool_use_id: null,
      uuid: '12345678-1234-1234-1234-123456789012',
      session_id: '12345678-1234-1234-1234-123456789012',
    })
    expect(result.success).toBe(true)
  })

  test('SDKSystemMessageSchema accepts valid data', () => {
    const schema = SDKSystemMessageSchema()
    const result = schema.safeParse({
      type: 'system',
      subtype: 'init',
      apiKeySource: 'user',
      claude_code_version: '0.3.0',
      cwd: '/home/user/project',
      tools: ['Read', 'Write'],
      mcp_servers: [{ name: 'test', status: 'connected' }],
      model: 'claude-sonnet-4-6',
      permissionMode: 'default',
      slash_commands: [],
      output_style: 'default',
      skills: [],
      plugins: [],
      uuid: '12345678-1234-1234-1234-123456789012',
      session_id: '12345678-1234-1234-1234-123456789012',
    })
    expect(result.success).toBe(true)
  })

  test('SDKCompactBoundaryMessageSchema accepts valid data', () => {
    const schema = SDKCompactBoundaryMessageSchema()
    const result = schema.safeParse({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: {
        trigger: 'manual',
        pre_tokens: 1000,
      },
      uuid: '12345678-1234-1234-1234-123456789012',
      session_id: '12345678-1234-1234-1234-123456789012',
    })
    expect(result.success).toBe(true)
  })

  test('SDKCompactBoundaryMessageSchema accepts preserved_segment', () => {
    const schema = SDKCompactBoundaryMessageSchema()
    const result = schema.safeParse({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: {
        trigger: 'auto',
        pre_tokens: 50000,
        preserved_segment: {
          head_uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          anchor_uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          tail_uuid: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        },
      },
      uuid: '12345678-1234-1234-1234-123456789012',
      session_id: '12345678-1234-1234-1234-123456789012',
    })
    expect(result.success).toBe(true)
  })

  test('SDKUserMessageSchema accepts valid data', () => {
    const schema = SDKUserMessageSchema()
    const result = schema.safeParse({
      type: 'user',
      message: { role: 'user', content: 'hello' },
      parent_tool_use_id: null,
    })
    expect(result.success).toBe(true)
  })

  test('SDKResultSuccessSchema accepts valid data', () => {
    const schema = SDKResultSuccessSchema()
    const result = schema.safeParse({
      type: 'result',
      subtype: 'success',
      duration_ms: 1500,
      duration_api_ms: 1200,
      is_error: false,
      num_turns: 1,
      result: 'Done',
      stop_reason: 'end_turn',
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50 },
      modelUsage: {},
      permission_denials: [],
      uuid: '12345678-1234-1234-1234-123456789012',
      session_id: '12345678-1234-1234-1234-123456789012',
    })
    expect(result.success).toBe(true)
  })

  test('SDKResultErrorSchema accepts valid data', () => {
    const schema = SDKResultErrorSchema()
    const result = schema.safeParse({
      type: 'result',
      subtype: 'error_during_execution',
      duration_ms: 100,
      duration_api_ms: 80,
      is_error: true,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: 0.001,
      usage: { input_tokens: 50, output_tokens: 10 },
      modelUsage: {},
      permission_denials: [],
      errors: ['Something went wrong'],
      uuid: '12345678-1234-1234-1234-123456789012',
      session_id: '12345678-1234-1234-1234-123456789012',
    })
    expect(result.success).toBe(true)
  })

  test('SDKMessageSchema accepts all message types', () => {
    const schema = SDKMessageSchema()

    const messages = [
      {
        type: 'assistant',
        message: {},
        parent_tool_use_id: null,
        uuid: '12345678-1234-1234-1234-123456789012',
        session_id: '12345678-1234-1234-1234-123456789012',
      },
      {
        type: 'user',
        message: {},
        parent_tool_use_id: null,
      },
      {
        type: 'system',
        subtype: 'init',
        apiKeySource: 'user',
        claude_code_version: '0.3.0',
        cwd: '/tmp',
        tools: [],
        mcp_servers: [],
        model: 'sonnet',
        permissionMode: 'default',
        slash_commands: [],
        output_style: 'default',
        skills: [],
        plugins: [],
        uuid: '12345678-1234-1234-1234-123456789012',
        session_id: '12345678-1234-1234-1234-123456789012',
      },
      {
        type: 'system',
        subtype: 'compact_boundary',
        compact_metadata: { trigger: 'manual', pre_tokens: 100 },
        uuid: '12345678-1234-1234-1234-123456789012',
        session_id: '12345678-1234-1234-1234-123456789012',
      },
    ]

    for (const msg of messages) {
      const result = schema.safeParse(msg)
      expect(result.success).toBe(true)
    }
  })

  test('SDKSessionInfoSchema accepts valid data', () => {
    const schema = SDKSessionInfoSchema()
    const result = schema.safeParse({
      sessionId: '12345678-1234-1234-1234-123456789012',
      summary: 'Test session',
      lastModified: Date.now(),
    })
    expect(result.success).toBe(true)
  })

  test('PermissionModeSchema accepts valid modes', () => {
    const schema = PermissionModeSchema()
    const modes = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']
    for (const mode of modes) {
      expect(schema.safeParse(mode).success).toBe(true)
    }
    expect(schema.safeParse('invalid').success).toBe(false)
  })

  test('ThinkingConfigSchema accepts all variants', () => {
    const schema = ThinkingConfigSchema()
    expect(schema.safeParse({ type: 'adaptive' }).success).toBe(true)
    expect(schema.safeParse({ type: 'enabled' }).success).toBe(true)
    expect(schema.safeParse({ type: 'enabled', budgetTokens: 10000 }).success).toBe(true)
    expect(schema.safeParse({ type: 'disabled' }).success).toBe(true)
    expect(schema.safeParse({ type: 'unknown' }).success).toBe(false)
  })

  test('FastModeStateSchema accepts valid states', () => {
    const schema = FastModeStateSchema()
    expect(schema.safeParse('off').success).toBe(true)
    expect(schema.safeParse('cooldown').success).toBe(true)
    expect(schema.safeParse('on').success).toBe(true)
    expect(schema.safeParse('unknown').success).toBe(false)
  })

  test('ExitReasonSchema accepts valid reasons', () => {
    const schema = ExitReasonSchema()
    const reasons = ['clear', 'resume', 'logout', 'prompt_input_exit', 'other', 'bypass_permissions_disabled']
    for (const r of reasons) {
      expect(schema.safeParse(r).success).toBe(true)
    }
    expect(schema.safeParse('invalid').success).toBe(false)
  })

  test('ModelUsageSchema accepts valid data', () => {
    const schema = ModelUsageSchema()
    const result = schema.safeParse({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 200,
      cacheCreationInputTokens: 300,
      webSearchRequests: 1,
      costUSD: 0.01,
      contextWindow: 200000,
      maxOutputTokens: 8192,
    })
    expect(result.success).toBe(true)
  })

  test('AgentDefinitionSchema accepts valid data', () => {
    const schema = AgentDefinitionSchema()
    const result = schema.safeParse({
      description: 'Test agent',
      prompt: 'You are a test agent',
    })
    expect(result.success).toBe(true)
  })

  test('McpServerStatusSchema accepts valid data', () => {
    const schema = McpServerStatusSchema()
    const result = schema.safeParse({
      name: 'test-server',
      status: 'connected',
    })
    expect(result.success).toBe(true)
  })
})
