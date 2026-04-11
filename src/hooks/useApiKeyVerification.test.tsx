import { PassThrough } from 'node:stream'

import { afterEach, expect, mock, test } from 'bun:test'
import React from 'react'
import { createRoot, Text } from '../ink.js'

type AuthState = {
  anthropicAuthEnabled: boolean
  claudeSubscriber: boolean
  key?: string
  source?: string
}

function createTestStreams(): {
  stdout: PassThrough
  stdin: PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
} {
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }

  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = 120

  return { stdout, stdin }
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return
    }
    await Bun.sleep(10)
  }

  throw new Error('Timed out waiting for useApiKeyVerification test state')
}

afterEach(() => {
  mock.restore()
})

test('useApiKeyVerification resets stale missing status when the session switches to a third-party provider', async () => {
  const authState: AuthState = {
    anthropicAuthEnabled: true,
    claudeSubscriber: false,
  }
  const seenStatuses: string[] = []

  mock.module('../utils/auth.js', () => ({
    getAnthropicApiKeyWithSource: () => ({
      key: authState.key,
      source: authState.source,
    }),
    getApiKeyFromApiKeyHelper: async () => undefined,
    isAnthropicAuthEnabled: () => authState.anthropicAuthEnabled,
    isClaudeAISubscriber: () => authState.claudeSubscriber,
  }))

  mock.module('../bootstrap/state.js', () => ({
    getIsNonInteractiveSession: () => false,
  }))

  mock.module('../services/api/claude.js', () => ({
    verifyApiKey: async () => true,
  }))

  // @ts-expect-error cache-busting query string for Bun module mocks
  const { useApiKeyVerification } = await import(
    './useApiKeyVerification.ts?switch-to-third-party'
  )

  function Harness(): React.ReactNode {
    const { status } = useApiKeyVerification()

    React.useEffect(() => {
      seenStatuses.push(status)
    }, [status])

    return <Text>{status}</Text>
  }

  const { stdout, stdin } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(<Harness />)

  await waitForCondition(() => seenStatuses.includes('missing'))

  authState.anthropicAuthEnabled = false
  root.render(<Harness />)

  await waitForCondition(() => seenStatuses.includes('valid'))

  root.unmount()
  stdin.end()
  stdout.end()
  await Bun.sleep(0)

  expect(seenStatuses[0]).toBe('missing')
  expect(seenStatuses).toContain('valid')
})
