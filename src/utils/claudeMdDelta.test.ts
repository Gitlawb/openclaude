import { describe, expect, test } from 'bun:test'
import { getClaudeMdDelta } from './claudeMdDelta.js'

// Fake minimal attachment-message shape — mirrors the Message union's
// AttachmentMessage but without dragging in the whole message type
// graph (which includes many unrelated imports). The scanner only
// touches `type` and `attachment.type`/`attachment.contentHash`.
type FakeMsg = {
  type: string
  attachment?: { type: string; contentHash?: string }
}

function announced(hash: string): FakeMsg {
  return {
    type: 'attachment',
    attachment: { type: 'claude_md_delta', contentHash: hash },
  }
}

describe('getClaudeMdDelta', () => {
  test('returns null when history is empty AND current content is empty', () => {
    expect(getClaudeMdDelta('', [])).toBeNull()
    expect(getClaudeMdDelta(null, [])).toBeNull()
    expect(getClaudeMdDelta(undefined, [])).toBeNull()
  })

  test('emits full content on turn 1 when content is non-empty', () => {
    const delta = getClaudeMdDelta('# Project rules\nUse bun.', [])
    expect(delta).not.toBeNull()
    expect(delta!.addedContent).toBe('# Project rules\nUse bun.')
    expect(delta!.isInitial).toBe(true)
    expect(delta!.contentHash).toHaveLength(8)
  })

  test('returns null when content matches the last announced hash', () => {
    const first = getClaudeMdDelta('stable content', [])!
    const history: FakeMsg[] = [announced(first.contentHash)]
    expect(getClaudeMdDelta('stable content', history)).toBeNull()
  })

  test('emits a new delta when content drifts', () => {
    const first = getClaudeMdDelta('version 1', [])!
    const history: FakeMsg[] = [announced(first.contentHash)]
    const second = getClaudeMdDelta('version 2', history)
    expect(second).not.toBeNull()
    expect(second!.addedContent).toBe('version 2')
    expect(second!.isInitial).toBe(false)
    expect(second!.contentHash).not.toBe(first.contentHash)
  })

  test('copy elision: two identical calls return consistent no-op', () => {
    const v1 = getClaudeMdDelta('same body', [])!
    const history: FakeMsg[] = [announced(v1.contentHash)]
    // A stateless repeat scan should still report no-op.
    expect(getClaudeMdDelta('same body', history)).toBeNull()
    expect(getClaudeMdDelta('same body', history)).toBeNull()
  })

  test('content becoming empty after prior announcement emits retraction', () => {
    const v1 = getClaudeMdDelta('will vanish', [])!
    const history: FakeMsg[] = [announced(v1.contentHash)]
    const delta = getClaudeMdDelta('', history)
    expect(delta).not.toBeNull()
    expect(delta!.addedContent).toBe('')
    // Hash for empty string is the empty sentinel.
    expect(delta!.contentHash).toBe('')
  })

  test('ignores unrelated attachment types in history', () => {
    const history: FakeMsg[] = [
      { type: 'user' },
      {
        type: 'attachment',
        attachment: { type: 'mcp_instructions_delta' },
      },
      { type: 'attachment', attachment: { type: 'git_status_delta' } },
    ]
    const delta = getClaudeMdDelta('fresh', history)
    expect(delta).not.toBeNull()
    expect(delta!.isInitial).toBe(true)
  })
})
