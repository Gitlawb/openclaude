import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dirname, 'claude.ts'), 'utf8')

describe('Claude stream abort classification wiring', () => {
  test('logs aborted streams through reason-aware abort formatting', () => {
    expect(source).toContain('getStreamingAbortMessage(')
    expect(source).toContain('signal.reason')
    expect(source).not.toContain('Streaming aborted by user:')
  })
})
