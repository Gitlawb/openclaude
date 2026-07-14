import { expect, test } from 'bun:test'
import {
  consumeInterruptionCorrectionReminder,
  InterruptionCorrectionTracker,
  shouldMarkInterruptionCorrection,
} from './interruptionCorrection.js'
import { QueryGuard } from './QueryGuard.js'

test('only marks a local user cancellation of the active model query', () => {
  const localUserCancellation = {
    isUserInitiated: true,
    activeQueryId: 'query-1',
    modelBoundQueryId: 'query-1',
    isRemoteMode: false,
  }
  expect(shouldMarkInterruptionCorrection(localUserCancellation)).toBe(true)

  const excludedCancellations = [
    { ...localUserCancellation, isUserInitiated: false },
    { ...localUserCancellation, activeQueryId: null },
    { ...localUserCancellation, modelBoundQueryId: null },
    { ...localUserCancellation, modelBoundQueryId: 'query-2' },
    { ...localUserCancellation, isRemoteMode: true },
    { ...localUserCancellation, hasQueuedNormalPrompt: true },
  ]

  for (const cancellation of excludedCancellations) {
    expect(shouldMarkInterruptionCorrection(cancellation)).toBe(false)
  }
})

test('clears a pending reminder when the interrupted context is rewritten', () => {
  const queryGuard = new QueryGuard()
  const tracker = new InterruptionCorrectionTracker(
    queryGuard,
    () => 'session-a',
  )
  const turn = queryGuard.tryStart({
    queryId: 'auto-restored-turn',
    querySource: 'repl_main_thread',
    startedAt: 1,
  })!
  tracker.bindModelTurn({
    shouldQuery: true,
    isInterruptionCorrectionEligible: true,
    queryId: turn.context.queryId,
  })
  tracker.handleCancellation({
    isUserInitiated: true,
    isRemoteMode: false,
  })
  queryGuard.forceEnd('user-abort', 'user-cancel')

  tracker.handleConversationRewrite()

  expect(tracker.takeReminder()).toBeNull()
})

test('builds one same-session reminder and clears pending state', () => {
  const withoutPending = consumeInterruptionCorrectionReminder(null, 'session-a')
  expect(withoutPending).toEqual({ pendingSessionId: null, reminder: null })

  const first = consumeInterruptionCorrectionReminder('session-a', 'session-a')
  expect(first.pendingSessionId).toBeNull()
  expect(first.reminder).toMatchObject({
    type: 'user',
    isMeta: true,
    message: {
      content: `<system-reminder>
The previous assistant turn was interrupted by the user. Treat the user's latest message as a correction and do not continue the interrupted plan unless explicitly asked.
</system-reminder>`,
    },
  })

  expect(
    consumeInterruptionCorrectionReminder(
      first.pendingSessionId,
      'session-a',
    ),
  ).toEqual({
    pendingSessionId: null,
    reminder: null,
  })

  expect(
    consumeInterruptionCorrectionReminder('session-a', 'session-b'),
  ).toEqual({ pendingSessionId: null, reminder: null })
})
