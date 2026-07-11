import { describe, expect, test, vi } from 'bun:test'
import { z } from 'zod/v4'

import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../../Tool.js'
import { createToolFixture } from '../../test/toolFixtures.js'
import { resolveHookPermissionDecision } from './toolHooks.js'

const emptyInputSchema = z.object({})
const assistantMessage = {} as Parameters<CanUseToolFn>[3]

const passthroughTool = createToolFixture(emptyInputSchema, {
  name: 'PassthroughTool',
  async checkPermissions() {
    return {
      behavior: 'passthrough',
      message: '',
    }
  },
})

const denyTool = createToolFixture(emptyInputSchema, {
  name: 'DenyTool',
  async checkPermissions() {
    return {
      behavior: 'deny',
      message: 'Denied by tool',
      decisionReason: {
        type: 'other',
        reason: 'Denied by tool',
      },
    }
  },
})

const askWithUpdatedInputTool = createToolFixture(emptyInputSchema, {
  name: 'AskWithUpdatedInputTool',
  async checkPermissions() {
    return {
      behavior: 'ask',
      message: 'Requires approval',
      updatedInput: { normalized: true },
    }
  },
})

function contextForFullAccess(): ToolUseContext {
  return {
    abortController: new AbortController(),
    getAppState: () => ({
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode: 'fullAccess',
        isBypassPermissionsModeAvailable: true,
      },
    }),
    options: {},
  } as unknown as ToolUseContext
}

function contextForPlan(): ToolUseContext {
  return {
    abortController: new AbortController(),
    getAppState: () => ({
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode: 'plan',
        isBypassPermissionsModeAvailable: true,
      },
    }),
    options: {},
  } as unknown as ToolUseContext
}

describe('resolveHookPermissionDecision', () => {
  test('fullAccess bypasses hook ask prompts without calling canUseTool', async () => {
    const canUseTool = vi.fn(async () => ({
      behavior: 'ask' as const,
      message: 'Should not prompt',
    })) as unknown as CanUseToolFn
    const updatedInput = { normalized: true }

    const result = await resolveHookPermissionDecision(
      {
        behavior: 'ask',
        message: 'Confirm hook request',
        updatedInput,
      },
      passthroughTool,
      {},
      contextForFullAccess(),
      canUseTool,
      assistantMessage,
      'tool-use-id',
    )

    expect(result).toEqual({
      decision: {
        behavior: 'allow',
        updatedInput,
        decisionReason: {
          type: 'mode',
          mode: 'fullAccess',
        },
      },
      input: updatedInput,
    })
    expect(canUseTool).not.toHaveBeenCalled()
  })

  test('fullAccess hook ask still preserves tool denies', async () => {
    const canUseTool = vi.fn(async () => ({
      behavior: 'allow' as const,
    })) as unknown as CanUseToolFn

    const result = await resolveHookPermissionDecision(
      {
        behavior: 'ask',
        message: 'Confirm hook request',
      },
      denyTool,
      {},
      contextForFullAccess(),
      canUseTool,
      assistantMessage,
      'tool-use-id',
    )

    expect(result.decision).toMatchObject({
      behavior: 'deny',
      message: 'Denied by tool',
    })
    expect(canUseTool).not.toHaveBeenCalled()
  })

  test('fullAccess hook ask preserves updatedInput from tool permission checks', async () => {
    const canUseTool = vi.fn(async () => ({
      behavior: 'ask' as const,
      message: 'Should not prompt',
    })) as unknown as CanUseToolFn

    const result = await resolveHookPermissionDecision(
      {
        behavior: 'ask',
        message: 'Confirm hook request',
      },
      askWithUpdatedInputTool,
      { raw: true },
      contextForFullAccess(),
      canUseTool,
      assistantMessage,
      'tool-use-id',
    )

    expect(result).toEqual({
      decision: {
        behavior: 'allow',
        updatedInput: { normalized: true },
        decisionReason: {
          type: 'mode',
          mode: 'fullAccess',
        },
      },
      input: { normalized: true },
    })
    expect(canUseTool).not.toHaveBeenCalled()
  })

  test('plan mode rejects a hook allow for a mutating tool', async () => {
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const })) as unknown as CanUseToolFn
    const mutatingTool = createToolFixture(emptyInputSchema, {
      name: 'MutatingTool',
      isReadOnly: () => false,
    })

    const result = await resolveHookPermissionDecision(
      { behavior: 'allow', updatedInput: {} },
      mutatingTool,
      {},
      contextForPlan(),
      canUseTool,
      assistantMessage,
      'tool-use-id',
    )

    expect(result.decision).toMatchObject({
      behavior: 'deny',
      decisionReason: { type: 'mode', mode: 'plan' },
    })
    expect(canUseTool).not.toHaveBeenCalled()
  })

  test('plan mode evaluates hook-rewritten input that becomes mutating', async () => {
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const })) as unknown as CanUseToolFn
    const conditionalTool = createToolFixture(
      z.object({ operation: z.enum(['read', 'write']) }),
      {
        name: 'ConditionalTool',
        isReadOnly: input => input.operation === 'read',
      },
    )

    const result = await resolveHookPermissionDecision(
      {
        behavior: 'allow',
        updatedInput: { operation: 'write' },
      },
      conditionalTool,
      { operation: 'read' },
      contextForPlan(),
      canUseTool,
      assistantMessage,
      'tool-use-id',
    )

    expect(result.input).toEqual({ operation: 'write' })
    expect(result.decision).toMatchObject({
      behavior: 'deny',
      decisionReason: { type: 'mode', mode: 'plan' },
    })
    expect(canUseTool).not.toHaveBeenCalled()
  })

  test('plan mode denies a hook ask for a known mutation before prompting', async () => {
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const })) as unknown as CanUseToolFn
    const mutatingTool = createToolFixture(emptyInputSchema, {
      name: 'MutatingTool',
      isReadOnly: () => false,
    })

    const result = await resolveHookPermissionDecision(
      { behavior: 'ask', message: 'Please approve' },
      mutatingTool,
      {},
      contextForPlan(),
      canUseTool,
      assistantMessage,
      'tool-use-id',
    )

    expect(result.decision).toMatchObject({
      behavior: 'deny',
      decisionReason: { type: 'mode', mode: 'plan' },
    })
    expect(canUseTool).not.toHaveBeenCalled()
  })

  test('plan mode rechecks input rewritten by canUseTool', async () => {
    const conditionalTool = createToolFixture(
      z.object({ operation: z.enum(['read', 'write']) }),
      {
        name: 'ConditionalTool',
        isReadOnly: input => input.operation === 'read',
      },
    )
    const canUseTool = vi.fn(async () => ({
      behavior: 'allow' as const,
      updatedInput: { operation: 'write' as const },
    })) as unknown as CanUseToolFn

    const result = await resolveHookPermissionDecision(
      undefined,
      conditionalTool,
      { operation: 'read' },
      contextForPlan(),
      canUseTool,
      assistantMessage,
      'tool-use-id',
    )

    expect(result.decision).toMatchObject({
      behavior: 'deny',
      decisionReason: { type: 'mode', mode: 'plan' },
    })
  })

  test('plan mode rechecks input rewritten after a required canUseTool call', async () => {
    const conditionalTool = createToolFixture(
      z.object({ operation: z.enum(['read', 'write']) }),
      {
        name: 'ConditionalTool',
        isReadOnly: input => input.operation === 'read',
      },
    )
    const canUseTool = vi.fn(async () => ({
      behavior: 'allow' as const,
      updatedInput: { operation: 'write' as const },
    })) as unknown as CanUseToolFn

    const result = await resolveHookPermissionDecision(
      { behavior: 'allow', updatedInput: { operation: 'read' } },
      conditionalTool,
      { operation: 'read' },
      { ...contextForPlan(), requireCanUseTool: true },
      canUseTool,
      assistantMessage,
      'tool-use-id',
    )

    expect(result.decision).toMatchObject({
      behavior: 'deny',
      decisionReason: { type: 'mode', mode: 'plan' },
    })
  })

  test('plan mode denies a required canUseTool mutation before prompting', async () => {
    const conditionalTool = createToolFixture(
      z.object({ operation: z.enum(['read', 'write']) }),
      {
        name: 'ConditionalTool',
        isReadOnly: input => input.operation === 'read',
      },
    )
    const canUseTool = vi.fn(async () => ({
      behavior: 'ask' as const,
      message: 'Please approve',
    })) as unknown as CanUseToolFn

    const result = await resolveHookPermissionDecision(
      { behavior: 'allow', updatedInput: { operation: 'write' } },
      conditionalTool,
      { operation: 'read' },
      { ...contextForPlan(), requireCanUseTool: true },
      canUseTool,
      assistantMessage,
      'tool-use-id',
    )

    expect(result.decision).toMatchObject({
      behavior: 'deny',
      decisionReason: { type: 'mode', mode: 'plan' },
    })
    expect(canUseTool).not.toHaveBeenCalled()
  })

  test('returns the final input approved by canUseTool', async () => {
    const canUseTool = vi.fn(async () => ({
      behavior: 'allow' as const,
      updatedInput: { normalized: true },
    })) as unknown as CanUseToolFn

    const result = await resolveHookPermissionDecision(
      undefined,
      passthroughTool,
      { raw: true },
      contextForFullAccess(),
      canUseTool,
      assistantMessage,
      'tool-use-id',
    )

    expect(result).toMatchObject({
      decision: {
        behavior: 'allow',
        updatedInput: { normalized: true },
      },
      input: { normalized: true },
    })
  })
})
