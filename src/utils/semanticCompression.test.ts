import { describe, expect, it } from 'bun:test'
import {
  semanticCompress,
  estimateCompressedSize,
  batchCompress,
  findOptimalConfig,
} from './semanticCompression.js'

describe('semanticCompression', () => {
  describe('semanticCompress', () => {
    it('reduces text size', () => {
      const text = 'Please can you help me with this? Of course I will help you. Thank you so much!'
      const result = semanticCompress(text, { targetRatio: 0.8, aggressive: true })
      
      expect(result.compressed).toBeDefined()
      expect(result.compressedTokens).toBeLessThanOrEqual(result.originalTokens)
    })

    it('preserves code', () => {
      const code = 'function test() { const x = 1; return x; }'
      const result = semanticCompress(code, { preserveCode: true, aggressive: true })
      
      expect(result.compressed).toContain('function')
      expect(result.methods).not.toContain('repeated_chars')
    })

    it('preserves URLs', () => {
      const text = 'Check this link: https://example.com/test and thanks please'
      const result = semanticCompress(text, { preserveUrls: true, aggressive: true })
      
      expect(result.compressed).toContain('https://example.com')
    })

    it('tracks compression methods used', () => {
      const text = 'This   is   a   test   with   extra   spaces'
      const result = semanticCompress(text, { aggressive: true })
      
      expect(result.methods.length).toBeGreaterThan(0)
    })

    it('calculates actual ratio', () => {
      const text = 'Hello world please help me thanks'
      const result = semanticCompress(text, { targetRatio: 0.5, aggressive: true })
      
      expect(result.actualRatio).toBeGreaterThan(0)
      expect(result.actualRatio).toBeLessThanOrEqual(1)
    })
  })

  describe('estimateCompressedSize', () => {
    it('estimates without full compression', () => {
      const text = 'This is a test of the compression estimation feature'
      const result = estimateCompressedSize(text, { targetRatio: 0.8 })
      
      expect(result.estimatedTokens).toBeGreaterThan(0)
      expect(result.estimatedRatio).toBeGreaterThan(0)
    })
  })

  describe('batchCompress', () => {
    it('compresses multiple texts', () => {
      const texts = [
        'First text please help',
        'Second text thank you',
        'Third text of course',
      ]
      const results = batchCompress(texts, { aggressive: true })
      
      expect(results.length).toBe(3)
      expect(results[0].compressed).toBeDefined()
    })
  })

  describe('findOptimalConfig', () => {
    it('finds config for target tokens', () => {
      const text = 'This is a longer piece of text that should be compressed to fit within a target token budget. Please help me with this task, it is very important.'
      const config = findOptimalConfig(text, 50)
      
      expect(config.targetRatio).toBeDefined()
    })

    it('returns conservative ratio when no compression needed', () => {
      const shortText = 'Hi'
      const config = findOptimalConfig(shortText, 100)
      
      expect(config.targetRatio).toBeGreaterThanOrEqual(0.99)
    })
  })
})