import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { z } from 'zod/v4'
import type { ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import { createToolFixture } from '../../test/toolFixtures.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { PermissionDecision } from './PermissionResult.js'
import type { PermissionUpdate } from './PermissionUpdateSchema.js'

type HookDecision = PermissionDecision & {
  updatedPermissions?: PermissionUpdate[]
}

let hookDecision: HookDecision
let hasPermissionsToUseTool: typeof import('./permissions.js').hasPermissionsToUseTool
let createPermissionContext: typeof import('../../hooks/toolPermission/PermissionContext.js').createPermissionContext
let StructuredIO: typeof import('../../cli/structuredIO.js').StructuredIO
let actualHooks: typeof import('../hooks.js')
let beforeHookDecision: (() => void) | undefined

beforeAll(async () => {
  await acquireSharedMutationLock(
    'utils/permissions/permissions.headlessPlanHooks.test.ts',
  )
  actualHooks = await import(
    `../hooks.ts?headlessPlanHooksActual=${Date.now()}-${Math.random()}`
  )
  mock.module('../hooks.js', () => ({
    ...actualHooks,
    async *executePermissionRequestHooks() {
      beforeHookDecision?.()
      yield { permissionRequestResult: hookDecision }
    },
  }))
  ;({ hasPermissionsToUseTool } = await import(
    `./permissions.ts?headlessPlanHooks=${Date.now()}-${Math.random()}`
  ))
  ;({ createPermissionContext } = await import(
    `../../hooks/toolPermission/PermissionContext.ts?headlessPlanHooks=${Date.now()}-${Math.random()}`
  ))
  ;({ StructuredIO } = await import(
    `../../cli/structuredIO.ts?headlessPlanHooks=${Date.now()}-${Math.random()}`
  ))
})

afterAll(() => {
  try {
    mock.restore()
    mock.module('../hooks.js', () => actualHooks)
  } finally {
    releaseSharedMutationLock()
  }
})

function planContext(
  overrides: Partial<ToolPermissionContext> = {},
): {
  context: ToolUseContext
  getPermissionContext: () => ToolPermissionContext
  setPermissionContext: (context: ToolPermissionContext) => void
} {
  let toolPermissionContext: ToolPermissionContext = {
    mode: 'plan',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: true,
    shouldAvoidPermissionPrompts: true,
    ...overrides,
  }
  const context = {
    abortController: new AbortController(),
    getAppState: () => ({ toolPermissionContext }),
    setAppState: (
      update: (state: { toolPermissionContext: ToolPermissionContext }) => {
        toolPermissionContext: ToolPermissionContext
      },
    ) => {
      toolPermissionContext = update({ toolPermissionContext })
        .toolPermissionContext
    },
    options: {},
  } as unknown as ToolUseContext
  return {
    context,
    getPermissionContext: () => toolPermissionContext,
    setPermissionContext: nextContext => {
      toolPermissionContext = nextContext
    },
  }
}

const assistantMessage = {} as Parameters<
  typeof import('./permissions.js').hasPermissionsToUseTool
>[3]

describe('headless plan-mode PermissionRequest hooks', () => {
  test('denies input rewritten into an explicit deny', async () => {
    const tool = createToolFixture(
      z.object({ target: z.enum(['review', 'restricted']) }),
      {
        name: 'HeadlessTargetTool',
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
            : { behavior: 'ask' as const, message: 'Review target' }
        },
      },
    )
    hookDecision = {
      behavior: 'allow',
      updatedInput: { target: 'restricted' },
    }

    const result = await hasPermissionsToUseTool(
      tool,
      { target: 'review' },
      planContext().context,
      assistantMessage,
      'deny-rewrite',
    )

    expect(result).toMatchObject({
      behavior: 'deny',
      message: 'Restricted target',
    })
  })

  test('preserves an ask constraint introduced by rewritten input', async () => {
    const tool = createToolFixture(
      z.object({ target: z.enum(['review', 'sensitive']) }),
      {
        name: 'HeadlessAskTool',
        isReadOnly: () => true,
        async checkPermissions(input) {
          return {
            behavior: 'ask' as const,
            message: `Approval required for ${input.target}`,
            decisionReason: {
              type: 'rule' as const,
              rule: {
                source: 'session' as const,
                ruleBehavior: 'ask' as const,
                ruleValue: {
                  toolName: 'HeadlessAskTool',
                  ruleContent: input.target,
                },
              },
            },
          }
        },
      },
    )
    hookDecision = {
      behavior: 'allow',
      updatedInput: { target: 'sensitive' },
    }

    const result = await hasPermissionsToUseTool(
      tool,
      { target: 'review' },
      planContext().context,
      assistantMessage,
      'ask-rewrite',
    )

    expect(result).toMatchObject({
      behavior: 'ask',
      message: 'Approval required for sensitive',
    })
  })

  test.each([
    'acceptEdits',
    'bypassPermissions',
    'fullAccess',
  ] as const)('does not let hook permission updates enter %s', async mode => {
    const readTool = createToolFixture(z.object({}), {
      name: 'HeadlessReadTool',
      isReadOnly: () => true,
      async checkPermissions() {
        return { behavior: 'ask' as const, message: 'Review read' }
      },
    })
    const writeTool = createToolFixture(z.object({}), {
      name: 'HeadlessWriteTool',
      isReadOnly: () => false,
    })
    const { context, getPermissionContext } = planContext()
    hookDecision = {
      behavior: 'allow',
      updatedPermissions: [
        { type: 'setMode', mode, destination: 'session' },
      ],
    }

    const readResult = await hasPermissionsToUseTool(
      readTool,
      {},
      context,
      assistantMessage,
      'mode-update',
    )
    const writeResult = await hasPermissionsToUseTool(
      writeTool,
      {},
      context,
      assistantMessage,
      'subsequent-write',
    )

    expect(readResult.behavior).toBe('allow')
    expect(getPermissionContext().mode).toBe('plan')
    expect(writeResult).toMatchObject({
      behavior: 'deny',
      decisionReason: { type: 'mode', mode: 'plan' },
    })
  })

  test('interactive PermissionRequest hooks cannot persist a plan-mode escape', async () => {
    const readTool = createToolFixture(z.object({}), {
      name: 'InteractiveReadTool',
      isReadOnly: () => true,
    })
    const state = planContext({
      alwaysAskRules: { session: ['InteractiveReadTool'] },
    })
    const permissionContext = createPermissionContext(
      readTool,
      {},
      state.context,
      { message: { id: 'assistant-message' } } as never,
      'interactive-mode-update',
      state.setPermissionContext,
    )
    hookDecision = {
      behavior: 'allow',
      updatedPermissions: [
        { type: 'setMode', mode: 'fullAccess', destination: 'session' },
        {
          type: 'replaceRules',
          rules: [],
          behavior: 'ask',
          destination: 'session',
        },
      ],
    }

    const result = await permissionContext.runHooks(undefined, undefined)

    expect(result?.behavior).toBe('allow')
    expect(state.getPermissionContext().mode).toBe('plan')
    expect(state.getPermissionContext().alwaysAskRules.session).toEqual([
      'InteractiveReadTool',
    ])
  })

  test('interactive PermissionRequest hooks cannot rewrite a read into a mutation', async () => {
    const conditionalTool = createToolFixture(
      z.object({ operation: z.enum(['read', 'write']) }),
      {
        name: 'InteractiveConditionalTool',
        isReadOnly: input => input.operation === 'read',
      },
    )
    const state = planContext()
    const permissionContext = createPermissionContext(
      conditionalTool,
      { operation: 'read' },
      state.context,
      { message: { id: 'assistant-message' } } as never,
      'interactive-input-rewrite',
      state.setPermissionContext,
    )
    hookDecision = {
      behavior: 'allow',
      updatedInput: { operation: 'write' },
    }

    const result = await permissionContext.runHooks(undefined, undefined)

    expect(result).toMatchObject({
      behavior: 'deny',
      decisionReason: { type: 'mode', mode: 'plan' },
    })
  })

  test('interactive PermissionRequest hooks cannot rewrite into an explicit deny', async () => {
    const tool = createToolFixture(
      z.object({ target: z.enum(['review', 'restricted']) }),
      {
        name: 'InteractiveTargetTool',
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
            : { behavior: 'ask' as const, message: 'Review target' }
        },
      },
    )
    const state = planContext()
    const permissionContext = createPermissionContext(
      tool,
      { target: 'review' },
      state.context,
      { message: { id: 'assistant-message' } } as never,
      'interactive-deny-rewrite',
      state.setPermissionContext,
    )
    hookDecision = {
      behavior: 'allow',
      updatedInput: { target: 'restricted' },
    }

    const result = await permissionContext.runHooks(undefined, undefined)

    expect(result).toMatchObject({
      behavior: 'deny',
      message: 'Restricted target',
    })
  })

  test('interactive PermissionRequest hooks preserve a new ask constraint', async () => {
    const tool = createToolFixture(
      z.object({ target: z.enum(['review', 'sensitive']) }),
      {
        name: 'InteractiveAskTool',
        isReadOnly: () => true,
        async checkPermissions(input) {
          return {
            behavior: 'ask' as const,
            message: `Approval required for ${input.target}`,
            decisionReason: {
              type: 'rule' as const,
              rule: {
                source: 'session' as const,
                ruleBehavior: 'ask' as const,
                ruleValue: {
                  toolName: 'InteractiveAskTool',
                  ruleContent: input.target,
                },
              },
            },
          }
        },
      },
    )
    const state = planContext()
    const permissionContext = createPermissionContext(
      tool,
      { target: 'review' },
      state.context,
      { message: { id: 'assistant-message' } } as never,
      'interactive-ask-rewrite',
      state.setPermissionContext,
    )
    hookDecision = {
      behavior: 'allow',
      updatedInput: { target: 'sensitive' },
    }

    const result = await permissionContext.runHooks(undefined, undefined)

    expect(result).toMatchObject({
      behavior: 'ask',
      message: 'Approval required for sensitive',
    })
  })

  test('SDK PermissionRequest hooks cannot persist a plan-mode escape', async () => {
    const readTool = createToolFixture(z.object({}), {
      name: 'SDKReadTool',
      isReadOnly: () => true,
    })
    const writeTool = createToolFixture(z.object({}), {
      name: 'SDKWriteTool',
      isReadOnly: () => false,
    })
    const state = planContext()
    const structuredIO = new StructuredIO(
      (async function* () {
        yield* []
      })(),
    )
    hookDecision = {
      behavior: 'allow',
      updatedPermissions: [
        {
          type: 'setMode',
          mode: 'fullAccess',
          destination: 'session',
        },
      ],
    }

    const readResult = await structuredIO.createCanUseTool()(
      readTool,
      {},
      state.context,
      assistantMessage,
      'sdk-mode-update',
      { behavior: 'ask', message: 'Review read' },
    )
    const writeResult = await hasPermissionsToUseTool(
      writeTool,
      {},
      state.context,
      assistantMessage,
      'sdk-subsequent-write',
    )

    expect(readResult.behavior).toBe('allow')
    expect(state.getPermissionContext().mode).toBe('plan')
    expect(writeResult).toMatchObject({
      behavior: 'deny',
      decisionReason: { type: 'mode', mode: 'plan' },
    })
  })

  test('SDK PermissionRequest hooks cannot rewrite a read into a mutation', async () => {
    const conditionalTool = createToolFixture(
      z.object({ operation: z.enum(['read', 'write']) }),
      {
        name: 'SDKConditionalTool',
        isReadOnly: input => input.operation === 'read',
      },
    )
    const state = planContext()
    const structuredIO = new StructuredIO(
      (async function* () {
        yield* []
      })(),
    )
    hookDecision = {
      behavior: 'allow',
      updatedInput: { operation: 'write' },
    }

    const result = await structuredIO.createCanUseTool()(
      conditionalTool,
      { operation: 'read' },
      state.context,
      assistantMessage,
      'sdk-input-rewrite',
      { behavior: 'ask', message: 'Review read' },
    )

    expect(result).toMatchObject({
      behavior: 'deny',
      decisionReason: { type: 'mode', mode: 'plan' },
    })
  })

  test('entering plan mode while an SDK hook runs blocks its permission updates', async () => {
    const readTool = createToolFixture(z.object({}), {
      name: 'SDKTransitionReadTool',
      isReadOnly: () => true,
    })
    const state = planContext({ mode: 'default' })
    const structuredIO = new StructuredIO(
      (async function* () {
        yield* []
      })(),
    )
    hookDecision = {
      behavior: 'allow',
      updatedPermissions: [
        {
          type: 'setMode',
          mode: 'fullAccess',
          destination: 'session',
        },
      ],
    }
    beforeHookDecision = () => {
      state.setPermissionContext({
        ...state.getPermissionContext(),
        mode: 'plan',
      })
    }

    try {
      const result = await structuredIO.createCanUseTool()(
        readTool,
        {},
        state.context,
        assistantMessage,
        'sdk-enter-plan-mode',
        { behavior: 'ask', message: 'Review read' },
      )

      expect(result.behavior).toBe('allow')
      expect(state.getPermissionContext().mode).toBe('plan')
    } finally {
      beforeHookDecision = undefined
    }
  })

  test('entering plan mode while an interactive hook runs guards its rewritten input', async () => {
    const conditionalTool = createToolFixture(
      z.object({ operation: z.enum(['read', 'write']) }),
      {
        name: 'TransitionConditionalTool',
        isReadOnly: input => input.operation === 'read',
      },
    )
    const state = planContext({ mode: 'default' })
    const permissionContext = createPermissionContext(
      conditionalTool,
      { operation: 'read' },
      state.context,
      { message: { id: 'assistant-message' } } as never,
      'enter-plan-input-rewrite',
      state.setPermissionContext,
    )
    hookDecision = {
      behavior: 'allow',
      updatedInput: { operation: 'write' },
    }
    beforeHookDecision = () => {
      state.setPermissionContext({
        ...state.getPermissionContext(),
        mode: 'plan',
      })
    }

    try {
      const result = await permissionContext.runHooks(undefined, undefined)

      expect(result).toMatchObject({
        behavior: 'deny',
        decisionReason: { type: 'mode', mode: 'plan' },
      })
    } finally {
      beforeHookDecision = undefined
    }
  })

  test.each(['headless', 'interactive'] as const)(
    'entering plan mode while a %s hook runs blocks its permission updates',
    async executionPath => {
      const readTool = createToolFixture(z.object({}), {
        name: 'TransitionReadTool',
        isReadOnly: () => true,
        async checkPermissions() {
          return { behavior: 'ask' as const, message: 'Review read' }
        },
      })
      const state = planContext({ mode: 'default' })
      hookDecision = {
        behavior: 'allow',
        updatedPermissions: [
          { type: 'setMode', mode: 'fullAccess', destination: 'session' },
        ],
      }
      beforeHookDecision = () => {
        state.setPermissionContext({
          ...state.getPermissionContext(),
          mode: 'plan',
        })
      }

      try {
        const result =
          executionPath === 'headless'
            ? await hasPermissionsToUseTool(
                readTool,
                {},
                state.context,
                assistantMessage,
                'enter-plan-headless',
              )
            : await createPermissionContext(
                readTool,
                {},
                state.context,
                { message: { id: 'assistant-message' } } as never,
                'enter-plan-interactive',
                state.setPermissionContext,
              ).runHooks(undefined, undefined)

        expect(result?.behavior).toBe('allow')
        expect(state.getPermissionContext().mode).toBe('plan')
      } finally {
        beforeHookDecision = undefined
      }
    },
  )
})
