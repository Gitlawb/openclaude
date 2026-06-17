import { describe, expect, test } from 'bun:test'
import { hookSourceDescriptionDisplayString } from './hooksSettings.js'

describe('hookSourceDescriptionDisplayString', () => {
  test('uses the canonical OpenClaude plugin path for plugin hooks', () => {
    const description = hookSourceDescriptionDisplayString('pluginHook')

    expect(description).toBe(
      'Plugin hooks (~/.openclaude/plugins/*/hooks/hooks.json)',
    )
    expect(description).not.toContain('~/.claude/')
  })
})
