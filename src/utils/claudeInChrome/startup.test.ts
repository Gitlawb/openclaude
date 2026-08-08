import { describe, expect, test } from 'bun:test'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'
import {
  CLAUDE_IN_CHROME_SKILL_HINT,
  CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER,
} from './prompt.js'
import {
  mergeClaudeInChromeStartupConfig,
  resolveClaudeInChromeStartupMode,
} from './startup.js'

const existingMcpConfig: Record<string, ScopedMcpServerConfig> = {
  existing: {
    type: 'stdio',
    command: 'existing-command',
    args: [],
    scope: 'dynamic',
  },
}

const setupResult = {
  mcpConfig: {
    'claude-in-chrome': {
      type: 'stdio' as const,
      command: 'chrome-command',
      args: ['--chrome'],
      scope: 'dynamic' as const,
    },
  },
  allowedTools: ['mcp__claude-in-chrome__tabs_context_mcp'],
  systemPrompt: 'chrome system prompt',
}

describe('resolveClaudeInChromeStartupMode', () => {
  test('uses explicit Chrome startup only when subscriber access is available', () => {
    expect(
      resolveClaudeInChromeStartupMode({
        explicitEnabled: true,
        autoEnabled: false,
        hasClaudeInChromeAccess: true,
      }),
    ).toBe('explicit')

    expect(
      resolveClaudeInChromeStartupMode({
        explicitEnabled: true,
        autoEnabled: false,
        hasClaudeInChromeAccess: false,
      }),
    ).toBe('disabled')
  })

  test('uses auto Chrome startup only when subscriber access is available', () => {
    expect(
      resolveClaudeInChromeStartupMode({
        explicitEnabled: false,
        autoEnabled: true,
        hasClaudeInChromeAccess: true,
      }),
    ).toBe('auto')

    expect(
      resolveClaudeInChromeStartupMode({
        explicitEnabled: false,
        autoEnabled: true,
        hasClaudeInChromeAccess: false,
      }),
    ).toBe('disabled')
  })

  test('prefers explicit startup over auto startup', () => {
    expect(
      resolveClaudeInChromeStartupMode({
        explicitEnabled: true,
        autoEnabled: true,
        hasClaudeInChromeAccess: true,
      }),
    ).toBe('explicit')
  })
})

describe('mergeClaudeInChromeStartupConfig', () => {
  test('explicit startup merges MCP config, allowed tools, and prepends the Chrome system prompt', () => {
    const merged = mergeClaudeInChromeStartupConfig({
      mode: 'explicit',
      setupResult,
      dynamicMcpConfig: existingMcpConfig,
      appendSystemPrompt: 'existing prompt',
      hasWebBrowserTool: false,
    })

    expect(Object.keys(merged.dynamicMcpConfig)).toEqual([
      'existing',
      'claude-in-chrome',
    ])
    expect(merged.allowedTools).toEqual(setupResult.allowedTools)
    expect(merged.appendSystemPrompt).toBe(
      'chrome system prompt\n\nexisting prompt',
    )
  })

  test('auto startup merges MCP config and appends the Chrome skill hint only for subscribers', () => {
    const merged = mergeClaudeInChromeStartupConfig({
      mode: 'auto',
      setupResult,
      dynamicMcpConfig: existingMcpConfig,
      appendSystemPrompt: 'existing prompt',
      hasWebBrowserTool: false,
    })

    expect(Object.keys(merged.dynamicMcpConfig)).toEqual([
      'existing',
      'claude-in-chrome',
    ])
    expect(merged.allowedTools).toEqual([])
    expect(merged.appendSystemPrompt).toBe(
      `existing prompt\n\n${CLAUDE_IN_CHROME_SKILL_HINT}`,
    )
  })

  test('auto startup uses the WebBrowser-specific hint when that tool is available', () => {
    const merged = mergeClaudeInChromeStartupConfig({
      mode: 'auto',
      setupResult,
      dynamicMcpConfig: {},
      hasWebBrowserTool: true,
    })

    expect(merged.appendSystemPrompt).toBe(
      CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER,
    )
  })
})
