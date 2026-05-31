import { describe, expect, test } from 'bun:test'

import {
  classifyTurn,
  injectLocalThinkingParams,
  isMechanicalBashCommand,
  resolveLocalBackend,
  resolveLocalThinkingConfig,
  _resetWarningsForTest,
  type LocalThinkingConfig,
} from './localThinkingBudget.ts'

describe('resolveLocalThinkingConfig', () => {
  test('returns null when absent', () => {
    expect(resolveLocalThinkingConfig(null)).toBeNull()
  })

  test('returns null when not enabled', () => {
    expect(resolveLocalThinkingConfig({ enabled: false })).toBeNull()
    expect(resolveLocalThinkingConfig({})).toBeNull()
  })

  test('fills defaults when enabled', () => {
    const cfg = resolveLocalThinkingConfig({ enabled: true })
    expect(cfg).not.toBeNull()
    expect(cfg!.budgetTokens).toEqual({
      afterRoutineTool: 0,
      normalTurn: 1024,
      complexTurn: -1,
    })
    expect(cfg!.complexKeywords).toContain('debug')
    expect(cfg!.backend).toBeUndefined()
  })

  test('partial budget override keeps other defaults', () => {
    const cfg = resolveLocalThinkingConfig({
      enabled: true,
      backend: 'vllm',
      budgetTokens: { normalTurn: 512 },
    })
    expect(cfg!.backend).toBe('vllm')
    expect(cfg!.budgetTokens).toEqual({
      afterRoutineTool: 0,
      normalTurn: 512,
      complexTurn: -1,
    })
  })

  test('custom keywords replace defaults', () => {
    const cfg = resolveLocalThinkingConfig({
      enabled: true,
      complexKeywords: ['ponder'],
    })
    expect(cfg!.complexKeywords).toEqual(['ponder'])
  })

  test('empty keyword array falls back to defaults', () => {
    const cfg = resolveLocalThinkingConfig({
      enabled: true,
      complexKeywords: [],
    })
    expect(cfg!.complexKeywords.length).toBeGreaterThan(0)
  })
})

describe('resolveLocalBackend', () => {
  test('explicit setting wins', () => {
    expect(resolveLocalBackend('http://localhost:8000/v1', 'vllm')).toBe('vllm')
    expect(resolveLocalBackend('http://localhost:11434/v1', 'llama.cpp')).toBe(
      'llama.cpp',
    )
  })

  test('auto-detects ollama by port', () => {
    expect(resolveLocalBackend('http://localhost:11434/v1', undefined)).toBe(
      'ollama',
    )
  })

  test('returns null for non-ollama endpoint with no explicit backend', () => {
    _resetWarningsForTest()
    expect(resolveLocalBackend('http://localhost:8000/v1', undefined)).toBeNull()
  })

  test('_resetWarningsForTest allows warning to fire again', () => {
    _resetWarningsForTest()
    expect(resolveLocalBackend('http://localhost:8000/v1', undefined)).toBeNull()
    _resetWarningsForTest()
    // second call after reset should also return null (not cached as warned)
    expect(resolveLocalBackend('http://localhost:8000/v1', undefined)).toBeNull()
  })
})

describe('isMechanicalBashCommand', () => {
  // mechanical — git status/listing
  test.each([
    'git status',
    'git status --short',
    'git branch',
    'git branch -a',
    'git stash list',
    'git remote -v',
    'git tag',
    'git describe --tags',
    'git log --oneline',
    'git log --oneline -10',
    'git log --oneline --graph',
    'git diff --stat',
    'git diff HEAD --stat',
    'git show --stat',
  ])('mechanical: %s', cmd => {
    expect(isMechanicalBashCommand(cmd)).toBe(true)
  })

  // mechanical — simple shell ops
  test.each([
    'ls',
    'ls -la',
    'pwd',
    'which bun',
    'echo hello',
    'mkdir -p /tmp/foo',
    'touch file.ts',
    'whoami',
    'uname -a',
    'hostname',
  ])('mechanical: %s', cmd => {
    expect(isMechanicalBashCommand(cmd)).toBe(true)
  })

  // mechanical — piped, left side is mechanical
  test('mechanical pipe: git status | grep modified', () => {
    expect(isMechanicalBashCommand('git status | grep modified')).toBe(true)
  })

  // not mechanical — patch-producing git ops
  test.each([
    'git diff',
    'git diff HEAD~1',
    'git show',
    'git show abc123',
    'git log',
    'git log --all',
  ])('not mechanical: %s', cmd => {
    expect(isMechanicalBashCommand(cmd)).toBe(false)
  })

  // not mechanical — test runners / build tools
  test.each([
    'bun test',
    'npm test',
    'pytest',
    'cargo build',
    'tsc --noEmit',
  ])('not mechanical: %s', cmd => {
    expect(isMechanicalBashCommand(cmd)).toBe(false)
  })

  // not mechanical — multi-command shells
  test.each([
    'git status && echo ok',
    'mkdir foo; cd foo',
    'ls || exit 1',
  ])('not mechanical (multi-command): %s', cmd => {
    expect(isMechanicalBashCommand(cmd)).toBe(false)
  })

  // not mechanical — cat (behaves like Read)
  test('not mechanical: cat file.ts', () => {
    expect(isMechanicalBashCommand('cat file.ts')).toBe(false)
  })

  // not mechanical — env-wrapped non-mechanical commands
  test.each([
    'env CI=1 npm test',
    'env RUFF_CACHE_DIR=. ruff check .',
    'CI=1 bun test',
    'NODE_ENV=test jest',
  ])('not mechanical (env-wrapped runner): %s', cmd => {
    expect(isMechanicalBashCommand(cmd)).toBe(false)
  })

  // mechanical — env-wrapped mechanical commands still qualify
  test.each([
    'env HOME=/tmp ls',
    'PATH=/usr/bin which node',
  ])('mechanical (env-wrapped shell op): %s', cmd => {
    expect(isMechanicalBashCommand(cmd)).toBe(true)
  })

  // not mechanical — --oneline with patch-producing flags
  test.each([
    'git log --oneline -p',
    'git log --oneline --patch',
    'git diff --stat -p',
    'git show --stat --patch',
    'git show HEAD --stat -p',
  ])('not mechanical (patch-producing flags): %s', cmd => {
    expect(isMechanicalBashCommand(cmd)).toBe(false)
  })

  // edge cases
  test('empty command → not mechanical', () => {
    expect(isMechanicalBashCommand('')).toBe(false)
  })
})

const cfg: LocalThinkingConfig = {
  backend: undefined,
  budgetTokens: { afterRoutineTool: 0, normalTurn: 1024, complexTurn: -1 },
  complexKeywords: ['debug', 'architect'],
  maxRoutineResultTokens: 200,
}

describe('classifyTurn', () => {
  test('LS tool_result → afterRoutineTool', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'LS', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
      },
    ]
    expect(classifyTurn(messages, cfg.complexKeywords, cfg.maxRoutineResultTokens)).toBe('afterRoutineTool')
  })

  test('Grep tool_result → afterRoutineTool', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'Grep', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
      },
    ]
    expect(classifyTurn(messages, cfg.complexKeywords, cfg.maxRoutineResultTokens)).toBe('afterRoutineTool')
  })

  test('Bash(git status) → afterRoutineTool', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Bash',
            input: { command: 'git status' },
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
      },
    ]
    expect(classifyTurn(messages, cfg.complexKeywords, cfg.maxRoutineResultTokens)).toBe('afterRoutineTool')
  })

  test('Bash(git diff) → normalTurn', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Bash',
            input: { command: 'git diff' },
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'diff...' }],
      },
    ]
    expect(classifyTurn(messages, cfg.complexKeywords)).toBe('normalTurn')
  })

  test('Bash(bun test) → normalTurn', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Bash',
            input: { command: 'bun test' },
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'FAIL' }],
      },
    ]
    expect(classifyTurn(messages, cfg.complexKeywords)).toBe('normalTurn')
  })

  test('mixed: Grep + Bash(git status) → afterRoutineTool (all routine)', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't1', name: 'Grep', input: {} },
          {
            type: 'tool_use',
            id: 't2',
            name: 'Bash',
            input: { command: 'git status' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'hits' },
          { type: 'tool_result', tool_use_id: 't2', content: 'clean' },
        ],
      },
    ]
    expect(classifyTurn(messages, cfg.complexKeywords, cfg.maxRoutineResultTokens)).toBe('afterRoutineTool')
  })

  test('mixed: Grep + Bash(git diff) → normalTurn (not all routine)', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't1', name: 'Grep', input: {} },
          {
            type: 'tool_use',
            id: 't2',
            name: 'Bash',
            input: { command: 'git diff' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'hits' },
          { type: 'tool_result', tool_use_id: 't2', content: 'diff...' },
        ],
      },
    ]
    expect(classifyTurn(messages, cfg.complexKeywords)).toBe('normalTurn')
  })

  test('Read tool_result → normalTurn (Read not in routine list)', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file...' }],
      },
    ]
    expect(classifyTurn(messages, cfg.complexKeywords)).toBe('normalTurn')
  })

  test('orphan tool_result (no matching tool_use) → normalTurn', () => {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'ghost', content: 'ok' }],
      },
    ]
    expect(classifyTurn(messages, cfg.complexKeywords)).toBe('normalTurn')
  })

  test('complex keyword in user text → complexTurn', () => {
    const messages = [{ role: 'user', content: 'please debug this crash' }]
    expect(classifyTurn(messages, cfg.complexKeywords)).toBe('complexTurn')
  })

  test('keyword match is case-insensitive', () => {
    const messages = [{ role: 'user', content: 'ARCHITECT the module' }]
    expect(classifyTurn(messages, cfg.complexKeywords)).toBe('complexTurn')
  })

  test('plain user text → normalTurn', () => {
    const messages = [{ role: 'user', content: 'add a comment here' }]
    expect(classifyTurn(messages, cfg.complexKeywords)).toBe('normalTurn')
  })

  test('handles wrapped { message: { role, content } } shape', () => {
    const messages = [
      {
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't1', name: 'Grep', input: {} }],
        },
      },
      {
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
        },
      },
    ]
    expect(classifyTurn(messages, cfg.complexKeywords, cfg.maxRoutineResultTokens)).toBe('afterRoutineTool')
  })

  test('empty messages → normalTurn', () => {
    expect(classifyTurn([], cfg.complexKeywords, cfg.maxRoutineResultTokens)).toBe('normalTurn')
  })

  test('Grep with long result → normalTurn', () => {
    // threshold is 200 tokens; at ~4 chars/token need >800 chars to exceed it
    const longContent = 'x'.repeat(900)
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'Grep', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: longContent }],
      },
    ]
    expect(classifyTurn(messages, cfg.complexKeywords, cfg.maxRoutineResultTokens)).toBe('normalTurn')
  })

  test('Grep with short result → afterRoutineTool', () => {
    const shortContent = 'x'.repeat(100)
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'Grep', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: shortContent }],
      },
    ]
    expect(classifyTurn(messages, cfg.complexKeywords, cfg.maxRoutineResultTokens)).toBe('afterRoutineTool')
  })
})

describe('injectLocalThinkingParams', () => {
  test('llama.cpp sets thinking_budget_tokens', () => {
    const body: Record<string, unknown> = {}
    injectLocalThinkingParams(body, [], 'normalTurn', cfg, 'llama.cpp')
    expect(body.thinking_budget_tokens).toBe(1024)
  })

  test('llama.cpp does not overwrite existing thinking_budget_tokens', () => {
    const body: Record<string, unknown> = { thinking_budget_tokens: 999 }
    injectLocalThinkingParams(body, [], 'normalTurn', cfg, 'llama.cpp')
    expect(body.thinking_budget_tokens).toBe(999)
  })

  test('vllm sets enable_thinking false at zero budget', () => {
    const body: Record<string, unknown> = {}
    injectLocalThinkingParams(body, [], 'afterRoutineTool', cfg, 'vllm')
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
  })

  test('vllm sets enable_thinking true at non-zero budget', () => {
    const body: Record<string, unknown> = {}
    injectLocalThinkingParams(body, [], 'complexTurn', cfg, 'vllm')
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true })
  })

  test('vllm merges into existing chat_template_kwargs', () => {
    const body: Record<string, unknown> = {
      chat_template_kwargs: { foo: 'bar' },
    }
    injectLocalThinkingParams(body, [], 'normalTurn', cfg, 'vllm')
    expect(body.chat_template_kwargs).toEqual({
      foo: 'bar',
      enable_thinking: true,
    })
  })

  test('ollama prepends /nothink to existing system message at zero budget', () => {
    const messages = [{ role: 'system', content: 'You are helpful.' }]
    injectLocalThinkingParams({}, messages, 'afterRoutineTool', cfg, 'ollama')
    expect(messages[0].content).toBe('/nothink\nYou are helpful.')
  })

  test('ollama prepends /think at non-zero budget', () => {
    const messages = [{ role: 'system', content: 'You are helpful.' }]
    injectLocalThinkingParams({}, messages, 'complexTurn', cfg, 'ollama')
    expect(messages[0].content).toBe('/think\nYou are helpful.')
  })

  test('ollama unshifts a system message when none present', () => {
    const messages = [{ role: 'user', content: 'hi' }]
    injectLocalThinkingParams({}, messages, 'afterRoutineTool', cfg, 'ollama')
    expect(messages[0]).toEqual({ role: 'system', content: '/nothink' })
  })

  test('ollama idempotent: calling twice replaces directive, does not double-prepend', () => {
    const messages = [{ role: 'system', content: 'You are helpful.' }]
    injectLocalThinkingParams({}, messages, 'afterRoutineTool', cfg, 'ollama')
    injectLocalThinkingParams({}, messages, 'complexTurn', cfg, 'ollama')
    // second call should replace /nothink with /think, not prepend again
    expect(messages[0].content).toBe('/think\nYou are helpful.')
    expect(messages.length).toBe(1)
  })

  test('zero budget strips reasoning_effort', () => {
    const body: Record<string, unknown> = { reasoning_effort: 'high' }
    injectLocalThinkingParams(body, [], 'afterRoutineTool', cfg, 'llama.cpp')
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.thinking_budget_tokens).toBe(0)
  })

  test('non-zero budget keeps reasoning_effort', () => {
    const body: Record<string, unknown> = { reasoning_effort: 'high' }
    injectLocalThinkingParams(body, [], 'normalTurn', cfg, 'llama.cpp')
    expect(body.reasoning_effort).toBe('high')
  })
})
