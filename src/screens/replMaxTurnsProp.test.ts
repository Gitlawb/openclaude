import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_REPL_MAX_TURNS, resolveReplMaxTurns } from './replMaxTurns.js'

const screenDir = import.meta.dirname

const ENV_KEYS = ['OPENCLAUDE_MAX_TURNS', 'CLAUDE_CODE_MAX_TURNS'] as const
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {}

function readScreen(name: string): string {
  return readFileSync(join(screenDir, name), 'utf8')
}

function readSourceUp(name: string): string {
  return readFileSync(join(screenDir, '..', name), 'utf8')
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

function clearTurnEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = savedEnv[key]
    if (previous === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = previous
    }
  }
})

for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key]
}

describe('interactive REPL max-turn cap', () => {
  test('supplies the local interactive default at runtime', () => {
    clearTurnEnv()
    expect(DEFAULT_REPL_MAX_TURNS).toBe(50)
    expect(resolveReplMaxTurns()).toBe(50)
  })

  test('preserves an explicit interactive cap at runtime', () => {
    clearTurnEnv()
    expect(resolveReplMaxTurns(7)).toBe(7)
  })

  test('honors OPENCLAUDE_MAX_TURNS when no explicit cap is passed', () => {
    clearTurnEnv()
    process.env.OPENCLAUDE_MAX_TURNS = '200'
    expect(resolveReplMaxTurns()).toBe(200)
  })

  test('falls back to CLAUDE_CODE_MAX_TURNS when OPENCLAUDE_MAX_TURNS is unset', () => {
    clearTurnEnv()
    process.env.CLAUDE_CODE_MAX_TURNS = '125'
    expect(resolveReplMaxTurns()).toBe(125)
  })

  test('prefers OPENCLAUDE_MAX_TURNS over CLAUDE_CODE_MAX_TURNS', () => {
    clearTurnEnv()
    process.env.OPENCLAUDE_MAX_TURNS = '90'
    process.env.CLAUDE_CODE_MAX_TURNS = '30'
    expect(resolveReplMaxTurns()).toBe(90)
  })

  test('explicit CLI cap wins over environment overrides', () => {
    clearTurnEnv()
    process.env.OPENCLAUDE_MAX_TURNS = '200'
    expect(resolveReplMaxTurns(80)).toBe(80)
  })

  test('ignores invalid env and explicit values and keeps the default', () => {
    clearTurnEnv()
    process.env.OPENCLAUDE_MAX_TURNS = 'nope'
    expect(resolveReplMaxTurns()).toBe(DEFAULT_REPL_MAX_TURNS)
    expect(resolveReplMaxTurns(0)).toBe(DEFAULT_REPL_MAX_TURNS)
    expect(resolveReplMaxTurns(-3)).toBe(DEFAULT_REPL_MAX_TURNS)
    expect(resolveReplMaxTurns(Number.NaN)).toBe(DEFAULT_REPL_MAX_TURNS)
    expect(resolveReplMaxTurns(2.5)).toBe(DEFAULT_REPL_MAX_TURNS)
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

  test('sessionConfig wires maxTurns from the CLI flag', () => {
    const source = readSourceUp('main.tsx')
    const body = objectBody(source, /const sessionConfig = \{/)
    expect(body).toContain('maxTurns: options.maxTurns')
  })

  test('non-sessionConfig interactive launch paths forward maxTurns', () => {
    // connect / ssh / assistant / --remote build REPL props without
    // spreading sessionConfig; each must still pass the CLI override.
    const source = readSourceUp('main.tsx')
    const markers = [
      /directConnectConfig,\s*\n\s*thinkingConfig,\s*\n\s*maxTurns: options\.maxTurns/,
      /sshSession,\s*\n\s*thinkingConfig,\s*\n\s*maxTurns: options\.maxTurns/,
    ]
    for (const marker of markers) {
      expect(source).toMatch(marker)
    }
    // Count explicit maxTurns: options.maxTurns assignments outside
    // sessionConfig — connect, ssh, assistant, remote (+ sessionConfig = 5).
    const matches = source.match(/maxTurns:\s*options\.maxTurns/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(5)
  })

  test('--max-turns help no longer claims print-only', () => {
    const source = readSourceUp('main.tsx')
    const optionMatch = source.match(
      /\.addOption\(\s*new Option\(\s*'--max-turns <turns>',\s*'([^']+)'/,
    )
    expect(optionMatch).not.toBeNull()
    const help = optionMatch![1]
    expect(help.toLowerCase()).not.toContain('only works with --print')
    expect(help.toLowerCase()).toContain('interactive')
  })
})
