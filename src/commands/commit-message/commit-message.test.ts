import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import {
  call,
  formatCoAuthorTrailer,
  parseCoAuthor,
  stripMatchingQuotes,
  USAGE,
} from './commit-message.js'

let tempSettingsDir: string | null = null

afterEach(() => {
  setClaudeConfigHomeDirForTesting(undefined)
  getClaudeConfigHomeDir.cache?.clear?.()
  resetSettingsCache()
  if (tempSettingsDir) {
    rmSync(tempSettingsDir, { recursive: true, force: true })
    tempSettingsDir = null
  }
})

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

  it('rejects co-author trailers with empty sanitized names', () => {
    expect(parseCoAuthor('"  " noreply@openclaude.dev')).toBeNull()
    expect(parseCoAuthor('"  " <noreply@openclaude.dev>')).toBeNull()
  })

  it('strips one pair of matching quotes from custom attribution text', () => {
    expect(stripMatchingQuotes('"Generated with OpenClaude"')).toBe(
      'Generated with OpenClaude',
    )
    expect(stripMatchingQuotes("'Generated with OpenClaude'")).toBe(
      'Generated with OpenClaude',
    )
    expect(stripMatchingQuotes('"Generated with OpenClaude')).toBe(
      '"Generated with OpenClaude',
    )
  })

  it('formats a sanitized co-author trailer', () => {
    expect(
      formatCoAuthorTrailer('OpenClaude <gpt>\n', '<noreply@openclaude.dev>'),
    ).toBe('Co-Authored-By: OpenClaude gpt <noreply@openclaude.dev>')
  })

  it('makes set scope explicit with example text', () => {
    expect(USAGE).toContain(
      'Controls only the attribution text appended after /commit messages.',
    )
    expect(USAGE).toContain(
      '/commit-message set "Generated with OpenClaude using GPT-5.5"',
    )
    expect(USAGE).not.toContain('/commit-message set-attribution')
  })

  it('describes default reset as privacy-preserving', async () => {
    tempSettingsDir = mkdtempSync(join(tmpdir(), 'openclaude-settings-'))
    setClaudeConfigHomeDirForTesting(tempSettingsDir)
    getClaudeConfigHomeDir.cache?.clear?.()

    await expect(call('default', {} as never)).resolves.toEqual({
      type: 'text',
      value: 'Commit attribution reset to the privacy-preserving default.',
    })
  })
})
