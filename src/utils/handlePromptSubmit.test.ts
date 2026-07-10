import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as realAnalyticsModule from '../services/analytics/index.js'
import { getCommandQueue, resetCommandQueue } from './messageQueueManager.js'
import { createUserMessage } from './messages.js'
import * as realProcessUserInputModule from './processUserInput/processUserInput.js'

const realAnalytics = { ...realAnalyticsModule }
const realProcessUserInput = { ...realProcessUserInputModule }

describe('handlePromptSubmit', () => {
  beforeEach(async () => {
    await acquireSharedMutationLock('utils/handlePromptSubmit.test.ts')
    resetCommandQueue()
    mock.module('src/services/analytics/index.js', () => ({
      logEvent: () => {},
    }))
  })

  afterEach(() => {
    try {
      resetCommandQueue()
      mock.restore()
      mock.module('src/services/analytics/index.js', () => realAnalytics)
      mock.module(
        './processUserInput/processUserInput.js',
        () => realProcessUserInput,
      )
    } finally {
      releaseSharedMutationLock()
    }
  })

  it('prepends a pending interruption reminder to the next normal prompt', async () => {
    const correctionMessage = createUserMessage({ content: 'do Y instead' })
    const reminderMessage = createUserMessage({
      content: '<system-reminder>interrupted</system-reminder>',
      isMeta: true,
    })
    mock.module('./processUserInput/processUserInput.js', () => ({
      processUserInput: async () => ({
        messages: [correctionMessage],
        shouldQuery: true,
      }),
    }))
    const { handlePromptSubmit } = await import('./handlePromptSubmit.js')

    const queriedMessages: unknown[][] = []
    let reminderTakeCount = 0

    await handlePromptSubmit({
      input: 'do Y instead',
      mode: 'prompt',
      pastedContents: {},
      helpers: {
        setCursorOffset: () => {},
        clearBuffer: () => {},
        resetHistory: () => {},
      },
      onInputChange: () => {},
      setPastedContents: () => {},
      takeInterruptionCorrectionReminder: () => {
        reminderTakeCount++
        return reminderMessage
      },
      queryGuard: {
        isActive: false,
        reserve: () => true,
        cancelReservation: () => {},
      } as never,
      isExternalLoading: false,
      commands: [],
      messages: [],
      mainLoopModel: 'sonnet',
      ideSelection: undefined,
      querySource: 'repl' as never,
      setToolJSX: () => {},
      getToolUseContext: () => ({}) as never,
      setUserInputOnProcessing: () => {},
      setAbortController: () => {},
      onQuery: async newMessages => {
        queriedMessages.push(newMessages)
      },
      setAppState: () => ({}) as never,
    })

    expect(reminderTakeCount).toBe(1)
    expect(queriedMessages).toEqual([[reminderMessage, correctionMessage]])
  })

  it('preserves a reminder across a queued slash command and injects it once', async () => {
    const reminderMessage = createUserMessage({
      content: '<system-reminder>interrupted</system-reminder>',
      isMeta: true,
    })
    mock.module('./processUserInput/processUserInput.js', () => ({
      processUserInput: async ({ input }: { input: string }) => ({
        messages: input.startsWith('/')
          ? []
          : [createUserMessage({ content: input })],
        shouldQuery: !input.startsWith('/'),
      }),
    }))
    const { handlePromptSubmit } = await import('./handlePromptSubmit.js')

    let pending = true
    let injectedCount = 0
    const queriedMessages: unknown[][] = []
    const takeReminder = () => {
      if (!pending) return null
      pending = false
      injectedCount++
      return reminderMessage
    }
    const baseParams = {
      helpers: {
        setCursorOffset: () => {},
        clearBuffer: () => {},
        resetHistory: () => {},
      },
      onInputChange: () => {},
      setPastedContents: () => {},
      takeInterruptionCorrectionReminder: takeReminder,
      queryGuard: {
        isActive: false,
        reserve: () => true,
        cancelReservation: () => {},
      } as never,
      isExternalLoading: false,
      commands: [],
      messages: [],
      mainLoopModel: 'sonnet',
      ideSelection: undefined,
      querySource: 'repl' as never,
      setToolJSX: () => {},
      getToolUseContext: () => ({}) as never,
      setUserInputOnProcessing: () => {},
      setAbortController: () => {},
      onQuery: async (newMessages: unknown[]) => {
        queriedMessages.push(newMessages)
      },
      setAppState: () => ({}) as never,
    }

    await handlePromptSubmit({
      ...baseParams,
      queuedCommands: [
        {
          value: '/help',
          preExpansionValue: '[Pasted text #1]',
          mode: 'prompt',
        },
      ],
    } as never)
    expect(pending).toBe(true)
    expect(injectedCount).toBe(0)

    for (const value of ['do Y instead', 'future prompt']) {
      await handlePromptSubmit({
        ...baseParams,
        queuedCommands: [{ value, preExpansionValue: value, mode: 'prompt' }],
      } as never)
    }

    expect(injectedCount).toBe(1)
    expect(queriedMessages).toHaveLength(2)
    expect(queriedMessages[0]).toEqual([
      reminderMessage,
      expect.objectContaining({
        type: 'user',
        message: expect.objectContaining({ content: 'do Y instead' }),
      }),
    ])
    expect(queriedMessages[1]).toEqual([
      expect.objectContaining({
        type: 'user',
        message: expect.objectContaining({ content: 'future prompt' }),
      }),
    ])
  })

  it('only consumes correction reminders for normal local keyboard prompts', async () => {
    const promptSubmitModule = await import('./handlePromptSubmit.js')
    const isNormalLocalUserPrompt = (
      promptSubmitModule as typeof promptSubmitModule & {
        isNormalLocalUserPrompt?: (command: Record<string, unknown>) => boolean
      }
    ).isNormalLocalUserPrompt

    expect(typeof isNormalLocalUserPrompt).toBe('function')

    const normalPrompt = {
      value: 'do Y instead',
      preExpansionValue: 'do Y instead',
      mode: 'prompt',
    }
    expect(isNormalLocalUserPrompt?.(normalPrompt)).toBe(true)

    const ineligiblePrompts = [
      { ...normalPrompt, value: '/help', preExpansionValue: '/help' },
      {
        ...normalPrompt,
        value: '/help',
        preExpansionValue: '[Pasted text #1]',
      },
      { ...normalPrompt, mode: 'bash' },
      { ...normalPrompt, preExpansionValue: undefined },
      { ...normalPrompt, skipSlashCommands: true },
      { ...normalPrompt, bridgeOrigin: true },
      { ...normalPrompt, isMeta: true },
      { ...normalPrompt, origin: { kind: 'task-notification' } },
      { ...normalPrompt, slashCommandOverride: {} },
      { ...normalPrompt, value: [{ type: 'text', text: 'do Y instead' }] },
    ]

    for (const prompt of ineligiblePrompts) {
      expect(isNormalLocalUserPrompt?.(prompt)).toBe(false)
    }
  })

  it('queues prompt submissions during generation without interrupting the current turn', async () => {
    const { handlePromptSubmit } = await import('./handlePromptSubmit.js')

    const abortCalls: unknown[] = []
    const inputChanges: string[] = []
    let cursorOffset = 123
    let bufferCleared = false
    let pastedContentsCleared = false
    let historyReset = false

    await handlePromptSubmit({
      input: '  use another library  ',
      mode: 'prompt',
      pastedContents: {},
      helpers: {
        setCursorOffset: offset => {
          cursorOffset = offset
        },
        clearBuffer: () => {
          bufferCleared = true
        },
        resetHistory: () => {
          historyReset = true
        },
      },
      onInputChange: value => {
        inputChanges.push(value)
      },
      setPastedContents: updater => {
        const nextValue =
          typeof updater === 'function'
            ? updater({ 1: { id: 1, type: 'text', content: 'x' } })
            : updater
        pastedContentsCleared = Object.keys(nextValue).length === 0
      },
      abortController: {
        abort: (reason: unknown) => {
          abortCalls.push(reason)
        },
      } as never,
      hasInterruptibleToolInProgress: true,
      queryGuard: {
        isActive: true,
      } as never,
      isExternalLoading: false,
      commands: [],
      messages: [],
      mainLoopModel: 'sonnet',
      ideSelection: undefined,
      querySource: 'repl' as never,
      setToolJSX: () => {},
      getToolUseContext: () => ({}) as never,
      setUserInputOnProcessing: () => {},
      setAbortController: () => {},
      onQuery: async () => {},
      setAppState: () => ({}) as never,
    })

    expect(abortCalls).toEqual([])
    expect(inputChanges).toEqual([''])
    expect(cursorOffset).toBe(0)
    expect(bufferCleared).toBe(true)
    expect(pastedContentsCleared).toBe(true)
    expect(historyReset).toBe(true)
    expect(getCommandQueue()).toMatchObject([
      {
        value: 'use another library',
        preExpansionValue: 'use another library',
        mode: 'prompt',
      },
    ])
  })
})
