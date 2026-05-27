import { describe, expect, test } from 'bun:test'
import { deriveMcpSkillName, isSkillResource } from './mcpSkills.js'

describe('isSkillResource', () => {
  test('true for skill:// uri', () => {
    expect(isSkillResource({ uri: 'skill://code-review', name: 'code-review' })).toBe(true)
  })
  test('false for file:// uri', () => {
    expect(isSkillResource({ uri: 'file:///tmp/x.md', name: 'x' })).toBe(false)
  })
  test('false for https resource', () => {
    expect(isSkillResource({ uri: 'https://example.com/r', name: 'r' })).toBe(false)
  })
  test('case-insensitive scheme', () => {
    expect(isSkillResource({ uri: 'SKILL://Thing', name: 'Thing' })).toBe(true)
  })
  test('false for empty uri', () => {
    expect(isSkillResource({ uri: '', name: 'x' })).toBe(false)
  })
})

describe('deriveMcpSkillName', () => {
  test('namespaces with mcp__<server>__<skill>', () => {
    expect(deriveMcpSkillName('my-server', 'skill://code-review')).toBe('mcp__my-server__code-review')
  })
  test('strips skill:// scheme and uses the remainder', () => {
    expect(deriveMcpSkillName('s', 'skill://deploy/prod')).toBe('mcp__s__deploy/prod')
  })
  test('normalizes server name segment', () => {
    const name = deriveMcpSkillName('My Server', 'skill://x')
    expect(name.startsWith('mcp__')).toBe(true)
    expect(name.endsWith('__x')).toBe(true)
    expect(name).not.toContain('My Server')
  })
  test('falls back to bare uri when no skill:// prefix', () => {
    expect(deriveMcpSkillName('s', 'weird')).toBe('mcp__s__weird')
  })
})
