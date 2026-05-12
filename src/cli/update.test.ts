import { describe, expect, test } from 'bun:test'

;(globalThis as Record<string, unknown>).MACRO = {
  DISPLAY_VERSION: '0.0.0-test',
  PACKAGE_URL: '@gitlawb/openclaude',
}

import { getSourceBuildUpdateMessage } from './updateMessage.js'

describe('update CLI install-source warning', () => {
  test('explains that source builds should pull and rebuild or install from npm', () => {
    const message = getSourceBuildUpdateMessage()

    expect(message).toContain(
      'Auto-update is only available for OpenClaude npm package installs.',
    )
    expect(message).toContain('You are running from source or an unpackaged build.')
    expect(message).toContain('git pull && bun install && bun run build')
    expect(message).toContain('npm install -g @gitlawb/openclaude@latest')
  })
})
