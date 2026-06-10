import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import type { ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import { createToolFixture } from '../../test/toolFixtures.js'
import { hasPermissionsToUseTool } from './permissions.js'

const emptyInputSchema = z.object({})
const assistantMessage = {} as Parameters<typeof hasPermissionsToUseTool>[3]

const safetyCheckTool = createToolFixture(emptyInputSchema, {
  name: 'SafetyCheckTool',
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
})

const userInteractionTool = createToolFixture(emptyInputSchema, {
  name: 'UserInteractionTool',
  requiresUserInteraction() {
    return true
  },
  async checkPermissions() {
    return {
      behavior: 'ask',
      message: 'User interaction requires approval',
    }
  },
})

const plainAskRuleTool = createToolFixture(emptyInputSchema, {
  name: 'PlainAskRuleTool',
  async checkPermissions() {
    return {
      behavior: 'passthrough',
      message: '',
    }
  },
})

const contentAskTool = createToolFixture(emptyInputSchema, {
  name: 'ContentAskTool',
  async checkPermissions() {
    return {
      behavior: 'ask',
      message: 'Content rule requires approval',
      decisionReason: {
        type: 'rule',
        rule: {
          source: 'session',
          ruleBehavior: 'ask',
          ruleValue: {
            toolName: 'ContentAskTool',
          },
        },
      },
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

function contextFor(
  mode: ToolPermissionContext['mode'],
  overrides: Partial<ToolPermissionContext> = {},
): ToolUseContext {
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
  } as unknown as ToolUseContext
}

describe('permission modes and safety checks', () => {
  test('bypassPermissions still preserves hard safety-check prompts', async () => {
    const result = await hasPermissionsToUseTool(
      safetyCheckTool,
      {},
      contextFor('bypassPermissions'),
      assistantMessage,
      'tool-use-id',
    )

    expect(result.behavior).toBe('ask')
    expect(result.decisionReason).toMatchObject({ type: 'safetyCheck' })
  })

  test('fullAccess bypasses hard safety-check prompts', async () => {
    const result = await hasPermissionsToUseTool(
      safetyCheckTool,
      {},
      contextFor('fullAccess'),
      assistantMessage,
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
      }),
      assistantMessage,
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
      contextFor('fullAccess'),
      assistantMessage,
      'tool-use-id',
    )

    expect(result.behavior).toBe('ask')
    if (result.behavior !== 'ask') {
      throw new Error(`Expected ask decision, received ${result.behavior}`)
    }
    expect(result.message).toBe('User interaction requires approval')
  })

  test('fullAccess bypasses content-specific ask-rule prompts', async () => {
    const result = await hasPermissionsToUseTool(
      contentAskTool,
      {},
      contextFor('fullAccess'),
      assistantMessage,
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
      contextFor('fullAccess'),
      assistantMessage,
      'tool-use-id',
    )

    expect(result.behavior).toBe('deny')
    if (result.behavior !== 'deny') {
      throw new Error(`Expected deny decision, received ${result.behavior}`)
    }
    expect(result.message).toBe('Denied by tool')
  })
})
