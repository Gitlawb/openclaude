import { describe, expect, it } from 'bun:test'
import { extractThinkingTokens } from './tokens.js'

describe('extractThinkingTokens', () => {
  it('extracts thinking and output separately', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'Let me think about this...' },
          { type: 'text', text: 'Here is my answer.' },
        ],
      },
    } as any

    const result = extractThinkingTokens(message)

    expect(result.thinking).toBeGreaterThan(0)
    expect(result.output).toBeGreaterThan(0)
    expect(result.total).toBe(result.thinking + result.output)
  })

  it('handles no thinking', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Hello world' }],
      },
    } as any

    const result = extractThinkingTokens(message)

    expect(result.thinking).toBe(0)
    expect(result.output).toBeGreaterThan(0)
  })

  it('handles redacted thinking', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'redacted_thinking', data: '[thinking hidden]' },
          { type: 'text', text: 'Answer here.' },
        ],
      },
    } as any

    const result = extractThinkingTokens(message)

    expect(result.thinking).toBeGreaterThan(0)
    expect(result.output).toBeGreaterThan(0)
  })

  it('handles tool use', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tool_1', name: 'bash', input: { cmd: 'echo test' } },
          { type: 'text', text: 'Ran command.' },
        ],
      },
    } as any

    const result = extractThinkingTokens(message)

    expect(result.output).toBeGreaterThan(0)
  })
})