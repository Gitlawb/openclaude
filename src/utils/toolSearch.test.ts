import { describe, expect, test } from 'bun:test'
import { resolveToolSearchMode } from './toolSearch.js'

describe('resolveToolSearchMode', () => {
  test('defaults to tst when nothing is configured', () => {
    expect(resolveToolSearchMode({}, 'firstParty')).toBe('tst')
    expect(resolveToolSearchMode({}, 'codex')).toBe('tst')
  })

  test('kill switch forces standard mode on Anthropic-wire providers', () => {
    const env = { CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: 'true' }
    expect(resolveToolSearchMode(env, 'firstParty')).toBe('standard')
    expect(resolveToolSearchMode(env, 'bedrock')).toBe('standard')
    expect(resolveToolSearchMode(env, 'vertex')).toBe('standard')
    expect(resolveToolSearchMode(env, 'foundry')).toBe('standard')
    expect(resolveToolSearchMode(env, 'minimax')).toBe('standard')
  })

  test('kill switch does not disable tool search on converted-wire providers', () => {
    // The OpenAI shims and the Gemini Vertex client convert every message and
    // tool definition client-side — no Anthropic beta shape reaches the wire,
    // so the beta kill switch has nothing to protect there.
    const env = { CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: 'true' }
    expect(resolveToolSearchMode(env, 'codex')).toBe('tst')
    expect(resolveToolSearchMode(env, 'openai')).toBe('tst')
    expect(resolveToolSearchMode(env, 'github')).toBe('tst')
    expect(resolveToolSearchMode(env, 'gemini')).toBe('tst')
    expect(resolveToolSearchMode(env, 'mistral')).toBe('tst')
  })

  test('explicit ENABLE_TOOL_SEARCH=false still disables everywhere', () => {
    const env = { ENABLE_TOOL_SEARCH: 'false' }
    expect(resolveToolSearchMode(env, 'codex')).toBe('standard')
    expect(resolveToolSearchMode(env, 'firstParty')).toBe('standard')
  })

  test('auto mode is preserved on converted-wire providers despite kill switch', () => {
    const env = {
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: 'true',
      ENABLE_TOOL_SEARCH: 'auto',
    }
    expect(resolveToolSearchMode(env, 'codex')).toBe('tst-auto')
    expect(resolveToolSearchMode(env, 'firstParty')).toBe('standard')
  })
})
