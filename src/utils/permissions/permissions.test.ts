import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import type { Tool, ToolPermissionContext } from '../../Tool.js'
import { hasPermissionsToUseTool } from './permissions.js'

const safetyCheckTool = {
  name: 'SafetyCheckTool',
  inputSchema: z.object({}),
  async checkPermissions() {
    return {
      behavior: 'ask',
      message: 'Safety check requires approval',
      decisionReason: {
        type: 'safetyCheck',
        reason: 'Safety check requires approval',
        classifierApprovable: false,
      },
    }
  },
} as Tool<Record<string, never>>

const userInteractionTool = {
  name: 'UserInteractionTool',
  inputSchema: z.object({}),
  requiresUserInteraction() {
    return true
  },
  async checkPermissions() {
    return {
      behavior: 'ask',
      message: 'User interaction requires approval',
    }
  },
} as Tool<Record<string, never>>

const plainAskRuleTool = {
  name: 'PlainAskRuleTool',
  inputSchema: z.object({}),
  async checkPermissions() {
    return {
      behavior: 'passthrough',
      message: '',
    }
  },
} as Tool<Record<string, never>>

const contentAskTool = {
  name: 'ContentAskTool',
  inputSchema: z.object({}),
  async checkPermissions() {
    return {
      behavior: 'ask',
      message: 'Content rule requires approval',
      decisionReason: {
        type: 'rule',
        rule: {
          ruleBehavior: 'ask',
        },
      },
    }
  },
} as Tool<Record<string, never>>

const denyTool = {
  name: 'DenyTool',
  inputSchema: z.object({}),
  async checkPermissions() {
    return {
      behavior: 'deny',
      message: 'Denied by tool',
    }
  },
} as Tool<Record<string, never>>

function contextFor(
  mode: ToolPermissionContext['mode'],
  overrides: Partial<ToolPermissionContext> = {},
) {
  const toolPermissionContext = {
    mode,
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable:
      mode === 'bypassPermissions' || mode === 'fullAccess',
    ...overrides,
  } satisfies ToolPermissionContext

  return {
    abortController: new AbortController(),
    getAppState: () => ({ toolPermissionContext }),
    setAppState: () => {},
    options: {},
  }
}

describe('permission modes and safety checks', () => {
  test('bypassPermissions still preserves hard safety-check prompts', async () => {
    const result = await hasPermissionsToUseTool(
      safetyCheckTool,
      {},
      contextFor('bypassPermissions') as never,
      {} as never,
      'tool-use-id',
    )

    expect(result.behavior).toBe('ask')
    expect(result.decisionReason).toMatchObject({ type: 'safetyCheck' })
  })

  test('fullAccess bypasses hard safety-check prompts', async () => {
    const result = await hasPermissionsToUseTool(
      safetyCheckTool,
      {},
      contextFor('fullAccess') as never,
      {} as never,
      'tool-use-id',
    )

    expect(result.behavior).toBe('allow')
    expect(result.decisionReason).toMatchObject({
      type: 'mode',
      mode: 'fullAccess',
    })
  })

  test('fullAccess bypasses entire-tool ask rules', async () => {
    const result = await hasPermissionsToUseTool(
      plainAskRuleTool,
      {},
      contextFor('fullAccess', {
        alwaysAskRules: { session: ['PlainAskRuleTool'] },
      }) as never,
      {} as never,
      'tool-use-id',
    )

    expect(result.behavior).toBe('allow')
    expect(result.decisionReason).toMatchObject({
      type: 'mode',
      mode: 'fullAccess',
    })
  })

  test('fullAccess preserves user interaction prompts', async () => {
    const result = await hasPermissionsToUseTool(
      userInteractionTool,
      {},
      contextFor('fullAccess') as never,
      {} as never,
      'tool-use-id',
    )

    expect(result.behavior).toBe('ask')
    expect(result.message).toBe('User interaction requires approval')
  })

  test('fullAccess bypasses content-specific ask-rule prompts', async () => {
    const result = await hasPermissionsToUseTool(
      contentAskTool,
      {},
      contextFor('fullAccess') as never,
      {} as never,
      'tool-use-id',
    )

    expect(result.behavior).toBe('allow')
    expect(result.decisionReason).toMatchObject({
      type: 'mode',
      mode: 'fullAccess',
    })
  })

  test('fullAccess still preserves hard deny decisions', async () => {
    const result = await hasPermissionsToUseTool(
      denyTool,
      {},
      contextFor('fullAccess') as never,
      {} as never,
      'tool-use-id',
    )

    expect(result.behavior).toBe('deny')
    expect(result.message).toBe('Denied by tool')
  })
})
