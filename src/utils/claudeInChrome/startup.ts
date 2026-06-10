import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'
import {
  CLAUDE_IN_CHROME_SKILL_HINT,
  CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER,
} from './prompt.js'
import type { setupClaudeInChrome } from './setup.js'

type ClaudeInChromeSetupResult = ReturnType<typeof setupClaudeInChrome>

export type ClaudeInChromeStartupMode = 'disabled' | 'explicit' | 'auto'

export function resolveClaudeInChromeStartupMode({
  explicitEnabled,
  autoEnabled,
  hasClaudeInChromeAccess,
}: {
  explicitEnabled: boolean
  autoEnabled: boolean
  hasClaudeInChromeAccess: boolean
}): ClaudeInChromeStartupMode {
  if (!hasClaudeInChromeAccess) {
    return 'disabled'
  }
  if (explicitEnabled) {
    return 'explicit'
  }
  if (autoEnabled) {
    return 'auto'
  }
  return 'disabled'
}

export function mergeClaudeInChromeStartupConfig({
  mode,
  setupResult,
  dynamicMcpConfig,
  appendSystemPrompt,
  hasWebBrowserTool,
}: {
  mode: Exclude<ClaudeInChromeStartupMode, 'disabled'>
  setupResult: ClaudeInChromeSetupResult
  dynamicMcpConfig: Record<string, ScopedMcpServerConfig>
  appendSystemPrompt?: string
  hasWebBrowserTool: boolean
}): {
  dynamicMcpConfig: Record<string, ScopedMcpServerConfig>
  allowedTools: string[]
  appendSystemPrompt?: string
} {
  const nextDynamicMcpConfig = {
    ...dynamicMcpConfig,
    ...setupResult.mcpConfig,
  }

  if (mode === 'explicit') {
    return {
      dynamicMcpConfig: nextDynamicMcpConfig,
      allowedTools: setupResult.allowedTools,
      appendSystemPrompt: appendSystemPrompt
        ? `${setupResult.systemPrompt}\n\n${appendSystemPrompt}`
        : setupResult.systemPrompt,
    }
  }

  const hint = hasWebBrowserTool
    ? CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER
    : CLAUDE_IN_CHROME_SKILL_HINT

  return {
    dynamicMcpConfig: nextDynamicMcpConfig,
    allowedTools: [],
    appendSystemPrompt: appendSystemPrompt
      ? `${appendSystemPrompt}\n\n${hint}`
      : hint,
  }
}
