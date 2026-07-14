import { expect, test } from 'bun:test'

import gptModels from './models/gpt.js'
import openaiVendor from './vendors/openai.js'

const GPT56_IDS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const

test('gpt-5.6 model descriptors carry the verified limits', () => {
  for (const id of GPT56_IDS) {
    const descriptor = gptModels.find(model => model.id === id)
    expect(descriptor).toBeDefined()
    expect(descriptor?.contextWindow).toBe(1_050_000)
    expect(descriptor?.maxOutputTokens).toBe(128_000)
  }
})

test('openai vendor gpt-5.6 catalog entries carry limits and reasoning metadata', () => {
  for (const id of GPT56_IDS) {
    const entry = openaiVendor.catalog?.models?.find(model => model.id === id)
    expect(entry).toBeDefined()
    expect(entry?.contextWindow).toBe(1_050_000)
    expect(entry?.maxOutputTokens).toBe(128_000)
    expect(entry?.reasoning?.wireFormat).toBe('reasoning_effort')
    expect(entry?.reasoning?.levels).toContain('xhigh')
  }
})
