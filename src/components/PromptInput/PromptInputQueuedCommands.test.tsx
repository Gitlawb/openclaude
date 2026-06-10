import React from 'react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { renderToString } from '../../utils/staticRender.js'
import * as realCommandQueue from '../../hooks/useCommandQueue.js'
import { AppStateProvider } from 'src/state/AppState.js'

describe('PromptInputQueuedCommands', () => {
  beforeEach(async () => {
    await acquireSharedMutationLock('components/PromptInput/PromptInputQueuedCommands.test.tsx')
    mock.module('../../hooks/useCommandQueue.js', () => ({
      useCommandQueue: () => [
        {
          value: 'Use another library',
          mode: 'prompt',
        },
      ],
    }))

  })

  afterEach(() => {
    try {
      mock.restore()
      mock.module('../../hooks/useCommandQueue.js', () => realCommandQueue)
    } finally {
      releaseSharedMutationLock()
    }
  })

  it('shows a next-turn guidance banner for queued prompt messages', async () => {
    const { PromptInputQueuedCommands } = await import('./PromptInputQueuedCommands.js')

    const output = await renderToString(
      <AppStateProvider>
        <PromptInputQueuedCommands />
      </AppStateProvider>,
      100,
    )

    expect(output).toContain('1 message queued for next turn')
    expect(output).toContain('Use another library')
  })
})
