import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function source(path: string): string {
  return readFileSync(join(import.meta.dirname, path), 'utf8')
}

test('programmatic interruption sources are explicit at their request sites', () => {
  expect(source('hooks/useReplBridge.tsx')).toContain(
    "source: 'bridge_interrupt'",
  )
  expect(source('utils/handlePromptSubmit.ts')).toContain(
    "source: 'interrupt_on_submit'",
  )
  expect(source('screens/REPL.tsx')).toContain(
    "source: 'background_handoff'",
  )
  expect(source('screens/REPL.tsx')).toContain("source: 'priority_now'")
})

test('goal phases and external provider errors have causal trace seams', () => {
  expect(source('query.ts')).toContain("'goal.main_turn_started'")
  expect(source('services/goal/controller.ts')).toContain(
    "'goal.evaluation_started'",
  )
  expect(source('services/goal/evaluator.ts')).toContain(
    "'goal.evaluation_failed'",
  )
  expect(source('services/api/claude.ts')).toContain(
    "outcome: signal.aborted ? 'root_aborted' : 'external_error'",
  )
  expect(source('services/api/codexShim.ts')).toContain(
    "outcome: signal?.aborted ? 'root_aborted' : 'external_error'",
  )
})
