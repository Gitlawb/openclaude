import { describe, expect, test, vi } from 'bun:test'
import { z } from 'zod/v4'

import {
  createExternalCanUseTool,
  createPermissionTarget,
} from '../../entrypoints/sdk/permissions.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
  type ToolUseContext,
} from '../../Tool.js'
import { createToolFixture } from '../../test/toolFixtures.js'
import { AgentTool } from '../../tools/AgentTool/AgentTool.js'
import { EXPLORE_AGENT } from '../../tools/AgentTool/built-in/exploreAgent.js'
import { PLAN_AGENT } from '../../tools/AgentTool/built-in/planAgent.js'
import { BashTool } from '../../tools/BashTool/BashTool.js'
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
  isReadOnly: () => true,
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

function contextForPlan(
  overrides: Partial<ToolPermissionContext> = {},
): ToolUseContext {
  return {
    abortController: new AbortController(),
    getAppState: () => ({
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode: 'plan',
        isBypassPermissionsModeAvailable: true,
        ...overrides,
      },
    }),
    options: {
      agentDefinitions: {
        activeAgents: [EXPLORE_AGENT, PLAN_AGENT],
        allAgents: [EXPLORE_AGENT, PLAN_AGENT],
      },
    },
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

  test('plan mode rejects hook-rewritten Agent cwd even when the schema strips it', async () => {
    const canUseTool = vi.fn(async () => ({
      behavior: 'allow' as const,
    })) as unknown as CanUseToolFn
    const originalInput = {
      description: 'Inspect code',
      prompt: 'Read only',
      subagent_type: 'Explore',
    }
    const rewrittenInput = { ...originalInput, cwd: '/tmp/escape' }

    const result = await resolveHookPermissionDecision(
      { behavior: 'allow', updatedInput: rewrittenInput },
      AgentTool,
      originalInput,
      contextForPlan(),
      canUseTool,
      assistantMessage,
      'agent-cwd-rewrite',
    )

    expect(result.input).toEqual(rewrittenInput)
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

  test('plan mode survives a permission hook mode change before rewritten input is checked', async () => {
    const conditionalTool = createToolFixture(
      z.object({ operation: z.enum(['read', 'write']) }),
      {
        name: 'ConditionalTool',
        isReadOnly: input => input.operation === 'read',
      },
    )
    let mode: ToolPermissionContext['mode'] = 'plan'
    const context = contextForPlan()
    context.getAppState = (() => ({
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode,
        isBypassPermissionsModeAvailable: true,
      },
    })) as ToolUseContext['getAppState']
    const canUseTool = vi.fn(async () => {
      mode = 'fullAccess'
      return {
        behavior: 'allow' as const,
        updatedInput: { operation: 'write' as const },
      }
    }) as unknown as CanUseToolFn

    const result = await resolveHookPermissionDecision(
      undefined,
      conditionalTool,
      { operation: 'read' },
      context,
      canUseTool,
      assistantMessage,
      'tool-use-id',
    )

    expect(result.decision).toMatchObject({
      behavior: 'deny',
      decisionReason: { type: 'mode', mode: 'plan' },
    })
  })

  test('entering plan mode before rewritten input executes activates the guard', async () => {
    const conditionalTool = createToolFixture(
      z.object({ operation: z.enum(['read', 'write']) }),
      {
        name: 'ConditionalTool',
        isReadOnly: input => input.operation === 'read',
      },
    )
    let mode: ToolPermissionContext['mode'] = 'acceptEdits'
    const context = contextForPlan()
    context.getAppState = (() => ({
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode,
      },
    })) as ToolUseContext['getAppState']
    const canUseTool = vi.fn(async () => {
      mode = 'plan'
      return {
        behavior: 'allow' as const,
        updatedInput: { operation: 'write' as const },
      }
    }) as unknown as CanUseToolFn

    const result = await resolveHookPermissionDecision(
      undefined,
      conditionalTool,
      { operation: 'read' },
      context,
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

  test('plan mode rechecks input rewritten by an ask decision', async () => {
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
    expect(result.input).toEqual({ operation: 'write' })
  })

  test('a forced hook ask cannot bypass an existing tool deny', async () => {
    const canUseTool = vi.fn(async () => ({
      behavior: 'allow' as const,
    })) as unknown as CanUseToolFn

    const result = await resolveHookPermissionDecision(
      { behavior: 'ask', message: 'Please approve' },
      denyTool,
      {},
      contextForPlan(),
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

  test('a forced hook ask cannot bypass an explicit deny rule', async () => {
    const canUseTool = vi.fn(async () => ({
      behavior: 'allow' as const,
    })) as unknown as CanUseToolFn

    const result = await resolveHookPermissionDecision(
      { behavior: 'ask', message: 'Please approve' },
      BashTool,
      { command: 'git status' },
      contextForPlan({
        alwaysDenyRules: { session: ['Bash'] },
      }),
      canUseTool,
      assistantMessage,
      'tool-use-id',
    )

    expect(result.decision).toMatchObject({
      behavior: 'deny',
      decisionReason: { type: 'rule' },
    })
    expect(canUseTool).not.toHaveBeenCalled()
  })

  test('required canUseTool cannot bypass an existing tool deny', async () => {
    const canUseTool = vi.fn(async () => ({
      behavior: 'allow' as const,
    })) as unknown as CanUseToolFn

    const result = await resolveHookPermissionDecision(
      { behavior: 'allow', updatedInput: {} },
      denyTool,
      {},
      { ...contextForPlan(), requireCanUseTool: true },
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

  test('rechecks tool denies against input rewritten by canUseTool', async () => {
    const targetTool = createToolFixture(
      z.object({ target: z.enum(['public', 'restricted']) }),
      {
        name: 'TargetTool',
        isReadOnly: () => true,
        async checkPermissions(input) {
          return input.target === 'restricted'
            ? {
                behavior: 'deny' as const,
                message: 'Restricted target',
                decisionReason: {
                  type: 'other' as const,
                  reason: 'Restricted target',
                },
              }
            : { behavior: 'passthrough' as const, message: '' }
        },
      },
    )
    const canUseTool = vi.fn(async () => ({
      behavior: 'allow' as const,
      updatedInput: { target: 'restricted' as const },
    })) as unknown as CanUseToolFn

    const result = await resolveHookPermissionDecision(
      undefined,
      targetTool,
      { target: 'public' },
      contextForPlan(),
      canUseTool,
      assistantMessage,
      'tool-use-id',
    )

    expect(result.decision).toMatchObject({
      behavior: 'deny',
      message: 'Restricted target',
    })
    expect(result.input).toEqual({ target: 'restricted' })
  })

  test('keeps an approved read-only ask rule allowed in plan mode', async () => {
    const canUseTool = vi.fn(async () => ({
      behavior: 'allow' as const,
    }))

    const result = await resolveHookPermissionDecision(
      undefined,
      BashTool,
      { command: 'git status' },
      contextForPlan({ alwaysAskRules: { session: ['Bash'] } }),
      canUseTool as unknown as CanUseToolFn,
      assistantMessage,
      'tool-use-id',
    )

    expect(result.decision.behavior).toBe('allow')
    expect(result.input).toEqual({ command: 'git status' })
    expect(canUseTool).toHaveBeenCalledTimes(1)
  })

  test('requests approval for an ask rule introduced by rewritten input', async () => {
    const conditionalTool = createToolFixture(
      z.object({ target: z.enum(['public', 'review']) }),
      {
        name: 'ConditionalTool',
        isReadOnly: () => true,
        async checkPermissions(input) {
          return input.target === 'review'
            ? {
                behavior: 'ask' as const,
                message: 'Review target requires approval',
                decisionReason: {
                  type: 'rule' as const,
                  rule: {
                    source: 'session' as const,
                    ruleBehavior: 'ask' as const,
                    ruleValue: {
                      toolName: 'ConditionalTool',
                      ruleContent: 'review',
                    },
                  },
                },
              }
            : { behavior: 'passthrough' as const, message: '' }
        },
      },
    )
    let permissionCall = 0
    const hostCanUseTool = vi.fn(async (_name: string, _input: unknown) => {
      permissionCall += 1
      return permissionCall === 1
        ? {
            behavior: 'allow' as const,
            updatedInput: { target: 'review' as const },
          }
        : { behavior: 'allow' as const }
    })
    const fallback = vi.fn(async () => ({
      behavior: 'deny' as const,
      message: 'Fallback should not run',
      decisionReason: { type: 'other' as const, reason: 'Unexpected fallback' },
    })) as unknown as CanUseToolFn
    const canUseTool = createExternalCanUseTool(
      hostCanUseTool,
      fallback,
      createPermissionTarget(),
    )

    const result = await resolveHookPermissionDecision(
      undefined,
      conditionalTool,
      { target: 'public' },
      contextForPlan(),
      canUseTool,
      assistantMessage,
      'tool-use-id',
    )

    expect(result.decision.behavior).toBe('allow')
    expect(result.input).toEqual({ target: 'review' })
    expect(hostCanUseTool).toHaveBeenCalledTimes(2)
    expect(hostCanUseTool.mock.calls[1]?.[1]).toEqual({ target: 'review' })
    expect(fallback).not.toHaveBeenCalled()
  })
})
