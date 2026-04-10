import { expect, test } from 'bun:test'

import { formatCodexModelDisplay } from './codexDisplay.js'

test('formats codex aliases using resolved model defaults', () => {
  expect(formatCodexModelDisplay({ model: 'codexplan' })).toBe('gpt-5.4 high')
  expect(formatCodexModelDisplay({ model: 'codexspark' })).toBe(
    'gpt-5.3-codex-spark',
  )
})

test('formats explicit codex effort and fast mode like native Codex', () => {
  expect(
    formatCodexModelDisplay({
      model: 'codexplan',
      effortValue: 'xhigh',
      fastMode: true,
    }),
  ).toBe('gpt-5.4 xhigh fast')
})
