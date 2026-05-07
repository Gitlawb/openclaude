import { PassThrough } from 'node:stream'

import { afterEach, expect, mock, test } from 'bun:test'
import React from 'react'

import { createRoot, Text } from '../ink.js'

const TOKENS = {
  accessToken: 'device-access-token',
  refreshToken: 'device-refresh-token',
  accountId: 'acct_device',
  idToken: 'device-id-token',
  apiKey: 'device-api-key',
}

const DEVICE_CODE = {
  deviceCode: 'device-code',
  userCode: 'USER-CODE',
  verificationUri: 'https://auth.openai.com/activate',
  verificationUriComplete: 'https://auth.openai.com/activate?user_code=USER-CODE',
  expiresIn: 900,
  interval: 5,
}

function createTestStreams(): {
  stdout: PassThrough
  stdin: PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
  getOutput: () => string
} {
  let output = ''
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
  stdout.on('data', chunk => {
    output += chunk.toString()
  })

  return {
    stdout,
    stdin,
    getOutput: () => output,
  }
}

async function waitForCondition(
  predicate: () => boolean,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 5000
  const intervalMs = options?.intervalMs ?? 10
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return
    }
    await Bun.sleep(intervalMs)
  }

  throw new Error('Timed out waiting for useCodexDeviceCodeFlow test condition')
}

afterEach(() => {
  mock.restore()
})

test('reports bare-mode error without starting device flow', async () => {
  const requestCodexDeviceCode = mock(async () => DEVICE_CODE)
  const pollCodexDeviceToken = mock(async () => TOKENS)
  const openVerificationUri = mock(async () => true)
  const saveCodexCredentials = mock(() => ({ success: true }))
  const onAuthenticated = mock(async () => {})
  const deps = {
    requestCodexDeviceCode,
    pollCodexDeviceToken,
    openVerificationUri,
    saveCodexCredentials,
    isBareMode: () => true,
  }

  const { useCodexDeviceCodeFlow } = await import(
    `./useCodexDeviceCodeFlow.js?bare-${Date.now()}-${Math.random()}`
  )

  function Harness(): React.ReactNode {
    const handleAuthenticated = React.useCallback(onAuthenticated, [onAuthenticated])
    const status = useCodexDeviceCodeFlow({
      onAuthenticated: handleAuthenticated,
      deps,
    })

    return <Text>{status.state === 'error' ? status.message : status.state}</Text>
  }

  const streams = createTestStreams()
  const root = await createRoot({
    stdout: streams.stdout as unknown as NodeJS.WriteStream,
    stdin: streams.stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })
  root.render(<Harness />)

  try {
    await waitForCondition(() => streams.getOutput().includes('unavailable in --bare'))
    expect(requestCodexDeviceCode).not.toHaveBeenCalled()
    expect(openVerificationUri).not.toHaveBeenCalled()
    expect(pollCodexDeviceToken).not.toHaveBeenCalled()
    expect(saveCodexCredentials).not.toHaveBeenCalled()
    expect(onAuthenticated).not.toHaveBeenCalled()
  } finally {
    root.unmount()
    streams.stdin.end()
    streams.stdout.end()
    await Bun.sleep(0)
  }
})

test('opens complete verification uri and polls with device code timing', async () => {
  const requestCodexDeviceCode = mock(async () => DEVICE_CODE)
  const pollCodexDeviceToken = mock(async () => TOKENS)
  const openVerificationUri = mock(async () => true)
  const saveCodexCredentials = mock(() => ({ success: true }))
  const onAuthenticated = mock(async () => {})
  const deps = {
    requestCodexDeviceCode,
    pollCodexDeviceToken,
    openVerificationUri,
    saveCodexCredentials,
    isBareMode: () => false,
  }

  const { useCodexDeviceCodeFlow } = await import(
    `./useCodexDeviceCodeFlow.js?poll-${Date.now()}-${Math.random()}`
  )

  function Harness(): React.ReactNode {
    const handleAuthenticated = React.useCallback(onAuthenticated, [onAuthenticated])
    const status = useCodexDeviceCodeFlow({
      onAuthenticated: handleAuthenticated,
      deps,
    })

    if (status.state !== 'waiting') return <Text>{status.state}</Text>
    return <Text>{`${status.userCode} ${status.verificationUri}`}</Text>
  }

  const streams = createTestStreams()
  const root = await createRoot({
    stdout: streams.stdout as unknown as NodeJS.WriteStream,
    stdin: streams.stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })
  root.render(<Harness />)

  try {
    await waitForCondition(() => pollCodexDeviceToken.mock.calls.length === 1)
    expect(openVerificationUri).toHaveBeenCalledWith(
      DEVICE_CODE.verificationUriComplete,
    )
    expect(pollCodexDeviceToken).toHaveBeenCalledWith(DEVICE_CODE.deviceCode, {
      initialInterval: DEVICE_CODE.interval,
      timeoutSeconds: DEVICE_CODE.expiresIn,
      signal: expect.any(AbortSignal),
    })
  } finally {
    root.unmount()
    streams.stdin.end()
    streams.stdout.end()
    await Bun.sleep(0)
  }
})

test('does not persist credentials when downstream setup rejects', async () => {
  const requestCodexDeviceCode = mock(async () => DEVICE_CODE)
  const pollCodexDeviceToken = mock(async () => TOKENS)
  const openVerificationUri = mock(async () => true)
  const saveCodexCredentials = mock(() => ({ success: true }))
  const onAuthenticated = mock(async () => {
    throw new Error('profile save failed')
  })
  const deps = {
    requestCodexDeviceCode,
    pollCodexDeviceToken,
    openVerificationUri,
    saveCodexCredentials,
    isBareMode: () => false,
  }

  const { useCodexDeviceCodeFlow } = await import(
    `./useCodexDeviceCodeFlow.js?reject-${Date.now()}-${Math.random()}`
  )

  function Harness(): React.ReactNode {
    const handleAuthenticated = React.useCallback(onAuthenticated, [onAuthenticated])
    const status = useCodexDeviceCodeFlow({
      onAuthenticated: handleAuthenticated,
      deps,
    })

    return <Text>{status.state === 'error' ? status.message : status.state}</Text>
  }

  const streams = createTestStreams()
  const root = await createRoot({
    stdout: streams.stdout as unknown as NodeJS.WriteStream,
    stdin: streams.stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })
  root.render(<Harness />)

  try {
    await waitForCondition(() => onAuthenticated.mock.calls.length === 1)
    await Bun.sleep(0)
    await Bun.sleep(0)
    expect(onAuthenticated).toHaveBeenCalled()
    expect(saveCodexCredentials).not.toHaveBeenCalled()
  } finally {
    root.unmount()
    streams.stdin.end()
    streams.stdout.end()
    await Bun.sleep(0)
  }
})

test('persists credentials with profile linkage after downstream setup succeeds', async () => {
  const requestCodexDeviceCode = mock(async () => DEVICE_CODE)
  const pollCodexDeviceToken = mock(async () => TOKENS)
  const openVerificationUri = mock(async () => true)
  const saveCodexCredentials = mock(() => ({ success: true }))
  const onAuthenticated = mock(
    async (
      _tokens: typeof TOKENS,
      persistCredentials: (options?: { profileId?: string }) => void,
    ) => {
      persistCredentials({ profileId: 'profile_codex_device' })
    },
  )
  const deps = {
    requestCodexDeviceCode,
    pollCodexDeviceToken,
    openVerificationUri,
    saveCodexCredentials,
    isBareMode: () => false,
  }

  const { useCodexDeviceCodeFlow } = await import(
    `./useCodexDeviceCodeFlow.js?persist-${Date.now()}-${Math.random()}`
  )

  function Harness(): React.ReactNode {
    const handleAuthenticated = React.useCallback(onAuthenticated, [onAuthenticated])
    useCodexDeviceCodeFlow({
      onAuthenticated: handleAuthenticated,
      deps,
    })
    return <Text>waiting</Text>
  }

  const streams = createTestStreams()
  const root = await createRoot({
    stdout: streams.stdout as unknown as NodeJS.WriteStream,
    stdin: streams.stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })
  root.render(<Harness />)

  try {
    await waitForCondition(() => onAuthenticated.mock.calls.length === 1)
    await waitForCondition(() => saveCodexCredentials.mock.calls.length === 1)
    expect(onAuthenticated).toHaveBeenCalled()
    expect(saveCodexCredentials).toHaveBeenCalledWith({
      apiKey: TOKENS.apiKey,
      accessToken: TOKENS.accessToken,
      refreshToken: TOKENS.refreshToken,
      idToken: TOKENS.idToken,
      accountId: TOKENS.accountId,
      profileId: 'profile_codex_device',
    })
  } finally {
    root.unmount()
    streams.stdin.end()
    streams.stdout.end()
    await Bun.sleep(0)
  }
})

test('aborts polling on unmount', async () => {
  let pollingSignal: AbortSignal | undefined
  const requestCodexDeviceCode = mock(async () => DEVICE_CODE)
  const pollCodexDeviceToken = mock(
    async (
      _deviceCode: string,
      options?: { signal?: AbortSignal },
    ): Promise<typeof TOKENS> => {
      pollingSignal = options?.signal
      await new Promise(() => {})
      return TOKENS
    },
  )
  const openVerificationUri = mock(async () => true)
  const saveCodexCredentials = mock(() => ({ success: true }))
  const onAuthenticated = mock(async () => {})
  const deps = {
    requestCodexDeviceCode,
    pollCodexDeviceToken,
    openVerificationUri,
    saveCodexCredentials,
    isBareMode: () => false,
  }

  const { useCodexDeviceCodeFlow } = await import(
    `./useCodexDeviceCodeFlow.js?abort-${Date.now()}-${Math.random()}`
  )

  function Harness(): React.ReactNode {
    const handleAuthenticated = React.useCallback(onAuthenticated, [onAuthenticated])
    useCodexDeviceCodeFlow({
      onAuthenticated: handleAuthenticated,
      deps,
    })
    return <Text>waiting</Text>
  }

  const streams = createTestStreams()
  const root = await createRoot({
    stdout: streams.stdout as unknown as NodeJS.WriteStream,
    stdin: streams.stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })
  root.render(<Harness />)

  try {
    await waitForCondition(() => pollingSignal !== undefined)
    expect(pollingSignal?.aborted).toBe(false)
    root.unmount()
    await Bun.sleep(0)
    expect(pollingSignal?.aborted).toBe(true)
  } finally {
    streams.stdin.end()
    streams.stdout.end()
    await Bun.sleep(0)
  }
})
