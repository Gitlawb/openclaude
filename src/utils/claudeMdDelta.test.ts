import { afterEach, describe, expect, test } from 'bun:test'
import { isStaticDedupEnabled } from './claudeMdDelta.js'
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
    // Hash is opaque — we only care it's non-empty and deterministic.
    // Specific length depends on djb2Hash base36 encoding (varies by input).
    expect(delta!.contentHash.length).toBeGreaterThan(0)
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

// The gate has three paths: truthy env → on, explicit falsy → off,
// everything else (undefined/empty) → off. The default-off case is
// exercised implicitly by every test above (env is unset). This block
// covers the two explicit paths so a regression in either — e.g. a
// typo in the `isEnvDefinedFalsy` branch — surfaces as a red test.
describe('isStaticDedupEnabled env gate', () => {
  const original = process.env.OPENCLAUDE_STATIC_DEDUP

  afterEach(() => {
    if (original === undefined) {
      delete process.env.OPENCLAUDE_STATIC_DEDUP
    } else {
      process.env.OPENCLAUDE_STATIC_DEDUP = original
    }
  })

  test('truthy env enables dedup', () => {
    process.env.OPENCLAUDE_STATIC_DEDUP = 'true'
    expect(isStaticDedupEnabled()).toBe(true)
    process.env.OPENCLAUDE_STATIC_DEDUP = '1'
    expect(isStaticDedupEnabled()).toBe(true)
  })

  test('explicit falsy env disables dedup', () => {
    process.env.OPENCLAUDE_STATIC_DEDUP = 'false'
    expect(isStaticDedupEnabled()).toBe(false)
    process.env.OPENCLAUDE_STATIC_DEDUP = '0'
    expect(isStaticDedupEnabled()).toBe(false)
  })

  test('undefined env defaults to disabled', () => {
    delete process.env.OPENCLAUDE_STATIC_DEDUP
    expect(isStaticDedupEnabled()).toBe(false)
  })
})
