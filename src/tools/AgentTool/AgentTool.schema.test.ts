import { describe, expect, test } from 'bun:test'
import { AgentTool, fullInputSchema, inputSchema, outputSchema } from './AgentTool.js'

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

describe('AgentTool input schema isolation contract', () => {
  test('accepts worktree isolation with the base required fields', () => {
    expect(
      inputSchema().safeParse({ ...baseInput, isolation: 'worktree' }).success,
    ).toBe(true)
  })

  test('rejects the removed remote isolation value', () => {
    expect(
      inputSchema().safeParse({ ...baseInput, isolation: 'remote' }).success,
    ).toBe(false)
  })

  test('rejects cwd together with worktree isolation in the full schema', () => {
    expect(
      fullInputSchema().safeParse({
        ...baseInput,
        isolation: 'worktree',
        cwd: '/tmp/openclaude-agent',
      }).success,
    ).toBe(false)
  })

  test('accepts cwd without worktree isolation in the full schema', () => {
    expect(
      fullInputSchema().safeParse({
        ...baseInput,
        cwd: '/tmp/openclaude-agent',
      }).success,
    ).toBe(true)
  })
})

describe('AgentTool output status contract', () => {
  test('rejects removed remote-launched output status', () => {
    expect(
      outputSchema().safeParse({
        status: 'remote_launched',
        prompt: baseInput.prompt,
        sessionUrl: 'https://example.com/session',
      }).success,
    ).toBe(false)
  })

  test('maps async-launched output to the expected tool result text', () => {
    const block = AgentTool.mapToolResultToToolResultBlockParam(
      {
        status: 'async_launched',
        agentId: 'agent-1',
        description: baseInput.description,
        prompt: baseInput.prompt,
        outputFile: '/tmp/openclaude-agent-output.txt',
        canReadOutputFile: true,
      },
      'toolu_1',
    )

    expect(block.type).toBe('tool_result')
    const text = block.content[0]?.type === 'text' ? block.content[0].text : ''
    expect(text).toContain('Async agent launched successfully')
    expect(text).toContain('output_file: /tmp/openclaude-agent-output.txt')
  })

  test('throws for unsupported output statuses', () => {
    expect(() =>
      AgentTool.mapToolResultToToolResultBlockParam(
        { status: 'remote_launched' } as never,
        'toolu_1',
      ),
    ).toThrow('Unexpected agent tool result status: remote_launched')
  })
})
