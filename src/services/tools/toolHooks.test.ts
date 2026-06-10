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
})
