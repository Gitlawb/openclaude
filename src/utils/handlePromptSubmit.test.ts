import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { getCommandQueue, resetCommandQueue } from './messageQueueManager.js'

describe('handlePromptSubmit', () => {
  beforeEach(() => {
    resetCommandQueue()
    mock.module('src/services/analytics/index.js', () => ({
      logEvent: () => {},
    }))
  })

  afterEach(() => {
    resetCommandQueue()
    mock.restore()
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
