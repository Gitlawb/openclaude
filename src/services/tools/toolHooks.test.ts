import { describe, expect, test, vi } from 'bun:test'
import { z } from 'zod/v4'

import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { getEmptyToolPermissionContext, type Tool } from '../../Tool.js'
import { resolveHookPermissionDecision } from './toolHooks.js'

const passthroughTool = {
  name: 'PassthroughTool',
  inputSchema: z.object({}),
  async checkPermissions() {
    return {
      behavior: 'passthrough',
      message: '',
    }
  },
} as Tool<Record<string, unknown>>

const denyTool = {
  name: 'DenyTool',
  inputSchema: z.object({}),
  async checkPermissions() {
    return {
      behavior: 'deny',
      message: 'Denied by tool',
    }
  },
} as Tool<Record<string, unknown>>

const askWithUpdatedInputTool = {
  name: 'AskWithUpdatedInputTool',
  inputSchema: z.object({}),
  async checkPermissions() {
    return {
      behavior: 'ask',
      message: 'Requires approval',
      updatedInput: { normalized: true },
    }
  },
} as Tool<Record<string, unknown>>

function contextForFullAccess() {
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
  } as never
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
      {} as never,
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
      {} as never,
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
      {} as never,
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
