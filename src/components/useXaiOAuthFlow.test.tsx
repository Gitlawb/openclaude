import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, expect, test } from 'bun:test'
import React from 'react'

import { createRoot, Text } from '../ink.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import type {
  XaiOAuthFlowHandle,
  XaiOAuthService,
} from '../services/api/xaiOAuth.js'
import { useXaiOAuthFlow } from './useXaiOAuthFlow.js'

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

beforeEach(async () => {
  await acquireSharedMutationLock('components/useXaiOAuthFlow.test.tsx')
})

afterEach(() => {
  releaseSharedMutationLock()
})

// Probe component — just exercises the hook. We never read its output;
// we assert on the service mock's call sequence.
function HookProbe({
  service,
}: {
  service: Pick<XaiOAuthService, 'beginOAuthFlow' | 'cleanup'>
}) {
  // Memoize so the hook's useEffect doesn't re-fire on every render —
  // setStatus inside the hook triggers re-renders, and fresh deps each
  // render would loop infinitely (and inflate the cancel counter).
  const onAuthenticated = React.useCallback(async () => {
    /* never reached in these tests */
  }, [])
  const deps = React.useMemo(
    () => ({
      createOAuthService: () => service,
      openBrowser: async () => true,
      isBareMode: () => false,
      persistXaiOAuthTokens: () => ({ success: true }),
    }),
    [service],
  )
  useXaiOAuthFlow({ onAuthenticated, deps })
  return React.createElement(Text, null, 'probe')
}

function deferredHandle(): {
  resolveBegin: (handle: XaiOAuthFlowHandle) => void
  rejectBegin: (error: Error) => void
  beginPromise: Promise<XaiOAuthFlowHandle>
  handleCancelCount: () => number
  serviceCleanupCount: () => number
  makeHandle: () => XaiOAuthFlowHandle
  service: Pick<XaiOAuthService, 'beginOAuthFlow' | 'cleanup'>
} {
  let cancelCount = 0
  let cleanupCount = 0
  let resolveBegin!: (handle: XaiOAuthFlowHandle) => void
  let rejectBegin!: (error: Error) => void
  const beginPromise = new Promise<XaiOAuthFlowHandle>((resolve, reject) => {
    resolveBegin = resolve
    rejectBegin = reject
  })
  const makeHandle = (): XaiOAuthFlowHandle => ({
    authUrl: 'https://auth.x.ai/oauth2/authorize?stub=1',
    waitForTokens: () => new Promise(() => undefined), // never resolves
    submitManualCode: () => undefined,
    cancel: () => {
      cancelCount++
    },
  })
  const service = {
    beginOAuthFlow: () => beginPromise,
    cleanup: () => {
      cleanupCount++
    },
  }
  return {
    resolveBegin,
    rejectBegin,
    beginPromise,
    handleCancelCount: () => cancelCount,
    serviceCleanupCount: () => cleanupCount,
    makeHandle,
    service,
  }
}

// P2 regression: if the user presses Esc / unmounts the React tree
// while `beginOAuthFlow()` is still awaiting discovery or starting the
// loopback server, cleanup runs before the service has a callback
// handle. Then beginOAuthFlow() resolves and the freshly-started
// loopback server stays open — next attempt fails with EADDRINUSE on
// the fixed 56121 port.
test('cancellation mid-start cancels the handle once beginOAuthFlow resolves', async () => {
  const d = deferredHandle()
  const { stdout, stdin } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })
  root.render(React.createElement(HookProbe, { service: d.service }))

  // Unmount while beginOAuthFlow is still pending — simulates Esc /
  // component unmount during the discovery+listen phase.
  await Bun.sleep(10)
  expect(d.handleCancelCount()).toBe(0)
  root.unmount()
  expect(d.serviceCleanupCount()).toBeGreaterThanOrEqual(1)

  // Now resolve beginOAuthFlow — the IIFE inside the hook should see
  // `cancelled === true` and close the handle.
  d.resolveBegin(d.makeHandle())
  await Bun.sleep(20)
  expect(d.handleCancelCount()).toBe(1)
})

test('handle cancel also fires when unmount happens after handle exists', async () => {
  const d = deferredHandle()
  const { stdout, stdin } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })
  root.render(React.createElement(HookProbe, { service: d.service }))

  // Let beginOAuthFlow resolve first.
  d.resolveBegin(d.makeHandle())
  await Bun.sleep(20)
  expect(d.handleCancelCount()).toBe(0)

  // Now unmount. The cleanup function should close the handle that's
  // already tracked in activeHandle.
  root.unmount()
  expect(d.handleCancelCount()).toBe(1)
})
