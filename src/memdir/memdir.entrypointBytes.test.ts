import { describe, expect, test } from 'bun:test'
import { MAX_ENTRYPOINT_BYTES, truncateEntrypointContent } from './memdir.js'

describe('truncateEntrypointContent byte cap', () => {
  test('enforces the byte cap on multibyte content that is under the char cap', () => {
    // 50 short lines of CJK text: well under MAX_ENTRYPOINT_LINES (200) and
    // under MAX_ENTRYPOINT_BYTES *characters*, but ~3x over it in real bytes
    // (each `一` is 3 UTF-8 bytes).
    const line = '一'.repeat(498) // 498 chars, 1494 bytes
    const raw = Array.from({ length: 50 }, () => line).join('\n')

    expect(raw.length).toBeLessThanOrEqual(MAX_ENTRYPOINT_BYTES)
    expect(Buffer.byteLength(raw)).toBeGreaterThan(MAX_ENTRYPOINT_BYTES)

    const result = truncateEntrypointContent(raw)

    // The byte cap must fire, byteCount must report real bytes, and the emitted
    // content must actually be bounded by the cap (plus the appended warning).
    // Before the fix `.length` undercounted, so wasByteTruncated was false and
    // the full ~75KB passed through uncapped.
    expect(result.wasByteTruncated).toBe(true)
    expect(result.byteCount).toBe(Buffer.byteLength(raw))
    const warningBytes = 400
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(
      MAX_ENTRYPOINT_BYTES + warningBytes,
    )
  })

  test('leaves small multibyte content untouched', () => {
    const raw = '# 見出し\n\n- 項目一つ\n- 項目二つ'
    const result = truncateEntrypointContent(raw)
    expect(result.wasByteTruncated).toBe(false)
    expect(result.wasLineTruncated).toBe(false)
    expect(result.content).toBe(raw)
    expect(result.byteCount).toBe(Buffer.byteLength(raw))
  })
})
