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
    expect(source).toContain('const DEFAULT_REPL_MAX_TURNS = 50')
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
})
