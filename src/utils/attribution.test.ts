import { describe, expect, it } from 'bun:test'
import {
  getDefaultCommitCoAuthorEmail,
  getDefaultCommitCoAuthorName,
} from './attribution.js'

describe('getDefaultCommitCoAuthorName', () => {
  it('does not label unknown non-Claude provider models as Opus', () => {
    expect(
      getDefaultCommitCoAuthorName({
        model: 'gpt-5.5',
        apiProvider: 'openai',
        isInternalRepo: false,
      }),
    ).toBe('OpenClaude (gpt-5.5)')
  })

  it('keeps the codename-safe fallback for unknown first-party models', () => {
    expect(
      getDefaultCommitCoAuthorName({
        model: 'unreleased-internal-model',
        apiProvider: 'firstParty',
        isInternalRepo: false,
      }),
    ).toBe('Claude Opus 4.6')
  })

  it('uses the OpenClaude email for non-first-party commit attribution', () => {
    expect(getDefaultCommitCoAuthorEmail('openai')).toBe(
      'openclaude@gitlawb.com',
    )
  })
})
