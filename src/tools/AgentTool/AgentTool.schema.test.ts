import { describe, expect, test } from 'bun:test'
import { inputSchema } from './AgentTool.js'

const baseInput = {
  description: 'Run check',
  prompt: 'Check the implementation',
}

describe('AgentTool input schema model override', () => {
  test('accepts aliases and custom provider-supported model IDs', () => {
    const acceptedModels = [
      'sonnet',
      'opus',
      'haiku',
      'inherit',
      'gpt-5.5',
      'mimo-v2.5-pro',
      'deepseek-v4-flash',
      'deepseek/deepseek-v4-flash:nitro',
      'qwen3-coder-next:cloud',
      'custom_model-v1.2:fast',
    ]

    for (const model of acceptedModels) {
      expect(inputSchema().safeParse({ ...baseInput, model }).success).toBe(
        true,
      )
    }
  })

  test('rejects empty and whitespace-only model overrides', () => {
    for (const model of ['', '   ']) {
      expect(inputSchema().safeParse({ ...baseInput, model }).success).toBe(
        false,
      )
    }
  })

  test('rejects non-string model overrides', () => {
    for (const model of [null, 42, true, ['gpt-5.5']]) {
      expect(inputSchema().safeParse({ ...baseInput, model }).success).toBe(
        false,
      )
    }
  })

  test('trims accepted model overrides', () => {
    const result = inputSchema().safeParse({
      ...baseInput,
      model: '  deepseek/deepseek-v4-flash:nitro  ',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.model).toBe('deepseek/deepseek-v4-flash:nitro')
    }
  })

  test('describes aliases, custom model IDs, overrides, and inheritance', () => {
    const description = inputSchema().shape.model.description

    expect(description).toContain('sonnet')
    expect(description).toContain('opus')
    expect(description).toContain('haiku')
    expect(description).toContain('provider-supported model ID')
    expect(description).toContain('Takes precedence')
    expect(description).toContain('inherit')
  })
})
