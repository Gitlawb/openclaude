import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const testDir = import.meta.dirname

function readSource(filename: string): string {
  return readFileSync(join(testDir, filename), 'utf8')
}

function readMainSource(): string {
  return readFileSync(join(testDir, '..', 'main.tsx'), 'utf8')
}

describe('interactive REPL max-turn cap', () => {
  test('main session config supplies the REPL-only default', () => {
    const source = readMainSource()
    expect(source).toContain('const DEFAULT_REPL_MAX_TURNS = 49')
    expect(source).toContain('maxTurns: DEFAULT_REPL_MAX_TURNS')
  })

  test('REPL forwards maxTurns to its foreground query', () => {
    const source = readSource('REPL.tsx')
    expect(source).toContain('maxTurns?: number')
    const match = source.match(
      /query\(\s*\{[\s\S]*?maxTurns,[\s\S]*?\}\s*\)/,
    )
    expect(match).not.toBeNull()
  })

  test('resume picker forwards maxTurns to the REPL', () => {
    const source = readSource('ResumeConversation.tsx')
    expect(source).toContain('maxTurns?: number')
    const replIdx = source.indexOf('<REPL')
    const replEnd = source.indexOf('/>', replIdx)
    expect(source.slice(replIdx, replEnd)).toContain('maxTurns={maxTurns}')
  })
})
