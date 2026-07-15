import { expect, test } from 'bun:test'
import {
  applyInterruptionCorrectionAwareMessageUpdate,
  buildInterruptionCorrectionMessageViews,
  consumeInterruptionCorrectionReminder,
  InterruptionCorrectionTracker,
  shouldMarkInterruptionCorrection,
} from './interruptionCorrection.js'
import { createUserMessage } from './messages/factories.js'
import { createCompactBoundaryMessage } from './messages/systemFactories.js'
import { QueryGuard } from './QueryGuard.js'
import type { Message } from '../types/message.js'

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
  const proofTurn = queryGuard.tryStart({
    queryId: 'proof-turn',
    querySource: 'repl_main_thread',
    startedAt: 1,
  })!
  tracker.bindModelTurn({
    shouldQuery: true,
    isInterruptionCorrectionEligible: true,
    queryId: proofTurn.context.queryId,
  })
  tracker.handleCancellation({
    isUserInitiated: true,
    isRemoteMode: false,
  })
  queryGuard.forceEnd('user-abort', 'user-cancel')
  expect(tracker.takeReminder()).toMatchObject({ type: 'user', isMeta: true })

  const rewrittenTurn = queryGuard.tryStart({
    queryId: 'auto-restored-turn',
    querySource: 'repl_main_thread',
    startedAt: 2,
  })!
  tracker.bindModelTurn({
    shouldQuery: true,
    isInterruptionCorrectionEligible: true,
    queryId: rewrittenTurn.context.queryId,
  })
  tracker.handleCancellation({
    isUserInitiated: true,
    isRemoteMode: false,
  })
  queryGuard.forceEnd('user-abort', 'user-cancel')

  tracker.handleConversationRewrite()

  expect(tracker.takeReminder()).toBeNull()
})

test('clears a pending reminder when a full compact boundary is applied', () => {
  const queryGuard = new QueryGuard()
  const tracker = new InterruptionCorrectionTracker(
    queryGuard,
    () => 'session-a',
  )
  const turn = queryGuard.tryStart({
    queryId: 'interrupted-turn',
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

  const messagesRef = { current: [] }
  applyInterruptionCorrectionAwareMessageUpdate(
    messagesRef,
    [createCompactBoundaryMessage('manual', 100)],
    tracker,
  )

  expect(tracker.takeReminder()).toBeNull()
})

test('keeps a pending reminder when messages retain the existing compact boundary', () => {
  const queryGuard = new QueryGuard()
  const tracker = new InterruptionCorrectionTracker(
    queryGuard,
    () => 'session-a',
  )
  const boundary = createCompactBoundaryMessage('manual', 100)
  const turn = queryGuard.tryStart({
    queryId: 'post-compact-turn',
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

  const messagesRef = { current: [boundary] }
  applyInterruptionCorrectionAwareMessageUpdate(
    messagesRef,
    [boundary, createUserMessage({ content: 'new correction' })],
    tracker,
  )

  expect(tracker.takeReminder()).toMatchObject({ type: 'user', isMeta: true })
})

test('clears a pending reminder when a later compaction replaces an existing boundary', () => {
  const queryGuard = new QueryGuard()
  const tracker = new InterruptionCorrectionTracker(
    queryGuard,
    () => 'session-a',
  )
  const previousBoundary = createCompactBoundaryMessage('manual', 100)
  const turn = queryGuard.tryStart({
    queryId: 'repeat-compact-turn',
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

  const messagesRef: { current: Message[] } = { current: [previousBoundary] }
  const nextBoundary = createCompactBoundaryMessage('manual', 200)
  const transition = applyInterruptionCorrectionAwareMessageUpdate(
    messagesRef,
    previousMessages => [
      ...previousMessages.slice(0, -1),
      nextBoundary,
      createUserMessage({ content: 'compact summary' }),
    ],
    tracker,
  )

  expect(transition.previousMessages).toEqual([previousBoundary])
  expect(transition.nextMessages).toEqual([
    nextBoundary,
    expect.objectContaining({ type: 'user' }),
  ])
  expect(messagesRef.current).toBe(transition.nextMessages)
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

test('keeps the correction reminder in one request without persisting it', () => {
  const priorMessage = createUserMessage({ content: 'start with X' })
  const reminder = consumeInterruptionCorrectionReminder(
    'session-a',
    'session-a',
  ).reminder!
  const otherMetaMessage = createUserMessage({
    content: '<system-reminder>keep this context</system-reminder>',
    isMeta: true,
  })
  const correction = createUserMessage({ content: 'do Y instead' })

  const correctionTurn = buildInterruptionCorrectionMessageViews(
    [priorMessage],
    [otherMetaMessage, reminder, correction],
  )
  expect(correctionTurn.persistentMessages).toEqual([
    priorMessage,
    otherMetaMessage,
    correction,
  ])
  expect(correctionTurn.persistentNewMessages).toEqual([
    otherMetaMessage,
    correction,
  ])
  expect(correctionTurn.requestOnlyMessages).toEqual([reminder])

  const laterPrompt = createUserMessage({ content: 'unrelated follow-up' })
  const laterTurn = buildInterruptionCorrectionMessageViews(
    correctionTurn.persistentMessages,
    [laterPrompt],
  )
  expect(laterTurn.persistentMessages).toEqual([
    priorMessage,
    otherMetaMessage,
    correction,
    laterPrompt,
  ])
  expect(laterTurn.requestOnlyMessages).toEqual([])
})
