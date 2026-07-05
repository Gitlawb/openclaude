import { describe, expect, test } from 'bun:test'
import { detectCodeIndexingFromCommand } from './codeIndexing.js'

// Regression: CLI_COMMAND_MAPPING was a plain object, so a command whose first
// word collided with an inherited Object.prototype member (`constructor`,
// `__proto__`) resolved to the prototype value instead of `undefined`. The bare
// lookup `CLI_COMMAND_MAPPING[firstWord]` then returned the `Object` constructor
// function, and the npx/bunx branch used `in` (which walks the prototype chain),
// both falsely reporting a code-indexing tool and emitting a bogus telemetry
// event with a function as the `tool` field.
describe('detectCodeIndexingFromCommand — prototype-chain command names', () => {
  test('inherited Object.prototype member names do not resolve to a tool', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'valueOf']) {
      expect(detectCodeIndexingFromCommand(name)).toBeUndefined()
      expect(detectCodeIndexingFromCommand(`${name} search "x"`)).toBeUndefined()
    }
  })

  test('npx/bunx with a prototype-chain second word does not resolve', () => {
    expect(detectCodeIndexingFromCommand('npx constructor')).toBeUndefined()
    expect(detectCodeIndexingFromCommand('bunx __proto__ run')).toBeUndefined()
  })

  test('real mappings still resolve', () => {
    expect(detectCodeIndexingFromCommand('src search "pattern"')).toBe(
      'sourcegraph',
    )
    expect(detectCodeIndexingFromCommand('cody chat')).toBe('cody')
    expect(detectCodeIndexingFromCommand('q chat')).toBe('amazon-q')
    expect(detectCodeIndexingFromCommand('npx aider')).toBe('aider')
  })

  test('unknown commands return undefined', () => {
    expect(detectCodeIndexingFromCommand('ls -la')).toBeUndefined()
    expect(detectCodeIndexingFromCommand('')).toBeUndefined()
  })
})
