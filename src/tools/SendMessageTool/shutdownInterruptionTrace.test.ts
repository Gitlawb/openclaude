import { afterEach, expect, test } from 'bun:test'
import {
  __getInterruptionTraceSnapshotForTests,
  __resetInterruptionTraceForTests,
  registerInterruptionController,
} from '../../utils/interruptionTrace.js'
import { abortApprovedInProcessTeammate } from './shutdownInterruptionTrace.js'

const originalTrace = process.env.OPENCLAUDE_INTERRUPT_TRACE

afterEach(() => {
  __resetInterruptionTraceForTests()
  if (originalTrace === undefined) delete process.env.OPENCLAUDE_INTERRUPT_TRACE
  else process.env.OPENCLAUDE_INTERRUPT_TRACE = originalTrace
})

test('shutdown approval records its input before requesting the teammate abort', () => {
  process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
  const controller = new AbortController()
  registerInterruptionController(controller, {
    subsystem: 'in_process_teammate',
    controllerRole: 'subagent-lifecycle',
    subagentId: 'agent-1',
  })

  abortApprovedInProcessTeammate(controller, {
    agentId: 'agent-1',
  })

  expect(controller.signal.aborted).toBe(true)
  expect(controller.signal.reason).toBeInstanceOf(DOMException)
  expect((controller.signal.reason as DOMException).name).toBe('AbortError')
  const trace = __getInterruptionTraceSnapshotForTests()
  const approved = trace.find(
    entry => entry.event === 'teammate.shutdown_approved',
  )
  const requested = trace.find(entry => entry.event === 'abort.requested')
  expect(approved).toMatchObject({
    source: 'shutdown_approved',
    subsystem: 'in_process_teammate',
    controllerRole: 'subagent-lifecycle',
    subagentId: 'agent-1',
  })
  expect(requested).toMatchObject({
    source: 'shutdown_approved',
    subsystem: 'in_process_teammate',
    controllerRole: 'subagent-lifecycle',
    subagentId: 'agent-1',
    causalEventId: approved?.eventId,
  })
  expect(trace.indexOf(approved!)).toBeLessThan(trace.indexOf(requested!))
})
