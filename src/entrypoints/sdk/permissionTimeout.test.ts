import { expect, test, vi } from 'bun:test'
import { z } from 'zod/v4'

import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  getEmptyToolPermissionContext,
  type ToolUseContext,
} from '../../Tool.js'
import { createToolFixture } from '../../test/toolFixtures.js'
import {
  createExternalCanUseTool,
  createPermissionTarget,
} from './permissions.js'

// When a host wires up onPermissionRequest but does not answer within the
// timeout window, the timeout branch resolved its own deny into a promise the
// race had already abandoned and then fell through to the fallback. The
// fallback is createDefaultCanUseTool, whose contract is "no permission
// callback was provided at all" -- so the tool result blamed a missing
// callback that was in fact supplied, and the reason for the denial (a
// timeout) never reached the model or the host developer.

const tool = createToolFixture(z.object({}), { name: 'SlowTool' })

const assistantMessage = {} as Parameters<CanUseToolFn>[3]

function context(): ToolUseContext {
  return {
    abortController: new AbortController(),
    getAppState: () => ({
      toolPermissionContext: getEmptyToolPermissionContext(),
    }),
    options: {},
  } as unknown as ToolUseContext
}

test('a permission timeout reports the timeout, not a missing callback', async () => {
  const fallback = vi.fn(async () => ({
    behavior: 'deny' as const,
    message:
      'SDK: Tool "SlowTool" denied — no canUseTool or onPermissionRequest callback provided. Pass canUseTool in options to control tool permissions.',
    decisionReason: { type: 'mode' as const, mode: 'default' as const },
  })) as unknown as CanUseToolFn
  const onTimeout = vi.fn()

  // No userFn, but onPermissionRequest IS provided, and the host never calls
  // respondToPermission -- so the request can only end by timing out.
  const canUseTool = createExternalCanUseTool(
    undefined,
    fallback,
    createPermissionTarget(),
    () => {},
    onTimeout,
    10,
  )

  const decision = await canUseTool(
    tool,
    {},
    context(),
    assistantMessage,
    'tool-use-id',
    undefined,
  )

  expect(decision.behavior).toBe('deny')
  expect(decision.behavior === 'deny' && decision.message).toContain(
    'timed out',
  )
  // The misleading advice must not be what the model is told.
  expect(decision.behavior === 'deny' && decision.message).not.toContain(
    'no canUseTool or onPermissionRequest callback provided',
  )
  // The timeout event still fires, and the no-callback fallback never runs --
  // running it would also burn its one-shot warning latch for the process.
  expect(onTimeout).toHaveBeenCalledTimes(1)
  expect(fallback).not.toHaveBeenCalled()
})

test('a host answer before the timeout is unaffected', async () => {
  const fallback = vi.fn(async () => ({
    behavior: 'deny' as const,
    message: 'fallback',
    decisionReason: { type: 'mode' as const, mode: 'default' as const },
  })) as unknown as CanUseToolFn
  const onTimeout = vi.fn()
  const target = createPermissionTarget()

  const canUseTool = createExternalCanUseTool(
    undefined,
    fallback,
    target,
    () => {
      // Answer as soon as the request is emitted.
      queueMicrotask(() => target.denyPendingPermission('tool-use-id', 'no'))
    },
    onTimeout,
    5_000,
  )

  const decision = await canUseTool(
    tool,
    {},
    context(),
    assistantMessage,
    'tool-use-id',
    undefined,
  )

  expect(decision.behavior).toBe('deny')
  expect(decision.behavior === 'deny' && decision.message).toBe('no')
  expect(onTimeout).not.toHaveBeenCalled()
  expect(fallback).not.toHaveBeenCalled()
})

test('the fallback still runs when no permission callback is wired up', async () => {
  const fallback = vi.fn(async () => ({
    behavior: 'deny' as const,
    message: 'fallback ran',
    decisionReason: { type: 'mode' as const, mode: 'default' as const },
  })) as unknown as CanUseToolFn

  // Neither userFn nor onPermissionRequest: this is the case the fallback's
  // message actually describes, and it must keep reaching it.
  const canUseTool = createExternalCanUseTool(
    undefined,
    fallback,
    createPermissionTarget(),
    undefined,
    undefined,
    10,
  )

  const decision = await canUseTool(
    tool,
    {},
    context(),
    assistantMessage,
    'tool-use-id',
    undefined,
  )

  expect(decision.behavior === 'deny' && decision.message).toBe('fallback ran')
  expect(fallback).toHaveBeenCalledTimes(1)
})
