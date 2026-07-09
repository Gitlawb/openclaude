import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import React from 'react'

import type { Notification } from '../../context/notifications.js'
import { AppStateProvider, getDefaultAppState } from '../../state/AppState.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import type { Message } from '../../types/message.js'
import type { EffortValue } from '../../utils/effort.js'
import { renderToString } from '../../utils/staticRender.js'

beforeEach(async () => {
  await acquireSharedMutationLock(
    'components/PromptInput/Notifications.effort.test.tsx',
  )
  mock.restore()
  mock.module('../AutoUpdaterWrapper.js', () => ({
    AutoUpdaterWrapper: () => null,
  }))
})

afterEach(() => {
  try {
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

async function renderNotifications({
  effortValue,
  currentNotification = null,
}: {
  effortValue: EffortValue | undefined
  currentNotification?: Notification | null
}): Promise<string> {
  const { Notifications } = await import(
    `./Notifications.js?ts=${Date.now()}-${Math.random()}`
  )

  return renderToString(
    <AppStateProvider
      initialState={{
        ...getDefaultAppState(),
        mainLoopModelForSession: 'claude-opus-4-8',
        effortValue,
        notifications: {
          current: currentNotification,
          queue: [],
        },
      }}
    >
      <Notifications
        apiKeyStatus="valid"
        autoUpdaterResult={{ version: null, status: 'success' }}
        debug={false}
        isAutoUpdating={false}
        verbose={false}
        messages={[] as Message[]}
        onAutoUpdaterResult={() => {}}
        onChangeIsUpdating={() => {}}
        ideSelection={undefined}
      />
    </AppStateProvider>,
    120,
  )
}

test('renders effort as the stable footer fallback when no notification is active', async () => {
  const output = await renderNotifications({ effortValue: 'medium' })

  expect(output).toContain('medium')
  expect(output).toContain('/effort')
})

test('uses current app state when rendering the effort footer fallback', async () => {
  const highOutput = await renderNotifications({ effortValue: 'high' })
  const lowOutput = await renderNotifications({ effortValue: 'low' })

  expect(highOutput).toContain('high')
  expect(highOutput).toContain('/effort')
  expect(lowOutput).toContain('low')
  expect(lowOutput).toContain('/effort')
  expect(lowOutput).not.toContain('high · /effort')
})

test('lets transient notifications temporarily occupy the footer slot', async () => {
  const output = await renderNotifications({
    effortValue: 'medium',
    currentNotification: {
      key: 'other',
      text: 'Other notice',
      priority: 'high',
    },
  })

  expect(output).toContain('Other notice')
  expect(output).not.toContain('medium · /effort')
})
