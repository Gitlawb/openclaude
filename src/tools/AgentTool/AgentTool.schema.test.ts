import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  AgentTool,
  assertAgentToolCwdAllowed,
  fullInputSchema,
  inputSchema,
  isMissingGitAgentWorktreeError,
  outputSchema,
  resolveAgentToolCwdOverride,
  resolveAgentToolEffectiveIsolation,
} from './AgentTool.js'
import { renderToolResultMessage } from './UI.js'
import { renderToString } from '../../utils/staticRender.js'

const baseInput = {
  description: 'Run check',
  prompt: 'Check the implementation',
}

const existingCwd = mkdtempSync(join(tmpdir(), 'openclaude-agent-cwd-'))
process.on('exit', () => {
  try {
    rmSync(existingCwd, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
})

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

  test('accepts cwd together with worktree isolation for multi-repo parents', () => {
    expect(
      fullInputSchema().safeParse({
        ...baseInput,
        isolation: 'worktree',
        cwd: existingCwd,
      }).success,
    ).toBe(true)
    expect(
      inputSchema().safeParse({
        ...baseInput,
        isolation: 'worktree',
        cwd: existingCwd,
      }).success,
    ).toBe(true)
  })

  test('accepts cwd without worktree isolation in the full schema', () => {
    expect(
      fullInputSchema().safeParse({
        ...baseInput,
        cwd: existingCwd,
      }).success,
    ).toBe(true)
  })

  test('exposes cwd on the open-build input schema', () => {
    expect(inputSchema().shape.cwd).toBeDefined()
    expect(
      inputSchema().safeParse({
        ...baseInput,
        cwd: existingCwd,
      }).success,
    ).toBe(true)
  })

  test('inherits worktree isolation from agent definitions', () => {
    expect(resolveAgentToolEffectiveIsolation(undefined, 'worktree')).toBe(
      'worktree',
    )
    expect(resolveAgentToolEffectiveIsolation('worktree', undefined)).toBe(
      'worktree',
    )
    expect(resolveAgentToolEffectiveIsolation(undefined, undefined)).toBe(
      undefined,
    )
  })

  test('allows absolute cwd with or without worktree isolation', () => {
    expect(() =>
      assertAgentToolCwdAllowed(existingCwd, 'worktree'),
    ).not.toThrow()
    expect(() =>
      assertAgentToolCwdAllowed(existingCwd, undefined),
    ).not.toThrow()
  })

  test('rejects relative cwd paths in the schema and helper', () => {
    expect(
      inputSchema().safeParse({
        ...baseInput,
        cwd: 'relative/path',
      }).success,
    ).toBe(false)
    expect(() => assertAgentToolCwdAllowed('relative/path', undefined)).toThrow(
      'cwd must be an absolute path.',
    )
  })

  test('rejects nonexistent absolute cwd paths', () => {
    expect(() =>
      assertAgentToolCwdAllowed('/tmp/openclaude-missing-cwd-2052', undefined),
    ).toThrow('cwd must be an existing directory.')
  })

  test('detects missing-git and WorktreeCreate hook worktree errors for fallback', () => {
    expect(
      isMissingGitAgentWorktreeError(
        'Cannot create agent worktree: not in a git repository and no WorktreeCreate hooks are configured.',
      ),
    ).toBe(true)
    expect(
      isMissingGitAgentWorktreeError(
        'WorktreeCreate hook failed: no successful output',
      ),
    ).toBe(true)
    expect(isMissingGitAgentWorktreeError('some other failure')).toBe(false)
  })

  test('prefers worktree cwd over explicit cwd when both are present defensively', () => {
    expect(
      resolveAgentToolCwdOverride(existingCwd, {
        worktreePath: '/tmp/openclaude-worktree',
      }),
    ).toBe('/tmp/openclaude-worktree')
    expect(resolveAgentToolCwdOverride(existingCwd, null)).toBe(existingCwd)
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

  test('renders async-launched output as a backgrounded agent', async () => {
    const output = await renderToString(
      renderToolResultMessage(
        {
          status: 'async_launched',
          agentId: 'agent-1',
          description: baseInput.description,
          prompt: baseInput.prompt,
          outputFile: '/tmp/openclaude-agent-output.txt',
          canReadOutputFile: true,
        },
        [],
        { tools: [], verbose: false, theme: 'dark' },
      ),
      80,
    )

    expect(output).toContain('Backgrounded agent')
  })

  test('does not render the removed remote-launched status', async () => {
    const output = await renderToString(
      renderToolResultMessage(
        { status: 'remote_launched' } as never,
        [],
        { tools: [], verbose: false, theme: 'dark' },
      ),
      80,
    )

    expect(output.trim()).toBe('')
  })
})
