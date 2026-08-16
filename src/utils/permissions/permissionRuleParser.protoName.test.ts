import { describe, expect, test } from 'bun:test'
import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import {
  normalizeLegacyToolName,
  permissionRuleValueFromString,
} from './permissionRuleParser.js'

// Regression: LEGACY_TOOL_NAME_ALIASES is a plain object literal indexed by a
// caller-supplied tool name. A bare bracket lookup resolves inherited
// Object.prototype members, so a name that collides with one of them
// (`constructor`, `toString`, `valueOf`, `hasOwnProperty`, `__proto__`)
// returned the inherited function/object instead of the string. `?? name`
// never caught it because the inherited value is non-null. That broke the
// declared `string` return type and every downstream comparison
// (availableToolNames.has(...), hook matcher `===`, permission-rule toolName).
describe('normalizeLegacyToolName — prototype-safe alias lookup', () => {
  const protoNames = [
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    '__proto__',
  ]

  for (const name of protoNames) {
    test(`'${name}' resolves to itself (own aliases only)`, () => {
      const result = normalizeLegacyToolName(name)
      expect(typeof result).toBe('string')
      expect(result).toBe(name)
    })
  }

  // Controls: real legacy aliases and plain passthrough names are unaffected.
  test('genuine legacy aliases still map to their canonical name', () => {
    expect(normalizeLegacyToolName('Task')).toBe(AGENT_TOOL_NAME)
  })

  test('unknown tool names pass through unchanged', () => {
    expect(normalizeLegacyToolName('Bash')).toBe('Bash')
    expect(normalizeLegacyToolName('Read')).toBe('Read')
  })
})

describe('permissionRuleValueFromString — proto-name tool names', () => {
  // A permission rule whose tool name collides with a prototype member must
  // still yield that literal name as a string, not the inherited function.
  test('bare proto-name rule keeps the literal tool name', () => {
    const rule = permissionRuleValueFromString('constructor')
    expect(typeof rule.toolName).toBe('string')
    expect(rule.toolName).toBe('constructor')
    expect(rule.ruleContent).toBeUndefined()
  })

  test('proto-name rule with content keeps the literal tool name and content', () => {
    const rule = permissionRuleValueFromString('hasOwnProperty(rm -rf /)')
    expect(typeof rule.toolName).toBe('string')
    expect(rule.toolName).toBe('hasOwnProperty')
    expect(rule.ruleContent).toBe('rm -rf /')
  })

  test('ordinary rules are unchanged', () => {
    expect(permissionRuleValueFromString('Bash')).toEqual({ toolName: 'Bash' })
    expect(permissionRuleValueFromString('Bash(npm install)')).toEqual({
      toolName: 'Bash',
      ruleContent: 'npm install',
    })
  })
})
