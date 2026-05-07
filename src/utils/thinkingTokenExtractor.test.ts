import { describe, expect, it } from 'bun:test'
import { ThinkingTokenAnalyzer } from './thinkingTokenExtractor.js'

describe('ThinkingTokenAnalyzer', () => {
  describe('extract', () => {
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

      const result = ThinkingTokenAnalyzer.extract(message)

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

      const result = ThinkingTokenAnalyzer.extract(message)

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

      const result = ThinkingTokenAnalyzer.extract(message)

      expect(result.thinking).toBeGreaterThan(0)
      expect(result.output).toBeGreaterThan(0)
    })
  })

  describe('analyze', () => {
    it('calculates percentages', () => {
      const message = {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'Thinking1 Thinking2 Thinking3' },
            { type: 'text', text: 'Output1 Output2' },
          ],
        },
      } as any

      const analysis = ThinkingTokenAnalyzer.analyze(message)

      expect(analysis.hasThinking).toBe(true)
      expect(analysis.thinkingPercentage).toBeGreaterThan(0)
      expect(analysis.outputPercentage).toBeGreaterThan(0)
      expect(analysis.reasoningComplexity).toBeTruthy()
    })
  })

  describe('hasSignificantThinking', () => {
    it('detects significant thinking', () => {
      const message = {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'x'.repeat(500) },
            { type: 'text', text: 'short' },
          ],
        },
      } as any

      expect(ThinkingTokenAnalyzer.hasSignificantThinking(message, 20)).toBe(true)
    })

    it('rejects minimal thinking', () => {
      const message = {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'a' },
            { type: 'text', text: 'much longer output text here with more content' },
          ],
        },
      } as any

      expect(ThinkingTokenAnalyzer.hasSignificantThinking(message, 20)).toBe(false)
    })
  })
})