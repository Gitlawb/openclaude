import { describe, expect, it } from 'bun:test'
import {
  formatCoAuthorTrailer,
  parseCoAuthor,
  USAGE,
} from './commit-message.js'

describe('commit-message command helpers', () => {
  it('parses quoted co-author names with a plain email', () => {
    expect(parseCoAuthor('"GPT 5.5" noreply@openclaude.dev')).toEqual({
      name: 'GPT 5.5',
      email: 'noreply@openclaude.dev',
    })
  })

  it('parses co-author trailers with angle-bracket emails', () => {
    expect(parseCoAuthor('OpenClaude (gpt-5.5) <noreply@openclaude.dev>')).toEqual(
      {
        name: 'OpenClaude (gpt-5.5)',
        email: 'noreply@openclaude.dev',
      },
    )
  })

  it('formats a sanitized co-author trailer', () => {
    expect(
      formatCoAuthorTrailer('OpenClaude <gpt>\n', '<noreply@openclaude.dev>'),
    ).toBe('Co-Authored-By: OpenClaude gpt <noreply@openclaude.dev>')
  })

  it('makes set-attribution scope explicit in usage text', () => {
    expect(USAGE).toContain(
      'Controls only the attribution text appended after /commit messages.',
    )
    expect(USAGE).toContain('/commit-message set-attribution')
    expect(USAGE).not.toContain('/commit-message set <')
  })
})
