import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'

import {
  _resetErrorLogForTesting,
  attachErrorLogSink,
  logError,
} from './log.js'

describe('logError', () => {
  let capturedErrors: Error[] = []

  beforeAll(() => {
    // Ensure env vars don't short-circuit the reporting path
    const prevBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
    const prevVertex = process.env.CLAUDE_CODE_USE_VERTEX
    const prevFoundry = process.env.CLAUDE_CODE_USE_FOUNDRY
    const prevDisable = process.env.DISABLE_ERROR_REPORTING
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.DISABLE_ERROR_REPORTING

    // Clean-attach the test sink
    _resetErrorLogForTesting()
    attachErrorLogSink({
      logError: (err: Error) => {
        capturedErrors.push(err)
      },
      logMCPError: () => {},
      logMCPDebug: () => {},
      getErrorsPath: () => '/tmp/test-errors',
      getMCPLogsPath: () => '/tmp/test-mcp-logs',
    })

    // Restore env vars after setup
    return () => {
      if (prevBedrock) process.env.CLAUDE_CODE_USE_BEDROCK = prevBedrock
      if (prevVertex) process.env.CLAUDE_CODE_USE_VERTEX = prevVertex
      if (prevFoundry) process.env.CLAUDE_CODE_USE_FOUNDRY = prevFoundry
      if (prevDisable) process.env.DISABLE_ERROR_REPORTING = prevDisable
    }
  })

  afterEach(() => {
    capturedErrors = []
  })

  afterAll(() => {
    _resetErrorLogForTesting()
  })

  test("redacts custom enumerable string properties on the sanitized error", () => {
    const err = new Error("test error")
    const originalSecret = "sk-ant-03abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyzAA"
    ;(err as unknown as Record<string, unknown>)["apiKey"] = originalSecret

    logError(err)

    expect(capturedErrors.length).toBe(1)
    const sanitized = capturedErrors[0]
    const redacted = (sanitized as unknown as Record<string, unknown>)["apiKey"] as string
    expect(redacted).not.toBe(originalSecret)
    expect(redacted).toMatch(/\[REDACTED/)
  })

  test("redacts enumerable object properties via jsonRedactor", () => {
    const err = new Error("test error")
    ;(err as unknown as Record<string, unknown>)["cause"] = {
      apiKey: "sk-ant-03abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyzAA",
      url: "https://example.com?token=secret",
    }

    logError(err)

    expect(capturedErrors.length).toBe(1)
    const sanitized = capturedErrors[0]
    const cause = (sanitized as unknown as Record<string, unknown>)["cause"] as Record<string, unknown>
    expect(cause["apiKey"] as string).toMatch(/\[REDACTED/)
    expect(cause["url"] as string).toContain("[REDACTED]")
  })
})
