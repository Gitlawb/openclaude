/**
 * Tests for channelAutoAllow — the trust boundary that controls which
 * tool permission rules are auto-granted for channel servers.
 *
 * Validates:
 *   - Only official non-dev plugin entries get auto-allow rules
 *   - Only reply/send tools are allowed (not arbitrary server tools)
 *   - Dev entries get nothing
 *   - Server-kind entries get nothing
 *   - Merge is idempotent (repeated reconnects don't widen permissions)
 *   - A plugin exposing extra tools does not inherit broader trust
 */
import { describe, expect, test } from 'bun:test'
import type { ChannelEntry } from '../../bootstrap/state.js'
import {
  computeChannelAutoAllowRules,
  mergeAutoAllowRules,
} from './channelAutoAllow.js'

// ---------------------------------------------------------------------------
// computeChannelAutoAllowRules
// ---------------------------------------------------------------------------

describe('computeChannelAutoAllowRules', () => {
  test('returns reply rule for official plugin entry', () => {
    const entry: ChannelEntry = {
      kind: 'plugin',
      name: 'telegram',
      marketplace: 'claude-plugins-official',
    }
    const rules = computeChannelAutoAllowRules('plugin:telegram:abc', entry)
    expect(rules).toHaveLength(1)
    // Rules must contain exactly reply with the correct MCP prefix
    expect(rules[0]).toMatch(/^mcp__.*__reply$/)
  })

  test('rules use normalised server name in prefix', () => {
    const entry: ChannelEntry = {
      kind: 'plugin',
      name: 'telegram',
      marketplace: 'claude-plugins-official',
    }
    const rules = computeChannelAutoAllowRules('plugin:telegram:abc', entry)
    // "plugin:telegram:abc" normalised: colons → underscores
    expect(rules[0]).toContain('plugin_telegram_abc')
  })

  test('returns empty array for dev plugin entry', () => {
    const entry: ChannelEntry = {
      kind: 'plugin',
      name: 'custom-chat',
      marketplace: 'my-marketplace',
      dev: true,
    }
    const rules = computeChannelAutoAllowRules('plugin:custom-chat:abc', entry)
    expect(rules).toEqual([])
  })

  test('returns empty array for server-kind entry', () => {
    const entry: ChannelEntry = { kind: 'server', name: 'my-bridge' }
    const rules = computeChannelAutoAllowRules('my-bridge', entry)
    expect(rules).toEqual([])
  })

  test('returns empty array for server-kind entry even with dev flag', () => {
    const entry: ChannelEntry = {
      kind: 'server',
      name: 'my-bridge',
      dev: true,
    }
    const rules = computeChannelAutoAllowRules('my-bridge', entry)
    expect(rules).toEqual([])
  })

  test('returns empty array for undefined entry', () => {
    const rules = computeChannelAutoAllowRules('unknown-server', undefined)
    expect(rules).toEqual([])
  })

  test('only produces reply — no broader server-level rule', () => {
    const entry: ChannelEntry = {
      kind: 'plugin',
      name: 'telegram',
      marketplace: 'claude-plugins-official',
    }
    const rules = computeChannelAutoAllowRules('plugin:telegram:abc', entry)
    // No rule should be a prefix-only (server-level) rule like "mcp__plugin_telegram_abc"
    for (const rule of rules) {
      // Every rule must have content after the last __ (a tool name)
      const parts = rule.split('__')
      expect(parts.length).toBeGreaterThanOrEqual(3)
      expect(parts[parts.length - 1]).toBeTruthy() // non-empty tool name
    }
    // Ensure only reply — send goes through normal permission prompt
    const toolNames = rules.map(r => r.split('__').pop())
    expect(toolNames).toEqual(['reply'])
  })
})

// ---------------------------------------------------------------------------
// mergeAutoAllowRules
// ---------------------------------------------------------------------------

describe('mergeAutoAllowRules', () => {
  test('adds new rules to empty existing list', () => {
    const result = mergeAutoAllowRules([], ['rule_a', 'rule_b'])
    expect(result).toEqual(['rule_a', 'rule_b'])
  })

  test('adds new rules alongside existing rules', () => {
    const result = mergeAutoAllowRules(['existing'], ['rule_a', 'rule_b'])
    expect(result).toEqual(['existing', 'rule_a', 'rule_b'])
  })

  test('returns null when all rules already exist (idempotent)', () => {
    const result = mergeAutoAllowRules(
      ['rule_a', 'rule_b'],
      ['rule_a', 'rule_b'],
    )
    expect(result).toBeNull()
  })

  test('only adds rules that are new (partial overlap)', () => {
    const result = mergeAutoAllowRules(['rule_a'], ['rule_a', 'rule_b'])
    expect(result).toEqual(['rule_a', 'rule_b'])
  })

  test('returns null for empty new rules', () => {
    const result = mergeAutoAllowRules(['existing'], [])
    expect(result).toBeNull()
  })

  test('repeated reconnects are idempotent', () => {
    // Simulate: first connect adds rules, second connect is a no-op
    const entry: ChannelEntry = {
      kind: 'plugin',
      name: 'telegram',
      marketplace: 'claude-plugins-official',
    }
    const rules = computeChannelAutoAllowRules('plugin:telegram:abc', entry)
    const afterFirst = mergeAutoAllowRules([], rules)!
    expect(afterFirst).toHaveLength(1)

    const afterSecond = mergeAutoAllowRules(afterFirst, rules)
    expect(afterSecond).toBeNull() // no change — idempotent
  })

  test('different servers get separate rules without duplication', () => {
    const telegramEntry: ChannelEntry = {
      kind: 'plugin',
      name: 'telegram',
      marketplace: 'claude-plugins-official',
    }
    const discordEntry: ChannelEntry = {
      kind: 'plugin',
      name: 'discord',
      marketplace: 'claude-plugins-official',
    }

    const tgRules = computeChannelAutoAllowRules(
      'plugin:telegram:abc',
      telegramEntry,
    )
    const dcRules = computeChannelAutoAllowRules(
      'plugin:discord:xyz',
      discordEntry,
    )

    let session = mergeAutoAllowRules([], tgRules)!
    expect(session).toHaveLength(1)

    session = mergeAutoAllowRules(session, dcRules)!
    expect(session).toHaveLength(2)

    // All two rules should be distinct
    expect(new Set(session).size).toBe(2)
  })
})
