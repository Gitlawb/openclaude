import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  Command as CommanderCommand,
  InvalidArgumentError,
  Option,
} from '@commander-js/extra-typings'
import { createQueryTurnBudget } from '../query.js'
import {
  claimBackgroundTurnBudget,
  releaseForegroundTurnBudget,
} from './replMaxTurns.js'
import {
  DEFAULT_GLOBAL_CONFIG,
  GLOBAL_CONFIG_KEYS,
  getGlobalConfig,
  isGlobalConfigKey,
  saveGlobalConfig,
} from '../utils/config.js'
import {
  DEFAULT_REPL_MAX_TURNS,
  getReplMaxTurnsWarning,
  MAX_TURNS_CLI_DESCRIPTION,
  MAX_TURNS_UNLIMITED_WARNING,
  normalizeReplMaxTurns,
  parseMaxTurnsCli,
  REPL_MAX_TURNS_OPTIONS,
  resolveReplMaxTurns,
} from '../utils/replMaxTurns.js'
import * as debug from '../utils/debug.js'

const screenDir = import.meta.dirname

const ENV_KEYS = ['OPENCLAUDE_MAX_TURNS', 'CLAUDE_CODE_MAX_TURNS'] as const
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {}
const savedReplMaxTurns = getGlobalConfig().replMaxTurns

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

function setReplMaxTurnsConfig(value: number | undefined): void {
  saveGlobalConfig(current => ({
    ...current,
    replMaxTurns: value,
  }))
}

function createMaxTurnsCliProgram(): CommanderCommand {
  const program = new CommanderCommand()
  program
    .name('openclaude')
    .exitOverride()
    .addOption(
      new Option('--max-turns <turns>', MAX_TURNS_CLI_DESCRIPTION).argParser(
        value => {
          try {
            return parseMaxTurnsCli(value)
          } catch (error) {
            throw new InvalidArgumentError(
              error instanceof Error ? error.message : String(error),
            )
          }
        },
      ),
    )
    .action(() => {})
  return program
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
  setReplMaxTurnsConfig(savedReplMaxTurns)
})

for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key]
}

describe('interactive REPL max-turn cap', () => {
  test('supplies the local interactive default at runtime', () => {
    clearTurnEnv()
    setReplMaxTurnsConfig(undefined)
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

  test('invalid OPENCLAUDE_MAX_TURNS does not fall through to legacy', () => {
    clearTurnEnv()
    process.env.OPENCLAUDE_MAX_TURNS = 'nope'
    process.env.CLAUDE_CODE_MAX_TURNS = '125'
    expect(resolveReplMaxTurns()).toBe(DEFAULT_REPL_MAX_TURNS)
  })

  test('does not include an invalid environment value in debug logs', () => {
    clearTurnEnv()
    const invalidValue = 'private-value-that-must-not-be-logged'
    process.env.OPENCLAUDE_MAX_TURNS = invalidValue
    const logSpy = spyOn(debug, 'logForDebugging').mockImplementation(() => {})

    try {
      expect(resolveReplMaxTurns()).toBe(DEFAULT_REPL_MAX_TURNS)
      expect(logSpy).toHaveBeenCalledTimes(1)
      const logged = logSpy.mock.calls.flat().join(' ')
      expect(logged).toContain('OPENCLAUDE_MAX_TURNS has an invalid value')
      expect(logged).not.toContain(invalidValue)
    } finally {
      logSpy.mockRestore()
    }
  })

  test('explicit CLI cap wins over environment overrides', () => {
    clearTurnEnv()
    process.env.OPENCLAUDE_MAX_TURNS = '200'
    expect(resolveReplMaxTurns(80)).toBe(80)
  })

  test('honors /config replMaxTurns when CLI and env are unset', () => {
    clearTurnEnv()
    setReplMaxTurnsConfig(200)
    expect(resolveReplMaxTurns()).toBe(200)
  })

  test('env wins over /config replMaxTurns', () => {
    clearTurnEnv()
    setReplMaxTurnsConfig(200)
    process.env.OPENCLAUDE_MAX_TURNS = '80'
    expect(resolveReplMaxTurns()).toBe(80)
  })

  test('CLI wins over /config replMaxTurns', () => {
    clearTurnEnv()
    setReplMaxTurnsConfig(200)
    expect(resolveReplMaxTurns(90)).toBe(90)
  })

  test('treats an explicit CLI zero as unlimited and invalid values as the default', () => {
    clearTurnEnv()
    setReplMaxTurnsConfig(undefined)
    process.env.OPENCLAUDE_MAX_TURNS = 'nope'
    expect(resolveReplMaxTurns()).toBe(DEFAULT_REPL_MAX_TURNS)
    clearTurnEnv()
    expect(resolveReplMaxTurns(0)).toBeUndefined()
    expect(resolveReplMaxTurns(-3)).toBe(DEFAULT_REPL_MAX_TURNS)
    expect(resolveReplMaxTurns(Number.NaN)).toBe(DEFAULT_REPL_MAX_TURNS)
    expect(resolveReplMaxTurns(2.5)).toBe(DEFAULT_REPL_MAX_TURNS)
  })

  test('warns when the CLI explicitly disables the turn limit', () => {
    expect(getReplMaxTurnsWarning(0)).toBe(MAX_TURNS_UNLIMITED_WARNING)
    expect(getReplMaxTurnsWarning(50)).toBeUndefined()
    expect(getReplMaxTurnsWarning()).toBeUndefined()
  })

  test('emits the unlimited warning only from a local REPL', () => {
    const repl = readScreen('REPL.tsx')
    const main = readSourceUp('main.tsx')
    expect(repl).toContain('!isRemoteSession && !directConnectConfig && !sshSession')
    expect(main).not.toContain('getReplMaxTurnsWarning')
  })

  test('normalizeReplMaxTurns matches /config picker persistence', () => {
    expect(normalizeReplMaxTurns(200)).toBe(200)
    expect(normalizeReplMaxTurns('500')).toBe(500)
    expect(normalizeReplMaxTurns(0)).toBe(DEFAULT_REPL_MAX_TURNS)
    expect(normalizeReplMaxTurns('nope')).toBe(DEFAULT_REPL_MAX_TURNS)
  })

  test('replMaxTurns is registered for /config', () => {
    expect(GLOBAL_CONFIG_KEYS).toContain('replMaxTurns')
    expect(isGlobalConfigKey('replMaxTurns')).toBe(true)
    expect(DEFAULT_GLOBAL_CONFIG.replMaxTurns).toBeUndefined()
    expect(REPL_MAX_TURNS_OPTIONS).toEqual([50, 100, 200, 500])
  })

  test('background budget handoff preserves identity and is one-shot', () => {
    const budget = createQueryTurnBudget(50)
    const budgetRef = { current: budget }
    const handoffStartedRef = { current: false }

    expect(
      claimBackgroundTurnBudget(budgetRef, handoffStartedRef),
    ).toBe(budget)
    expect(
      claimBackgroundTurnBudget(budgetRef, handoffStartedRef),
    ).toBeNull()

    const newerBudget = createQueryTurnBudget(100)
    budgetRef.current = newerBudget
    handoffStartedRef.current = false
    releaseForegroundTurnBudget(budgetRef, handoffStartedRef, budget)
    expect(budgetRef.current).toBe(newerBudget)

    releaseForegroundTurnBudget(budgetRef, handoffStartedRef, newerBudget)
    expect(budgetRef.current).toBeNull()
    expect(handoffStartedRef.current).toBe(false)
  })

  test('background tasks retain a max-turn terminal attachment', () => {
    const backgroundTask = readSourceUp(join('tasks', 'LocalMainSessionTask.ts'))
    expect(backgroundTask).toContain(
      "event.attachment.type === 'max_turns_reached'",
    )
  })

  test('Config panel exposes Max turns (interactive)', () => {
    const source = readSourceUp(join('components', 'Settings', 'Config.tsx'))
    expect(source).toContain("id: 'replMaxTurns'")
    expect(source).toContain("label: 'Max turns (interactive)'")
  })

  test('passes the cap from the resume selector into REPL', () => {
    const source = readScreen('ResumeConversation.tsx')
    const repl = source.slice(
      source.indexOf('<REPL'),
      source.indexOf('/>', source.indexOf('<REPL')) + 2,
    )

    expect(repl).toContain('maxTurns={maxTurns}')
  })

  test('Commander --max-turns help scopes the interactive cap to local query loops', () => {
    // Commander wraps long option help across lines; collapse whitespace.
    const help = createMaxTurnsCliProgram()
      .helpInformation()
      .toLowerCase()
      .replace(/\s+/g, ' ')
    expect(help).toContain('--max-turns')
    expect(help).toContain('local interactive')
    expect(help).toContain('remote-backed')
    expect(help).not.toContain('only works with --print')
  })

  test('Commander --max-turns parses into the value the local REPL resolves', async () => {
    clearTurnEnv()
    setReplMaxTurnsConfig(50)
    const program = createMaxTurnsCliProgram()
    await program.parseAsync(['node', 'openclaude', '--max-turns', '200'], {
      from: 'node',
    })
    const parsed = program.getOptionValue('maxTurns') as number
    expect(parsed).toBe(200)
    // Same handoff the interactive session uses: CLI option → resolveReplMaxTurns.
    expect(resolveReplMaxTurns(parsed)).toBe(200)
  })

  test('Commander --max-turns rejects values that could disable the cap accidentally', () => {
    expect(parseMaxTurnsCli('0')).toBe(0)
    expect(parseMaxTurnsCli('200')).toBe(200)
    for (const invalid of ['', '   ', 'nope', '-3', '2.5', 'Infinity']) {
      expect(() => parseMaxTurnsCli(invalid)).toThrow(
        '--max-turns must be a non-negative integer',
      )
    }
  })

  test('Commander formats invalid --max-turns as an option error', async () => {
    const program = createMaxTurnsCliProgram()
    await expect(
      program.parseAsync(['node', 'openclaude', '--max-turns', 'nope'], {
        from: 'node',
      }),
    ).rejects.toMatchObject({
      code: 'commander.invalidArgument',
      exitCode: 1,
    })
  })

  test('main imports the shared --max-turns description and wires sessionConfig', () => {
    // main.tsx is hard to boot in unit tests; assert the import so the
    // shared constant cannot be referenced without being bundled, plus the
    // local interactive sessionConfig handoff (same pattern as fallbackModel).
    const source = readSourceUp('main.tsx')
    expect(source).toMatch(
      /import\s*\{[^}]*\bMAX_TURNS_CLI_DESCRIPTION\b[^}]*\}\s*from\s*'\.\/utils\/replMaxTurns\.js'/,
    )
    expect(source).toContain(
      "new Option('--max-turns <turns>', MAX_TURNS_CLI_DESCRIPTION)",
    )
    const body = objectBody(source, /const sessionConfig = \{/)
    expect(body).toContain('maxTurns: options.maxTurns')
  })
})
