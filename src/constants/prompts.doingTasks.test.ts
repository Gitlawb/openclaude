import { expect, test } from 'bun:test'
import { withMockMacro } from 'src/test/mockMacro.js'
import { getSystemPrompt } from './prompts.js'

test('coding system prompt includes the timing and wiring robustness guidance', async () => {
  const prompt = await withMockMacro(
    { ISSUES_EXPLAINER: 'report the issue at the tracker', VERSION: '0.0.0-test' },
    async () => (await getSystemPrompt([], 'test-model')).join('\n'),
  )

  // Focused assertions on the new "Doing tasks" guidance — not a full-prompt
  // snapshot, so unrelated prompt edits don't churn this test.
  expect(prompt).toContain(
    'derive timing-sensitive logic (animation, physics, timers) from actual elapsed time',
  )
  expect(prompt).toContain('Every element you introduce must be wired up')
})
