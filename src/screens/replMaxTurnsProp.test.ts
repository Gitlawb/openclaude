import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_REPL_MAX_TURNS, resolveReplMaxTurns } from './replMaxTurns.js'

const screenDir = import.meta.dirname

function readScreen(name: string): string {
  return readFileSync(join(screenDir, name), 'utf8')
}

function objectBody(source: string, marker: RegExp): string {
  const match = source.match(marker)
  expect(match).not.toBeNull()
  const start = match!.index! + match![0].length - 1
  let depth = 0
  for (let index = start; index < source.length; index++) {
    if (source[index] === '{') depth++
    if (source[index] === '}') {
      depth--
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`Unclosed object after ${marker}`)
}

describe('interactive REPL max-turn cap', () => {
  test('supplies the local interactive default at runtime', () => {
    expect(DEFAULT_REPL_MAX_TURNS).toBe(50)
    expect(resolveReplMaxTurns()).toBe(50)
  })

  test('preserves an explicit interactive cap at runtime', () => {
    expect(resolveReplMaxTurns(7)).toBe(7)
  })

  test('passes the resolved cap to foreground and background queries', () => {
    const source = readScreen('REPL.tsx')
    const foreground = objectBody(source, /for await \(const event of query\(\{/)
    const background = objectBody(source, /queryParams:\s*\{/)

    expect(foreground).toContain('maxTurns,')
    expect(background).toContain('maxTurns,')
  })

  test('passes the cap from the resume selector into REPL', () => {
    const source = readScreen('ResumeConversation.tsx')
    const repl = source.slice(source.indexOf('<REPL'), source.indexOf('/>', source.indexOf('<REPL')) + 2)

    expect(repl).toContain('maxTurns={maxTurns}')
  })
})
