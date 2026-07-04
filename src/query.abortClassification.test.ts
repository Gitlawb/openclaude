import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dirname, 'query.ts'), 'utf8')

function getAbortBlocks(): string[] {
  const blocks: string[] = []
  let searchFrom = 0
  const needle = 'if (toolUseContext.abortController.signal.aborted) {'

  while (true) {
    const start = source.indexOf(needle, searchFrom)
    if (start === -1) break

    let depth = 0
    let end = -1
    for (
      let i = start + source.slice(start).indexOf('{');
      i < source.length;
      i++
    ) {
      const ch = source[i]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          end = i + 1
          break
        }
      }
    }
    expect(end).toBeGreaterThan(start)
    blocks.push(source.slice(start, end))
    searchFrom = end
  }

  return blocks
}

describe('query abort classification wiring', () => {
  test('uses abort reason helpers instead of treating every abort as user interruption', () => {
    expect(source).toContain("from './utils/abortReasons.js'")
    expect(source).toContain('getMissingToolResultAbortMessage')
    expect(source).toContain('getQueryAbortSystemMessage')
    expect(source).toContain('shouldCreateUserInterruptionMessage')

    const abortBlocks = getAbortBlocks().filter(block =>
      block.includes('createUserInterruptionMessage'),
    )
    expect(abortBlocks).toHaveLength(2)

    for (const block of abortBlocks) {
      expect(block).toContain('shouldCreateUserInterruptionMessage(')
      expect(block).toContain('getQueryAbortSystemMessage(')
      if (block.includes('yieldMissingToolResultBlocks')) {
        expect(block).toContain('getMissingToolResultAbortMessage(')
      }
      expect(block).not.toContain(
        "toolUseContext.abortController.signal.reason !== 'interrupt'",
      )
      expect(block).not.toContain("'Interrupted by user'")
    }
  })
})
