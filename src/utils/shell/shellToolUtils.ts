import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'
import { getPlatform } from '../platform.js'

export const SHELL_TOOL_NAMES: string[] = [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME]

/**
 * Resolve the PowerShell-tool env var with backward-compatible fallback.
 *
 *   explicit OPENCLAUDE_USE_POWERSHELL_TOOL
 *   else fall back to CLAUDE_CODE_USE_POWERSHELL_TOOL (legacy)
 */
export function getPowershellToolEnv(): string | undefined {
  return (
    process.env.OPENCLAUDE_USE_POWERSHELL_TOOL ??
    process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL
  )
}

/**
 * Runtime gate for PowerShellTool. Windows-only (the permission engine uses
 * Win32-specific path normalizations). Ant defaults on (opt-out via env=0);
 * external defaults off (opt-in via env=1).
 *
 * Used by tools.ts (tool-list visibility), processBashCommand (! routing),
 * and promptShellExecution (skill frontmatter routing) so the gate is
 * consistent across all paths that invoke PowerShellTool.call().
 */
export function isPowerShellToolEnabled(): boolean {
  if (getPlatform() !== 'windows') return false
  return process.env.USER_TYPE === 'ant'
    ? !isEnvDefinedFalsy(getPowershellToolEnv())
    : isEnvTruthy(getPowershellToolEnv())
}
