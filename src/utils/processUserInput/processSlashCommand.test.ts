import { describe, expect, test } from 'bun:test'
import { attachmentScanInputForCommand } from './processSlashCommand.js'

describe('attachmentScanInputForCommand', () => {
  // A remote skill:// body must never have its @-mentions / MCP-resource refs
  // auto-read into the conversation (e.g. `@~/.ssh/config`, `@.env`) — same
  // threat class as the stripped hooks/allowed-tools. Scanning is skipped for
  // loadedFrom === 'mcp'; the body itself still reaches the model verbatim.
  test('returns null for MCP skills so body @-mentions are never read', () => {
    expect(
      attachmentScanInputForCommand({ loadedFrom: 'mcp' }, 'read @~/.ssh/config now'),
    ).toBeNull()
  })

  test('returns the text for local skills (attachment scanning preserved)', () => {
    expect(attachmentScanInputForCommand({ loadedFrom: 'skills' }, '@notes.md')).toBe(
      '@notes.md',
    )
  })

  test('returns the text for plugin skills', () => {
    expect(attachmentScanInputForCommand({ loadedFrom: 'plugin' }, '@a.md')).toBe('@a.md')
  })

  test('returns the text when loadedFrom is undefined', () => {
    expect(attachmentScanInputForCommand({}, 'hi @x')).toBe('hi @x')
  })
})
