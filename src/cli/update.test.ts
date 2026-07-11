import { describe, expect, test } from 'bun:test'
import { withMockMacro } from 'src/test/mockMacro.js'
import { resolvePackageManagerUpdateGuidance } from '../utils/packageManagerUpdateGuidance.js'
import {
  getGlobalUpdateFailureHint,
  writePackageManagerUpdateGuidance,
} from './update.js'

describe('getGlobalUpdateFailureHint', () => {
  test('points npm-only builds at npm instead of the native installer', () => {
    withMockMacro({ PACKAGE_URL: '@gitlawb/openclaude' }, () => {
      expect(getGlobalUpdateFailureHint(false)).toContain(
        'npm install -g @gitlawb/openclaude@latest',
      )
      expect(getGlobalUpdateFailureHint(false)).not.toContain(
        'openclaude install',
      )
    })
  })

  test('preserves native installer guidance for native-capable builds', () => {
    expect(getGlobalUpdateFailureHint(true)).toBe(
      'Or consider using native installation with: openclaude install\n',
    )
  })
})

describe('writePackageManagerUpdateGuidance', () => {
  test('writes safe OpenClaude guidance without upstream commands', async () => {
    let output = ''

    await writePackageManagerUpdateGuidance('homebrew', 'latest', {
      displayVersion: '1.0.0',
      getGuidance: manager =>
        resolvePackageManagerUpdateGuidance(manager, '@gitlawb/openclaude'),
      getLatestVersion: async () => '2.0.0',
      write: value => {
        output += value
      },
      bold: value => value,
    })

    expect(output).toContain(
      'OpenClaude is managed by Homebrew. Use Homebrew to update OpenClaude.',
    )
    expect(output).toContain('Update available: 1.0.0 → 2.0.0')
    expect(output).not.toContain('brew upgrade claude-code')
    expect(output).not.toContain('Anthropic.ClaudeCode')
    expect(output).not.toContain('apk upgrade claude-code')
  })
})
