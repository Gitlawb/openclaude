import { expect, test } from 'bun:test'
import { QueryGuard } from './QueryGuard.js'
import {
  InterruptionCorrectionTracker,
  consumeInterruptionCorrectionReminder,
  shouldMarkInterruptionCorrection,
} from './interruptionCorrection.js'

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
  ]

  for (const cancellation of excludedCancellations) {
    expect(shouldMarkInterruptionCorrection(cancellation)).toBe(false)
  }
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

test('tracks the REPL query, cancellation, and one-shot reminder flow', () => {
  const tracker = new InterruptionCorrectionTracker()
  const queryGuard = new QueryGuard()

  const localCommand = queryGuard.tryStart({
    queryId: 'local-command',
    querySource: 'repl_main_thread',
    startedAt: 1,
  })!
  tracker.bindModelTurn({
    shouldQuery: false,
    isAborted: false,
    activeQueryId: queryGuard.activeContext?.queryId ?? null,
    queryId: localCommand.context.queryId,
  })
  tracker.handleCancellation({
    isUserInitiated: true,
    activeQueryId: queryGuard.activeContext?.queryId ?? null,
    isRemoteMode: false,
    sessionId: 'session-a',
  })
  queryGuard.forceEnd('user-abort', 'user-cancel')
  expect(tracker.takeReminder('session-a')).toBeNull()

  const modelTurn = queryGuard.tryStart({
    queryId: 'model-turn',
    querySource: 'repl_main_thread',
    startedAt: 2,
  })!
  tracker.bindModelTurn({
    shouldQuery: true,
    isAborted: false,
    activeQueryId: queryGuard.activeContext?.queryId ?? null,
    queryId: modelTurn.context.queryId,
  })
  tracker.handleCancellation({
    isUserInitiated: true,
    activeQueryId: queryGuard.activeContext?.queryId ?? null,
    isRemoteMode: false,
    sessionId: 'session-a',
  })
  queryGuard.forceEnd('user-abort', 'user-cancel')

  expect(tracker.takeReminder('session-a')).toMatchObject({
    type: 'user',
    isMeta: true,
  })
  expect(tracker.takeReminder('session-a')).toBeNull()
})
