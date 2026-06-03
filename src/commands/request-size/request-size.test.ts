import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { isValidElement } from 'react'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { ContextData } from '../../utils/analyzeContext.js'
import { processSlashCommand } from '../../utils/processUserInput/processSlashCommand.js'

const originalEnv = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
}

function restoreEnv(key: keyof typeof originalEnv): void {
  const value = originalEnv[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

function makeContextData(): ContextData {
  return {
    categories: [
      { name: 'System prompt', tokens: 1_000, color: 'permission' },
      { name: 'Messages', tokens: 2_000, color: 'permission' },
    ],
    totalTokens: 3_000,
    maxTokens: 200_000,
    rawMaxTokens: 200_000,
    percentage: 2,
    gridRows: [],
    model: 'test-model',
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    isAutoCompactEnabled: false,
    messageBreakdown: {
      toolCallTokens: 0,
      toolResultTokens: 0,
      attachmentTokens: 0,
      assistantMessageTokens: 1_000,
      userMessageTokens: 1_000,
      toolCallsByType: [],
      attachmentsByType: [],
    },
    apiUsage: null,
  }
}

beforeEach(async () => {
  await acquireSharedMutationLock('request-size.test.ts')
})

afterEach(() => {
  try {
    restoreEnv('ANTHROPIC_API_KEY')
    restoreEnv('OPENAI_API_KEY')
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

function waitForCaptured<T>(getValue: () => T | undefined): Promise<T> {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const check = () => {
      const value = getValue()
      if (value !== undefined) {
        resolve(value)
        return
      }
      attempts += 1
      if (attempts > 50) {
        reject(new Error('Timed out waiting for captured value'))
        return
      }
      setTimeout(check, 0)
    }
    check()
  })
}

test('interactive command renders a transient report without provider credentials', async () => {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.OPENAI_API_KEY

  const collectContextData = mock(async () => makeContextData())
  mock.module('../context/context-noninteractive.js', () => ({
    collectContextData,
  }))

  const nonce = `${Date.now()}-${Math.random()}`
  const { call } = await import(`./request-size.tsx?ts=${nonce}`)
  const onDone = mock(() => {})
  const result = await call(onDone as never, {} as never, '')

  expect(collectContextData).toHaveBeenCalledTimes(1)
  expect(isValidElement(result)).toBe(true)
  expect(onDone).not.toHaveBeenCalled()
})

test('closing the interactive report skips transcript output', async () => {
  const collectContextData = mock(async () => makeContextData())
  mock.module('../context/context-noninteractive.js', () => ({
    collectContextData,
  }))

  const nonce = `${Date.now()}-${Math.random()}`
  const { call } = await import(`./request-size.tsx?ts=${nonce}`)
  const onDone = mock(() => {})
  const result = await call(onDone as never, {} as never, '')

  expect(isValidElement(result)).toBe(true)

  const props = (result as { props: { onClose: () => void } }).props
  props.onClose()

  expect(onDone).toHaveBeenCalledWith(undefined, { display: 'skip' })
})

test('interactive command failures still render transient output', async () => {
  const collectContextData = mock(async () => {
    throw new Error('boom')
  })
  mock.module('../context/context-noninteractive.js', () => ({
    collectContextData,
  }))

  const nonce = `${Date.now()}-${Math.random()}`
  const { call } = await import(`./request-size.tsx?ts=${nonce}`)
  const onDone = mock(() => {})
  const result = await call(onDone as never, {} as never, '')

  expect(isValidElement(result)).toBe(true)
  expect(
    (result as { props: { reportText: string } }).props.reportText,
  ).toContain('Unable to estimate request context size')
  expect(onDone).not.toHaveBeenCalled()
})

test('noninteractive command returns a text result without provider credentials', async () => {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.OPENAI_API_KEY

  const collectContextData = mock(async () => makeContextData())
  mock.module('../context/context-noninteractive.js', () => ({
    collectContextData,
  }))

  const nonce = `${Date.now()}-${Math.random()}`
  const { call } = await import(`./request-size-noninteractive.ts?ts=${nonce}`)
  const result = await call('', {} as never)

  expect(result.type).toBe('text')
  expect(result.type === 'text' ? result.value : '').toContain(
    'Estimated context load:',
  )
  expect(result.type === 'text' ? result.display : undefined).toBe('skip')
})

test('noninteractive slash command returns text without transcript messages', async () => {
  const collectContextData = mock(async () => makeContextData())
  mock.module('../context/context-noninteractive.js', () => ({
    collectContextData,
  }))

  const nonce = `${Date.now()}-${Math.random()}`
  const { requestSizeNonInteractive } = await import(`./index.ts?ts=${nonce}`)
  const result = await processSlashCommand(
    '/request-size',
    [],
    [],
    [],
    {
      options: {
        commands: [requestSizeNonInteractive],
        isNonInteractiveSession: true,
      },
    } as never,
    mock(() => {}) as never,
  )

  expect(result.shouldQuery).toBe(false)
  expect(result.resultText).toContain('Estimated context load:')
  expect(result.messages).toEqual([])
})

test('noninteractive command failures return text without transcript messages', async () => {
  const collectContextData = mock(async () => {
    throw new Error('boom')
  })
  mock.module('../context/context-noninteractive.js', () => ({
    collectContextData,
  }))

  const nonce = `${Date.now()}-${Math.random()}`
  const { requestSizeNonInteractive } = await import(`./index.ts?ts=${nonce}`)
  const result = await processSlashCommand(
    '/request-size',
    [],
    [],
    [],
    {
      options: {
        commands: [requestSizeNonInteractive],
        isNonInteractiveSession: true,
      },
    } as never,
    mock(() => {}) as never,
  )

  expect(result.shouldQuery).toBe(false)
  expect(result.resultText).toContain('Unable to estimate request context size')
  expect(result.messages).toEqual([])
})

test('slash command processing does not create transcript messages after close', async () => {
  const collectContextData = mock(async () => makeContextData())
  mock.module('../context/context-noninteractive.js', () => ({
    collectContextData,
  }))

  const nonce = `${Date.now()}-${Math.random()}`
  const { requestSize } = await import(`./index.ts?ts=${nonce}`)
  let capturedToolJSX:
    | {
        jsx: { props: { onClose: () => void } }
      }
    | undefined

  const pendingResult = processSlashCommand(
    '/request-size',
    [],
    [],
    [],
    {
      options: {
        commands: [requestSize],
        isNonInteractiveSession: false,
      },
    } as never,
    mock(value => {
      capturedToolJSX = value as typeof capturedToolJSX
    }) as never,
  )

  const localJSX = await waitForCaptured(() => capturedToolJSX)
  expect(localJSX.jsx.props).toEqual(
    expect.objectContaining({
      reportText: expect.stringContaining('Estimated context load:'),
    }),
  )

  localJSX.jsx.props.onClose()
  const result = await pendingResult

  expect(result.shouldQuery).toBe(false)
  expect(result.messages).toEqual([])
})
