import { describe, expect, test } from 'bun:test'

import { sanitizeError } from './log.js'

// Test sanitizeError directly (an exported wrapper around the inline
// redaction logic in logError). Direct unit testing avoids races on
// the shared errorLogSink singleton from parallel test execution.

describe('sanitizeError', () => {
  test("redacts custom enumerable string properties", () => {
    const err = new Error("test error")
    const originalSecret =
      "sk-ant-03abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyzAA"
    ;(err as unknown as Record<string, unknown>)["apiKey"] = originalSecret

    const sanitized = sanitizeError(err)

    const redacted = sanitized as unknown as Record<string, unknown>
    expect(redacted["apiKey"] as string).not.toBe(originalSecret)
    expect(redacted["apiKey"] as string).toMatch(/\[REDACTED/)
    // Original error should not be mutated
    expect((err as unknown as Record<string, unknown>)["apiKey"] as string).toBe(
      originalSecret,
    )
  })

  test("redacts enumerable object properties via jsonRedactor", () => {
    const err = new Error("test error")
    ;(err as unknown as Record<string, unknown>)["cause"] = {
      apiKey:
        "sk-ant-03abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyzAA",
      url: "https://example.com?token=secret",
    }

    const sanitized = sanitizeError(err)

    const cause = (sanitized as unknown as Record<string, unknown>)[
      "cause"
    ] as Record<string, unknown>
    expect(cause["apiKey"] as string).toMatch(/\[REDACTED/)
    expect(cause["url"] as string).toBe(
      "https://example.com/?token=redacted",
    )
  })

  test("preserves message and stack on the sanitized copy", () => {
    const err = new Error("sensitive: API_KEY=abc123")
    err.stack = "Error: sensitive: API_KEY=abc123\n    at test (file.ts:1:1)"

    const sanitized = sanitizeError(err)

    expect(sanitized.message).toMatch(/\[REDACTED/)
    expect(sanitized.stack).toMatch(/\[REDACTED/)
  })

  test("sanitized error retains prototype chain (instanceof)", () => {
    const err = new TypeError("test")
    const sanitized = sanitizeError(err)
    expect(sanitized instanceof TypeError).toBe(true)
    expect(sanitized instanceof Error).toBe(true)
    // Direct prototype should be TypeError.prototype, not the original
    // error instance — Object.create(err) would leak non-enumerable
    // own properties through the prototype chain.
    expect(Object.getPrototypeOf(sanitized)).toBe(TypeError.prototype)
  })

  test("sanitized error does not leak non-enumerable properties", () => {
    const err = new Error("test")
    // Non-enumerable own property (Object.assign does not copy these)
    Object.defineProperty(err, "secretKey", {
      value: "should-not-leak",
      enumerable: false,
    })
    const sanitized = sanitizeError(err)
    expect(sanitized instanceof Error).toBe(true)
    expect(
      (sanitized as unknown as Record<string, unknown>)["secretKey"],
    ).toBeUndefined()
  })

  test("redacts string values with sensitive key names using key-aware redaction", () => {
    // A value like "my-key" would pass through redactSensitiveInfo
    // unchanged since it doesn't look like a credential. jsonRedactor
    // catches it because the key name "apiKey" is in SENSITIVE_FIELD_SUBSTRINGS.
    const err = new Error("test")
    ;(err as unknown as Record<string, unknown>)["apiKey"] = "my-key"
    ;(err as unknown as Record<string, unknown>)["token"] = "abc-123"

    const sanitized = sanitizeError(err)

    const obj = sanitized as unknown as Record<string, unknown>
    expect(obj["apiKey"] as string).toBe("[REDACTED]")
    expect(obj["token"] as string).toBe("[REDACTED]")
  })

  test("fails closed on non-serializable object properties", () => {
    const err = new Error("test")
    const circular: Record<string, unknown> = { self: null }
    circular["self"] = circular
    ;(err as unknown as Record<string, unknown>)["meta"] = circular

    const sanitized = sanitizeError(err)

    const obj = sanitized as unknown as Record<string, unknown>
    // Should not be the original reference (circular object)
    expect(obj["meta"]).not.toBe(circular)
    // Should have been replaced with a safe placeholder
    expect(obj["meta"] as string).toBe("[REDACTED]")
  })
})
