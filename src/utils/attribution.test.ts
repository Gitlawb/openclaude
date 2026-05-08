import { describe, expect, it } from 'bun:test'
import {
  getDefaultModelForProvider,
  getModelMetadata,
} from '../integrations/modelCatalog/catalog.js'
import {
  getDefaultCommitCoAuthorEmail,
  getDefaultCommitCoAuthorName,
} from './attribution.js'
import { sanitizeModelName } from './commitAttribution.js'

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

  it('does not apply internal Claude formatting to non-Claude providers', () => {
    expect(
      getDefaultCommitCoAuthorName({
        model: 'gpt-5.5',
        apiProvider: 'openai',
        isInternalRepo: true,
      }),
    ).toBe('OpenClaude (gpt-5.5)')
  })

  it('keeps the codename-safe fallback for unknown first-party models', () => {
    const defaultOpus = getDefaultModelForProvider('anthropic', 'opus')
    const label = defaultOpus
      ? getModelMetadata(defaultOpus, 'anthropic')?.label
      : undefined

    expect(
      getDefaultCommitCoAuthorName({
        model: 'unreleased-internal-model',
        apiProvider: 'firstParty',
        isInternalRepo: false,
      }),
    ).toBe(label ?? 'Claude')
  })

  it('sanitizes unknown internal Claude co-author names', () => {
    expect(
      getDefaultCommitCoAuthorName({
        model: 'bad\nmodel<id>',
        apiProvider: 'firstParty',
        isInternalRepo: true,
      }),
    ).toBe('Claude (bad model id)')
  })

  it('does not duplicate the Claude prefix for Claude model names', () => {
    expect(
      getDefaultCommitCoAuthorName({
        model: 'claude-opus-4-6',
        apiProvider: 'firstParty',
        isInternalRepo: false,
      }),
    ).toBe('Claude Opus 4.6')
  })

  it('sanitizes internal model surfaces from the Anthropic catalog', () => {
    const defaultOpus = getDefaultModelForProvider('anthropic', 'opus')
    expect(defaultOpus).toBeDefined()

    expect(
      sanitizeModelName(`cli/${defaultOpus!.replace(/^claude-/, '')}-fast`),
    ).toBe(defaultOpus!)
  })

  it('uses the OpenClaude email for commit attribution across providers', () => {
    expect(getDefaultCommitCoAuthorEmail('openai')).toBe(
      'openclaude@gitlawb.com',
    )
    expect(getDefaultCommitCoAuthorEmail('firstParty')).toBe(
      'openclaude@gitlawb.com',
    )
  })
})
